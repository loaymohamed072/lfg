# LFG Website — Mac Handoff

Packaged 2026-07-01 to move from Windows to MacBook. Read this top to bottom once, then you are ready to work.

---

## 1. What this project is

The LFG Dubai website and bootcamp/run-club system. It is a **static HTML front end** plus **Vercel serverless functions** in `api/`. There is no build step and no framework. You edit `.html` files directly and they ship as-is.

- **Front end:** plain HTML/CSS/JS files at the repo root (`index.html`, `admin.html`, `account.html`, `bootcamp.html`, `shop.html`, `leaderboard.html`, etc.).
- **Back end:** `api/*.js` files, each one a Vercel serverless function (booking, checkout, check-in, leaderboard, admin tools, Stripe webhook, GHL sync).
- **Data + auth:** Supabase.
- **Payments:** Stripe.
- **CRM:** GoHighLevel (GHL) integration.
- **Video:** the live site streams video from Bunny CDN (`lfgdubai.b-cdn.net`), not from files in this repo.
- **Hosting:** Vercel (with a weekly cron that sends the run roster — see `vercel.json`).

---

## 2. What is IN this archive

Everything you need to run, edit, and deploy:

- All source: every `.html`, the whole `api/` folder, `scripts/`, `sql/`, `data/`.
- All config: `package.json`, `package-lock.json`, `vercel.json`, `.vercelignore`, `.gitignore`, `robots.txt`, `sitemap.xml`, `site.webmanifest`, `llms.txt`, `sw.js`.
- All web assets: favicons, logos, images, sponsor/tshirt art, `app-assets/`.
- **`.git/` — full commit history.** Your work continues with every past commit intact.
- **Brand/design assets:** `design/` (playbook + run-day artwork) and all favicons/logos.
- **Secrets:** `.env`, `.env.newprod`, and `admin login.txt` are included so the app runs immediately. See the security note in section 6.

**This is the SLIM archive.** Raw video masters and editing exports are left out (they're ~1 GB and the site streams video from Bunny CDN, not from these files). See section 3. If you ever need a specific master, it's still on the Windows machine and we move that one file over.

## 3. What is NOT in the archive (rebuild on Mac, on purpose)

These three are Windows-specific or reinstallable. Leaving them out avoids a broken state on macOS:

| Folder | Why it's excluded | How to restore on Mac |
|---|---|---|
| `node_modules/` | Contains a **Windows** build of `sharp` that won't run on macOS | `npm install` (see below) |
| `.tools/` | Holds `stripe.exe`, a **Windows** binary | Install the Mac Stripe CLI (see below) |
| `.vercel/` | Machine-linked Vercel project state | `vercel link` re-creates it |
| Raw video masters + `_deliverables/` | ~1 GB of editing files; live site serves video from Bunny CDN | Still on Windows; copy a single file over only if you need to re-edit it |

Excluded video/editing files: `new videos to check/`, `_deliverables/`, `TOBY MORNING RUN .mp4`, `First hero video.mov`, `First hero video_c.mp4`, `running video.mp4`, `video edit.mp4`, `restored_v1.png`, `restored_v2.png`. The site does not depend on any of them.

---

## 4. First-time Mac setup

```bash
# 1. Install Node.js 20+ if you don't have it (via nvm or the installer from nodejs.org)
node -v        # confirm 20 or newer

# 2. From inside the extracted lfg folder:
cd path/to/lfg
npm install    # rebuilds node_modules with the macOS sharp binary

# 3. (Optional) Stripe CLI for webhook testing — replaces the Windows stripe.exe
brew install stripe/stripe-cli/stripe
stripe login

# 4. (Optional) Vercel CLI, if you deploy from the terminal
npm i -g vercel
vercel link    # re-links this folder to the LFG Vercel project
```

---

## 5. Running it locally

The repo ships a custom dev server that serves the static site AND the `/api/*` functions together, mimicking Vercel:

```bash
npm run dev          # = node --env-file=.env scripts/dev-server.js
# then open http://localhost:8080
```

To test Stripe webhooks locally, in a second terminal:

```bash
stripe listen --forward-to localhost:8080/api/stripe-webhook
```

(The `stripe` script in `package.json` points at the old Windows `.exe`; on Mac use the `stripe` command directly as above.)

---

## 6. Secrets — keep this archive private

**The `.env`, `.env.newprod`, and `admin login.txt` files contain LIVE keys** (Stripe secret key, Supabase service key, GHL API key, admin password). They are inside this archive so the project works out of the box.

Because of that:
- **Do not share the Google Drive link publicly.** Anyone with the file has the live credentials.
- Do not commit these files to any new remote. `.gitignore` already blocks `.env*` and `admin login.txt`, so a normal `git push` is safe, but double-check before pushing to a new repo.
- The variable shape (no real values) is documented in `.env.example` if you ever need to regenerate.
- If this file ever leaks, rotate the Stripe, Supabase, and GHL keys.

---

## 7. Deployment

- Hosted on **Vercel**. Push to the connected branch or run `vercel --prod`.
- `vercel.json` defines caching headers, clean URLs, and a **cron** (`0 8 * * 6`, every Saturday 08:00) that calls `/api/admin/send-roster`.
- Set the same environment variables from `.env` in the **Vercel project settings** (Vercel does not read your local `.env` in production). They should already be set on the existing project; confirm after `vercel link`.
- `.vercelignore` keeps the heavy local media out of deploys since video is served from Bunny CDN.

---

## 8. Folder map

```
lfg/
├─ *.html                 # every page of the site (edit directly)
├─ api/                   # Vercel serverless functions
│  ├─ _lib.js _email.js _ghl.js   # shared helpers
│  ├─ admin/              # admin-only endpoints (roster, stats, credits, merch...)
│  └─ book, checkout, checkin, leaderboard, stripe-webhook, ...
├─ app-assets/            # front-end JS/CSS assets
├─ scripts/               # dev-server.js, icon gen, seed + QA/test scripts, legacy/
├─ sql/                   # database migrations
├─ data/                  # attendance/check-in spreadsheets
├─ design/                # design playbook + brand/run-day artwork
├─ docs/                  # owner's manual (HTML + PDF), email previews
├─ .git/                  # full history
├─ .env / .env.newprod    # LIVE secrets (private)
├─ admin login.txt        # admin credentials (private)
├─ vercel.json            # hosting config + cron
└─ package.json           # scripts + deps
```

---

## 9. Quick start (TL;DR)

```bash
cd lfg
npm install
npm run dev
# open http://localhost:8080
```

That's the whole loop. Everything you were working with on Windows is here except the reinstallable pieces in section 3.
