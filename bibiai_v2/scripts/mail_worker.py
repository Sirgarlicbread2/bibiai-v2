"""Bounded SMTP/IMAP helper. Credentials travel on stdin, never argv or logs."""
import email
import imaplib
import json
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.policy import default


def run(data):
    config = data['config']
    context = ssl.create_default_context()
    if data['action'] == 'send':
        message = EmailMessage()
        message['From'] = config['emailAddress']
        message['To'] = data['to']
        message['Subject'] = data['subject'][:200]
        message.set_content(data['text'][:6000])
        port = config['smtpPort']
        cls = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
        kwargs = {'timeout': 15}
        if port == 465:
            kwargs['context'] = context
        with cls(config['smtpHost'], port, **kwargs) as smtp:
            if port != 465:
                smtp.starttls(context=context)
            smtp.login(config['emailAddress'], data['password'])
            smtp.send_message(message)
        return {'sent': True}
    if data['action'] != 'poll':
        raise ValueError('Unsupported mail action')
    with imaplib.IMAP4_SSL(config['imapHost'], config['imapPort'], ssl_context=context, timeout=15) as inbox:
        inbox.login(config['emailAddress'], data['password'])
        inbox.select('INBOX', readonly=True)
        validity = str(inbox.response('UIDVALIDITY')[1][0], 'ascii')
        last = int(data.get('lastUid', 0)) if data.get('uidValidity') == validity else 0
        # Dedicated BibiAI inbox; only messages addressed to known random case tokens are read.
        status, raw = inbox.uid('search', None, f'UID {last + 1}:*', 'SUBJECT', 'BIBI-')
        if status != 'OK':
            raise RuntimeError('Mailbox search failed')
        ids = [int(value) for value in raw[0].split() if int(value) > last][:20]
        messages = []
        for uid in ids:
            last = max(last, uid)
            status, headers = inbox.uid('fetch', str(uid), '(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])')
            if status != 'OK':
                continue
            header = next((part[1] for part in headers if isinstance(part, tuple)), b'')
            if len(header) > 4096:
                continue
            metadata = email.message_from_bytes(header, policy=default)
            case = re.search(r'BIBI-([0-9a-f]{32})', str(metadata.get('Subject', ''))[:200])
            if not case or case.group(1) not in data.get('cases', []):
                continue
            status, sizes = inbox.uid('fetch', str(uid), '(RFC822.SIZE)')
            serialized = b' '.join(x for x in sizes if isinstance(x, bytes))
            match = re.search(rb'RFC822.SIZE (\d+)', serialized)
            if status != 'OK' or not match or int(match.group(1)) > 32768:
                continue
            status, chunks = inbox.uid('fetch', str(uid), '(BODY.PEEK[])')
            if status != 'OK':
                continue
            for chunk in chunks:
                if not isinstance(chunk, tuple):
                    continue
                msg = email.message_from_bytes(chunk[1], policy=default)
                subject = str(msg.get('Subject', ''))[:200]
                case = re.search(r'BIBI-([0-9a-f]{32})', subject)
                if not case or case.group(1) not in data.get('cases', []):
                    continue
                body = msg.get_body(preferencelist=('plain',))
                if body is None:
                    continue
                messages.append({'case': case.group(1), 'from': email.utils.parseaddr(str(msg.get('From', '')))[1].lower(), 'text': body.get_content()[:2000], 'uid': uid})
        return {'messages': messages, 'lastUid': last, 'uidValidity': validity}


if __name__ == '__main__':
    try:
        payload = sys.stdin.buffer.read(65537)
        if len(payload) > 65536:
            raise ValueError('Input too large')
        print(json.dumps(run(json.loads(payload))))
    except Exception:
        print(json.dumps({'error': 'Email connection or authentication failed.'}))
        sys.exit(1)
