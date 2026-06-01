'use strict';

const { Plugin, MarkdownView } = require('obsidian');
const { EditorView, Decoration, WidgetType } = require('@codemirror/view');
const { StateField, StateEffect } = require('@codemirror/state');

// Marker written into the opening fence info-string when a block is folded.
// e.g.  ```python  →  ```python {fold}
const FOLD_MARKER = ' {fold}';

// ---------------------------------------------------------------------------
// State effects
// ---------------------------------------------------------------------------

const foldEffect     = StateEffect.define();
const unfoldEffect   = StateEffect.define();
const clearAllEffect = StateEffect.define();

// ---------------------------------------------------------------------------
// Widget displayed in place of a folded code block
// ---------------------------------------------------------------------------

class FoldWidget extends WidgetType {
  constructor(preview, blockFrom) {
    super();
    this.preview   = preview;
    this.blockFrom = blockFrom;
  }

  toDOM(view) {
    const el = document.createElement('span');
    el.className = 'code-fold-widget';
    el.textContent = this.preview + ' …';
    el.title = 'Click to unfold';

    const blockFrom = this.blockFrom;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Remove the in-text marker AND the decoration in one transaction.
      const text   = view.state.doc.toString();
      const marker = findFoldMarker(text, blockFrom);

      if (marker) {
        view.dispatch({
          changes: { from: marker.from, to: marker.to, insert: '' },
          effects: unfoldEffect.of({ from: blockFrom }),
        });
      } else {
        // Marker somehow missing — remove decoration only.
        view.dispatch({ effects: unfoldEffect.of({ from: blockFrom }) });
      }
    });

    return el;
  }

  eq(other) {
    return (
      other instanceof FoldWidget &&
      this.preview   === other.preview &&
      this.blockFrom === other.blockFrom
    );
  }

  ignoreEvent(e) { return e instanceof MouseEvent; }
}

// ---------------------------------------------------------------------------
// StateField storing active fold decorations
// ---------------------------------------------------------------------------

const foldField = StateField.define({
  create: () => Decoration.none,

  update(set, tr) {
    // Map existing decoration positions through any document changes first.
    set = set.map(tr.changes);

    for (const e of tr.effects) {
      if (e.is(foldEffect)) {
        const { from, to, preview } = e.value;
        set = set.update({
          add:  [Decoration.replace({ widget: new FoldWidget(preview, from) }).range(from, to)],
          sort: true,
        });
      } else if (e.is(unfoldEffect)) {
        const target = e.value.from;
        set = set.update({ filter: (from) => from !== target });
      } else if (e.is(clearAllEffect)) {
        set = Decoration.none;
      }
    }

    return set;
  },

  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse every fenced code block in `text`.
 * Blocks whose info-string contains `{fold}` get `isFolded: true`; the marker
 * is stripped from `lang` so the preview label stays clean.
 */
function findCodeBlocks(text) {
  const blocks = [];
  const lines  = text.split('\n');
  let offset   = 0;
  let inBlock  = false;
  let fence    = '';
  let blockFrom = 0;
  let lang     = '';
  let isFolded = false;
  let firstLine = '';
  let seenContent = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inBlock) {
      const m = trimmed.match(/^(`{3,}|~{3,})(.*)/);
      if (m) {
        fence     = m[1];
        const info = m[2].trim();
        isFolded  = info.includes('{fold}');
        lang      = info.replace(/\s*\{fold\}\s*/g, '').trim();
        blockFrom = offset;
        firstLine = '';
        seenContent = false;
        inBlock   = true;
      }
    } else {
      const cm = trimmed.match(/^(`{3,}|~{3,})\s*$/);
      if (cm && cm[1][0] === fence[0] && cm[1].length >= fence.length) {
        const words = firstLine.split(/\s+/).slice(0, 5).join(' ');
        blocks.push({ from: blockFrom, to: offset + line.length, lang, firstLine: words, isFolded });
        inBlock = false;
      } else if (!seenContent && trimmed) {
        firstLine   = trimmed;
        seenContent = true;
      }
    }

    offset += line.length + 1; // +1 for the '\n'
  }

  return blocks;
}

/**
 * Return the character range of FOLD_MARKER in the opening fence line of the
 * block that starts at `blockFrom`, or null if not present.
 */
function findFoldMarker(text, blockFrom) {
  const lineEnd    = text.indexOf('\n', blockFrom);
  const openLine   = text.slice(blockFrom, lineEnd === -1 ? text.length : lineEnd);
  const idx        = openLine.indexOf(FOLD_MARKER);
  if (idx === -1) return null;
  return { from: blockFrom + idx, to: blockFrom + idx + FOLD_MARKER.length };
}

/** Position just before the '\n' of the opening fence line (where we insert the marker). */
function markerInsertPos(text, blockFrom) {
  const lineEnd = text.indexOf('\n', blockFrom);
  return lineEnd === -1 ? text.length : lineEnd;
}

function makePreview(lang, firstLine) {
  let p = '```' + (lang || '');
  if (firstLine) p += '  ' + firstLine;
  return p;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

class CodeBlockFoldPlugin extends Plugin {
  async onload() {
    const plugin = this;

    this.registerEditorExtension([foldField]);

    // Reapply decorations whenever a file is opened (the marker is already in
    // the text; we only need to rebuild the visual layer).
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file) return;
        const filePath = file.path;
        setTimeout(() => {
          const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
          if (!view || !view.file || view.file.path !== filePath) return;
          const cm = view.editor && view.editor.cm;
          if (cm) plugin.restoreDecorations(cm);
        }, 100);
      })
    );

    // ── Command 1: toggle-fold every code block in the document ──────────
    this.addCommand({
      id:   'toggle-fold-all-code-blocks',
      name: 'Toggle fold all code blocks',
      editorCallback: (editor) => {
        const cm = editor.cm;
        if (!cm) return;

        const text   = cm.state.doc.toString();
        const blocks = findCodeBlocks(text);
        if (!blocks.length) return;

        if (cm.state.field(foldField).size > 0) {
          // ── Unfold all ────────────────────────────────────────────────
          // Remove every {fold} marker from the document and clear decorations.
          const changes = [];
          for (const b of blocks.filter(b => b.isFolded)) {
            const marker = findFoldMarker(text, b.from);
            if (marker) changes.push({ from: marker.from, to: marker.to, insert: '' });
          }
          cm.dispatch({ changes, effects: clearAllEffect.of(undefined) });

        } else {
          // ── Fold all ──────────────────────────────────────────────────
          // Insert {fold} into each opening fence and add a decoration.
          //
          // Because multiple insertions shift positions, each subsequent
          // effect must account for the cumulative offset of earlier inserts.
          const ml = FOLD_MARKER.length;
          const changes = [];
          const effects = [];
          let insertionsBefore = 0; // number of markers inserted into earlier blocks

          for (const b of blocks) {
            if (b.isFolded) continue; // already has the marker; decoration restored separately
            const insertPos = markerInsertPos(text, b.from);
            changes.push({ from: insertPos, insert: FOLD_MARKER });
            // from is before insertPos so it doesn't shift from earlier inserts,
            // but it DOES shift from inserts in even-earlier blocks.
            // to shifts from all insertions up to and including this one.
            effects.push(foldEffect.of({
              from:    b.from + insertionsBefore * ml,
              to:      b.to  + (insertionsBefore + 1) * ml,
              preview: makePreview(b.lang, b.firstLine),
            }));
            insertionsBefore++;
          }

          if (changes.length) cm.dispatch({ changes, effects });
        }
      },
    });

    // ── Command 2: toggle-fold the code block the cursor is inside ────────
    this.addCommand({
      id:   'toggle-fold-code-block-at-cursor',
      name: 'Toggle fold code block at cursor',
      editorCallback: (editor) => {
        const cm = editor.cm;
        if (!cm) return;

        const text   = cm.state.doc.toString();
        const cursor = cm.state.selection.main.head;
        const block  = findCodeBlocks(text).find(b => b.from <= cursor && cursor <= b.to);
        if (!block) return;

        let isDecorated = false;
        cm.state.field(foldField).between(block.from, block.to, (from) => {
          if (from === block.from) isDecorated = true;
        });

        if (isDecorated) {
          // Unfold: remove marker + decoration.
          const marker = findFoldMarker(text, block.from);
          if (marker) {
            cm.dispatch({
              changes: { from: marker.from, to: marker.to, insert: '' },
              effects: unfoldEffect.of({ from: block.from }),
            });
          } else {
            cm.dispatch({ effects: unfoldEffect.of({ from: block.from }) });
          }
        } else {
          // Fold: insert marker + add decoration.
          // Single insertion — no offset arithmetic needed.
          const insertPos = markerInsertPos(text, block.from);
          cm.dispatch({
            changes: { from: insertPos, insert: FOLD_MARKER },
            effects: foldEffect.of({
              from:    block.from,
              to:      block.to + FOLD_MARKER.length,
              preview: makePreview(block.lang, block.firstLine),
            }),
          });
        }
      },
    });
  }

  /**
   * Scan the document for blocks that already carry the {fold} marker and
   * apply the corresponding decorations. Called on file-open; no text changes
   * are made since the markers are already in the file.
   */
  restoreDecorations(cm) {
    const text    = cm.state.doc.toString();
    const effects = findCodeBlocks(text)
      .filter(b => b.isFolded)
      .map(b => foldEffect.of({ from: b.from, to: b.to, preview: makePreview(b.lang, b.firstLine) }));

    if (effects.length) cm.dispatch({ effects });
  }
}

module.exports = CodeBlockFoldPlugin;
