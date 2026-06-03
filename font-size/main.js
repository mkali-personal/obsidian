'use strict';

const { Plugin } = require('obsidian');
const { EditorView, Decoration } = require('@codemirror/view');
const { StateField } = require('@codemirror/state');

const CLOSE_TAG = '</font>';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Block-level markdown that cannot live inside a <font> wrapper.
function isBlockLine(line) {
  const t = line.trim();
  return /^#{1,6}\s/.test(t)  ||   // headings
         /^!\[\[/.test(t)      ||   // Obsidian image embeds
         /^!\[.*?\]\(/.test(t) ||   // markdown images
         /^-{3,}$/.test(t)     ||   // horizontal rules
         /^\|/.test(t)         ||   // table rows
         /^>/.test(t)          ||   // blockquotes
         /^```/.test(t);            // code fences
}

function makeOpenTag(delta) {
  return `<font size="${delta > 0 ? '+' : ''}${delta}">`;
}

function wrapSegment(text, delta) {
  return makeOpenTag(delta) + text + CLOSE_TAG;
}

// Wrap contiguous resizable lines; leave block lines unwrapped between them.
function wrapText(text, delta) {
  const lines = text.split('\n');
  if (lines.length === 1) return isBlockLine(text) ? text : wrapSegment(text, delta);

  const out = [];
  let buf   = [];

  const flush = () => {
    if (buf.length) { out.push(wrapSegment(buf.join('\n'), delta)); buf = []; }
  };

  for (const line of lines) {
    if (isBlockLine(line)) { flush(); out.push(line); }
    else buf.push(line);
  }
  flush();
  return out.join('\n');
}

// ── Font-region detection ─────────────────────────────────────────────────────

function findFontRegions(text) {
  const regions = [];
  const re = /<font size="([+-]\d+)">([\s\S]*?)<\/font>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const delta     = parseInt(m[1], 10);
    const openTag   = `<font size="${m[1]}">`;
    const openFrom  = m.index;
    const openTo    = openFrom + openTag.length;
    const closeTo   = openFrom + m[0].length;
    const closeFrom = closeTo - CLOSE_TAG.length;
    regions.push({ openFrom, openTo, contentFrom: openTo, contentTo: closeFrom, closeFrom, closeTo, delta });
  }
  return regions;
}

// ── Command helpers ───────────────────────────────────────────────────────────

function applyFontSize(cm, delta) {
  const text = cm.state.doc.toString();
  const { from, to } = cm.state.selection.main;
  if (from === to) return;

  // If the selection sits entirely within an existing region, adjust that region.
  const inside = findFontRegions(text).find(r => r.contentFrom <= from && to <= r.contentTo);
  if (inside) {
    const newDelta = inside.delta + delta;
    if (newDelta === 0) {
      // Removing both tags together avoids a transient ghost state.
      cm.dispatch({ changes: [
        { from: inside.openFrom,  to: inside.openTo,  insert: '' },
        { from: inside.closeFrom, to: inside.closeTo, insert: '' },
      ]});
    } else {
      cm.dispatch({ changes: { from: inside.openFrom, to: inside.openTo, insert: makeOpenTag(newDelta) } });
    }
    return;
  }

  const selected = text.slice(from, to);
  const wrapped  = wrapText(selected, delta);
  if (wrapped !== selected) cm.dispatch({ changes: { from, to, insert: wrapped } });
}

function removeFontSize(cm) {
  const text = cm.state.doc.toString();
  const { from, to } = cm.state.selection.main;
  if (from === to) return;

  const inside = findFontRegions(text).find(r => r.contentFrom <= from && to <= r.contentTo);
  if (!inside) return;

  cm.dispatch({ changes: [
    { from: inside.openFrom,  to: inside.openTo,  insert: '' },
    { from: inside.closeFrom, to: inside.closeTo, insert: '' },
  ]});
}

// ── Decorations (Live Preview) ────────────────────────────────────────────────
// <font> tags are always hidden; the content range gets a CSS class for the
// visual size change. Tags are never revealed, even when the cursor is inside —
// the user manipulates sizing exclusively through the commands.

function buildDecos(text) {
  const decos = [];
  const re = /<font size="([+-]\d+)">([\s\S]*?)<\/font>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const delta     = parseInt(m[1], 10);
    const openTag   = `<font size="${m[1]}">`;
    const openFrom  = m.index;
    const openTo    = openFrom + openTag.length;
    const closeTo   = openFrom + m[0].length;
    const closeFrom = closeTo - CLOSE_TAG.length;
    const cls = delta > 0
      ? `font-size-plus-${delta}`
      : `font-size-minus-${Math.abs(delta)}`;

    decos.push(Decoration.replace({}).range(openFrom, openTo));
    if (openTo < closeFrom) {
      decos.push(Decoration.mark({ class: cls }).range(openTo, closeFrom));
    }
    decos.push(Decoration.replace({}).range(closeFrom, closeTo));
  }
  return Decoration.set(decos, true);
}

const fontSizeField = StateField.define({
  create:  state      => buildDecos(state.doc.toString()),
  update:  (decs, tr) => tr.docChanged ? buildDecos(tr.state.doc.toString()) : decs,
  provide: f          => EditorView.decorations.from(f),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

class FontSizePlugin extends Plugin {
  async onload() {
    this.registerEditorExtension([fontSizeField]);

    this.addCommand({
      id:   'font-size-increase',
      name: 'Font Size: Increase',
      editorCallback: (editor) => applyFontSize(editor.cm, +1),
    });

    this.addCommand({
      id:   'font-size-decrease',
      name: 'Font Size: Decrease',
      editorCallback: (editor) => applyFontSize(editor.cm, -1),
    });

    this.addCommand({
      id:   'font-size-remove',
      name: 'Font Size: Remove',
      editorCallback: (editor) => removeFontSize(editor.cm),
    });
  }
}

module.exports = FontSizePlugin;
