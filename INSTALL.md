# Install BibiAI v2

The add-on stays on Home Assistant. Its new memory goes on your Samba Pi. The full address and share name still need to be filled in; “143 Pi” alone is not a complete address.

## 1. Prepare the Samba folder

If you already have a writable Samba share, create a dedicated `bibiai` folder inside it using your file manager.

If Samba is installed but no share is defined, this example creates one. Replace `YOUR_SAMBA_USER` with your actual account and preserve existing Samba configuration:

```sh
sudo install -d -m 0700 -o YOUR_SAMBA_USER -g YOUR_SAMBA_USER /srv/samba/bibiai
sudoedit /etc/samba/smb.conf
```

Append:

```ini
[bibiai]
    path = /srv/samba/bibiai
    browseable = yes
    read only = no
    guest ok = no
    valid users = YOUR_SAMBA_USER
    create mask = 0600
    directory mask = 0700
```

Set a Samba password with `sudo smbpasswd -a YOUR_SAMBA_USER` if needed. Run `sudo testparm`, then `sudo systemctl reload smbd`. These are example instructions; this package has not changed the Pi.

Modern SMB normally uses TCP **445**. Keep the standard port unless your server was configured differently. Do not append a port to the share name or guess a full IP from `.143`.

## 2. Mount the share in Home Assistant

Open **Settings → System → Storage → Add network storage**:

| Field | Value |
| --- | --- |
| Name | `bibiai` |
| Usage | **Share** |
| Server | Your Samba Pi's full IP address or hostname |
| Protocol | CIFS/SMB |
| Remote share | The actual share name, such as `bibiai` |
| Username/password | Your Samba credentials |

A Share mount named `bibiai` appears as `/share/bibiai`. If you mounted an existing share and created a folder inside it, use `/share/bibiai/<your-subfolder>` for BibiAI's memory path.

Keep **Require network mount** enabled. BibiAI checks for a mounted CIFS/NFS volume and pauses storage use when the NAS disappears. It will not create a local substitute folder. See Home Assistant's [network storage instructions](https://www.home-assistant.io/common-tasks/os/).

## 3. Install the fresh add-on

1. Extract `bibiai-v2-2.0.0.zip` on your computer.
2. Copy its `bibiai_v2` folder into Home Assistant's `/addons/`. The Dockerfile must end up at `/addons/bibiai_v2/Dockerfile`. From the source tree, copy `bibiai/` and rename the destination `bibiai_v2`.
3. Open the Add-on Store (called **Apps** in some current HA versions), refresh/check for updates, and find **BibiAI v2** under local add-ons.
4. Install it. The first build downloads container and Node packages. Supported targets are 64-bit ARM (`aarch64`) and `amd64`.
5. Enter credentials in the add-on's **Configuration** tab, then start it and choose **Open Web UI**.
6. With the NAS mounted, click **Initialize BibiAI folder** in **Control room**. This creates a new `bibiai-v2` subfolder on the selected mount.
7. Configure non-secret settings in the web UI. Saving reconnects Discord. Restart the add-on after changing credentials.

Stop the old bot before using the same Discord token here. This new add-on does not migrate the old memory. Existing v1 files remain outside this release.

Home Assistant's authenticated ingress provides administrator access to the dashboard. The separate Assist API uses port 8100, left unmapped by default. No router port forwarding is needed. Forwarded headers alone do not grant dashboard access; the application checks the actual ingress peer. See the [HA ingress guidance](https://developers.home-assistant.io/docs/apps/presentation/).

## 4. Credentials

| Configuration field | Purpose |
| --- | --- |
| `discord_token` | Discord bot login |
| `gemini_api_key` | Chat, summaries, media, optional speech input and appeal review |
| `rcon_password` | Optional Minecraft RCON |
| `pebble_token` | Optional PebbleHost panel power requests |
| `dashboard_key` | Optional direct/local dashboard access; at least 24 characters |
| `assist_key` | Optional Assist integration; a distinct random key of at least 24 characters |
| `home_token` | Usually blank in the add-on; Supervisor token is used. Only set for a separately configured HA endpoint. |
| `email_password` | Optional dedicated appeal mailbox password/app password |

Generate access keys with your password manager. The dashboard only shows whether credentials are configured. NAS credentials belong in HA's network storage settings. Choose a Gemini model available to your key under **Settings → Ai**; availability on your account has not been tested.

## 5. Discord and the privacy role

1. Enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal. See the [Discord gateway documentation](https://docs.discord.com/developers/events/gateway).
2. Invite with the `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Read Message History, Manage Roles, Moderate Members, and, as needed, Manage Messages, Connect, and Speak. An Administrator grant is unnecessary.
3. Create **No Bibi / Do not process**, a normal role with **no permission bits**, below the bot's highest role. Do not reuse an administrator or self-select role.
4. Enable Discord Developer Mode to copy IDs. In **Settings → Discord**, fill in the guild/server ID, allowed text channel IDs, privacy role ID, operator/admin role IDs, and optional report/snitch channel IDs.
5. Add cosmetic self-select/automatic role IDs if wanted. These must have no permission bits and be below the bot. Review channel-specific overwrites too; they can grant access even when a role has zero base permissions.
6. Enable Discord and save. The bot checks the privacy role and stored subjects before accepting activity, then registers commands in your server. Refresh the control room to check status.

The privacy role stops content features for that member and erases linked stored data, including derived notes. Members can use `/privacy optout` themselves. The `/privacy` commands remain available for managing this preference.

Removing the role alone does not resume processing. `/privacy optin` removes it if needed, erases remaining old data, and starts fresh. Opt-in needs the NAS online. During an outage, opt-out persists locally and stored erasure completes before records become usable on reconnect.

## 6. Other modules

- **Minecraft:** Enter host, game/RCON ports, optional mounted log path, and recovery settings. Enable RCON on the server. Test `/mc status`, then `/mc diagnostics` as an operator. A remote log path is not automatically mounted. Panel power needs the server identifier and token; an explicitly configured recovery webhook is also supported.
- **Join help:** Enter the address, version, Modrinth/CurseForge links, help channel, and pack-specific notes. The retained Origins Legacy Classes note is editable.
- **Moderation:** Review timeout settings and automatic snitch punishment. Defaults are five minutes for standard moderation and one–five minutes for snitch findings. Reports use rule signals and Gemini media summaries, not verified findings of fact. Operator roles are exempt.
- **Vacation:** Configure away/return text, rules, escalation, optional deletion, and daily report time. Times use UTC.
- **Voice:** Put your MP3 on a mounted path and set **Sholom file**. Enable its word trigger and/or random visits. Configure TTS roles for `/tts say`. Enable speech input separately for `/listen`, which captures only the requesting speaker for up to 15 seconds.
- **Appeals:** Configure the waiting period and optional dedicated IMAP/SMTP mailbox. SMTP 465 uses TLS; other SMTP ports require STARTTLS. IMAP requires TLS. Users verify their email with a mailed code and can reply to their case email. Automatic decisions default to off; grant/deny through the web appeal desk. Business days mean Monday–Friday in UTC, without a holiday calendar.

## 7. Home Assistant Assist (optional)

1. Copy `custom_components/bibiai_v2` into Home Assistant's `/config/custom_components/bibiai_v2`.
2. Set a random `assist_key` in the add-on configuration and restart the add-on.
3. Enable **Settings → Home** in the dashboard. Add the exact entity IDs it may read and named actions it may run. Example: name `Desk light on`, service `light.turn_on`, entity ID `light.desk`.
4. Restart HA, then open **Settings → Devices & services → Add integration → BibiAI v2**.
5. Enter the internal add-on URL and the same `assist_key`. A local install normally uses `http://local-bibiai-v2:8100`; confirm the actual hostname if this fails. Repository installs have a different prefix.
6. Select BibiAI v2 as your Assist pipeline's conversation agent. Keep using your existing HA speech-to-text/text-to-speech providers.

The API does not need a host port mapping for internal access. Home actions are available exclusively through Assist. Discord/general dashboard chat cannot run them. HA memory is separate from Discord memory. No printer integration or action list is provided.

## Troubleshooting and memory use

| Symptom | Check |
| --- | --- |
| NAS unavailable | Usage **Share**, credentials, actual share name/path; initialize a new volume once, then reconnect. |
| Discord not online | Intents, guild/privacy role IDs, role permissions/hierarchy, and API connectivity. |
| Bot ignores a member | Privacy role or saved opt-out; the member must explicitly opt in. |
| Commands absent | Guild ID, application command scope, allowed channel list, and bot status. |
| AI failure | API key, model availability, quota, and network access. |
| Voice failure | Connect/Speak permissions, feature toggles, file path, cooldown, and live voice compatibility. |
| Assist failure | Internal hostname, matching key of at least 24 characters, and Home enabled. |

There is no local LLM or vector database. The default budget is 16 MiB compressed records plus filesystem overhead, with 160 recent snippets and 800 notes. The container sets a 128 MiB V8 heap ceiling, **not** a total RAM limit. Discord, media buffers, FFmpeg and other processes add overhead. Leave unused voice/chime modules off for the lowest use.

Development requires Node 22.12 or newer: `npm ci`, `npm test`, `npm run build`, then `npm start`. For a disposable local preview, set `BIBI_DEMO=1` and a workspace `BIBI_DATA_DIR`; demo mode forces Discord off and simulates the NAS locally. Never enable demo mode in the installed add-on.
