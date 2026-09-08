# BibiAI v2 add-on

A fresh local Home Assistant add-on with a web UI, compact NAS memory, Discord roles/privacy exclusions, Minecraft, voice, moderation, appeals and Assist.

Install this folder as `/addons/bibiai_v2`; see the release's root `INSTALL.md`. Configure secrets in the HA add-on Configuration tab, mount Samba network storage with usage **Share**, then initialize the BibiAI folder through the web UI. Discord stays off until its server, allowed channels and privacy role are configured.

Default path: `/share/bibiai`. Default compressed record budget: 16 MiB. Keep the network mount check enabled. No old data is imported. No printer functionality is included.

Development requires Node 22.12 or newer:

```sh
npm ci
npm test
npm run build
npm start
```

The production container includes FFmpeg, espeak-ng and Python 3. Test the mail helper with `python -m unittest discover -s test -p "test_*.py"`.
