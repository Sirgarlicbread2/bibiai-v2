# Complete BibiAI v2 feature inventory

Implemented in source; external connections still require your configuration and live verification.

## Chat, personality and memory

- Gemini chat through mentions and `/ask`, with editable BibiAI/Honda Fit Republic persona and retained server lore.
- Image/video understanding for supported Discord attachments: up to three files, 3 MiB each, 6 MiB total. No retained media files.
- Bounded recent request/reply snippets and durable factual notes, deduplication, relevance retrieval, explicit note management, and expiration.
- Optional passive observation in allowed channels and compact fact extraction from small batches of consenting speakers' chat.
- Optional random AI chimes, probability/interval limits, idle-channel revives, and a separately enabled `@everyone` setting.
- Playful grudge count/level, short latest insult, reply cooldown, and linked-record deletion.
- `/join` and matching questions: server address, version, Modrinth/CurseForge import steps, custom notes, and help channel.

## Discord community tools

- One configured guild, allowed text channels, operator roles and current permission checks.
- `/roles menu`: approved cosmetic self-select roles; clearing the selection removes them.
- Automatic cosmetic join roles for eligible members.
- `/roles add` and `/roles remove`: staff role changes with permission and hierarchy checks.
- Mandatory no-consent role before enabling Discord; early content discard, durable hashed exclusions, linked/derived record erasure, pending command cancellation, and best-effort recent bot-output deletion.
- `/privacy optout`, `/privacy optin`, `/privacy status`, and owner forget/block controls in the UI.
- Spam tracking, custom blocked terms, rule/severity classification, repeat history, timeouts, operator exemptions, and moderation permission diagnostics.
- `/snitch`: target, explanation, evidence text/link and up to three supported files; compact metadata/media summaries, configurable automatic punishment, severity limits, and staff reports.
- Vacation mode: away/return messages, rules, stronger timeout escalation, optional offending-message deletion, check-in commands and daily reports.
- Appeals: submit/status/verify commands, weekday deadline, optional email verification and case replies, manual web decisions, optional Gemini decisions after the deadline, and timeout removal when granted.

## Minecraft

- TCP health and RCON queries for players, TPS, MSPT and version when supported.
- Operator diagnostics with an optional mounted log tail capped at 16 KiB / 80 lines.
- AI-assisted diagnosis and proposed fixes with real tool results supplied back to Gemini.
- Slash and web RCON interfaces sharing a fixed command allowlist; no chained/arbitrary console execution.
- Routine save, bounded announcements, selected time/weather changes, cycle gamerules, and whitelist reload; configurable automatic execution of AI-proposed routine commands.
- Operator-confirmed item/XP cleanup, kick, whitelist add/remove and difficulty changes. Stop is separately disabled by default and always needs confirmation when enabled.
- Optional PebbleHost panel start/recovery and configured recovery webhook.
- Periodic monitoring, online/offline events, one recovery attempt per outage after repeated failed checks, and weekly reports.

## Voice and Home Assistant

- Configurable MP3 word trigger and optional random visits to occupied eligible voice channels.
- Role-gated `/tts say` and `/tts leave`, local espeak-ng/FFmpeg playback, configurable voice/rate/pitch and cooldown.
- Optional explicit `/listen`: requesting user's stream only, up to 15 seconds / 3 MiB PCM, sent to Gemini. No saved recordings or passive transcription.
- Optional HA Assist conversation integration, with a separate API credential and existing Assist speech providers.
- Read only configured HA entity IDs; execute only named service/entity pairs from Assist.
- HA context separated from Discord context; HA actions unavailable to Discord/general dashboard chat.

## Web UI and runtime

- Control room with status on refresh, process RAM, storage budget/counts, credential-presence indicators, NAS initialize/reconnect and bot start/stop.
- Chat interface and confirmation controls for proposed Minecraft commands.
- Searchable, paginated note/recent-chat/grudge browser, subject-linked note entry, and deletion.
- Event and appeal desk with owner grant/deny decisions and reasons.
- Minecraft health, power requests and RCON console.
- Privacy explanation and owner forget/block tool.
- Functional forms for every non-secret setting, validation, editable HA actions, save/discard and reconnect behavior.
- Tiny gzip records on the NAS, serialized atomic replacement, metadata-only index, retention/count/byte pruning; no networked SQLite database.
- NAS failure pauses storage use with no local fallback. Local exclusions prevent opted-out data becoming available on reconnect.
- Home Assistant administrator ingress, distinct optional dashboard/Assist keys, secret redaction and request checks.
- Native HTTP server, plain HTML/CSS/JS, lazy Discord/voice libraries, bounded caches/queues/media and one active AI request.
- New add-on slug/storage, no v1 importer, no old data in the release.
- Dockerfile, aarch64/amd64 manifest, dependency lockfile, Assist custom integration, tests and setup documentation.

## Default storage limits

| Data | Default limit |
| --- | --- |
| Recent snippets | 160 records / 24 hours; request and reply each truncated to 500 characters |
| Durable notes | 800 records / 180 days; 500 characters each |
| Events | 1,000 records / 30 days |
| Grudges | 500 records / 180 days |
| Appeals | 200 records; at least event retention or enough days for the review interval |
| Bot reply references | 1,000 records / 30 days |
| Scheduling/mail state | 50 records |
| Compressed total | 16 MiB; filesystem overhead, temporary replacement files and local settings/exclusions are additional |
| Individual record | 32 KiB uncompressed |
| NAS write queue | Eight accepted jobs; overload returns busy |
| Privacy index | Up to 5,000 keyed hashes, local and independent of the NAS queue |

Count/size caps can expire old records early, including appeals in a volume exceeding its budget. This is intended for a small community, not an archive. Optional user-supplied MP3s remain at their configured path. The V8 heap ceiling is not a total process/container RAM guarantee.

## Privacy scope

Discord delivers gateway events to the bot process; BibiAI cannot ask Discord to withhold one member's events while retaining the same channel access. The author/role is checked before content features run. Explicit mentions, reply authors, report targets and memory provenance are linked for exclusion/erasure. Unknown membership is treated as unavailable. The `/privacy` preference commands remain usable after opting out.

An opt-out cannot retract an AI request already sent. The bot cannot reliably identify every named person in ordinary prose, screenshots, videos or copied text. Link member notes to their Discord ID and avoid submitting others' private content. Original Discord messages, other people's copies, mailbox history and NAS backups/snapshots are outside BibiAI's record erasure. Recent bot-owned outputs are deleted where references and permissions are available. Explicit opt-in starts fresh.

**Excluded:** all 3D printing/fabrication functionality. There is no printer connection, upload, command, queue, slicer, monitoring or print endpoint.
