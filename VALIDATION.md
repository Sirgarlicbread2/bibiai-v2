# Validation

## Completed locally

| Check | Result |
| --- | --- |
| TypeScript strict type check | Passed |
| Production build (`node --check` plus TypeScript compilation) | Passed |
| Node test suite | 46 tests passed across storage/privacy, Discord guards, HTTP API and voice lifecycle |
| Python mail helper tests | 3 tests passed: STARTTLS ordering, TLS-only port 465, and unknown-case headers without body download |
| Static privacy checks | Covered opted-out message/slash content access, no pre-erasure NAS read, linked memory erasure, persistent exclusions under queue pressure, evidence-link handling, Assist key isolation and no printer endpoint |
| Manual dashboard preview before final source changes | Login, settings save and layout checked using a disposable empty demo volume; no external services connected |
| Dependency reduction | Production uses direct Gemini REST calls and standard-library mail helper; no local model/vector database |

The empty Windows demo preview showed roughly 50.9 MiB process RSS with Discord and external modules disabled. That is a local development observation, not a Raspberry Pi benchmark or a total container memory guarantee.

## Still required on the real installation

- Create/mount the Samba share and initialize the fresh `bibiai-v2` folder.
- Build/install the add-on on the target Home Assistant architecture.
- Enter credentials and verify the selected Gemini model/API quota.
- Connect Discord and verify intents, command registration, role hierarchy, privacy role, channel permissions and real message events.
- Validate RCON/panel recovery against the actual Minecraft server before enabling automatic recovery.
- Test voice playback and explicit `/listen` in the server's actual Discord voice environment.
- Configure/test the optional mailbox and Home Assistant Assist integration with real credentials.
- Review role overwrites and moderation rules before enabling automatic role or timeout behavior.

No old instance, NAS, Discord server, Home Assistant installation, mailbox, Google account or Minecraft server was modified during this work. The package is not published or installed anywhere yet.
