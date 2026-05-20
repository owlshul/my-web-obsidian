/* ─────────────────────────────────────────────────────────────────────────────
   highlights.js — Text highlighting logic and persistence
───────────────────────────────────────────────────────────────────────────── */

window.HighlightsManager = (function() {
  let isAutoHighlight = false;
  let currentNotePath = null;
  let currentNoteBody = null;
  
  const STORAGE_KEY = 'obsidian_highlights';

  function getHighlights() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveHighlights(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  let activeColor = localStorage.getItem('activeHighlightColor') || 'yellow';

  function toggleAutoHighlight() {
    isAutoHighlight = !isAutoHighlight;
    const desktopBtn = document.getElementById('toggleHighlighter');
    if (desktopBtn) desktopBtn.classList.toggle('active', isAutoHighlight);
    
    // Show/hide color palette
    const colorPalette = document.getElementById('colorPalette');
    if (colorPalette) {
      if (isAutoHighlight) {
        colorPalette.classList.remove('hidden');
      } else {
        colorPalette.classList.add('hidden');
      }
    }
    
    // Hide floating button if auto is turned on
    if (isAutoHighlight) {
      document.getElementById('floatingHighlighter')?.classList.add('hidden');
    }
  }

  function initUI() {
    // Topbar Toggles
    document.getElementById('toggleHighlighter')?.addEventListener('click', toggleAutoHighlight);
    
    // Desktop Color Palette buttons
    document.querySelectorAll('.color-btn').forEach(btn => {
      const color = btn.dataset.color;
      if (color === activeColor) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeColor = color;
        localStorage.setItem('activeHighlightColor', activeColor);
      });
    });

    // Mobile popover Show Highlights button
    document.getElementById('popoverShowHighlights')?.addEventListener('click', () => {
      document.getElementById('mobileToolsPopover')?.hidePopover();
      
      const outlinePane = document.getElementById('outlinePane');
      if (outlinePane) {
        outlinePane.classList.remove('collapsed');
        outlinePane.classList.remove('hidden');
      }
      
      document.getElementById('outlineView')?.classList.remove('active');
      document.getElementById('outlineView')?.classList.add('hidden');
      document.getElementById('highlightsView')?.classList.remove('hidden');
      document.getElementById('highlightsView')?.classList.add('active');
      renderSidebar();
    });
    
    // Clear Highlights
    const clearHighlights = () => {
      if (!currentNotePath) return;
      if (confirm('Are you sure you want to clear all highlights in this note?')) {
        const data = getHighlights();
        delete data[currentNotePath];
        saveHighlights(data);
        
        // Remove visuals
        if (currentNoteBody) {
          const marks = currentNoteBody.querySelectorAll('mark.highlight');
          marks.forEach(mark => {
            const parent = mark.parentNode;
            while(mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            parent.removeChild(mark);
            parent.normalize(); // merge text nodes
          });
        }
        renderSidebar();
      }
    };
    document.getElementById('clearHighlightsBtn')?.addEventListener('click', clearHighlights);
    document.getElementById('popoverClearHighlightsBtn')?.addEventListener('click', clearHighlights);

    // Sidebar View Toggles
    document.getElementById('viewHighlightsBtn')?.addEventListener('click', () => {
      document.getElementById('outlineView')?.classList.remove('active');
      document.getElementById('outlineView')?.classList.add('hidden');
      document.getElementById('highlightsView')?.classList.remove('hidden');
      document.getElementById('highlightsView')?.classList.add('active');
      renderSidebar();
    });

    document.getElementById('backToOutlineBtn')?.addEventListener('click', () => {
      document.getElementById('highlightsView')?.classList.remove('active');
      document.getElementById('highlightsView')?.classList.add('hidden');
      document.getElementById('outlineView')?.classList.remove('hidden');
      document.getElementById('outlineView')?.classList.add('active');
    });

    // Floating Button Container level click (highly reliable)
    document.getElementById('floatingHighlighter')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const selection = window.getSelection();
      if (!selection.isCollapsed) {
        createHighlightFromSelection(selection);
        selection.removeAllRanges();
        document.getElementById('floatingHighlighter')?.classList.add('hidden');
      }
    });

    // Text Selection Listeners
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('mouseup', handleSelectionEnd);
    document.addEventListener('touchend', handleSelectionEnd);
  }

  let selectionEndTimeout = null;

  function processSelection() {
    const selection = window.getSelection();
    const floatingMenu = document.getElementById('floatingHighlighter');

    if (!selection || selection.isCollapsed || !currentNoteBody) {
      floatingMenu?.classList.add('hidden');
      return;
    }

    if (!currentNoteBody.contains(selection.anchorNode) || !currentNoteBody.contains(selection.focusNode)) {
      floatingMenu?.classList.add('hidden');
      return;
    }

    const range = selection.getRangeAt(0);
    const text = range.toString().trim();
    if (!text) return;

    if (isAutoHighlight) {
      createHighlightFromSelection(selection);
      selection.removeAllRanges();
    } else {
      // Show floating menu
      const rect = range.getBoundingClientRect();
      if (floatingMenu) {
        const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
        if (isMobile) {
          floatingMenu.classList.add('mobile-docked');
          floatingMenu.style.left = '';
          floatingMenu.style.top = '';
        } else {
          floatingMenu.classList.remove('mobile-docked');
          // Float centered horizontally above the selection
          const center = rect.left + rect.width / 2;
          floatingMenu.style.left = `${center}px`;
          floatingMenu.style.top = `${rect.top}px`; // position: fixed takes viewport-relative rect.top directly!
        }
        floatingMenu.classList.remove('hidden');
      }
    }
  }

  function handleSelectionChange() {
    const floatingMenu = document.getElementById('floatingHighlighter');
    const selection = window.getSelection();
    
    // Hide immediately if selection is lost or collapsed
    if (!selection || selection.isCollapsed) {
      floatingMenu?.classList.add('hidden');
    }
    
    // Debounce processing so it triggers when dragging handles stabilizes
    clearTimeout(selectionEndTimeout);
    selectionEndTimeout = setTimeout(() => {
      processSelection();
    }, 400); // 400ms is a safe delay for mobile handle drags
  }

  function handleSelectionEnd(e) {
    // Ignore clicks on the floating button itself
    if (e && e.target && e.target.closest && e.target.closest('#floatingHighlighter')) return;

    // Fast path for mouseup / quick taps
    clearTimeout(selectionEndTimeout);
    selectionEndTimeout = setTimeout(() => {
      processSelection();
    }, 50);
  }

  function createHighlightFromSelection(selection) {
    if (!currentNoteBody || !currentNotePath) return;
    const range = selection.getRangeAt(0);
    const text = range.toString();
    if (!text.trim()) return;

    // Calculate absolute offset
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(currentNoteBody);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preSelectionRange.toString().length;

    const highlight = {
      id: Date.now().toString(),
      text: text,
      startOffset: startOffset,
      length: text.length,
      timestamp: Date.now(),
      color: activeColor // Save current color choice
    };

    const data = getHighlights();
    if (!data[currentNotePath]) data[currentNotePath] = [];
    data[currentNotePath].push(highlight);
    saveHighlights(data);

    // Apply instantly
    applyHighlight(highlight);
    renderSidebar();
  }

  function applyHighlight(highlight) {
    if (!currentNoteBody) return;
    
    // Walk text nodes to find the exact character range
    const textNodes = [];
    const walker = document.createTreeWalker(currentNoteBody, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    let currentOffset = 0;
    let startNode = null;
    let startNodeOffset = 0;
    let endNode = null;
    let endNodeOffset = 0;

    for (const tNode of textNodes) {
      const nodeLen = tNode.nodeValue.length;
      
      // Find Start
      if (!startNode && currentOffset + nodeLen > highlight.startOffset) {
        startNode = tNode;
        startNodeOffset = highlight.startOffset - currentOffset;
      }
      
      // Find End
      if (startNode && currentOffset + nodeLen >= highlight.startOffset + highlight.length) {
        endNode = tNode;
        endNodeOffset = (highlight.startOffset + highlight.length) - currentOffset;
        break;
      }
      
      currentOffset += nodeLen;
    }

    if (!startNode || !endNode) return; // Could not find exact text match (document changed)

    try {
      const range = document.createRange();
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      
      // Because a highlight might span multiple elements (like across a bold tag),
      // we must wrap it carefully. document.execCommand('hiliteColor') is deprecated.
      // A robust way to wrap a range that spans nodes is to use CSS Custom Highlights API
      // if available, but for wider support we manually wrap or use a trick.
      // Since wrapping across boundaries is hard, we'll extract the contents and wrap text nodes.
      
      // Simpler robust method: wrap each text node in the range individually.
      const nodesToWrap = [];
      const extractWalker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null, false);
      let curr = extractWalker.nextNode();
      while(curr) {
        if (range.intersectsNode(curr)) {
          nodesToWrap.push(curr);
        }
        curr = extractWalker.nextNode();
      }

      nodesToWrap.forEach(n => {
        let nStart = 0;
        let nEnd = n.nodeValue.length;
        if (n === startNode) nStart = startNodeOffset;
        if (n === endNode) nEnd = endNodeOffset;
        
        if (nStart === nEnd) return;
        
        const textToWrap = n.nodeValue.substring(nStart, nEnd);
        const beforeText = n.nodeValue.substring(0, nStart);
        const afterText = n.nodeValue.substring(nEnd);
        
        const fragment = document.createDocumentFragment();
        if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
        
        const mark = document.createElement('mark');
        mark.className = `highlight ${highlight.color || 'yellow'}`;
        mark.dataset.id = highlight.id;
        mark.textContent = textToWrap;
        
        // Add click listener to scroll
        mark.addEventListener('click', (e) => {
          e.stopPropagation();
          // Optional: we could show a tooltip to delete it
        });
        
        fragment.appendChild(mark);
        if (afterText) fragment.appendChild(document.createTextNode(afterText));
        
        n.parentNode.replaceChild(fragment, n);
      });
      
    } catch (e) {
      console.warn("Failed to apply highlight visually. Text may have changed.", e);
    }
  }

  function onNoteLoaded(bodyElement, path) {
    currentNoteBody = bodyElement;
    currentNotePath = path;
    
    const data = getHighlights();
    const highlights = data[path] || [];
    
    // Sort descending by offset so DOM manipulations don't shift subsequent targets
    highlights.sort((a, b) => b.startOffset - a.startOffset);
    
    highlights.forEach(h => applyHighlight(h));
    renderSidebar();
  }

  function clearSidebar() {
    currentNotePath = null;
    currentNoteBody = null;
    renderSidebar();
  }

  function renderSidebar() {
    const container = document.getElementById('highlightsListContainer');
    if (!container) return;
    
    if (!currentNotePath) {
      container.innerHTML = '<div class="highlight-empty">Open a note to see its highlights.</div>';
      return;
    }

    const data = getHighlights();
    const highlights = data[currentNotePath] || [];

    if (highlights.length === 0) {
      container.innerHTML = '<div class="highlight-empty">No highlights in this note yet.<br><br>Select some text to highlight it!</div>';
      return;
    }

    container.innerHTML = '';
    // Sort by chronological appearance in doc (ascending offset)
    const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);

    sorted.forEach(h => {
      const item = document.createElement('div');
      item.className = 'highlight-item';
      
      // Truncate text for sidebar
      let display = h.text;
      if (display.length > 80) display = display.substring(0, 80) + '...';
      
      item.textContent = display;
      
      item.addEventListener('click', () => {
        // Find the mark element and scroll to it
        const mark = currentNoteBody?.querySelector(`mark[data-id="${h.id}"]`);
        if (mark) {
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
          mark.style.transition = 'background-color 0.3s';
          const originalBg = mark.style.backgroundColor;
          mark.style.backgroundColor = 'rgba(255, 100, 100, 0.6)'; // Flash red
          setTimeout(() => { mark.style.backgroundColor = originalBg; }, 600);
          
          if (window.innerWidth <= 1024) {
            document.getElementById('outlinePane')?.classList.add('collapsed');
          }
        }
      });
      
      container.appendChild(item);
    });
  }

  document.addEventListener('DOMContentLoaded', initUI);

  return {
    onNoteLoaded,
    clearSidebar
  };
})();
