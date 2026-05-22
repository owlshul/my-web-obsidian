import { EditorState, StateField, StateEffect } from 'https://esm.sh/@codemirror/state@6';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration, MatchDecorator, ViewPlugin, WidgetType } from 'https://esm.sh/@codemirror/view@6';
import { defaultKeymap, history, historyKeymap, indentWithTab } from 'https://esm.sh/@codemirror/commands@6';
import { markdown, markdownLanguage } from 'https://esm.sh/@codemirror/lang-markdown@6';
import { HighlightStyle, syntaxHighlighting } from 'https://esm.sh/@codemirror/language@6';
import { tags } from 'https://esm.sh/@lezer/highlight@1';

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
  '.cm-content': { padding: '1.5rem', caretColor: 'var(--accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent) !important', borderLeftWidth: '2px' },
  '.cm-activeLine': { backgroundColor: 'rgba(232,184,75,0.02)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(232,184,75,0.18) !important' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-1)',
    borderRight: '1px solid var(--border)',
    color: 'var(--text-faint)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 1rem', minWidth: '2.5rem' },
  
  /* LIVE PREVIEW CSS HACKS */
  /* Hide markdown formatting marks by default */
  '.cm-formatting': {
    display: 'none',
  },
  /* Reveal formatting marks when the line is active */
  '.cm-activeLine .cm-formatting': {
    display: 'inline',
    color: 'var(--text-faint)',
  },
  /* Different heading sizes in editor */
  '.cm-heading1': { fontSize: '2em', fontWeight: 'bold' },
  '.cm-heading2': { fontSize: '1.6em', fontWeight: 'bold' },
  '.cm-heading3': { fontSize: '1.3em', fontWeight: 'bold' },
  
}, { dark: true });

// ─── Syntax highlight style ───────────────────────────────────────────────────
const primaryHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: 'var(--primary-red)', fontWeight: '700', fontFamily: 'var(--font-heading)' },
  { tag: tags.heading2, color: 'var(--primary-orange)', fontWeight: '700', fontFamily: 'var(--font-heading)' },
  { tag: tags.heading3, color: 'var(--primary-yellow)', fontWeight: '600', fontFamily: 'var(--font-heading)' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: 'var(--primary-green)', fontWeight: '600' },
  { tag: tags.strong,       color: 'var(--text-normal)', fontWeight: '700' },
  { tag: tags.emphasis,     color: 'var(--accent)', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: 'var(--text-muted)', textDecoration: 'line-through' },
  { tag: tags.link,         color: 'var(--link)' },
  { tag: tags.url,          color: 'var(--primary-blue)', textDecoration: 'underline' },
  { tag: tags.monospace,    color: 'var(--code-tx)', backgroundColor: 'var(--code-bg)', borderRadius: '3px', padding: '0 3px' },
  { tag: tags.meta,         color: 'var(--text-faint)', class: 'cm-formatting' },
  { tag: tags.processingInstruction, color: 'var(--text-faint)', class: 'cm-formatting' },
  { tag: tags.quote,        color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: tags.list,         color: 'var(--accent)' },
  { tag: tags.comment,      color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: tags.keyword,      color: 'var(--primary-red)' },
  { tag: tags.string,       color: 'var(--primary-green)' },
  { tag: tags.number,       color: 'var(--primary-blue)' },
  { tag: tags.punctuation,  color: 'var(--text-muted)', class: 'cm-formatting' },
]);

export function createEditor(parentEl, initialContent, onChange) {
  const startState = EditorState.create({
    doc: initialContent || '',
    extensions: [
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
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged && onChange) onChange('change');
      }),
    ],
  });

  return new EditorView({ state: startState, parent: parentEl });
}

export function getContent(view) {
  return view ? view.state.doc.toString() : '';
}

export function setContent(view, content) {
  if (!view) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content || '' },
    selection: { anchor: 0 },
  });
}

export { EditorView };
