/* ─────────────────────────────────────────────────────────────────────────────
   visitor.js — Public read-only note viewer
───────────────────────────────────────────────────────────────────────────── */

// ─── State ───────────────────────────────────────────────────────────────────
let tree = [];
let currentPath = null;
let searchTimeout = null;
let isDark = localStorage.getItem('theme') === 'dark';

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();
  
  // Collapse sidebars on mobile by default
  if (window.innerWidth <= 640) {
    document.getElementById('sidebar')?.classList.add('collapsed');
    document.getElementById('outlinePane')?.classList.add('collapsed');
  }

  applyTheme();
  loadTree().then(() => {
    // Handle direct URL like /note/folder/file
    const pathMatch = window.location.pathname.match(/^\/note\/(.+)$/);
    if (pathMatch) {
      const notePath = pathMatch[1] + (pathMatch[1].endsWith('.md') ? '' : '.md');
      openNote(notePath);
    }
  });

  document.getElementById('toggleTheme').addEventListener('click', () => {
    isDark = !isDark;
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    applyTheme();
  });

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    sidebar.classList.remove('peeking');
  });

  document.getElementById('rightSidebarToggle')?.addEventListener('click', () => {
    const outlinePane = document.getElementById('outlinePane');
    outlinePane.classList.toggle('collapsed');
    outlinePane.classList.remove('peeking');
  });

  document.getElementById('exportPdfBtn')?.addEventListener('click', () => {
    window.print();
  });

  initResizers();

  // Mobile sidebar dismissal
  document.getElementById('mainArea')?.addEventListener('click', (e) => {
    if (window.innerWidth <= 640 && !e.target.closest('.topbar-toggle')) {
      document.getElementById('sidebar')?.classList.add('collapsed');
      document.getElementById('outlinePane')?.classList.add('collapsed');
    }
  });

  // Desktop Hover-to-Open Sidebar Peek
  document.addEventListener('mousemove', e => {
    if (window.innerWidth <= 640) return; // Only on desktop
    
    // Left sidebar peek
    if (e.clientX <= 20) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.classList.contains('collapsed') && !sidebar.classList.contains('peeking')) {
        sidebar.classList.add('peeking');
      }
    }
    
    // Right sidebar peek
    if (window.innerWidth - e.clientX <= 20) {
      const outlinePane = document.getElementById('outlinePane');
      if (outlinePane && outlinePane.classList.contains('collapsed') && !outlinePane.classList.contains('hidden') && !outlinePane.classList.contains('peeking')) {
        outlinePane.classList.add('peeking');
      }
    }
  });

  document.getElementById('sidebar')?.addEventListener('mouseleave', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('peeking')) {
      sidebar.classList.remove('peeking');
    }
  });

  document.getElementById('outlinePane')?.addEventListener('mouseleave', () => {
    const outlinePane = document.getElementById('outlinePane');
    if (outlinePane && outlinePane.classList.contains('peeking')) {
      outlinePane.classList.remove('peeking');
    }
  });

  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => filterTree(e.target.value.trim()), 200);
  });

  window.addEventListener('popstate', () => {
    const m = window.location.pathname.match(/^\/note\/(.+)$/);
    if (m) openNote(m[1] + (m[1].endsWith('.md') ? '' : '.md'));
    else showWelcome();
  });
});

// ─── Theme ───────────────────────────────────────────────────────────────────
function applyTheme() {
  document.body.classList.toggle('theme-dark', isDark);
  document.body.classList.toggle('theme-light', !isDark);
  const btn = document.getElementById('toggleTheme');
  if (btn) {
    btn.innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}"></i>`;
    if (window.lucide) window.lucide.createIcons({ root: btn });
  }
}

// ─── Tree Loading ─────────────────────────────────────────────────────────────
async function loadTree() {
  try {
    const res = await fetch('/api/tree');
    tree = await res.json();
    renderTree(tree);
  } catch {
    document.getElementById('fileTree').innerHTML =
      '<div class="tree-empty"><div style="display:flex;justify-content:center;margin-bottom:.5rem;color:var(--text-faint)"><i data-lucide="alert-triangle" style="width:32px;height:32px;"></i></div>Failed to load notes</div>';
    if (window.lucide) window.lucide.createIcons();
  }
}

// ─── Tree Rendering ───────────────────────────────────────────────────────────
function renderTree(nodes, container = document.getElementById('fileTree')) {
  if (!nodes.length) {
    container.innerHTML = '<div class="tree-empty"><div style="display:flex;justify-content:center;margin-bottom:.5rem;color:var(--text-faint)"><i data-lucide="leaf" style="width:32px;height:32px;"></i></div>No public notes yet</div>';
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  container.innerHTML = '';
  nodes.forEach(node => container.appendChild(buildNode(node)));
  if (window.lucide) window.lucide.createIcons({ root: container });
}

function buildNode(node) {
  if (node.type === 'folder') return buildFolderNode(node);
  return buildNoteNode(node);
}

function buildFolderNode(folder) {
  const el = document.createElement('div');
  el.className = 'tree-folder slide-in';

  const header = document.createElement('div');
  header.className = 'tree-folder-header';
  header.innerHTML = `
    <span class="folder-chevron open"><i data-lucide="chevron-right" style="width:12px;height:12px;"></i></span>
    <span class="folder-icon"><i data-lucide="folder" style="width:14px;height:14px;"></i></span>
    <span class="folder-name">${esc(folder.name)}</span>
  `;

  const children = document.createElement('div');
  children.className = 'tree-folder-children';
  (folder.children || []).forEach(c => children.appendChild(buildNode(c)));

  header.addEventListener('click', () => {
    const ch = header.querySelector('.folder-chevron');
    const isOpen = ch.classList.toggle('open');
    children.style.display = isOpen ? '' : 'none';
    const iconSpan = header.querySelector('.folder-icon');
    iconSpan.innerHTML = `<i data-lucide="${isOpen ? 'folder-open' : 'folder'}" style="width:14px;height:14px;"></i>`;
    if (window.lucide) window.lucide.createIcons({ root: iconSpan });
  });

  el.appendChild(header);
  el.appendChild(children);
  return el;
}

function buildNoteNode(note) {
  const el = document.createElement('div');
  el.className = 'tree-note slide-in';
  el.dataset.path = note.path;
  el.innerHTML = `
    <span class="note-icon"><i data-lucide="file-text" style="width:14px;height:14px;"></i></span>
    <span class="note-title">${esc(note.title || note.name)}</span>
  `;
  el.addEventListener('click', () => openNote(note.path));
  return el;
}

// ─── Note Loading ─────────────────────────────────────────────────────────────
async function openNote(notePath) {
  const np = notePath.endsWith('.md') ? notePath : notePath + '.md';
  
  // Update active state
  document.querySelectorAll('.tree-note').forEach(el => {
    el.classList.toggle('active', el.dataset.path === np);
  });

  currentPath = np;

  // Update URL
  const urlPath = '/note/' + np.replace(/\.md$/, '');
  if (window.location.pathname !== urlPath) {
    window.history.pushState({}, '', urlPath);
  }

  // Update breadcrumb
  const parts = np.replace(/\.md$/, '').split('/');
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = `<a href="/">Home</a>`;
  parts.forEach((p, i) => {
    bc.innerHTML += `<span class="sep">›</span>`;
    if (i === parts.length - 1) bc.innerHTML += `<span>${esc(p)}</span>`;
    else bc.innerHTML += `<a href="#">${esc(p)}</a>`;
  });

  // Show loading
  const pane = document.getElementById('contentPane');
  pane.innerHTML = `<div class="welcome" style="color:var(--tx-3)">
    <div style="font-size:1.5rem;animation:spin 1s linear infinite">⟳</div>
    <p>Loading…</p>
  </div>`;

  try {
    const res = await fetch('/api/note/' + np);
    if (!res.ok) throw new Error(res.status === 403 ? 'Private note' : 'Not found');
    const note = await res.json();

    // Render markdown
    const html = renderMarkdown(note.content);

    pane.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'note-header fade-in';

    const updated = note.updated ? new Date(note.updated).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    }) : '';

    header.innerHTML = `
      <div class="note-title-display">${esc(note.title || note.name)}</div>
      <div class="note-meta">
        ${updated ? `<span>Updated ${updated}</span>` : ''}
      </div>
    `;

    const divider = document.createElement('hr');
    divider.className = 'note-divider';

    const body = document.createElement('div');
    body.className = 'note-body fade-in';
    body.innerHTML = html;

    pane.appendChild(header);
    pane.appendChild(divider);
    pane.appendChild(body);

    updateOutline(body);

    const pdfBtn = document.getElementById('exportPdfBtn');
    if (pdfBtn) pdfBtn.style.display = 'inline-flex';

    // Update page title
    document.title = `${note.title || note.name} — My Notes`;

  } catch (err) {
    pane.innerHTML = `<div class="welcome fade-in">
      <div style="font-size:2rem">⚠️</div>
      <h2 style="font-size:1.2rem">${err.message === 'Private note' ? 'Private Note' : 'Note not found'}</h2>
      <p>${err.message === 'Private note' ? 'This note is not publicly available.' : 'The requested note could not be found.'}</p>
      <a href="/" class="btn btn-ghost" style="margin-top:.5rem">← Go home</a>
    </div>`;
  }
}

function showWelcome() {
  currentPath = null;
  document.title = 'My Notes';
  
  const pdfBtn = document.getElementById('exportPdfBtn');
  if (pdfBtn) pdfBtn.style.display = 'none';

  document.getElementById('breadcrumb').innerHTML = `<a href="/">Home</a>`;
  document.getElementById('contentPane').innerHTML = `
    <div class="welcome fade-in">
      <div class="welcome-logo">🌿</div>
      <h2>Welcome to My Notes</h2>
      <p>Select a note from the sidebar to start reading.</p>
    </div>`;
  document.querySelectorAll('.tree-note').forEach(el => el.classList.remove('active'));
  const outlinePane = document.getElementById('outlinePane');
  if (outlinePane) outlinePane.classList.add('hidden');
}

function updateOutline(container) {
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

// ─── Markdown Renderer ────────────────────────────────────────────────────────
function renderMarkdown(md) {
  if (!md) return '';

  // Process callouts before standard markdown
  md = md.replace(
    /^> \[!(\w+)\](.*)\n((?:>.*\n?)*)/gm,
    (_, type, title, content) => {
      const t = type.toLowerCase();
      const tl = title.trim() || (t.charAt(0).toUpperCase() + t.slice(1));
      const body = content.replace(/^> ?/gm, '').trim();
      return `<div class="callout callout-${t}"><div class="callout-title">${esc(tl)}</div><div class="callout-content">${body}</div></div>\n`;
    }
  );

  // If marked library is available (via CDN), use it for perfect markdown rendering (including lists and newlines)
  if (typeof marked !== 'undefined') {
    return marked.parse(md, { gfm: true, breaks: true });
  }

  // Simple markdown → HTML fallback (no external lib needed for basic rendering)
  // Headings
  md = md.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, text) => {
    const level = hashes.length;
    const cleanText = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_~`]/g, '');
    const id = 'h-' + cleanText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `<h${level} id="${id}">${text}</h${level}>`;
  });

  // HR
  md = md.replace(/^---+$/gm, '<hr>');

  // Code blocks
  md = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${escHtml(code.trim())}</code></pre>`;
  });

  // Inline code
  md = md.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold + italic
  md = md.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  md = md.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/\*(.+?)\*/g, '<em>$1</em>');
  md = md.replace(/__(.+?)__/g, '<strong>$1</strong>');
  md = md.replace(/_(.+?)_/g, '<em>$1</em>');
  md = md.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Blockquote (non-callout)
  md = md.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Links and images
  md = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:var(--radius-md)">');
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Lists (basic)
  md = md.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
  md = md.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  md = md.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

  // Paragraphs: wrap standalone lines
  md = md.replace(/^(?!<[a-zA-Z]).+$/gm, line => {
    if (!line.trim()) return '';
    if (line.startsWith('<')) return line;
    return `<p>${line}</p>`;
  });

  // Clean up empty lines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md;
}

// ─── Search ───────────────────────────────────────────────────────────────────
function filterTree(query) {
  if (!query) { renderTree(tree); return; }
  const q = query.toLowerCase();
  const filtered = filterNodes(tree, q);
  renderTree(filtered);
}

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

// ─── Utilities ────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escHtml(str) {
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
