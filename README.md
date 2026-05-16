# Personal Web Publishing System — Obsidian for Web 🌿

A self-hostable personal knowledge publishing platform that looks and feels like **Obsidian**.

## Features

- **Admin panel** at `/admin` — full markdown editor (CodeMirror 6)
- **Visitor view** at `/` — clean read-only wiki
- **Public / Private** visibility per note
- **Folder organization** with collapsible sidebar
- **Shareable URLs** like `/note/folder/note-name`
- **Obsidian-style callouts** (`> [!NOTE]`, `> [!WARNING]`, etc.)
- **Dark / Light theme** toggle
- **Search** in sidebar

---

## Running Locally

```bash
npm install
node server.js
```

Open:
- Visitor view: http://localhost:3000
- Admin: http://localhost:3000/admin (password: `admin123`)

---

## Configuration

Edit `.env`:

```env
ADMIN_PASSWORD=your-secure-password
SESSION_SECRET=a-random-long-string
PORT=3000
```

---

## Deployment

> ⚠️ **Netlify / Vercel will NOT work** — this is a persistent Node.js server with file-based storage.

### ✅ Recommended Platforms

| Platform | Free Tier | Persistent Storage | Notes |
|----------|-----------|-------------------|-------|
| **[Render](https://render.com)** | ✅ Yes | ✅ Persistent Disk | Best option — includes `render.yaml` |
| **[Railway](https://railway.app)** | ✅ $5 credit | ✅ Volumes | One-click GitHub deploy |
| **[Fly.io](https://fly.io)** | ✅ Yes | ✅ Volumes | Slightly more setup |
| **Self-hosted VPS** | Depends | ✅ Yes | Full control |

### Deploy to Render (easiest)

1. Push this project to a GitHub repo
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo — Render auto-detects `render.yaml`
4. Set `ADMIN_PASSWORD` in the Render dashboard
5. Click **Deploy** ✅

### Deploy to Railway

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → Deploy from GitHub
3. Add environment variables: `ADMIN_PASSWORD`, `SESSION_SECRET`
4. Add a **Volume** mounted at `/opt/railway` and set `NOTES_DIR=/opt/railway/notes` in env

---

## File Structure

```
├── server.js           # Express backend
├── notes/              # Markdown files
├── data/
│   └── metadata.json   # Note titles + visibility
└── public/
    ├── index.html      # Visitor SPA
    ├── admin.html      # Admin SPA
    ├── login.html      # Login page
    ├── css/
    │   ├── primary-web.css   # Primary Obsidian theme (web)
    │   └── app.css           # Layout & components
    └── js/
        ├── visitor.js  # Visitor logic
        ├── admin.js    # Admin logic
        └── editor.js   # CodeMirror 6 editor
```
