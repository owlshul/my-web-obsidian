/* ─────────────────────────────────────────────────────────────────────────────
   editor.js — CodeMirror 6 setup (ES module, imported by admin.js)
───────────────────────────────────────────────────────────────────────────── */

import { EditorState }                            from 'https://esm.sh/@codemirror/state@6';
import { EditorView, keymap, lineNumbers,
         highlightActiveLine, drawSelection }     from 'https://esm.sh/@codemirror/view@6';
import { defaultKeymap, history,
         historyKeymap, indentWithTab }           from 'https://esm.sh/@codemirror/commands@6';
import { markdown, markdownLanguage }             from 'https://esm.sh/@codemirror/lang-markdown@6';
import { HighlightStyle, syntaxHighlighting }     from 'https://esm.sh/@codemirror/language@6';
import { tags }                                   from 'https://esm.sh/@lezer/highlight@1';

// ─── Primary-flavoured theme ──────────────────────────────────────────────────
const primaryDark = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-0)',
    color: 'var(--tx-1)',
    height: '100%',
    fontSize: '14px',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.8' },
  '.cm-content': { padding: '1.5rem', caretColor: 'var(--clr-yellow)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--clr-yellow) !important', borderLeftWidth: '2px' },
  '.cm-activeLine': { backgroundColor: 'rgba(232,184,75,0.04)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(232,184,75,0.18) !important' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-1)',
    borderRight: '1px solid var(--border)',
    color: 'var(--tx-3)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 1rem', minWidth: '2.5rem' },
  '.cm-matchingBracket': { outline: '1px solid var(--clr-yellow)', borderRadius: '2px' },
}, { dark: true });

// ─── Syntax highlight style ───────────────────────────────────────────────────
const primaryHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: 'var(--clr-yellow)', fontWeight: '700', fontFamily: 'var(--font-heading)', fontSize: '1.4em' },
  { tag: tags.heading2, color: '#d4a840', fontWeight: '700', fontFamily: 'var(--font-heading)', fontSize: '1.2em' },
  { tag: tags.heading3, color: '#b89030', fontWeight: '600', fontFamily: 'var(--font-heading)' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: '#a08028', fontWeight: '600' },
  { tag: tags.strong,       color: 'var(--tx-0)', fontWeight: '700' },
  { tag: tags.emphasis,     color: 'var(--clr-yellow)', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: 'var(--tx-3)', textDecoration: 'line-through' },
  { tag: tags.link,         color: 'var(--link)' },
  { tag: tags.url,          color: 'var(--clr-blue)', textDecoration: 'underline' },
  { tag: tags.monospace,    color: 'var(--code-tx)', backgroundColor: 'var(--code-bg)', borderRadius: '3px', padding: '0 3px' },
  { tag: tags.meta,         color: 'var(--tx-3)' },
  { tag: tags.quote,        color: 'var(--tx-2)', fontStyle: 'italic' },
  { tag: tags.list,         color: 'var(--clr-yellow)' },
  { tag: tags.comment,      color: 'var(--tx-3)', fontStyle: 'italic' },
  { tag: tags.keyword,      color: 'var(--clr-red)' },
  { tag: tags.string,       color: 'var(--clr-green)' },
  { tag: tags.number,       color: 'var(--clr-blue)' },
  { tag: tags.punctuation,  color: 'var(--tx-3)' },
  { tag: tags.operator,     color: 'var(--tx-2)' },
]);

// ─── Create editor ────────────────────────────────────────────────────────────
export function createEditor(parentEl, initialContent, onChange) {
  const startState = EditorState.create({
    doc: initialContent || '',
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(primaryHighlight),
      primaryDark,
      EditorView.lineWrapping,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
        { key: 'Ctrl-s',   run: () => { onChange && onChange('save'); return true; } },
        { key: 'Cmd-s',    run: () => { onChange && onChange('save'); return true; } },
        { key: 'Ctrl-b',   run: view => { insertWrap(view, '**', '**'); return true; } },
        { key: 'Cmd-b',    run: view => { insertWrap(view, '**', '**'); return true; } },
        { key: 'Ctrl-i',   run: view => { insertWrap(view, '*', '*');   return true; } },
        { key: 'Cmd-i',    run: view => { insertWrap(view, '*', '*');   return true; } },
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged && onChange) onChange('change');
      }),
    ],
  });

  return new EditorView({ state: startState, parent: parentEl });
}

// ─── Toolbar actions ──────────────────────────────────────────────────────────
export function applyToolbarAction(view, action) {
  if (!view) return;

  const actions = {
    bold:           () => insertWrap(view, '**', '**'),
    italic:         () => insertWrap(view, '*', '*'),
    strike:         () => insertWrap(view, '~~', '~~'),
    code:           () => insertWrap(view, '`', '`'),
    codeblock:      () => insertWrap(view, '```\n', '\n```'),
    quote:          () => insertLinePrefix(view, '> '),
    h1:             () => insertLinePrefix(view, '# '),
    h2:             () => insertLinePrefix(view, '## '),
    h3:             () => insertLinePrefix(view, '### '),
    ul:             () => insertLinePrefix(view, '- '),
    ol:             () => insertLinePrefix(view, '1. '),
    hr:             () => insertAtCursor(view, '\n---\n'),
    link:           () => insertWrap(view, '[', '](url)'),
    image:          () => insertAtCursor(view, '![alt text](image-url)'),
    'callout-note':    () => insertAtCursor(view, '> [!NOTE]\n> Your note here\n'),
    'callout-warning': () => insertAtCursor(view, '> [!WARNING]\n> Your warning here\n'),
  };

  actions[action]?.();
  view.focus();
}

// ─── Editor helpers ───────────────────────────────────────────────────────────
function insertWrap(view, before, after) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: selected
      ? { anchor: from + before.length, head: to + before.length }
      : { anchor: from + before.length },
  });
}

function insertLinePrefix(view, prefix) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  view.dispatch({
    changes: { from: line.from, insert: prefix },
    selection: { anchor: from + prefix.length },
  });
}

function insertAtCursor(view, text) {
  const { from } = view.state.selection.main;
  view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length } });
}

// ─── Get content ─────────────────────────────────────────────────────────────
export function getContent(view) {
  return view ? view.state.doc.toString() : '';
}

// ─── Set content ─────────────────────────────────────────────────────────────
export function setContent(view, content) {
  if (!view) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content || '' },
    selection: { anchor: 0 },
  });
}

export { EditorView };
