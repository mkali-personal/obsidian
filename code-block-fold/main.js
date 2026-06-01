'use strict';

const { Plugin, setIcon } = require('obsidian');
const { EditorView, Decoration, WidgetType } = require('@codemirror/view');
const { StateField } = require('@codemirror/state');

const FOLD_MARKER = ' {fold}';

// ── Helpers ───────────────────────────────────────────────────────────────────

function findCodeBlocks(text) {
  const blocks  = [];
  const lines   = text.split('\n');
  let offset    = 0;
  let inBlock   = false;
  let fence     = '';
  let blockFrom = 0;
  let lang      = '';
  let isFolded  = false;
  let firstLine = '';
  let seenContent  = false;
  let contentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inBlock) {
      const m = trimmed.match(/^(`{3,}|~{3,})(.*)/);
      if (m) {
        fence        = m[1];
        const info   = m[2].trim();
        isFolded     = info.includes('{fold}');
        lang         = info.replace(/\s*\{fold\}\s*/g, '').trim();
        blockFrom    = offset;
        firstLine    = '';
        seenContent  = false;
        contentLines = [];
        inBlock      = true;
      }
    } else {
      const cm = trimmed.match(/^(`{3,}|~{3,})\s*$/);
      if (cm && cm[1][0] === fence[0] && cm[1].length >= fence.length) {
        blocks.push({
          from:     blockFrom,
          to:       offset + line.length,
          lang,
          firstLine: firstLine.split(/\s+/).slice(0, 5).join(' '),
          isFolded,
          content:  contentLines.join('\n'),
        });
        inBlock = false;
      } else {
        if (!seenContent && trimmed) { firstLine = trimmed; seenContent = true; }
        contentLines.push(line);
      }
    }

    offset += line.length + 1;
  }

  return blocks;
}

function findFoldMarker(text, blockFrom) {
  const lineEnd  = text.indexOf('\n', blockFrom);
  const openLine = text.slice(blockFrom, lineEnd === -1 ? text.length : lineEnd);
  const idx      = openLine.indexOf(FOLD_MARKER);
  if (idx === -1) return null;
  return { from: blockFrom + idx, to: blockFrom + idx + FOLD_MARKER.length };
}

function markerInsertPos(text, blockFrom) {
  const lineEnd = text.indexOf('\n', blockFrom);
  return lineEnd === -1 ? text.length : lineEnd;
}

function makePreview(lang, firstLine) {
  let p = '```' + (lang || '');
  if (firstLine) p += '  ' + firstLine;
  return p;
}

// ── Widgets ───────────────────────────────────────────────────────────────────

// Small arrow shown to the left of an unfolded code block.
class ArrowWidget extends WidgetType {
  constructor(blockFrom) {
    super();
    this.blockFrom = blockFrom;
  }

  toDOM(view) {
    const el = document.createElement('span');
    el.className = 'code-fold-arrow code-fold-arrow--open';
    setIcon(el, 'chevron-down');
    el.setAttribute('aria-label', 'Fold code block');
    const from = this.blockFrom;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = view.state.doc.toString();
      view.dispatch({ changes: { from: markerInsertPos(text, from), insert: FOLD_MARKER } });
    });
    return el;
  }

  eq(other) { return other instanceof ArrowWidget && this.blockFrom === other.blockFrom; }
  ignoreEvent(e) { return e instanceof MouseEvent; }
}

// Single-line widget that replaces a folded code block.
// Contains: ▶ arrow (click to unfold) | preview text | copy button.
class FoldWidget extends WidgetType {
  constructor(lang, firstLine, blockFrom, content) {
    super();
    this.lang      = lang;
    this.firstLine = firstLine;
    this.blockFrom = blockFrom;
    this.content   = content;
  }

  toDOM(view) {
    const wrap = document.createElement('span');
    wrap.className = 'code-fold-widget';

    const arrow = document.createElement('span');
    arrow.className = 'code-fold-arrow code-fold-arrow--closed';
    setIcon(arrow, 'chevron-right');
    arrow.setAttribute('aria-label', 'Unfold code block');
    const from = this.blockFrom;
    arrow.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text   = view.state.doc.toString();
      const marker = findFoldMarker(text, from);
      if (marker) view.dispatch({ changes: { from: marker.from, to: marker.to, insert: '' } });
    });

    const preview = document.createElement('span');
    preview.className   = 'code-fold-preview';
    preview.textContent = makePreview(this.lang, this.firstLine) + ' …';

    const copyBtn = document.createElement('button');
    copyBtn.className   = 'code-fold-copy-btn';
    copyBtn.textContent = this.lang || 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy code');
    const content = this.content;
    const lang    = this.lang;
    copyBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = lang || 'Copy'; }, 1500);
      });
    });

    wrap.appendChild(arrow);
    wrap.appendChild(preview);
    wrap.appendChild(copyBtn);
    return wrap;
  }

  eq(other) {
    return other instanceof FoldWidget  &&
      this.blockFrom === other.blockFrom &&
      this.lang      === other.lang      &&
      this.firstLine === other.firstLine;
  }

  ignoreEvent(e) { return e instanceof MouseEvent; }
}

// ── Decoration field ──────────────────────────────────────────────────────────
// Decorations are derived entirely from document content (the {fold} markers),
// so no manual effects are needed — any document change triggers a rebuild.

function buildDecos(text) {
  const decos = [];
  for (const b of findCodeBlocks(text)) {
    if (b.isFolded) {
      decos.push(
        Decoration.replace({
          widget: new FoldWidget(b.lang, b.firstLine, b.from, b.content),
          inclusive: false,
        }).range(b.from, b.to)
      );
    } else {
      decos.push(
        Decoration.widget({ widget: new ArrowWidget(b.from), side: -1 }).range(b.from)
      );
    }
  }
  return Decoration.set(decos, true);
}

const codeBlockField = StateField.define({
  create:  (state)     => buildDecos(state.doc.toString()),
  update:  (decos, tr) => tr.docChanged ? buildDecos(tr.state.doc.toString()) : decos,
  provide: f           => EditorView.decorations.from(f),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

class CodeBlockFoldPlugin extends Plugin {
  async onload() {
    this.registerEditorExtension([codeBlockField]);

    this.addCommand({
      id:   'toggle-fold-all-code-blocks',
      name: 'Toggle fold all code blocks',
      editorCallback: (editor) => {
        const cm     = editor.cm;
        if (!cm) return;
        const text   = cm.state.doc.toString();
        const blocks = findCodeBlocks(text);
        if (!blocks.length) return;

        if (blocks.some(b => b.isFolded)) {
          // Unfold all: remove every {fold} marker
          const changes = [];
          for (const b of blocks.filter(b => b.isFolded)) {
            const marker = findFoldMarker(text, b.from);
            if (marker) changes.push({ from: marker.from, to: marker.to, insert: '' });
          }
          if (changes.length) cm.dispatch({ changes });
        } else {
          // Fold all: insert {fold} into each opening fence
          // All positions are relative to the original text; CM6 combines them correctly.
          const changes = [];
          for (const b of blocks) {
            changes.push({ from: markerInsertPos(text, b.from), insert: FOLD_MARKER });
          }
          if (changes.length) cm.dispatch({ changes });
        }
      },
    });

    this.addCommand({
      id:   'toggle-fold-code-block-at-cursor',
      name: 'Toggle fold code block at cursor',
      editorCallback: (editor) => {
        const cm     = editor.cm;
        if (!cm) return;
        const text   = cm.state.doc.toString();
        const cursor = cm.state.selection.main.head;
        const block  = findCodeBlocks(text).find(b => b.from <= cursor && cursor <= b.to);
        if (!block) return;

        if (block.isFolded) {
          const marker = findFoldMarker(text, block.from);
          if (marker) cm.dispatch({ changes: { from: marker.from, to: marker.to, insert: '' } });
        } else {
          cm.dispatch({ changes: { from: markerInsertPos(text, block.from), insert: FOLD_MARKER } });
        }
      },
    });
  }
}

module.exports = CodeBlockFoldPlugin;
