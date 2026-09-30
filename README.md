# Bliscord

Chat, voice, video and screen sharing with your friends. Made by Gxvn.

- Accounts, profiles (avatar, banner, bio, pronouns, custom status, name color)
- Servers with text and voice channels, invites, roles (owner / admin), kicks, ownership transfer
- Direct messages, friends, friend requests, blocking
- Voice channels and 1:1 calls with camera and screen sharing (up to 1440p60), per-user volume, speaking indicators
- Everything updates in realtime (messages, typing, presence, profiles, voice)
- Themes: Dark (default), Light, Midnight, Liquid Glass and Frost Glass, plus accent colors
- Windows app with installer, tray, notifications, taskbar badges and automatic updates

## How it fits together

```
Bliscord app (Electron)  ──►  Bliscord server (server/)  ◄──  Bliscord app (anyone, anywhere)
                                 accounts, messages, uploads
                                 realtime events + call signaling
Calls: app ◄──── WebRTC (direct, or through a TURN relay) ────► app
```

Everyone connects to **one server** that you host. Calls go directly between people when possible; a TURN relay handles strict networks (office Wi-Fi, some mobile carriers, some ISPs). With a relay, calls work between any two countries.

## Run it locally

```bash
npm install
cd server && npm install && cd ..
npm run server        # starts the server on http://localhost:3000
npm run dev           # opens the app with hot reload (in a second terminal)
```

Optional demo data (logins `nova` / `atlas`, password `bliscord-dev`):

```bash
node scripts/seed-dev.mjs
node scripts/smoke-test.mjs   # checks every realtime feature end to end
```

## Host it from your PC (free)

Double-click `start-server.cmd`. It runs the server plus a free Cloudflare tunnel (`tools/cloudflared.exe`, from https://github.com/cloudflare/cloudflared/releases). The tunnel address changes each time it starts, so `scripts/tunnel.mjs` publishes it to `server.json` on the `server-url` branch, and the app looks it up automatically (`discoveryUrl` in `app.config.json`). Bliscord is online while your PC is on and that window is open.

## Put the server online

Or use a host that stays up 24/7. Pick one. Each option stores data on a persistent disk so nothing is lost on redeploy.

**Fly.io** (cheap, pick a region near your users, e.g. `yyz` Toronto or `iad` Virginia)
```bash
fly launch --no-deploy
fly volumes create bliscord_data --size 3
fly deploy
```

**Render**: New → Blueprint → select this repo (uses `render.yaml`).

**Your own VPS**: `docker compose up -d` (includes a TURN relay, see `docker-compose.yml`).

Then open the app, click the globe icon on the login screen, and enter your server URL, e.g. `https://bliscord.fly.dev`. To make that the default for everyone, put it in `app.config.json`:

```json
{ "serverUrl": "https://bliscord.fly.dev" }
```

The server also serves a browser version of Bliscord at the same URL.

### TURN relay (for reliable calls everywhere)

Set one of these on the server:

| Option | Environment variables |
| --- | --- |
| Metered (free tier) | `METERED_DOMAIN`, `METERED_API_KEY` |
| Cloudflare Realtime TURN | `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` |
| Your own coturn | `TURN_URLS`, `TURN_SECRET` (or `TURN_USERNAME` + `TURN_CREDENTIAL`) |

`GET /api/health` reports `"turn": true` once a relay is configured.

### GIFs

GIF search uses [KLIPY](https://klipy.com/developers) (free, no usage caps). Create an API key there, then either set `KLIPY_API_KEY` on the server or paste the key into `server/data/klipy-key.txt`. The server picks up the file within 30 seconds; no restart needed. The key stays on the server and is never sent to the app.

## Build the installer

```bash
npm run icons   # regenerate icons (only if you change the design)
npm run dist    # creates release/Bliscord-Setup-<version>.exe
```

## Auto updates through GitHub

Installed copies check GitHub Releases on startup and every 30 minutes, download updates in the background, and show an **Update** button in the title bar.

One-time setup:
1. Create an empty repo named `Bliscord` at https://github.com/new (no README).
2. Push this folder:
   ```bash
   git remote add origin https://github.com/gxvnhxrrslol/Bliscord.git
   git push -u origin main
   ```
3. Optional: in the repo go to Settings → Secrets and variables → Actions → Variables and add `BLISCORD_SERVER_URL` with your server URL, so installers from GitHub connect to it automatically.

To release a version:
```bash
npm version patch          # 1.0.0 -> 1.0.1, commits and tags
git push --follow-tags     # GitHub Actions builds and publishes the installer
```

## Credits

Sounds from [Mixkit](https://mixkit.co) (Mixkit Sound Effects Free License): "Marimba ringtone", "Marimba waiting ringtone", "Message pop alert".
