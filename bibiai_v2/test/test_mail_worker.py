import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('mail_worker', Path(__file__).parents[1] / 'scripts' / 'mail_worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class MailWorkerTests(unittest.TestCase):
    def settings(self):
        return {'emailAddress': 'bibi@example.invalid', 'smtpHost': 'mail.example.invalid',
                'smtpPort': 587, 'imapHost': 'mail.example.invalid', 'imapPort': 993}

    def test_starttls_precedes_authentication(self):
        with patch.object(worker.smtplib, 'SMTP') as smtp:
            connection = smtp.return_value.__enter__.return_value
            result = worker.run({'action': 'send', 'config': self.settings(), 'password': 'test-only',
                                 'to': 'member@example.invalid', 'subject': 'Test', 'text': 'Test'})
            self.assertTrue(result['sent'])
            self.assertEqual([call[0] for call in connection.method_calls], ['starttls', 'login', 'send_message'])

    def test_ssl_port_never_uses_plain_smtp(self):
        config = self.settings(); config['smtpPort'] = 465
        with patch.object(worker.smtplib, 'SMTP_SSL') as tls, patch.object(worker.smtplib, 'SMTP') as plain:
            worker.run({'action': 'send', 'config': config, 'password': 'test-only',
                        'to': 'member@example.invalid', 'subject': 'Test', 'text': 'Test'})
            tls.assert_called_once()
            plain.assert_not_called()

    def test_unknown_or_erased_case_body_is_not_downloaded(self):
        with patch.object(worker.imaplib, 'IMAP4_SSL') as imap:
            inbox = imap.return_value.__enter__.return_value
            inbox.response.return_value = ('UIDVALIDITY', [b'123'])
            def uid(command, *args):
                if command == 'search':
                    return 'OK', [b'1']
                self.assertIn('HEADER.FIELDS', args[-1])
                return 'OK', [(b'header', b'Subject: BIBI-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\nFrom: member@example.invalid\r\n')]
            inbox.uid.side_effect = uid
            result = worker.run({'action': 'poll', 'config': self.settings(), 'password': 'test-only', 'cases': []})
            self.assertEqual(result['messages'], [])
            self.assertEqual(result['lastUid'], 1)


if __name__ == '__main__':
    unittest.main()
