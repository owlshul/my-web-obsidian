require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const { marked } = require('marked');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'obsidian-web-secret';
const MONGODB_URI = process.env.MONGODB_URI;

// ─── MongoDB Connection ───────────────────────────────────────────────────────
if (!MONGODB_URI) {
  console.warn('⚠️ MONGODB_URI is not set! The app will start but database operations will fail until it is set.');
} else {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err));
}

// ─── Mongoose Models ──────────────────────────────────────────────────────────
const noteSchema = new mongoose.Schema({
  path: { type: String, required: true, unique: true },
  content: { type: String, default: '' },
  title: { type: String },
  visibility: { type: String, default: 'private' },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now }
});

const folderSchema = new mongoose.Schema({
  path: { type: String, required: true, unique: true }
});

const Note = mongoose.model('Note', noteSchema);
const Folder = mongoose.model('Folder', folderSchema);

// Configure marked
marked.setOptions({ gfm: true, breaks: true });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/theme.css', express.static(path.join(__dirname, 'theme.css')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MONGODB_URI ? MongoStore.create({ mongoUrl: MONGODB_URI }) : undefined,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function buildTree(isAdmin) {
  const notes = await Note.find({}).lean();
  const folders = await Folder.find({}).lean();
  
  // Create a map to hold folders and roots
  const nodeMap = new Map();
  const rootItems = [];
  
  // Ensure implicit folders exist
  const allFolderPaths = new Set(folders.map(f => f.path));
  for (const n of notes) {
    const parts = n.path.split('/');
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i++) {
        allFolderPaths.add(parts.slice(0, i).join('/'));
      }
    }
  }

  // Create folder nodes
  const sortedFolderPaths = Array.from(allFolderPaths).sort((a, b) => a.split('/').length - b.split('/').length);
  for (const fpath of sortedFolderPaths) {
    const parts = fpath.split('/');
    const name = parts[parts.length - 1];
    const folderNode = { type: 'folder', name, path: fpath, children: [] };
    nodeMap.set(fpath, folderNode);
    
    if (parts.length === 1) {
      rootItems.push(folderNode);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = nodeMap.get(parentPath);
      if (parent) parent.children.push(folderNode);
      else rootItems.push(folderNode); // fallback
    }
  }

  // Add notes to the tree
  for (const n of notes) {
    if (!isAdmin && n.visibility !== 'public') continue;
    
    const parts = n.path.split('/');
    const name = parts[parts.length - 1].replace(/\.md$/, '');
    const noteNode = {
      type: 'note',
      name,
      path: n.path,
      title: n.title || name,
      visibility: n.visibility || 'private',
      created: n.created,
      updated: n.updated
    };
    
    if (parts.length === 1) {
      rootItems.push(noteNode);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = nodeMap.get(parentPath);
      if (parent) parent.children.push(noteNode);
      else rootItems.push(noteNode);
    }
  }

  // Filter out empty folders for visitors
  function pruneEmptyFolders(items) {
    const pruned = [];
    for (const item of items) {
      if (item.type === 'folder') {
        item.children = pruneEmptyFolders(item.children);
        if (isAdmin || item.children.length > 0) pruned.push(item);
      } else {
        pruned.push(item);
      }
    }
    return pruned.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return pruneEmptyFolders(rootItems);
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
app.get('/api/tree', async (req, res) => {
  try {
    const isAdmin = !!req.session.admin;
    const tree = await buildTree(isAdmin);
    res.json(tree);
  } catch (err) {
    console.error('Tree error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Note CRUD ────────────────────────────────────────────────────────────────
app.get('/api/note/*', async (req, res) => {
  try {
    const notePath = req.params[0];
    const np = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
    
    const note = await Note.findOne({ path: np });
    if (!note) return res.status(404).json({ error: 'Not found' });
    
    if (!req.session.admin && note.visibility !== 'public') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({
      path: note.path,
      content: note.content,
      title: note.title,
      visibility: note.visibility,
      created: note.created,
      updated: note.updated
    });
  } catch (err) {
    console.error('Get note error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/note', requireAdmin, async (req, res) => {
  try {
    let { path: notePath, title, content = '', visibility = 'private' } = req.body;
    const np = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
    
    const existing = await Note.findOne({ path: np });
    if (existing) return res.status(409).json({ error: 'Already exists' });
    
    await Note.create({
      path: np,
      content,
      title: title || np.replace('.md', '').split('/').pop(),
      visibility
    });
    
    res.json({ success: true, path: np });
  } catch (err) {
    console.error('Create note error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.put('/api/note/*', requireAdmin, async (req, res) => {
  try {
    const notePath = req.params[0];
    const np = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
    
    const note = await Note.findOne({ path: np });
    if (!note) return res.status(404).json({ error: 'Not found' });
    
    const { content, title, visibility } = req.body;
    if (content !== undefined) note.content = content;
    if (title !== undefined) note.title = title;
    if (visibility !== undefined) note.visibility = visibility;
    note.updated = new Date();
    
    await note.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Update note error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.delete('/api/note/*', requireAdmin, async (req, res) => {
  try {
    const notePath = req.params[0];
    const np = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
    
    const result = await Note.deleteOne({ path: np });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Delete note error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Folder Routes ────────────────────────────────────────────────────────────
app.post('/api/folder', requireAdmin, async (req, res) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Invalid path' });
    
    await Folder.findOneAndUpdate(
      { path: folderPath },
      { path: folderPath },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Create folder error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.delete('/api/folder/*', requireAdmin, async (req, res) => {
  try {
    const folderPath = req.params[0];
    const prefix = folderPath + '/';
    
    await Folder.deleteMany({
      $or: [
        { path: folderPath },
        { path: { $regex: '^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } }
      ]
    });
    
    await Note.deleteMany({
      path: { $regex: '^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Rename ───────────────────────────────────────────────────────────────────
app.post('/api/rename', requireAdmin, async (req, res) => {
  try {
    const { oldPath, newPath, type } = req.body;
    const isNote = type === 'note';
    const oldNp = isNote ? (oldPath.endsWith('.md') ? oldPath : `${oldPath}.md`) : oldPath;
    const newNp = isNote ? (newPath.endsWith('.md') ? newPath : `${newPath}.md`) : newPath;

    if (isNote) {
      const existing = await Note.findOne({ path: newNp });
      if (existing) return res.status(409).json({ error: 'Destination exists' });
      
      const note = await Note.findOne({ path: oldNp });
      if (!note) return res.status(404).json({ error: 'Not found' });
      
      note.path = newNp;
      await note.save();
    } else {
      // It's a folder, cascade rename
      const oldPrefix = oldNp + '/';
      const newPrefix = newNp + '/';
      const oldRegex = new RegExp('^' + oldPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      
      // Update Notes
      const notesToUpdate = await Note.find({ path: oldRegex });
      for (const note of notesToUpdate) {
        note.path = note.path.replace(oldRegex, newPrefix);
        await note.save();
      }
      
      // Update Folders
      const foldersToUpdate = await Folder.find({ path: oldRegex });
      for (const folder of foldersToUpdate) {
        folder.path = folder.path.replace(oldRegex, newPrefix);
        await folder.save();
      }
      
      // Rename the exact folder if it exists
      const exactFolder = await Folder.findOne({ path: oldNp });
      if (exactFolder) {
        exactFolder.path = newNp;
        await exactFolder.save();
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Rename error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
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
