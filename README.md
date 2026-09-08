# BibiAI v2

A fresh Home Assistant add-on with a web control room, compact NAS memory, Discord roles and privacy opt-out, Minecraft administration, voice, moderation, email appeals, and Home Assistant Assist.

**No 3D printer, fabrication, slicing, print queue, or print monitoring integration is included.**

## Install through Home Assistant

After this repository is pushed to GitHub, open **Settings → Apps → App Store**, select the top-right menu, choose **Repositories**, and add:

```text
https://github.com/Sirgarlicbread2/bibiai-v2
```

Refresh/check for updates, select **BibiAI v2**, and install it. This add-on appears directly because `repository.yaml` is in the repository root and `bibiai_v2/config.yaml` is directly beneath it.

Start with [INSTALL.md](INSTALL.md) for the NAS, Discord, and Assist setup. [FEATURES.md](FEATURES.md) has the full feature inventory, [VALIDATION.md](VALIDATION.md) has verification/deployment limits, and [SERVER-INTRO.md](SERVER-INTRO.md) is a Discord announcement you can copy and paste.

This is a new implementation with add-on slug `bibiai_v2`. It does not import v1 records, credentials, or settings. Old installations and data have not been remotely deleted. The release contains no previous bot data or credentials.

## Contents

- `bibiai_v2/`: add-on source, web UI, Dockerfile, configuration, dependency lockfile, and tests. Home Assistant discovers it automatically from this repository.
- `custom_components/bibiai_v2/`: optional Home Assistant conversation integration for Assist.
- Installation, feature, verification, and announcement documents.

It excludes development dependencies, compiled output, temporary data, and previous prototypes.

The application runs locally on Home Assistant; Gemini inference runs through Google's API. The default budget is 16 MiB of compressed records on the NAS. Local files contain configuration and a small hashed privacy exclusion index. This is not a total container RAM limit.

The repository is prepared locally with an `origin` remote. It needs a GitHub login and push before Home Assistant can install from the URL.
