# Publish this repository

This repository is already initialized on branch `main` and points to:

```text
https://github.com/Sirgarlicbread2/bibiai-v2.git
```

GitHub authentication is intentionally not stored in this project. In PowerShell, from this repository folder, sign in and create the repository if it does not exist:

```powershell
gh auth login
gh repo create Sirgarlicbread2/bibiai-v2 --public --source . --remote origin --push
```

If you already created `Sirgarlicbread2/bibiai-v2` on GitHub, use this instead:

```powershell
git push -u origin main
```

Then, in Home Assistant, go to **Settings → Apps → App Store → menu → Repositories**, add:

```text
https://github.com/Sirgarlicbread2/bibiai-v2
```

Refresh/check for updates and install **BibiAI v2**. Finish Samba/NAS and Discord setup with [INSTALL.md](INSTALL.md).
