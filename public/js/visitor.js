/* ─────────────────────────────────────────────────────────────────────────────
   visitor.js — Public read-only note viewer
───────────────────────────────────────────────────────────────────────────── */

// ─── State ───────────────────────────────────────────────────────────────────
let tree = [];
let currentPath = null;
let searchTimeout = null;
let isDark = localStorage.getItem('theme') === 'dark';
let fontSize = localStorage.getItem('fontSize') || 'medium';

// ─── Mobile Sidebar Auto-Close ───────────────────────────────────────────────
function collapseSidebarsOnMobile() {
  if (window.innerWidth <= 640) {
    document.getElementById('sidebar')?.classList.add('collapsed');
    document.getElementById('outlinePane')?.classList.add('collapsed');
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();
  
  // Ensure page starts at top on load
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  
  // Collapse sidebars on mobile by default
  if (window.innerWidth <= 640) {
    document.getElementById('sidebar')?.classList.add('collapsed');
    document.getElementById('outlinePane')?.classList.add('collapsed');
  }

  applyTheme();
  loadTree().then(() => {
    const pathMatch = window.location.pathname.match(/^\/note\/(.+)$/);
    if (pathMatch) {
      const notePath = pathMatch[1] + (pathMatch[1].endsWith('.md') ? '' : '.md');
      openNote(notePath);
    }
  });

  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      isDark = !isDark;
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      applyTheme();
    });
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

  // Fullscreen
  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.error(`Error enabling fullscreen: ${err.message}`);
        });
      } else {
        document.exitFullscreen();
      }
    });
  }

  document.addEventListener('fullscreenchange', () => {
    const fsBtn = document.getElementById('fullscreenBtn');
    if (!fsBtn) return;
    
    const icon = fsBtn.querySelector('i');
    if (document.fullscreenElement) {
      document.body.classList.add('is-fullscreen');
      fsBtn.title = 'Exit fullscreen';
      if (icon) {
        icon.setAttribute('data-lucide', 'minimize');
        lucide.createIcons();
      }
    } else {
      document.body.classList.remove('is-fullscreen');
      fsBtn.title = 'Toggle fullscreen';
      if (icon) {
        icon.setAttribute('data-lucide', 'maximize');
        lucide.createIcons();
      }
    }
  });

  document.getElementById('backToTop')?.addEventListener('click', () => {
    document.getElementById('contentPane')?.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ─── Font Size ────────────────────────────────────────────────────────────
  const sizes = ['small', 'medium', 'large'];
  function applyFontSize(size) {
    fontSize = size;
    localStorage.setItem('fontSize', size);
    document.getElementById('contentPane')?.setAttribute('data-font-size', size);
  }
  applyFontSize(fontSize);

  document.getElementById('fontSizeDec')?.addEventListener('click', () => {
    const idx = sizes.indexOf(fontSize);
    if (idx > 0) applyFontSize(sizes[idx - 1]);
  });
  document.getElementById('fontSizeReset')?.addEventListener('click', () => {
    applyFontSize('medium');
  });
  document.getElementById('fontSizeInc')?.addEventListener('click', () => {
    const idx = sizes.indexOf(fontSize);
    if (idx < sizes.length - 1) applyFontSize(sizes[idx + 1]);
  });

  initResizers();
  initReadingProgress();
  initSwipeGestures();

  // Mobile: click anywhere outside sidebar closes it
  document.body.addEventListener('click', (e) => {
    if (window.innerWidth <= 640) {
      const sidebar = document.getElementById('sidebar');
      const sidebarRight = document.getElementById('outlinePane');
      const toggleBtn = e.target.closest('#sidebarToggle');
      const rightToggleBtn = e.target.closest('#rightSidebarToggle');
      const sidebarContent = e.target.closest('.sidebar');
      const rightSidebarContent = e.target.closest('.sidebar-right');
      
      if (sidebar && !sidebar.classList.contains('collapsed') && !toggleBtn && !sidebarContent) {
        sidebar.classList.add('collapsed');
      }
      if (sidebarRight && !sidebarRight.classList.contains('collapsed') && !rightToggleBtn && !rightSidebarContent) {
        sidebarRight.classList.add('collapsed');
      }
    }
  });

  document.getElementById('mainArea')?.addEventListener('click', (e) => {
    if (window.innerWidth <= 640 && !e.target.closest('.topbar-toggle')) {
      collapseSidebarsOnMobile();
    }
  });

  document.addEventListener('mousemove', e => {
    if (window.innerWidth <= 640) return;
    if (e.clientX <= 20) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.classList.contains('collapsed') && !sidebar.classList.contains('peeking')) {
        sidebar.classList.add('peeking');
      }
    }
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

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('searchInput')?.focus();
    }
    if (e.key === 'Escape') {
      document.getElementById('searchInput')?.blur();
    }
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
  const icon = isDark ? 'sun' : 'moon';
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.innerHTML = `<i data-lucide="${icon}"></i>`;
    if (window.lucide) window.lucide.createIcons({ root: btn });
  });
  const hint = document.getElementById('kbdHint');
  if (hint) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    hint.innerHTML = `<kbd>${isMac ? '⌘' : 'Ctrl'}K</kbd>`;
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
    const searchQuery = document.getElementById('searchInput')?.value?.trim();
    if (searchQuery) {
      container.innerHTML = '<div class="tree-empty"><div style="display:flex;justify-content:center;margin-bottom:.5rem;color:var(--text-faint)"><i data-lucide="search-x" style="width:32px;height:32px;"></i></div>No notes matching "' + esc(searchQuery) + '"</div>';
    } else {
      container.innerHTML = '<div class="tree-empty"><div style="display:flex;justify-content:center;margin-bottom:.5rem;color:var(--text-faint)"><i data-lucide="leaf" style="width:32px;height:32px;"></i></div>No public notes yet</div>';
    }
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
  const noteCount = countNotes(folder);
  const header = document.createElement('div');
  header.className = 'tree-folder-header';
  header.innerHTML = `
    <span class="folder-chevron open"><i data-lucide="chevron-right" style="width:12px;height:12px;"></i></span>
    <span class="folder-icon"><i data-lucide="folder" style="width:14px;height:14px;"></i></span>
    <span class="folder-name" title="${esc(folder.name)}">${esc(folder.name)}</span>
    ${noteCount > 0 ? `<span class="folder-badge">${noteCount}</span>` : ''}
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

function countNotes(folder) {
  let count = 0;
  for (const child of (folder.children || [])) {
    if (child.type === 'note') count++;
    else if (child.type === 'folder') count += countNotes(child);
  }
  return count;
}

function buildNoteNode(note) {
  const el = document.createElement('div');
  el.className = 'tree-note slide-in';
  el.dataset.path = note.path;
  const title = note.title || note.name;
  el.innerHTML = `
    <span class="note-icon"><i data-lucide="file-text" style="width:14px;height:14px;"></i></span>
    <span class="note-title" title="${esc(title)}">${esc(title)}</span>
  `;
  el.addEventListener('click', () => openNote(note.path));
  return el;
}

// ─── Note Loading ─────────────────────────────────────────────────────────────
async function openNote(notePath) {
  const np = notePath.endsWith('.md') ? notePath : notePath + '.md';
  document.querySelectorAll('.tree-note').forEach(el => {
    el.classList.toggle('active', el.dataset.path === np);
  });
  currentPath = np;
  const urlPath = '/note/' + np.replace(/\.md$/, '');
  if (window.location.pathname !== urlPath) {
    window.history.pushState({}, '', urlPath);
  }
  const parts = np.replace(/\.md$/, '').split('/');
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = `<a href="/">Home</a>`;
  parts.forEach((p, i) => {
    bc.innerHTML += `<span class="sep">›</span>`;
    if (i === parts.length - 1) bc.innerHTML += `<span>${esc(p)}</span>`;
    else bc.innerHTML += `<a href="#">${esc(p)}</a>`;
  });
  const pane = document.getElementById('contentPane');
  pane.innerHTML = `<div class="note-header fade-in"><div class="skeleton skeleton-heading"></div><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-line w-40"></div></div><hr class="note-divider"><div class="note-body"><div class="skeleton skeleton-line w-full"></div><div class="skeleton skeleton-line w-80"></div><div class="skeleton skeleton-line w-full"></div><div class="skeleton skeleton-line w-60"></div></div>`;
  const pdfBtn = document.getElementById('exportPdfBtn');
  if (pdfBtn) pdfBtn.style.display = 'none';
  try {
    const res = await fetch('/api/note/' + np);
    if (!res.ok) throw new Error(res.status === 403 ? 'Private note' : 'Not found');
    const note = await res.json();
    const html = renderMarkdown(note.content);
    pane.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'note-header fade-in';
    const updated = note.updated ? new Date(note.updated).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    const wordCount = note.content ? note.content.split(/\s+/).filter(w => w.length > 0).length : 0;
    const readingTime = Math.max(1, Math.ceil(wordCount / 200));
    header.innerHTML = `<div class="note-title-display">${esc(note.title || note.name)}</div><div class="note-meta">${updated ? `<span class="note-meta-item"><i data-lucide="calendar" style="width:13px;height:13px;"></i><span>Updated ${updated}</span></span>` : ''}<span class="note-meta-item"><i data-lucide="clock" style="width:13px;height:13px;"></i><span>${readingTime} min read</span></span></div>`;
    const divider = document.createElement('hr');
    divider.className = 'note-divider';
    const body = document.createElement('div');
    body.className = 'note-body fade-in note-transition';
    body.innerHTML = html;
    pane.appendChild(header);
    pane.appendChild(divider);
    pane.appendChild(body);
    wrapCodeBlocks(body);
    updateOutline(body);
    resetReadingProgress();
    collapseSidebarsOnMobile();
    if (pdfBtn) pdfBtn.style.display = 'inline-flex';
    document.title = `${note.title || note.name} — My Notes`;
    if (window.lucide) window.lucide.createIcons({ root: header });
  } catch (err) {
    pane.innerHTML = `<div class="welcome fade-in"><div style="font-size:2rem">⚠️</div><h2 style="font-size:1.2rem">${err.message === 'Private note' ? 'Private Note' : 'Note not found'}</h2><p>${err.message === 'Private note' ? 'This note is not publicly available.' : 'The requested note could not be found.'}</p><a href="/" class="btn btn-ghost" style="margin-top:.5rem">← Go home</a></div>`;
    collapseSidebarsOnMobile();
  }
}

function showWelcome() {
  currentPath = null;
  document.title = 'My Notes';
  const pdfBtn = document.getElementById('exportPdfBtn');
  if (pdfBtn) pdfBtn.style.display = 'none';
  document.getElementById('breadcrumb').innerHTML = `<a href="/">Home</a>`;
  document.getElementById('contentPane').innerHTML = `<div class="welcome fade-in"><div class="welcome-hero"><div class="welcome-logo">🌿</div><h2>Welcome to My Notes</h2><p>Select a note from the sidebar to start reading.</p></div></div>`;
  document.querySelectorAll('.tree-note').forEach(el => el.classList.remove('active'));
  const outlinePane = document.getElementById('outlinePane');
  if (outlinePane) outlinePane.classList.add('hidden');
  resetReadingProgress();
}

// ─── Code Block Wrapper ─────────────────────────────────────────────────────
function wrapCodeBlocks(container) {
  const codeBlocks = container.querySelectorAll('pre');
  codeBlocks.forEach(pre => {
    if (pre.closest('.code-block-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    const header = document.createElement('div');
    header.className = 'code-block-header';
    const codeEl = pre.querySelector('code');
    let lang = '';
    if (codeEl) {
      const classes = codeEl.className.split(' ');
      const langClass = classes.find(c => c.startsWith('language-'));
      if (langClass) lang = langClass.replace('language-', '');
    }
    header.innerHTML = `<span class="code-block-lang">${lang || 'text'}</span><button class="code-copy-btn" title="Copy code"><i data-lucide="copy" style="width:13px;height:13px;"></i><span>Copy</span></button>`;
    const copyBtn = header.querySelector('.code-copy-btn');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(pre.textContent).then(() => {
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = `<i data-lucide="check" style="width:13px;height:13px;"></i><span>Copied!</span>`;
        if (window.lucide) window.lucide.createIcons({ root: copyBtn });
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = `<i data-lucide="copy" style="width:13px;height:13px;"></i><span>Copy</span>`;
          if (window.lucide) window.lucide.createIcons({ root: copyBtn });
        }, 2000);
      });
    });
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
    if (window.lucide) window.lucide.createIcons({ root: header });
  });
}

// ─── Reading Progress ────────────────────────────────────────────────────────
function initReadingProgress() {
  const contentPane = document.getElementById('contentPane');
  if (!contentPane) return;
  contentPane.addEventListener('scroll', () => {
    const scrollTop = contentPane.scrollTop;
    const scrollHeight = contentPane.scrollHeight - contentPane.clientHeight;
    const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    const bar = document.getElementById('readingProgressBar');
    if (bar) bar.style.width = progress + '%';
    const backToTop = document.getElementById('backToTop');
    if (backToTop) backToTop.classList.toggle('visible', scrollTop > 400);
  });
}

function resetReadingProgress() {
  const bar = document.getElementById('readingProgressBar');
  if (bar) bar.style.width = '0%';
  const backToTop = document.getElementById('backToTop');
  if (backToTop) backToTop.classList.remove('visible');
}

// ─── Swipe Gestures ─────────────────────────────────────────────────────────
function initSwipeGestures() {
  if (window.innerWidth > 640) return;
  let touchStartX = 0;
  document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const diffX = e.changedTouches[0].screenX - touchStartX;
    if (Math.abs(diffX) < 80) return;
    const sidebar = document.getElementById('sidebar');
    const outlinePane = document.getElementById('outlinePane');
    if (diffX > 0 && touchStartX < 40) {
      sidebar?.classList.remove('collapsed');
    } else if (diffX < 0 && touchStartX > window.innerWidth - 40) {
      outlinePane?.classList.remove('collapsed');
    } else if (diffX < 0 && !sidebar?.classList.contains('collapsed')) {
      sidebar?.classList.add('collapsed');
    }
  }, { passive: true });
}

// ─── Outline ─────────────────────────────────────────────────────────────────
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
      collapseSidebarsOnMobile();
    });
    li.appendChild(a);
    outlineList.appendChild(li);
  });
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────
function renderMarkdown(md) {
  if (!md) return '';
  md = md.replace(/^> \[!(\w+)\](.*)\n((?:>.*\n?)*)/gm, (_, type, title, content) => {
    const t = type.toLowerCase();
    const tl = title.trim() || (t.charAt(0).toUpperCase() + t.slice(1));
    const body = content.replace(/^> ?/gm, '').trim();
    return `<div class="callout callout-${t}"><div class="callout-title">${esc(tl)}</div><div class="callout-content">${body}</div></div>\n`;
  });
  if (typeof marked !== 'undefined') {
    return marked.parse(md, { gfm: true, breaks: true });
  }
  md = md.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, text) => {
    const level = hashes.length;
    const cleanText = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_~`]/g, '');
    const id = 'h-' + cleanText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `<h${level} id="${id}">${text}</h${level}>`;
  });
  md = md.replace(/^---+$/gm, '<hr>');
  md = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="language-${lang}">${escHtml(code.trim())}</code></pre>`);
  md = md.replace(/`([^`]+)`/g, '<code>$1</code>');
  md = md.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  md = md.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/\*(.+?)\*/g, '<em>$1</em>');
  md = md.replace(/__(.+?)__/g, '<strong>$1</strong>');
  md = md.replace(/_(.+?)_/g, '<em>$1</em>');
  md = md.replace(/~~(.+?)~~/g, '<del>$1</del>');
  md = md.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  md = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:var(--radius-md)">');
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  md = md.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
  md = md.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  md = md.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  md = md.replace(/^(?!<[a-zA-Z]).+$/gm, line => {
    if (!line.trim()) return '';
    if (line.startsWith('<')) return line;
    return `<p>${line}</p>`;
  });
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