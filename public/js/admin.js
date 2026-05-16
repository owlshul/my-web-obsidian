/* ─────────────────────────────────────────────────────────────────────────────
   admin.js — Admin dashboard logic (ES module)
───────────────────────────────────────────────────────────────────────────── */

import { createEditor, applyToolbarAction, getContent, setContent, EditorView } from './editor.js';

// ─── State ───────────────────────────────────────────────────────────────────
let tree = [];
let currentNote = null;   // { path, title, visibility, content }
let editorView = null;
let isDirty = false;
let saveTimeout = null;
let isDark = localStorage.getItem('theme') !== 'light';

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Auth check
  const auth = await fetch('/api/auth').then(r => r.json());
  if (window.lucide) window.lucide.createIcons();
  
  // Collapse sidebars on mobile by default
  if (window.innerWidth <= 640) {
    document.getElementById('sidebar')?.classList.add('collapsed');
    document.getElementById('outlinePane')?.classList.add('collapsed');
  }

  applyTheme();
  initModals();
  initEditor();
  
  // Preview Toggle setup
  document.getElementById('previewToggleBtn')?.addEventListener('click', e => {
    isPreviewMode = !isPreviewMode;
    const btn = e.currentTarget;
    const cmWrap = document.getElementById('editorCmWrap');
    const prevWrap = document.getElementById('previewWrap');
    
    if (isPreviewMode) {
      btn.innerHTML = '<i data-lucide="edit-2" style="width:14px;height:14px;"></i> Edit';
      cmWrap.style.display = 'none';
      prevWrap.style.display = 'block';
      
      const md = editorView.state.doc.toString();
      if (typeof marked !== 'undefined') {
        let processed = md.replace(
          /^> \[!(\w+)\](.*)\n((?:>.*\n?)*)/gm,
          (_, type, title, content) => {
            const t = type.toLowerCase();
            const tl = title.trim() || (t.charAt(0).toUpperCase() + t.slice(1));
            const body = content.replace(/^> ?/gm, '').trim();
            return `<div class="callout callout-${t}"><div class="callout-title">${esc(tl)}</div><div class="callout-content">${body}</div></div>\n`;
          }
        );
        prevWrap.innerHTML = marked.parse(processed, { gfm: true, breaks: true });
      } else {
        prevWrap.innerHTML = '<p>Marked.js not loaded.</p>';
      }
      updateOutlineFromDOM(prevWrap);
    } else {
      btn.innerHTML = '<i data-lucide="eye" style="width:14px;height:14px;"></i> Preview';
      cmWrap.style.display = 'block';
      prevWrap.style.display = 'none';
      updateOutline(editorView.state.doc.toString());
    }
    if (window.lucide) window.lucide.createIcons();
  });
  await loadTree();
  bindUI();
});

// ─── Theme ───────────────────────────────────────────────────────────────────
function applyTheme() {
  document.body.classList.toggle('theme-dark', isDark);
  document.body.classList.toggle('theme-light', !isDark);
  const btn = document.getElementById('toggleTheme');
  if (btn) {
    btn.innerHTML = `<i data-lucide="${isDark ? 'moon' : 'sun'}"></i>`;
    if (window.lucide) window.lucide.createIcons({ root: btn });
  }
}

// ─── Tree ────────────────────────────────────────────────────────────────────
async function loadTree() {
  const res = await fetch('/api/tree');
  tree = await res.json();
  renderTree();
}

function renderTree() {
  const ft = document.getElementById('fileTree');
  const q = document.getElementById('searchInput').value.toLowerCase();
  const nodes = q ? filterNodes(tree, q) : tree;

  if (!nodes.length) {
    ft.innerHTML = '<div class="tree-empty"><div style="display:flex;justify-content:center;margin-bottom:.5rem;color:var(--text-faint)"><i data-lucide="file-plus-2" style="width:32px;height:32px;"></i></div>No notes yet.<br>Click new note to create one.</div>';
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  ft.innerHTML = '';
  nodes.forEach(n => ft.appendChild(buildNode(n)));
  if (window.lucide) window.lucide.createIcons({ root: ft });
}

// ─── Drag and Drop Handling ────────────────────────────────────────────────
async function handleDropMove(data, targetFolder) {
  const { type, path: oldPath } = data;
  if (type === 'folder' && (targetFolder === oldPath || targetFolder.startsWith(oldPath + '/'))) return;
  const oldName = oldPath.split('/').pop();
  const newPath = targetFolder ? `${targetFolder}/${oldName}` : oldName;
  if (oldPath === newPath) return;

  try {
    const res = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath, type })
    });
    const msg = await res.json();
    if (!res.ok) throw new Error(msg.error || 'Failed to move');
    
    showToast('Moved successfully', 'success');
    loadTree();
    
    if (type === 'note' && currentNote && currentNote.path === (oldPath.endsWith('.md') ? oldPath : oldPath + '.md')) {
      const newNp = newPath.endsWith('.md') ? newPath : newPath + '.md';
      currentNote.path = newNp;
      document.getElementById('noteTitleInput').dataset.originalPath = newNp;
    }
  } catch (err) {
    showToast(err.message || 'Failed to move', 'error');
  }
}

// Setup root tree drop zone
document.addEventListener('DOMContentLoaded', () => {
  const ft = document.getElementById('fileTree');
  if (!ft) return;
  ft.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    ft.classList.add('drag-over');
  });
  ft.addEventListener('dragleave', e => ft.classList.remove('drag-over'));
  ft.addEventListener('drop', async e => {
    e.preventDefault();
    ft.classList.remove('drag-over');
    if (e.target.closest('.tree-folder-header')) return; // handled by folder
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      handleDropMove(data, ''); // empty target folder = root
    } catch(err) {}
  });
});

function buildNode(node) {
  return node.type === 'folder' ? buildFolder(node) : buildNoteItem(node);
}

function buildFolder(folder) {
  const el = document.createElement('div');
  el.className = 'tree-folder';
  el.dataset.path = folder.path;
  el.dataset.type = 'folder';

  const header = document.createElement('div');
  header.className = 'tree-folder-header';
  header.innerHTML = `
    <span class="folder-chevron open"><i data-lucide="chevron-right" style="width:12px;height:12px;"></i></span>
    <span class="folder-icon"><i data-lucide="folder" style="width:14px;height:14px;"></i></span>
    <span class="folder-name">${esc(folder.name)}</span>
    <div class="tree-item-actions">
      <button class="btn-icon" data-action="newNote" data-folder="${esc(folder.path)}" title="New note here" style="font-size:.75rem"><i data-lucide="file-plus"></i></button>
    </div>
  `;

  const children = document.createElement('div');
  children.className = 'tree-folder-children';
  (folder.children || []).forEach(c => children.appendChild(buildNode(c)));

  header.querySelector('[data-action="newNote"]').addEventListener('click', e => {
    e.stopPropagation();
    showNewNoteModal(folder.path);
  });

  header.addEventListener('click', e => {
    if (e.target.closest('[data-action]')) return;
    const ch = header.querySelector('.folder-chevron');
    const open = ch.classList.toggle('open');
    children.style.display = open ? '' : 'none';
    const iconSpan = header.querySelector('.folder-icon');
    iconSpan.innerHTML = `<i data-lucide="${open ? 'folder-open' : 'folder'}" style="width:14px;height:14px;"></i>`;
    if (window.lucide) window.lucide.createIcons({ root: iconSpan });
  });

  header.addEventListener('contextmenu', e => {
    e.preventDefault();
    showCtxMenu(e, 'folder', folder.path, folder.name);
  });

  // Drag and drop for folders
  header.draggable = true;
  header.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'folder', path: folder.path }));
    e.dataTransfer.effectAllowed = 'move';
    header.style.opacity = '0.5';
  });
  header.addEventListener('dragend', () => header.style.opacity = '1');
  
  header.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    header.classList.add('drag-over');
  });
  header.addEventListener('dragleave', () => header.classList.remove('drag-over'));
  header.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation(); // prevent root from firing
    header.classList.remove('drag-over');
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      handleDropMove(data, folder.path);
    } catch(err) {}
  });

  el.appendChild(header);
  el.appendChild(children);
  return el;
}

function buildNoteItem(note) {
  const el = document.createElement('div');
  el.className = 'tree-note';
  el.dataset.path = note.path;
  el.dataset.type = 'note';
  if (currentNote?.path === note.path) el.classList.add('active');

  el.innerHTML = `
    <span class="note-icon"><i data-lucide="file-text" style="width:14px;height:14px;"></i></span>
    <span class="note-title">${esc(note.title || note.name)}</span>
    <span class="note-visibility ${note.visibility}" title="${note.visibility === 'public' ? 'Public' : 'Private'}">
      <i data-lucide="${note.visibility === 'public' ? 'globe' : 'lock'}" style="width:12px;height:12px;"></i>
    </span>
    <div class="tree-item-actions">
      <button class="btn-icon" data-action="delete" title="Delete" style="font-size:.7rem;color:var(--primary-red)"><i data-lucide="trash-2"></i></button>
    </div>
  `;

  el.addEventListener('click', e => {
    if (e.target.closest('[data-action]')) return;
    openNote(note.path);
  });

  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    showCtxMenu(e, 'note', note.path, note.title || note.name, note.visibility);
  });

  el.querySelector('[data-action="delete"]').addEventListener('click', e => {
    e.stopPropagation();
    confirmDelete('note', note.path, note.title || note.name);
  });

  // Drag and drop for notes
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'note', path: note.path }));
    e.dataTransfer.effectAllowed = 'move';
    el.style.opacity = '0.5';
  });
  el.addEventListener('dragend', () => el.style.opacity = '1');

  return el;
}

// ─── Open Note ───────────────────────────────────────────────────────────────
async function openNote(notePath) {
  if (isDirty) {
    const ok = confirm('You have unsaved changes. Discard them?');
    if (!ok) return;
  }

  const np = notePath.endsWith('.md') ? notePath : notePath + '.md';

  // Mark active
  document.querySelectorAll('.tree-note').forEach(el => {
    el.classList.toggle('active', el.dataset.path === np);
  });

  try {
    const res = await fetch('/api/note/' + np);
    if (!res.ok) throw new Error('Failed to load');
    const note = await res.json();

    currentNote = note;
    isDirty = false;

    showEditor();
    document.getElementById('noteTitleInput').value = note.title || '';
    updateVisibilityUI(note.visibility);
    document.getElementById('saveStatus').textContent = 'All saved';
    document.getElementById('saveStatus').className = 'save-status';

    // Init or reset editor
    const wrap = document.getElementById('editorCmWrap');
    if (editorView) {
      setContent(editorView, note.content);
    } else {
      editorView = createEditor(wrap, note.content, handleEditorEvent);
    }
    
    updateOutline(note.content);
  } catch (err) {
    toast('Failed to open note', 'error');
  }
}

function handleEditorEvent(type) {
  if (type === 'save') { saveNote(); return; }
  if (type === 'change') {
    isDirty = true;
    document.getElementById('saveStatus').textContent = 'Unsaved changes';
    document.getElementById('saveStatus').className = 'save-status';
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveNote(), 3000); // auto-save after 3s
    
    updateOutline(getContent(editorView));
  }
}

function showEditor() {
  document.getElementById('welcomePane').style.display = 'none';
  document.getElementById('editorPane').style.display = 'flex';
}

function showWelcome() {
  document.getElementById('welcomePane').style.display = '';
  document.getElementById('editorPane').style.display = 'none';
  currentNote = null;
  isDirty = false;
  const outlinePane = document.getElementById('outlinePane');
  if (outlinePane) outlinePane.classList.add('hidden');
  document.getElementById('previewWrap').style.display = 'none';
  document.getElementById('editorCmWrap').style.display = 'block';
  isPreviewMode = false;
  const btn = document.getElementById('previewToggleBtn');
  if (btn) btn.innerHTML = '<i data-lucide="eye" style="width:14px;height:14px;"></i> Preview';
  if (window.lucide) window.lucide.createIcons();
}

let isPreviewMode = false;

// ─── Outline ──────────────────────────────────────────────────────────────────
function updateOutline(md) {
  const outlinePane = document.getElementById('outlinePane');
  const outlineList = document.getElementById('outlineList');
  if (!outlinePane || !outlineList) return;

  const headings = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(md)) !== null) {
    const cleanText = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_~`]/g, '');
    headings.push({ level: match[1].length, text: cleanText, line: md.substring(0, match.index).split('\n').length });
  }

  if (headings.length === 0) {
    outlinePane.classList.add('hidden');
    return;
  }

  outlinePane.classList.remove('hidden');
  outlineList.innerHTML = '';
  headings.forEach(h => {
    const li = document.createElement('li');
    li.className = 'outline-item';
    const a = document.createElement('a');
    a.className = `outline-link outline-level-${h.level}`;
    a.href = '#';
    a.textContent = h.text;
    a.addEventListener('click', e => {
      e.preventDefault();
      // Scroll CodeMirror to line
      if (editorView) {
        const lineInfo = editorView.state.doc.line(h.line);
        editorView.dispatch({ effects: EditorView.scrollIntoView(lineInfo.from, { y: 'start' }) });
      }
    });
    li.appendChild(a);
    outlineList.appendChild(li);
  });
}

function updateOutlineFromDOM(container) {
  const outlinePane = document.getElementById('outlinePane');
  const outlineList = document.getElementById('outlineList');
  if (!outlinePane || !outlineList) return;

  const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'));

  if (headings.length === 0) {
    outlinePane.classList.add('hidden');
    return;
  }

  outlinePane.classList.remove('hidden');
  outlineList.innerHTML = '';
  headings.forEach(h => {
    const level = parseInt(h.tagName.substring(1));
    const li = document.createElement('li');
    li.className = 'outline-item';
    const a = document.createElement('a');
    a.className = `outline-link outline-level-${level}`;
    a.href = `#${h.id}`;
    a.textContent = h.textContent;
    
    a.addEventListener('click', e => {
      e.preventDefault();
      h.scrollIntoView({ behavior: 'smooth' });
      document.querySelectorAll('.outline-link').forEach(l => l.classList.remove('active'));
      a.classList.add('active');
    });

    li.appendChild(a);
    outlineList.appendChild(li);
  });
}

// ─── Save ─────────────────────────────────────────────────────────────────────
async function saveNote() {
  if (!currentNote) return;
  clearTimeout(saveTimeout);

  const status = document.getElementById('saveStatus');
  status.textContent = 'Saving…';
  status.className = 'save-status saving';

  const content  = getContent(editorView);
  const title    = document.getElementById('noteTitleInput').value.trim() || currentNote.path.replace(/\.md$/, '').split('/').pop();
  const visibility = currentNote.visibility;

  try {
    const res = await fetch('/api/note/' + currentNote.path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, title, visibility }),
    });
    if (!res.ok) throw new Error();

    currentNote.content  = content;
    currentNote.title    = title;
    isDirty = false;
    status.textContent = '✓ Saved';
    status.className = 'save-status saved';

    // Refresh tree label
    await loadTree();
    setTimeout(() => {
      if (!isDirty) { status.textContent = 'All saved'; status.className = 'save-status'; }
    }, 2000);
  } catch {
    status.textContent = '⚠ Save failed';
    toast('Failed to save note', 'error');
  }
}

// ─── Visibility ───────────────────────────────────────────────────────────────
function updateVisibilityUI(vis) {
  const btn = document.getElementById('visibilityToggle');
  const icon = document.getElementById('visIcon');
  const label = document.getElementById('visLabel');
  if (vis === 'public') {
    btn.className = 'visibility-toggle public';
    icon.innerHTML = '<i data-lucide="globe" style="width:14px;height:14px;"></i>';
    label.textContent = 'Public';
  } else {
    btn.className = 'visibility-toggle private';
    icon.innerHTML = '<i data-lucide="lock" style="width:14px;height:14px;"></i>';
    label.textContent = 'Private';
  }
  if (window.lucide) window.lucide.createIcons({ root: icon });
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function showCtxMenu(e, type, itemPath, name, visibility) {
  closeCtxMenu();
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = '';

  if (type === 'note') {
    menu.appendChild(ctxItem('edit-2', 'Rename', () => showRenameModal(type, itemPath, name)));
    menu.appendChild(ctxItem(visibility === 'public' ? 'lock' : 'globe',
      visibility === 'public' ? 'Make Private' : 'Make Public',
      () => toggleVisibility(itemPath, visibility)));
    const sep = document.createElement('hr');
    sep.className = 'ctx-sep';
    menu.appendChild(sep);
    menu.appendChild(ctxItem('trash-2', 'Delete', () => confirmDelete(type, itemPath, name), true));
  } else {
    menu.appendChild(ctxItem('file-plus', 'New Note Here', () => showNewNoteModal(itemPath)));
    menu.appendChild(ctxItem('edit-2', 'Rename', () => showRenameModal(type, itemPath, name)));
    const sep = document.createElement('hr');
    sep.className = 'ctx-sep';
    menu.appendChild(sep);
    menu.appendChild(ctxItem('trash-2', 'Delete Folder', () => confirmDelete(type, itemPath, name), true));
  }

  menu.style.display = '';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10) + 'px';

  setTimeout(() => document.addEventListener('click', closeCtxMenu, { once: true }), 0);
  if (window.lucide) window.lucide.createIcons({ root: menu });
}

function ctxItem(icon, label, action, danger = false) {
  const el = document.createElement('div');
  el.className = 'ctx-item' + (danger ? ' danger' : '');
  el.innerHTML = `<span><i data-lucide="${icon}" style="width:14px;height:14px;"></i></span><span>${esc(label)}</span>`;
  el.addEventListener('click', () => { closeCtxMenu(); action(); });
  return el;
}

function closeCtxMenu() {
  document.getElementById('ctxMenu').style.display = 'none';
}

// ─── Visibility Toggle ────────────────────────────────────────────────────────
async function toggleVisibility(notePath, currentVis) {
  const newVis = currentVis === 'public' ? 'private' : 'public';
  await fetch('/api/note/' + notePath, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility: newVis }),
  });
  if (currentNote?.path === notePath) {
    currentNote.visibility = newVis;
    updateVisibilityUI(newVis);
  }
  await loadTree();
  toast(`Note is now ${newVis}`, 'success');
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function showModal(title, bodyHTML, confirmText, onConfirm) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  document.getElementById('modalConfirm').textContent = confirmText;
  document.getElementById('modalOverlay').style.display = '';

  const confirmBtn = document.getElementById('modalConfirm');
  const newConfirm = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  newConfirm.addEventListener('click', () => {
    document.getElementById('modalOverlay').style.display = 'none';
    onConfirm();
  });
}

function showNewNoteModal(inFolder = '') {
  showModal('New Note',
    `<div class="form-group">
      <label>Folder</label>
      <input type="text" id="mFolder" value="${esc(inFolder)}" placeholder="folder (optional)">
    </div>
    <div class="form-group">
      <label>Note name</label>
      <input type="text" id="mName" placeholder="my-note" autofocus>
    </div>
    <div class="form-group">
      <label>Visibility</label>
      <select id="mVis" style="width:100%;padding:.45rem .6rem;background:var(--bg-2);color:var(--tx-0);border:1px solid var(--border);border-radius:var(--radius-sm);font-family:var(--font-ui)">
        <option value="private">🔒 Private</option>
        <option value="public">🌐 Public</option>
      </select>
    </div>`,
    'Create',
    async () => {
      const folder = document.getElementById('mFolder').value.trim();
      const name   = document.getElementById('mName').value.trim().replace(/\.md$/, '');
      const vis    = document.getElementById('mVis').value;
      if (!name) { toast('Please enter a note name', 'error'); return; }
      const notePath = folder ? `${folder}/${name}` : name;
      const res = await fetch('/api/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: notePath, title: name, visibility: vis }),
      });
      if (!res.ok) { toast('Failed to create note', 'error'); return; }
      toast('Note created!', 'success');
      await loadTree();
      openNote(notePath + '.md');
    }
  );
  setTimeout(() => document.getElementById('mName')?.focus(), 50);
}

function showNewFolderModal() {
  showModal('New Folder',
    `<div class="form-group">
      <label>Folder name</label>
      <input type="text" id="mFolderName" placeholder="my-folder" autofocus>
    </div>`,
    'Create',
    async () => {
      const name = document.getElementById('mFolderName').value.trim();
      if (!name) return;
      await fetch('/api/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name }),
      });
      toast('Folder created!', 'success');
      await loadTree();
    }
  );
  setTimeout(() => document.getElementById('mFolderName')?.focus(), 50);
}

function showRenameModal(type, itemPath, currentName) {
  showModal(`Rename ${type === 'note' ? 'Note' : 'Folder'}`,
    `<div class="form-group">
      <label>New name</label>
      <input type="text" id="mNewName" value="${esc(currentName)}" autofocus>
    </div>`,
    'Rename',
    async () => {
      const newName = document.getElementById('mNewName').value.trim();
      if (!newName || newName === currentName) return;
      const dir = itemPath.split('/').slice(0, -1).join('/');
      const newPath = dir ? `${dir}/${newName}` : newName;
      const res = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: itemPath, newPath, type }),
      });
      if (!res.ok) { toast('Rename failed', 'error'); return; }
      if (currentNote?.path === itemPath + '.md') {
        currentNote.path  = newPath + '.md';
        currentNote.title = newName;
      }
      toast('Renamed!', 'success');
      await loadTree();
    }
  );
  setTimeout(() => {
    const inp = document.getElementById('mNewName');
    inp?.focus();
    inp?.select();
  }, 50);
}

function confirmDelete(type, itemPath, name) {
  showModal(`Delete ${type === 'note' ? 'Note' : 'Folder'}`,
    `<p style="color:var(--tx-2)">Are you sure you want to delete <strong>"${esc(name)}"</strong>?
    ${type === 'folder' ? '<br><small style="color:var(--clr-red)">All notes inside will also be deleted.</small>' : ''}</p>`,
    'Delete',
    async () => {
      const url = type === 'note'
        ? '/api/note/' + (itemPath.endsWith('.md') ? itemPath : itemPath + '.md')
        : '/api/folder/' + itemPath;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) { toast('Delete failed', 'error'); return; }
      if (currentNote?.path === itemPath || currentNote?.path === itemPath + '.md') showWelcome();
      toast('Deleted', 'info');
      await loadTree();
    }
  );
  document.getElementById('modalConfirm').style.background = 'var(--clr-red)';
  document.getElementById('modalConfirm').style.color = '#fff';
}

// ─── UI Bindings ──────────────────────────────────────────────────────────────
function bindUI() {
  // Sidebar toggle
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  document.getElementById('rightSidebarToggle')?.addEventListener('click', () => {
    document.getElementById('outlinePane').classList.toggle('collapsed');
  });

  initResizers();

  // Mobile sidebar dismissal
  document.getElementById('editorArea')?.addEventListener('click', (e) => {
    // Only collapse if they didn't click the sidebar toggle
    if (window.innerWidth <= 640 && !e.target.closest('.topbar-toggle')) {
      document.getElementById('sidebar')?.classList.add('collapsed');
      document.getElementById('outlinePane')?.classList.add('collapsed');
    }
  });

  // New note / folder
  document.getElementById('newNoteBtn').addEventListener('click', () => showNewNoteModal());
  document.getElementById('newFolderBtn').addEventListener('click', () => showNewFolderModal());
  document.getElementById('welcomeNewNote')?.addEventListener('click', () => showNewNoteModal());
  document.getElementById('welcomeNewFolder')?.addEventListener('click', () => showNewFolderModal());

  // Save
  document.getElementById('saveBtn').addEventListener('click', saveNote);

  // Visibility toggle
  document.getElementById('visibilityToggle').addEventListener('click', () => {
    if (!currentNote) return;
    const newVis = currentNote.visibility === 'public' ? 'private' : 'public';
    currentNote.visibility = newVis;
    updateVisibilityUI(newVis);
    isDirty = true;
    document.getElementById('saveStatus').textContent = 'Unsaved changes';
  });

  // Title input
  document.getElementById('noteTitleInput').addEventListener('input', () => {
    isDirty = true;
    document.getElementById('saveStatus').textContent = 'Unsaved changes';
  });

  // Toolbar
  document.getElementById('editorToolbar').addEventListener('click', e => {
    const btn = e.target.closest('.toolbar-btn');
    if (!btn) return;
    applyToolbarAction(editorView, btn.dataset.action);
  });

  // Theme
  document.getElementById('toggleTheme').addEventListener('click', () => {
    isDark = !isDark;
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    applyTheme();
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // Search
  let st;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(st);
    st = setTimeout(renderTree, 200);
  });

  // Modal cancel
  document.getElementById('modalCancel').addEventListener('click', () => {
    document.getElementById('modalOverlay').style.display = 'none';
  });
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modalOverlay')) {
      document.getElementById('modalOverlay').style.display = 'none';
    }
  });

  // Close ctx menu on escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCtxMenu();
  });

  // Warn on unload
  window.addEventListener('beforeunload', e => {
    if (isDirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

// ─── Search filter ────────────────────────────────────────────────────────────
function filterNodes(nodes, q) {
  const result = [];
  for (const n of nodes) {
    if (n.type === 'folder') {
      const children = filterNodes(n.children || [], q);
      if (children.length) result.push({ ...n, children });
    } else {
      if ((n.title || n.name).toLowerCase().includes(q)) result.push(n);
    }
  }
  return result;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const wrap = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ─── Escape ───────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Resizers ─────────────────────────────────────────────────────────────────
function initResizers() {
  let isResizingLeft = false;
  let isResizingRight = false;
  const leftResizer = document.getElementById('leftResizer');
  const rightResizer = document.getElementById('rightResizer');
  const sidebar = document.getElementById('sidebar');
  const outlinePane = document.getElementById('outlinePane');

  if (leftResizer) {
    leftResizer.addEventListener('mousedown', () => { isResizingLeft = true; document.body.style.cursor = 'col-resize'; leftResizer.classList.add('dragging'); });
  }
  if (rightResizer) {
    rightResizer.addEventListener('mousedown', () => { isResizingRight = true; document.body.style.cursor = 'col-resize'; rightResizer.classList.add('dragging'); });
  }

  document.addEventListener('mousemove', e => {
    if (!isResizingLeft && !isResizingRight) return;
    e.preventDefault();
    if (isResizingLeft) {
      const newWidth = Math.max(200, Math.min(e.clientX, 500));
      document.documentElement.style.setProperty('--sidebar-w', newWidth + 'px');
    }
    if (isResizingRight) {
      const newWidth = Math.max(200, Math.min(window.innerWidth - e.clientX, 500));
      outlinePane.style.width = newWidth + 'px';
      outlinePane.style.minWidth = newWidth + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    isResizingLeft = false;
    isResizingRight = false;
    document.body.style.cursor = '';
    leftResizer?.classList.remove('dragging');
    rightResizer?.classList.remove('dragging');
  });
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function initModals() {
  const overlay = document.getElementById('modalOverlay');
  const cancelBtn = document.getElementById('modalCancel');
  
  overlay?.addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') {
      overlay.style.display = 'none';
    }
  });
  
  cancelBtn?.addEventListener('click', () => {
    if (overlay) overlay.style.display = 'none';
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (overlay) overlay.style.display = 'none';
      if (typeof closeCtxMenu === 'function') closeCtxMenu();
    }
  });
}

// ─── Editor ───────────────────────────────────────────────────────────────────
function initEditor() {
  const cmWrap = document.getElementById('editorCmWrap');
  if (!cmWrap) return;
  
  editorView = createEditor(cmWrap, '', (update) => {
    if (update.docChanged) {
      if (typeof handleEditorEvent === 'function') {
        handleEditorEvent('change');
      }
    }
  });
  
  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action) {
        applyToolbarAction(editorView, action);
      }
    });
  });
}
