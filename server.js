require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fs = require('fs-extra');
const path = require('path');
const { marked } = require('marked');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'obsidian-web-secret';

const NOTES_DIR = path.join(__dirname, 'notes');
const DATA_DIR = path.join(__dirname, 'data');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');

// Ensure directories and files exist
fs.ensureDirSync(NOTES_DIR);
fs.ensureDirSync(DATA_DIR);
if (!fs.existsSync(METADATA_FILE)) fs.writeJsonSync(METADATA_FILE, {});

// Configure marked
marked.setOptions({ gfm: true, breaks: true });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Serve the original theme.css from the root
app.use('/theme.css', express.static(path.join(__dirname, 'theme.css')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getMetadata() {
  return fs.readJsonSync(METADATA_FILE, { throws: false }) || {};
}

function saveMetadata(meta) {
  fs.writeJsonSync(METADATA_FILE, meta, { spaces: 2 });
}

function buildTree(dir, basePath, isAdmin) {
  const meta = getMetadata();
  const items = [];
  if (!fs.existsSync(dir)) return items;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      const children = buildTree(path.join(dir, entry.name), rel, isAdmin);
      if (isAdmin || children.length > 0) {
        items.push({ type: 'folder', name: entry.name, path: rel, children });
      }
    } else if (entry.name.endsWith('.md')) {
      const m = meta[rel] || {};
      if (!isAdmin && m.visibility !== 'public') continue;
      items.push({
        type: 'note',
        name: entry.name.replace('.md', ''),
        path: rel,
        title: m.title || entry.name.replace('.md', ''),
        visibility: m.visibility || 'private',
        created: m.created,
        updated: m.updated
      });
    }
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth', (req, res) => {
  res.json({ admin: !!req.session.admin });
});

// ─── File Tree ────────────────────────────────────────────────────────────────
app.get('/api/tree', (req, res) => {
  const isAdmin = !!req.session.admin;
  res.json(buildTree(NOTES_DIR, '', isAdmin));
});

// ─── Note CRUD ────────────────────────────────────────────────────────────────
app.get('/api/note/*', (req, res) => {
  const notePath = req.params[0];
  const np = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
  const filePath = path.join(NOTES_DIR, np);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

  const meta = getMetadata();
  const m = meta[np] || {};
  if (!req.session.admin && m.visibility !== 'public') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  res.json({
    path: np, content,
    title: m.title || np.replace('.md', '').split('/').pop(),
    visibility: m.visibility || 'private',
    created: m.created, updated: m.updated
  });
});

app.post('/api/note', requireAdmin, (req, res) => {
  let { path: notePath, title, content = '', visibility = 'private' } = req.body;
  const np = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
  const filePath = path.join(NOTES_DIR, np);

  // Security: prevent path traversal
  if (!filePath.startsWith(NOTES_DIR)) return res.status(400).json({ error: 'Invalid path' });
  if (fs.existsSync(filePath)) return res.status(409).json({ error: 'Already exists' });

  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content);

  const meta = getMetadata();
  meta[np] = {
    title: title || np.replace('.md', '').split('/').pop(),
    visibility, created: new Date().toISOString(), updated: new Date().toISOString()
  };
  saveMetadata(meta);
  res.json({ success: true, path: np });
});

app.put('/api/note/*', requireAdmin, (req, res) => {
  const notePath = req.params[0];
  const np = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
  const filePath = path.join(NOTES_DIR, np);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

  const { content, title, visibility } = req.body;
  if (content !== undefined) fs.writeFileSync(filePath, content);

  const meta = getMetadata();
  if (!meta[np]) meta[np] = { created: new Date().toISOString() };
  if (title !== undefined) meta[np].title = title;
  if (visibility !== undefined) meta[np].visibility = visibility;
  meta[np].updated = new Date().toISOString();
  saveMetadata(meta);
  res.json({ success: true });
});

app.delete('/api/note/*', requireAdmin, (req, res) => {
  const notePath = req.params[0];
  const np = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
  const filePath = path.join(NOTES_DIR, np);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.removeSync(filePath);

  const meta = getMetadata();
  delete meta[np];
  saveMetadata(meta);
  res.json({ success: true });
});

// ─── Folder Routes ────────────────────────────────────────────────────────────
app.post('/api/folder', requireAdmin, (req, res) => {
  const { path: folderPath } = req.body;
  const dirPath = path.join(NOTES_DIR, folderPath);
  if (!dirPath.startsWith(NOTES_DIR)) return res.status(400).json({ error: 'Invalid path' });
  fs.ensureDirSync(dirPath);
  res.json({ success: true });
});

app.delete('/api/folder/*', requireAdmin, (req, res) => {
  const folderPath = req.params[0];
  const dirPath = path.join(NOTES_DIR, folderPath);
  if (!dirPath.startsWith(NOTES_DIR)) return res.status(400).json({ error: 'Invalid path' });
  if (!fs.existsSync(dirPath)) return res.status(404).json({ error: 'Not found' });

  // Clean up metadata for all notes in this folder
  const meta = getMetadata();
  const prefix = folderPath + '/';
  Object.keys(meta).forEach(k => { if (k.startsWith(prefix) || k === folderPath) delete meta[k]; });
  saveMetadata(meta);
  fs.removeSync(dirPath);
  res.json({ success: true });
});

// ─── Rename ───────────────────────────────────────────────────────────────────
app.post('/api/rename', requireAdmin, (req, res) => {
  const { oldPath, newPath, type } = req.body;
  const isNote = type === 'note';
  const oldNp = isNote ? (oldPath.endsWith('.md') ? oldPath : `${oldPath}.md`) : oldPath;
  const newNp = isNote ? (newPath.endsWith('.md') ? newPath : `${newPath}.md`) : newPath;

  const oldFull = path.join(NOTES_DIR, oldNp);
  const newFull = path.join(NOTES_DIR, newNp);

  if (!fs.existsSync(oldFull)) return res.status(404).json({ error: 'Not found' });
  if (fs.existsSync(newFull)) return res.status(409).json({ error: 'Destination exists' });

  fs.ensureDirSync(path.dirname(newFull));
  fs.moveSync(oldFull, newFull);

  if (isNote) {
    const meta = getMetadata();
    if (meta[oldNp]) { meta[newNp] = meta[oldNp]; delete meta[oldNp]; }
    saveMetadata(meta);
  } else {
    // Move all metadata keys for folder
    const meta = getMetadata();
    const oldPrefix = oldNp + '/';
    const newPrefix = newNp + '/';
    Object.keys(meta).forEach(k => {
      if (k.startsWith(oldPrefix)) {
        meta[k.replace(oldPrefix, newPrefix)] = meta[k];
        delete meta[k];
      }
    });
    saveMetadata(meta);
  }
  res.json({ success: true });
});

// ─── Markdown render ─────────────────────────────────────────────────────────
app.post('/api/render', (req, res) => {
  const { content } = req.body;
  res.json({ html: marked(content || '') });
});

// ─── SPA Fallback Routes ──────────────────────────────────────────────────────
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/note/*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌿 Obsidian-for-Web`);
  console.log(`   Visitor: http://localhost:${PORT}`);
  console.log(`   Admin:   http://localhost:${PORT}/admin`);
  console.log(`   Password: ${ADMIN_PASSWORD}\n`);
});
