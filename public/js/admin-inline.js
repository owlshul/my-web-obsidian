/* ─────────────────────────────────────────────────────────────────────────────
   admin-inline.js — Inline admin on top of visitor.js
   • Loads AFTER visitor.js (plain script, global scope)
   • Zero changes to visitor.js
   • All admin features activate only after login
───────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────────────────── */
  let isAdmin        = false;
  let currentNote    = null;   // { path, title, visibility, content }
  let isDirty        = false;
  let saveTimeout    = null;
  let isEditMode     = false;
  let editorTextarea = null;
  let focusTitleOnEdit = false;
  let reloadTimeout = null;
  let dbWriteLock = false;
  let dbWriteTimeout = null;

  function reloadTreeDelayed(delay = 350) {
    clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
      if (typeof window.loadTree === 'function') {
        window.loadTree();
      }
    }, delay);
  }

  function triggerDbWriteSync() {
    dbWriteLock = true;
    clearTimeout(dbWriteTimeout);
    dbWriteTimeout = setTimeout(() => {
      dbWriteLock = false;
      if (typeof window.loadTree === 'function') {
        window.loadTree();
      }
    }, 2000);
  }




  /* ── Boot ──────────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    // Silent auth check — if already logged in, activate without toast
    try {
      const r = await fetch('/api/auth');
      const d = await r.json();
      if (d.admin) activateAdmin(false);
    } catch (_) {}

    // Login button click
    document.getElementById('adminLoginBtn')
      ?.addEventListener('click', () => isAdmin ? doLogout() : openLoginModal());

    // Login modal events
    document.getElementById('loginModalClose')
      ?.addEventListener('click', closeLoginModal);
    document.getElementById('loginModal')
      ?.addEventListener('click', e => { if (e.target.id === 'loginModal') closeLoginModal(); });
    document.getElementById('loginSubmitBtn')
      ?.addEventListener('click', doLogin);
    document.getElementById('loginPassword')
      ?.addEventListener('keyup', e => { if (e.key === 'Enter') doLogin(); });
  });

  /* ── Login Modal ───────────────────────────────────────────────────────── */
  function openLoginModal() {
    const pw = document.getElementById('loginPassword');
    const err = document.getElementById('loginError');
    if (pw)  pw.value = '';
    if (err) err.style.display = 'none';
    const m = document.getElementById('loginModal');
    if (m) { m.style.display = 'flex'; setTimeout(() => pw?.focus(), 60); }
  }
  function closeLoginModal() {
    const m = document.getElementById('loginModal');
    if (m) m.style.display = 'none';
  }
  async function doLogin() {
    const pw  = document.getElementById('loginPassword')?.value ?? '';
    const err = document.getElementById('loginError');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) { if (err) err.style.display = 'block'; return; }
      // Remove the login modal from DOM entirely — stops password-save prompts
      document.getElementById('loginModal')?.remove();
      activateAdmin(true);
    } catch (_) { if (err) err.style.display = 'block'; }
  }

  /* ── Activate Admin ────────────────────────────────────────────────────── */
  function activateAdmin(showToast) {
    isAdmin = true;

    // Swap "Admin 🔒" button → "Logout"
    const loginBtn = document.getElementById('adminLoginBtn');
    if (loginBtn) {
      loginBtn.innerHTML = 'Logout <i data-lucide="log-out" style="width:11px;height:11px;"></i>';
      loginBtn.title = 'Logout';
      // Remove previous listener (re-clone to wipe it)
      const fresh = loginBtn.cloneNode(true);
      loginBtn.replaceWith(fresh);
      fresh.addEventListener('click', doLogout);
    }

    // Update sidebar label
    const lbl = document.getElementById('sidebarFooterLabel');
    if (lbl) lbl.textContent = 'All notes';

    // Show sidebar new-note / new-folder buttons
    const sab = document.getElementById('sidebarAdminBtns');
    if (sab) sab.style.display = 'flex';

    // Show topbar read/write toggle
    const abt = document.getElementById('adminTopbarTools');
    if (abt) abt.style.display = 'flex';

    // Wire sidebar buttons
    document.getElementById('sidebarNewNoteBtn')
      ?.addEventListener('click', () => showNewNoteModal(''));
    document.getElementById('sidebarNewFolderBtn')
      ?.addEventListener('click', () => showNewFolderModal());

    // Wire topbar toggle
    document.getElementById('previewToggleBtn')
      ?.addEventListener('click', toggleEditMode);

    // Cmd/Ctrl+S save
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isAdmin && currentNote) saveNote();
      }
    });

    // (No fetch intercept — let all requests hit the real server)

    // Override visitor's openNote so admin gets editor state too
    const _origOpenNote = window.openNote;
    window.openNote = async function (notePath) {
      if (isEditMode && isDirty) await saveNote();
      await _origOpenNote(notePath);
      setTimeout(() => adminOpenHook(notePath), 80); // small delay so DOM settles
    };

    // Patch loadTree to tag folder paths in DOM after render
    const _origLoadTree = window.loadTree;
    window.loadTree = async function () {
      await _origLoadTree();
      tagFolderPaths(window.tree || tree || [], document.getElementById('fileTree'));
    };

    // Right-click context menus
    enableContextMenus();

    // Reload tree to show private notes too
    if (typeof window.loadTree === 'function') window.loadTree();

    if (showToast && typeof toast === 'function') toast('Logged in as Admin', 'success');
    if (window.lucide) window.lucide.createIcons();

    // Inject admin styles (show grips, etc)
    if (!document.getElementById('adminInlineStyles')) {
      const st = document.createElement('style');
      st.id = 'adminInlineStyles';
      st.innerHTML = `.drag-grip { display: flex !important; }`;
      document.head.appendChild(st);
    }
    
    // Setup SSE for live updates
    if (!window.adminEventSource) {
      window.adminEventSource = new EventSource('/api/events');
      window.adminEventSource.addEventListener('update', () => {
        if (!dbWriteLock) {
          reloadTreeDelayed(350);
        }
      });
    }

    setupDragAndDrop();

    // If a note is already open hook it immediately
    if (typeof currentPath !== 'undefined' && currentPath) {
      setTimeout(() => adminOpenHook(currentPath), 120);
    }
  }

  async function doLogout() {
    if (isEditMode && isDirty) await saveNote();
    if (window.adminEventSource) { window.adminEventSource.close(); window.adminEventSource = null; }
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
  }

  /* ── Tag folder paths in DOM (visitor.js doesn't set data-path on folders) */
  function tagFolderPaths(nodes, container, parentPath = '') {
    if (!nodes || !container) return;
    let fi = 0;
    const folderDivs = Array.from(container.children).filter(
      el => el.classList.contains('tree-folder')
    );

    nodes.forEach(node => {
      if (node.type !== 'folder') return;
      const el = folderDivs[fi++];
      if (!el) return;
      const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
      el.dataset.path = fullPath;
      const header = el.querySelector(':scope > .tree-folder-header');
      if (header) header.dataset.path = fullPath;
      const childrenContainer = el.querySelector(':scope > .tree-folder-children');
      if (childrenContainer) tagFolderPaths(node.children || [], childrenContainer, fullPath);
    });
  }

  /* ── Admin Open Hook ────────────────────────────────────────────────────── */
  async function adminOpenHook(notePath) {
    if (!isAdmin) return;
    const np = notePath.endsWith('.md') ? notePath : notePath + '.md';
    try {
      const res = await fetch('/api/note/' + np.split('/').map(encodeURIComponent).join('/'));
      if (!res.ok) return;
      const note = await res.json();
      currentNote = note;
      isDirty = false;

      if (isEditMode) {
        // Already in edit mode — swap textarea content
        if (editorTextarea) {
          editorTextarea.value = note.content || '';
          autoResize(editorTextarea);
        }
        updateEditorHeader(note);
        setStatus('');
        if (focusTitleOnEdit) {
          focusTitleOnEdit = false;
          setTimeout(() => {
            const ti = document.getElementById('editorTitleInput');
            if (ti) {
              ti.focus();
              ti.select();
            }
          }, 100);
        } else {
          setTimeout(() => editorTextarea?.focus(), 60);
        }
      }

    } catch (_) {}
  }

  /* ── Edit/Read Toggle ───────────────────────────────────────────────────── */
  function toggleEditMode() {
    if (!currentNote && !isEditMode) {
      if (typeof toast === 'function') toast('Open a note first', 'info');
      return;
    }
    isEditMode = !isEditMode;
    refreshToggleBtn();

    if (isEditMode) {
      enterEditMode();
    } else {
      if (isDirty) saveNote();
      exitEditMode();
    }
  }

  function refreshToggleBtn() {
    const btn  = document.getElementById('previewToggleBtn');
    if (!btn) return;
    if (isEditMode) {
      btn.innerHTML = '<i data-lucide="book-open" style="width:15px;height:15px;"></i>';
      btn.title = 'Switch to Reading Mode';
      btn.classList.add('btn-active-mode');
    } else {
      btn.innerHTML = '<i data-lucide="pencil" style="width:15px;height:15px;"></i>';
      btn.title = 'Switch to Writing Mode';
      btn.classList.remove('btn-active-mode');
    }
    if (window.lucide) window.lucide.createIcons({ root: btn });
  }

  /* ── Editor DOM ─────────────────────────────────────────────────────────── */
  function enterEditMode() {
    // Build the editor pane once
    let ep = document.getElementById('adminEditorPane');
    if (!ep) ep = buildEditorPane();

    // Hide visitor content pane, show editor
    const contentPane = document.getElementById('contentPane');
    if (contentPane) contentPane.style.display = 'none';
    ep.style.display = 'flex';

    if (currentNote) {
      if (editorTextarea) {
        editorTextarea.value = currentNote.content || '';
        autoResize(editorTextarea);
      }
      updateEditorHeader(currentNote);
    }
    setStatus('');
    if (focusTitleOnEdit) {
      focusTitleOnEdit = false;
      setTimeout(() => {
        const ti = document.getElementById('editorTitleInput');
        if (ti) {
          ti.focus();
          ti.select();
        }
      }, 100);
    } else {
      setTimeout(() => editorTextarea?.focus(), 60);
    }

  }

  function exitEditMode() {
    const ep = document.getElementById('adminEditorPane');
    if (ep) ep.style.display = 'none';
    const contentPane = document.getElementById('contentPane');
    if (contentPane) {
      contentPane.style.display = '';
      // Re-render markdown instantly so changes are visible
      if (currentNote && currentNote.content) {
        const body = contentPane.querySelector('.note-body');
        if (body && typeof renderMarkdown === 'function') {
          body.innerHTML = renderMarkdown(currentNote.content);
          if (typeof wrapCodeBlocks === 'function') wrapCodeBlocks(body);
          if (typeof updateOutline === 'function') updateOutline(body);
          if (typeof initHeadingFlowcharts === 'function') initHeadingFlowcharts(body);
        }
      }
    }
  }

  function buildEditorPane() {
    const pane = document.createElement('div');
    pane.id = 'adminEditorPane';
    pane.style.cssText = 'display:none;flex-direction:column;flex:1;overflow:hidden;min-width:0;';

    /* Header bar */
    const header = document.createElement('div');
    header.id = 'adminEditorHeader';
    header.className = 'admin-editor-header';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.id = 'editorTitleInput';
    titleInput.className = 'editor-title-input';
    titleInput.placeholder = 'Note title…';
    titleInput.autocomplete = 'off';
    titleInput.addEventListener('input', () => {
      if (currentNote) currentNote.title = titleInput.value.trim();
      isDirty = true;
      scheduleSave();
    });
    titleInput.addEventListener('blur', () => {
      handleTitleRename();
    });
    titleInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleInput.blur();
      }
    });


    const visBtn = document.createElement('button');
    visBtn.id = 'editorVisBtn';
    visBtn.className = 'editor-vis-btn visibility-toggle private';
    visBtn.innerHTML = '<i data-lucide="lock" style="width:12px;height:12px;"></i><span>Private</span>';
    visBtn.addEventListener('click', () => {
      if (!currentNote) return;
      const v = currentNote.visibility === 'public' ? 'private' : 'public';
      currentNote.visibility = v;
      refreshVisBtn(v);
      isDirty = true;
      scheduleSave();
    });

    const statusEl = document.createElement('span');
    statusEl.id = 'editorStatus';
    statusEl.className = 'save-status';
    statusEl.style.marginLeft = 'auto';

    header.appendChild(titleInput);
    header.appendChild(visBtn);
    header.appendChild(statusEl);

    /* Textarea scroll container */
    const scroll = document.createElement('div');
    scroll.className = 'editor-scroll';

    editorTextarea = document.createElement('textarea');
    editorTextarea.id = 'adminEditorTextarea';
    editorTextarea.className = 'admin-editor-textarea';
    editorTextarea.placeholder = 'Start writing in Markdown…';
    editorTextarea.spellcheck = true;
    editorTextarea.addEventListener('input', () => {
      autoResize(editorTextarea);
      if (currentNote) currentNote.content = editorTextarea.value;
      isDirty = true;
      scheduleSave();
    });
    editorTextarea.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = editorTextarea.selectionStart;
        const v = editorTextarea.value;
        editorTextarea.value = v.slice(0, s) + '  ' + v.slice(editorTextarea.selectionEnd);
        editorTextarea.selectionStart = editorTextarea.selectionEnd = s + 2;
        autoResize(editorTextarea);
      }
    });

    scroll.appendChild(editorTextarea);
    pane.appendChild(header);
    pane.appendChild(scroll);

    // Insert before contentPane (same parent)
    const contentPane = document.getElementById('contentPane');
    contentPane.parentNode.insertBefore(pane, contentPane);
    return pane;
  }

  function updateEditorHeader(note) {
    const ti = document.getElementById('editorTitleInput');
    if (ti) ti.value = note.title || note.path?.replace(/\.md$/, '').split('/').pop() || '';
    refreshVisBtn(note.visibility);
  }

  function refreshVisBtn(vis) {
    const btn = document.getElementById('editorVisBtn');
    if (!btn) return;
    btn.className = `editor-vis-btn visibility-toggle ${vis}`;
    btn.innerHTML = `<i data-lucide="${vis === 'public' ? 'globe' : 'lock'}" style="width:12px;height:12px;"></i><span>${vis === 'public' ? 'Public' : 'Private'}</span>`;
    if (window.lucide) window.lucide.createIcons({ root: btn });
  }

  function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 300) + 'px';
  }

  /* ── Autosave ───────────────────────────────────────────────────────────── */
  function scheduleSave() {
    setStatus('Unsaved…', '');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveNote, 2000);
  }

  async function saveNote() {
    if (!currentNote) return;
    clearTimeout(saveTimeout);
    setStatus('Saving…', 'saving');

    const content    = editorTextarea ? editorTextarea.value : (currentNote.content || '');
    const titleEl    = document.getElementById('editorTitleInput');
    const title      = (titleEl?.value || '').trim() || currentNote.path.replace(/\.md$/, '').split('/').pop();
    const visibility = currentNote.visibility || 'private';

    // Optimistically update the currentNote so switching to Read Mode instantly shows it
    currentNote.content = content;
    currentNote.title = title;

    try {
      const res = await fetch('/api/note/' + currentNote.path.split('/').map(encodeURIComponent).join('/'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, title, visibility }),
      });
      if (!res.ok) throw new Error();
      isDirty = false;
      const t = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      setStatus(`✓ Saved ${t}`, 'saved');
      triggerDbWriteSync();
      setTimeout(() => { if (!isDirty) setStatus('', ''); }, 3000);
    } catch {
      setStatus('⚠ Save failed', '');
    }
  }

  function setStatus(text, cls) {
    const el = document.getElementById('editorStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'save-status' + (cls ? ' ' + cls : '');
  }

  /* ── Context Menus ─────────────────────────────────────────────────────── */
  function enableContextMenus() {
    const ft = document.getElementById('fileTree');
    if (!ft) return;
    ft.addEventListener('contextmenu', e => {
      const noteEl   = e.target.closest('.tree-note');
      const folderEl = e.target.closest('.tree-folder-header');

      if (noteEl) {
        e.preventDefault();
        const path = noteEl.dataset.path || '';
        const name = noteEl.querySelector('.note-title')?.textContent?.trim() || path;
        showCtxMenu(e, [
          { icon: 'pen-line',  label: 'Rename',    cb: () => showRenameModal('note', path, name) },
          { icon: 'trash-2',   label: 'Delete',     cb: () => confirmDelete('note', path, name), danger: true },
        ]);
      } else if (folderEl) {
        e.preventDefault();
        // path is tagged by tagFolderPaths on the header element
        const path = folderEl.dataset.path || folderEl.closest('.tree-folder')?.dataset?.path || '';
        const name = folderEl.querySelector('.folder-name')?.textContent?.trim() || path.split('/').pop() || 'folder';
        showCtxMenu(e, [
          { icon: 'file-plus',   label: 'New Note Here',  cb: () => showNewNoteModal(path) },
          { icon: 'folder-plus', label: 'New Subfolder',   cb: () => showNewFolderModal(path) },
          { icon: 'pen-line',    label: 'Rename',          cb: () => showRenameModal('folder', path, name) },
          { icon: 'trash-2',     label: 'Delete Folder',   cb: () => confirmDelete('folder', path, name), danger: true },
        ]);
      } else {
        e.preventDefault();
        showCtxMenu(e, [
          { icon: 'file-plus',   label: 'New Note',   cb: () => quickCreateNote() },
          { icon: 'folder-plus', label: 'New Folder', cb: () => showNewFolderModal() },
        ]);
      }
    });


    document.addEventListener('click', closeCtx);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtx(); });
  }

  function showCtxMenu(e, items) {
    closeCtx();
    const menu = document.getElementById('ctxMenu');
    if (!menu) return;
    menu.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'ctx-item' + (item.danger ? ' danger' : '');
      el.innerHTML = `<i data-lucide="${item.icon}" style="width:14px;height:14px;"></i><span>${xss(item.label)}</span>`;
      el.addEventListener('click', () => { closeCtx(); item.cb(); });
      menu.appendChild(el);
    });
    menu.style.display = 'block';
    const x = Math.min(e.clientX, window.innerWidth  - 175);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 36 - 20);
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    if (window.lucide) window.lucide.createIcons({ root: menu });
    // close on next click
    setTimeout(() => document.addEventListener('click', closeCtx, { once: true }), 0);
  }

  function closeCtx() {
    const m = document.getElementById('ctxMenu');
    if (m) m.style.display = 'none';
  }

  /* ── Generic Modal ─────────────────────────────────────────────────────── */
  function showModal(title, bodyHTML, confirmText, onConfirm, danger) {
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return;
    document.getElementById('modalTitle').textContent  = title;
    document.getElementById('modalBody').innerHTML     = bodyHTML;
    overlay.style.display = 'flex';

    // Fresh buttons (wipe old listeners)
    let cb = document.getElementById('modalConfirm');
    let nc = cb.cloneNode(true);
    cb.parentNode.replaceChild(nc, cb);
    nc.textContent = confirmText;
    nc.style.background = danger ? 'var(--primary-red)' : '';

    let cnl = document.getElementById('modalCancel');
    let ncl = cnl.cloneNode(true);
    cnl.parentNode.replaceChild(ncl, cnl);

    const close  = () => { overlay.style.display = 'none'; document.removeEventListener('keydown', kd); };
    const submit = () => { close(); onConfirm(); };
    nc.addEventListener('click', submit);
    ncl.addEventListener('click', close);
    overlay.onclick = ev => { if (ev.target === overlay) close(); };
    function kd(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
      else if (ev.key === 'Escape') close();
    }
    document.addEventListener('keydown', kd);
  }

  /* ── CRUD Modals ────────────────────────────────────────────────────────── */
  function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  async function showDeleteConfirmModal(path, type) {
    showModal(`Delete ${type}?`, `Are you sure you want to delete <strong>${xss(path)}</strong>?`, 'Delete', async () => {
      closeModal();
      
      // OPTIMISTIC UI: Instantly remove from tree
      const el = document.querySelector(`[data-path="${path}"]`);
      if (el) {
        const actualNode = el.closest('.tree-note') || el.closest('.tree-folder');
        if (actualNode) actualNode.remove();
      }
      
      // If deleting the currently open note, close it
      if (type === 'note' && currentNote && currentNote.path === (path.endsWith('.md') ? path : path + '.md')) {
        currentNote = null;
        if (typeof showWelcome === 'function') showWelcome();
      }

      try {
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(`/api/${type}/${encodedPath}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error();
        triggerDbWriteSync();
      } catch (e) {
        if (typeof toast === 'function') toast('Delete failed', 'error');
        triggerDbWriteSync();
      }
    }, true);
  }

  function showNewNoteModal(inFolder) {
    const folderEls = document.querySelectorAll('.tree-folder-header');
    const folders = Array.from(folderEls).map(el => el.dataset.path).filter(Boolean);
    
    let folderOptions = '<option value="">(Root)</option>';
    folders.forEach(f => {
      folderOptions += `<option value="${xss(f)}" ${f === inFolder ? 'selected' : ''}>${xss(f)}</option>`;
    });

    showModal('New Note', `
      <div class="form-group">
        <label>Folder (optional)</label>
        <select id="mFolder" style="width:100%;padding:.45rem .6rem;background:var(--bg-secondary);color:var(--text-normal);border:1px solid var(--border);border-radius:var(--radius-sm);">
          ${folderOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Note name</label>
        <input type="text" id="mName" placeholder="my-note" autocomplete="off" autofocus>
      </div>
      <div class="form-group">
        <label>Visibility</label>
        <select id="mVis" style="width:100%;padding:.45rem .6rem;background:var(--bg-secondary);color:var(--text-normal);border:1px solid var(--border);border-radius:var(--radius-sm);">
          <option value="private">🔒 Private</option>
          <option value="public">🌐 Public</option>
        </select>
      </div>`,
      'Create', async () => {
        const folder   = document.getElementById('mFolder')?.value.trim();
        const rawName  = document.getElementById('mName')?.value.trim().replace(/\.md$/, '');
        const vis      = document.getElementById('mVis')?.value || 'private';
        if (!rawName) { toast('Please enter a name', 'error'); return; }
        const notePath = folder ? `${folder}/${rawName}` : rawName;
        closeModal();

        // OPTIMISTIC UI: Add functional note to tree instantly
        const noteNode = typeof buildNoteNode === 'function'
          ? buildNoteNode({ path: notePath + '.md', title: rawName, name: rawName, type: 'note' })
          : null;
        if (noteNode) {
          if (window.lucide) window.lucide.createIcons({ root: noteNode });
          if (isAdmin) noteNode.draggable = true;
          let targetContainer;
          if (folder) {
            const folderHeader = document.querySelector(`[data-path="${folder.replace(/"/g, '\\"')}"]`);
            targetContainer = folderHeader?.nextElementSibling;
            if (targetContainer) {
              targetContainer.style.display = '';
              folderHeader?.querySelector('.folder-chevron')?.classList.add('open');
              // Persist folder open so loadTree re-renders it open
              if (typeof window.setFolderOpen === 'function') window.setFolderOpen(folder, true);
            }
          }
          if (!targetContainer) targetContainer = document.getElementById('fileTree');
          insertSorted(targetContainer, noteNode, rawName, 'note');
          flashElement(noteNode);
        }

        try {
          // Lock tree reloads BEFORE the POST — server emits SSE immediately
          // after writing the file, and we don't want it to clobber the optimistic UI
          dbWriteLock = true;
          clearTimeout(dbWriteTimeout);

          const res = await fetch('/api/note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notePath, title: rawName, visibility: vis, content: '' }),
          });
          if (!res.ok) {
            dbWriteLock = false;
            if (noteNode) noteNode.remove();
            toast('Failed to create note', 'error');
            return;
          }
          toast('Note created!', 'success');

          focusTitleOnEdit = true;
          currentNote = { path: notePath + '.md', title: rawName, visibility: vis, content: '' };

          // Update sidebar active state directly (don't call openNote to avoid race)
          const fullPath = notePath + '.md';
          document.querySelectorAll('.tree-note').forEach(el => {
            el.classList.toggle('active', el.dataset.path === fullPath);
          });
          const urlPath = '/note/' + notePath;
          window.history.pushState({}, '', urlPath);
          document.title = `${rawName} — My Notes`;

          // Open editor directly with empty content
          if (!isEditMode) {
            isEditMode = true;
            refreshToggleBtn();
            enterEditMode();
          } else {
            // Already in edit mode, just swap content
            if (editorTextarea) {
              editorTextarea.value = '';
              autoResize(editorTextarea);
            }
            updateEditorHeader(currentNote);
          }
          // Hide content pane, show editor title
          const cp = document.getElementById('contentPane');
          if (cp) cp.style.display = 'none';

          // Release the lock and do one clean tree reload after a short delay
          dbWriteTimeout = setTimeout(() => {
            dbWriteLock = false;
            if (typeof window.loadTree === 'function') window.loadTree();
          }, 1200);
        } catch (err) {
          console.error(err);
          dbWriteLock = false;
          if (noteNode) noteNode.remove();
          toast('Failed to create note', 'error');
        }
      }
    );
    setTimeout(() => document.getElementById('mName')?.focus(), 60);
  }

  function getUniqueUntitledPath() {
    let base = 'Untitled';
    let path = base + '.md';
    let count = 1;
    while (document.querySelector(`[data-path="${path.replace(/"/g, '\\"')}"]`)) {
      path = `${base} ${count}.md`;
      count++;
    }
    return path.replace(/\.md$/, '');
  }

  async function quickCreateNote() {
    const rawName = getUniqueUntitledPath();
    const notePath = rawName;
    const vis = 'private';

    // OPTIMISTIC UI: Add note node to tree instantly
    const noteNode = typeof buildNoteNode === 'function'
      ? buildNoteNode({ path: notePath + '.md', title: rawName, name: rawName, type: 'note' })
      : null;
    if (noteNode) {
      if (window.lucide) window.lucide.createIcons({ root: noteNode });
      if (isAdmin) noteNode.draggable = true;
      const ft = document.getElementById('fileTree');
      insertSorted(ft, noteNode, rawName, 'note');
      flashElement(noteNode);
    }

    try {
      // Lock tree reloads BEFORE the POST — server emits SSE immediately
      dbWriteLock = true;
      clearTimeout(dbWriteTimeout);

      const res = await fetch('/api/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: notePath, title: rawName, visibility: vis, content: '' }),
      });
      if (!res.ok) {
        dbWriteLock = false;
        if (noteNode) noteNode.remove();
        toast('Failed to create note', 'error');
        return;
      }
      toast('Note created!', 'success');

      focusTitleOnEdit = true;
      currentNote = { path: notePath + '.md', title: rawName, visibility: vis, content: '' };

      // Update sidebar active state directly (don't call openNote to avoid race)
      const fullPath = notePath + '.md';
      document.querySelectorAll('.tree-note').forEach(el => {
        el.classList.toggle('active', el.dataset.path === fullPath);
      });
      const urlPath = '/note/' + notePath;
      window.history.pushState({}, '', urlPath);
      document.title = `${rawName} — My Notes`;

      // Open editor directly with empty content
      if (!isEditMode) {
        isEditMode = true;
        refreshToggleBtn();
        enterEditMode();
      } else {
        if (editorTextarea) {
          editorTextarea.value = '';
          autoResize(editorTextarea);
        }
        updateEditorHeader(currentNote);
      }
      const cp = document.getElementById('contentPane');
      if (cp) cp.style.display = 'none';

      // Release lock and do one clean reload
      dbWriteTimeout = setTimeout(() => {
        dbWriteLock = false;
        if (typeof window.loadTree === 'function') window.loadTree();
      }, 1200);
    } catch (err) {
      console.error(err);
      dbWriteLock = false;
      if (noteNode) noteNode.remove();
      toast('Failed to create note', 'error');
    }
  }

  async function handleTitleRename() {
    if (!currentNote) return;
    const oldTitle = currentNote.title || '';
    const ti = document.getElementById('editorTitleInput');
    const newTitle = ti ? ti.value.trim() : '';
    if (!newTitle || newTitle === oldTitle) return;

    const oldPath = currentNote.path;
    const parts = oldPath.split('/');
    const newPathName = newTitle.endsWith('.md') ? newTitle : (newTitle + '.md');
    parts[parts.length - 1] = newPathName;
    const newPath = parts.join('/');

    if (newPath === oldPath) {
      if (newTitle === oldTitle) return;
    }

    try {
      const res = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath, type: 'note' }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        toast(errData.error || 'Rename failed', 'error');
        if (ti) ti.value = oldTitle;
        return;
      }

      currentNote.path = newPath;
      currentNote.title = newTitle;
      if (typeof currentPath !== 'undefined') currentPath = newPath;

      const urlPath = '/note/' + newPath.replace(/\.md$/, '');
      window.history.replaceState({}, '', urlPath);

      const displayTitle = document.querySelector('.note-title-display');
      if (displayTitle) displayTitle.childNodes[0].nodeValue = newTitle + ' ';

      toast('Renamed note file!', 'success');
      triggerDbWriteSync();
    } catch (err) {
      console.error(err);
      toast('Rename failed', 'error');
      if (ti) ti.value = oldTitle;
    }
  }


  function showNewFolderModal(parentPath) {
    showModal('New Folder', `
      <div class="form-group">
        <label>Folder name</label>
        <input type="text" id="mFolderName" value="${xss(parentPath ? parentPath + '/' : '')}" placeholder="my-folder" autocomplete="off" autofocus>
      </div>`,
      'Create', async () => {
        const name = document.getElementById('mFolderName')?.value.trim();
        if (!name) return;
        
        // OPTIMISTIC UI: Add functional folder to tree
        const ft = document.getElementById('fileTree');
        let folderNode;
        if (typeof buildFolderNode === 'function') {
          folderNode = buildFolderNode({ name: name.split('/').pop(), path: name, type: 'folder', children: [] });
        } else {
          folderNode = document.createElement('div');
          folderNode.className = 'tree-folder';
          folderNode.innerHTML = `<div class="tree-folder-header" data-path="${xss(name)}"><span>${xss(name.split('/').pop())}</span></div>`;
        }
        
        // Append inside parent folder or root
        if (parentPath) {
           const parentHeader = document.querySelector(`[data-path="${parentPath.replace(/"/g, '\\"')}"]`);
           if (parentHeader && parentHeader.nextElementSibling) {
              parentHeader.nextElementSibling.appendChild(folderNode);
              parentHeader.querySelector('.folder-chevron')?.classList.add('open');
              parentHeader.nextElementSibling.style.display = '';
           } else {
              ft.appendChild(folderNode);
           }
        } else {
           ft.appendChild(folderNode);
        }

        const res = await fetch('/api/folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: name }),
        });
        if (!res.ok) { folderNode.remove(); toast('Failed to create folder', 'error'); return; }
        toast('Folder created!', 'success');
        triggerDbWriteSync();
      }
    );
    setTimeout(() => { const i = document.getElementById('mFolderName'); i?.focus(); i?.select(); }, 60);
  }

  function showRenameModal(type, itemPath, currentName) {
    showModal(
      `Rename ${type === 'note' ? 'Note' : 'Folder'}`,
      `<div class="form-group">
        <label>New name</label>
        <input type="text" id="mNewName" value="${xss(currentName)}" autocomplete="off">
      </div>`,
      'Rename', async () => {
        const newName = document.getElementById('mNewName')?.value.trim();
        if (!newName || newName === currentName) return;
        const dir     = itemPath.split('/').slice(0, -1).join('/');
        const newPath = dir ? `${dir}/${newName}` : newName;
        closeModal();

        // OPTIMISTIC UI: Instantly rename in tree
        const el = document.querySelector(`[data-path="${itemPath.replace(/"/g, '\\"')}"]`);
        if (el) {
          if (type === 'note') {
            const titleSpan = el.querySelector('.note-title');
            if (titleSpan) titleSpan.textContent = newName;
            el.dataset.path = newPath;
          } else {
            const nameSpan = el.querySelector('.folder-name');
            if (nameSpan) nameSpan.textContent = newName;
            el.dataset.path = newPath;
            // Cascade update children paths
            const prefix = itemPath + '/';
            const newPrefix = newPath + '/';
            el.closest('.tree-folder')?.querySelectorAll('[data-path]').forEach(childEl => {
              if (childEl.dataset.path && childEl.dataset.path.startsWith(prefix)) {
                childEl.dataset.path = childEl.dataset.path.replace(prefix, newPrefix);
              }
            });
          }
        }

        // OPTIMISTIC UI: Update currentNote if it was the one renamed
        if (type === 'note' && currentNote && currentNote.path === (itemPath.endsWith('.md') ? itemPath : itemPath + '.md')) {
          const newNp = newPath.endsWith('.md') ? newPath : newPath + '.md';
          currentNote.path = newNp;
          currentNote.title = newName;
          if (typeof currentPath !== 'undefined') currentPath = newNp;
          const urlPath = '/note/' + newNp.replace(/\.md$/, '');
          window.history.replaceState({}, '', urlPath);
          const editorTitle = document.getElementById('editorTitleInput');
          if (editorTitle) editorTitle.value = newName;
          const displayTitle = document.querySelector('.note-title-display');
          if (displayTitle) displayTitle.childNodes[0].nodeValue = newName + ' ';
        }

        const res = await fetch('/api/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath: itemPath, newPath, type }),
        });
        if (!res.ok) { 
          toast('Rename failed', 'error'); 
          triggerDbWriteSync();
          return; 
        }
        toast('Renamed!', 'success');
        triggerDbWriteSync();
      }
    );
    setTimeout(() => { const i = document.getElementById('mNewName'); i?.focus(); i?.select(); }, 60);
  }

  function confirmDelete(type, itemPath, name) {
    showModal(
      `Delete ${type === 'note' ? 'Note' : 'Folder'}`,
      `<p style="color:var(--text-normal)">Delete <strong>"${xss(name)}"</strong>?${
        type === 'folder'
          ? '<br><small style="color:var(--primary-red);margin-top:.35rem;display:block;">All notes inside will also be deleted.</small>'
          : ''
      }</p>`,
      'Delete', async () => {
        const isNote = type === 'note';
        
        // OPTIMISTIC UI: Remove from tree
        const el = document.querySelector(`[data-path="${itemPath.replace(/"/g, '\\"')}"]`);
        if (el) el.closest(isNote ? '.tree-note' : '.tree-folder')?.remove();
        
        const np = isNote ? (itemPath.endsWith('.md') ? itemPath : itemPath + '.md') : itemPath;
        const encodedPath = np.split('/').map(encodeURIComponent).join('/');
        const url = isNote ? '/api/note/' + encodedPath : '/api/folder/' + encodedPath;
        
        const res = await fetch(url, { method: 'DELETE' });
        if (!res.ok) { toast('Delete failed', 'error'); triggerDbWriteSync(); return; }
        toast('Deleted', 'info');
        // If we deleted the currently open note, exit edit mode and show welcome
        if (isNote && currentNote?.path === (itemPath.endsWith('.md') ? itemPath : itemPath + '.md')) {
          currentNote = null;
          if (isEditMode) { isEditMode = false; refreshToggleBtn(); exitEditMode(); }
          if (typeof showWelcome === 'function') showWelcome();
        }
        triggerDbWriteSync();
      },
      true /* danger */
    );
  }

  /* ── Util ───────────────────────────────────────────────────────────────── */
  function xss(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Insert sorted alphabetically (folders first, then notes) ─────────── */
  function insertSorted(container, newNode, itemName, itemType) {
    const children = Array.from(container.children);
    // Find the right insertion point
    for (const child of children) {
      const childIsFolder = child.classList.contains('tree-folder');
      const childIsNote   = child.classList.contains('tree-note');
      const childName     = (child.querySelector('.folder-name') || child.querySelector('.note-title'))?.textContent?.trim() || '';
      // Folders before notes
      if (itemType === 'note' && childIsFolder) continue;
      if (itemType === 'folder' && childIsNote) { container.insertBefore(newNode, child); return; }
      if (itemName.toLowerCase() < childName.toLowerCase()) {
        container.insertBefore(newNode, child);
        return;
      }
    }
    container.appendChild(newNode);
  }

  /* ── Flash highlight on a just-moved element ───────────────────────────── */
  function flashElement(el) {
    if (!el) return;
    el.classList.add('drop-flash');
    setTimeout(() => el.classList.remove('drop-flash'), 900);
  }

  /* ── Drag and Drop ──────────────────────────────────────────────────────── */
  function setupDragAndDrop() {
    const ft = document.getElementById('fileTree');
    if (!ft) return;
    
    // Enable draggability using observer
    const observer = new MutationObserver(() => {
      if (!isAdmin) return;
      ft.querySelectorAll('.tree-note, .tree-folder-header').forEach(el => {
        if (el.draggable !== true) el.draggable = true;
      });
    });
    observer.observe(ft, { childList: true, subtree: true });
    
    // Use event delegation for all drag and drop
    ft.addEventListener('dragstart', e => {
      if (!isAdmin) return;
      const el = e.target.closest('.tree-note') || e.target.closest('.tree-folder-header');
      if (!el) return;
      const path = el.dataset.path;
      if (path) {
        e.dataTransfer.setData('text/plain', path);
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    ft.addEventListener('dragover', e => {
      if (!isAdmin) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      const folder = e.target.closest('.tree-folder-header');
      if (folder) {
        folder.classList.add('drag-over');
      } else if (e.target === ft || e.target.classList.contains('tree-empty')) {
        ft.classList.add('drag-over');
      }
    });

    ft.addEventListener('dragleave', e => {
      if (!isAdmin) return;
      const folder = e.target.closest('.tree-folder-header');
      if (folder) folder.classList.remove('drag-over');
      if (e.target === ft || e.target.classList.contains('tree-empty')) ft.classList.remove('drag-over');
    });

    ft.addEventListener('drop', async e => {
      if (!isAdmin) return;
      e.preventDefault();
      e.stopPropagation();
      
      const folder = e.target.closest('.tree-folder-header');
      if (folder) folder.classList.remove('drag-over');
      ft.classList.remove('drag-over');
      
      let sourcePath = e.dataTransfer.getData('text/plain');
      if (!sourcePath) return;
      try { sourcePath = decodeURIComponent(sourcePath); } catch (err) {}
      
      let targetPath = null;
      const noteEl = e.target.closest('.tree-note');
      
      if (folder) {
        targetPath = folder.dataset.path || '';
      } else if (noteEl) {
        const parentChildren = noteEl.closest('.tree-folder-children');
        if (parentChildren) {
          const header = parentChildren.previousElementSibling;
          if (header && header.classList.contains('tree-folder-header')) {
            targetPath = header.dataset.path;
          }
        } else {
          targetPath = '';
        }
      } else if (e.target === ft || e.target.classList.contains('tree-empty') || e.target.classList.contains('tree-folder-children')) {
        targetPath = '';
      } else {
        return;
      }
      
      if (targetPath === null) return;
      if (targetPath === sourcePath || targetPath.startsWith(sourcePath + '/')) return;
      
      await moveItem(sourcePath, targetPath);
    });
  }

  async function moveItem(sourcePath, targetFolder) {
    const name = sourcePath.split('/').pop();
    const destPath = targetFolder ? `${targetFolder}/${name}` : name;
    
    if (sourcePath === destPath) return; // Didn't move
    
    // OPTIMISTIC UI: Instantly visually move the item
    const el = document.querySelector(`[data-path="${sourcePath.replace(/"/g, '\\"')}"]`);
    let type = 'note';
    if (el) {
      type = el.classList.contains('tree-folder-header') ? 'folder' : 'note';
      const actualNode = el.closest('.tree-note') || el.closest('.tree-folder');
      if (actualNode) {
        const targetChildren = targetFolder === '' 
           ? document.getElementById('fileTree')
           : document.querySelector(`[data-path="${targetFolder.replace(/"/g, '\\"')}"]`)?.nextElementSibling;
           
        if (targetChildren && (targetChildren.classList.contains('tree-folder-children') || targetChildren.id === 'fileTree')) {
          el.dataset.path = destPath; // update before sort check
          
          // If folder, cascade update all children's data-path attributes
          if (type === 'folder') {
            const prefix = sourcePath + '/';
            const newPrefix = destPath + '/';
            actualNode.querySelectorAll('[data-path]').forEach(childEl => {
              if (childEl.dataset.path && childEl.dataset.path.startsWith(prefix)) {
                childEl.dataset.path = childEl.dataset.path.replace(prefix, newPrefix);
              }
            });
          }

          // Insert in sorted position instead of appending at end
          insertSorted(targetChildren, actualNode, name, type);
          flashElement(actualNode);
        }
      }
    }
    
    // OPTIMISTIC UI: Update currentNote if it was the one moved
    if (type === 'note' && currentNote && currentNote.path === (sourcePath.endsWith('.md') ? sourcePath : sourcePath + '.md')) {
      const newNp = destPath.endsWith('.md') ? destPath : destPath + '.md';
      currentNote.path = newNp;
      if (typeof currentPath !== 'undefined') currentPath = newNp;
      const urlPath = '/note/' + newNp.replace(/\.md$/, '');
      window.history.pushState({}, '', urlPath);
    }
    
    try {
      const res = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: sourcePath, newPath: destPath, type })
      });
      if (!res.ok) {
        if (typeof toast === 'function') toast('Move failed', 'error');
        triggerDbWriteSync();
        return;
      }
      // Success, SSE handles tree update
    } catch (e) {
      if (typeof toast === 'function') toast('Move failed', 'error');
      triggerDbWriteSync();
    }
  }

})();
