'use strict';

const { Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, debounce } = require('obsidian');
const os = require('os');

const VIEW_TYPE = 'vault-comments-panel';

// ── Comment parsing ───────────────────────────────────────────────────────────
// Comment format in the markdown file:
//
//   > [!comment] @creator → #notify/name1 #notify/name2
//   > <!-- ts:1717123456789 -->
//   > Comment content here.
//
// The title line encodes creator and tagged users.
// The timestamp is stored as an HTML comment (invisible in rendered view).

function parseComments(filePath, content) {
  const comments = [];
  const lines    = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const titleMatch = lines[i].match(/^>\s*\[!comment\]\s*(.*)/);
    if (!titleMatch) { i++; continue; }

    const title        = titleMatch[1].trim();
    const creatorMatch = title.match(/@(\S+)/);
    const creator      = creatorMatch ? creatorMatch[1] : '?';

    const notifyTags = [];
    const tagRe = /#notify\/(\S+)/g;
    let tm;
    while ((tm = tagRe.exec(title)) !== null) notifyTags.push(tm[1]);

    // Collect callout body (lines starting with >)
    let ts = 0;
    const bodyLines = [];
    let j = i + 1;
    while (j < lines.length && /^>/.test(lines[j])) {
      const body     = lines[j].replace(/^>\s?/, '');
      const tsMatch  = body.match(/^<!--\s*ts:(\d+)\s*-->/);
      if (tsMatch) { ts = parseInt(tsMatch[1], 10); }
      else          { bodyLines.push(body); }
      j++;
    }

    comments.push({
      filePath,
      lineFrom:    i,
      creator,
      notifyTags,
      ts,
      preview: bodyLines.filter(l => l.trim()).join(' ').slice(0, 120),
    });
    i = j;
  }
  return comments;
}

// ── Notification panel ────────────────────────────────────────────────────────

class CommentsPanel extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType()    { return VIEW_TYPE; }
  getDisplayText() { return 'Vault Comments'; }
  getIcon()        { return 'bell'; }

  async onOpen() { await this.render(); }

  async render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass('vault-comments-panel');

    const username = this.plugin.getUsername();
    if (!username) {
      root.createEl('p', {
        text: 'Set your username in Settings → Community Plugins → Vault Comments.',
        cls: 'vault-comments-notice',
      });
      return;
    }

    const lastSeen = this.plugin.getLastSeen();
    const comments = await this.plugin.scanComments();
    const unread   = comments
      .filter(c => c.ts > lastSeen && c.notifyTags.includes(username))
      .sort((a, b) => b.ts - a.ts);

    // ── Header ──
    const header = root.createDiv({ cls: 'vault-comments-header' });
    header.createEl('span', {
      text: unread.length ? `${unread.length} unread` : 'No unread comments',
      cls: 'vault-comments-count',
    });

    const markBtn = header.createEl('button', { text: 'Mark as read', cls: 'vault-comments-btn' });
    markBtn.addEventListener('click', async () => {
      await this.plugin.markAsRead();
      await this.render();
    });

    const refreshBtn = header.createEl('button', { text: '↻', cls: 'vault-comments-btn vault-comments-refresh' });
    refreshBtn.setAttribute('aria-label', 'Refresh');
    refreshBtn.addEventListener('click', () => this.render());

    if (!unread.length) return;

    // ── Comment list ──
    const list = root.createDiv({ cls: 'vault-comments-list' });
    for (const c of unread) {
      const item = list.createDiv({ cls: 'vault-comments-item' });

      const meta = item.createDiv({ cls: 'vault-comments-meta' });
      meta.createEl('span', { text: `@${c.creator}`, cls: 'vault-comments-creator' });
      meta.createEl('span', { text: new Date(c.ts).toLocaleString(), cls: 'vault-comments-ts' });
      meta.createEl('span', {
        text: c.filePath.split('/').pop().replace(/\.md$/, ''),
        cls: 'vault-comments-file',
      });

      if (c.preview) {
        item.createEl('p', {
          text: c.preview + (c.preview.length >= 120 ? '…' : ''),
          cls: 'vault-comments-preview',
        });
      }

      item.addEventListener('click', () => this.plugin.navigateTo(c));
    }
  }
}

// ── Settings tab ──────────────────────────────────────────────────────────────

class VaultCommentsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Your username')
      .setDesc(
        `Identifies you on this machine (${this.plugin.hostname}). ` +
        'Use the same name others will type after #notify/.'
      )
      .addText(text => text
        .setPlaceholder('e.g. mkali')
        .setValue(this.plugin.getUsername() || '')
        .onChange(async value => {
          this.plugin.data.users[this.plugin.hostname] = value.trim();
          await this.plugin.persistData();
        })
      );
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

class VaultCommentsPlugin extends Plugin {
  async onload() {
    this.hostname = os.hostname();
    this.data     = await this.loadData() || { users: {}, lastSeen: {} };
    this._cache   = new Map(); // filePath → { mtime, comments }

    this._refreshPanel = debounce(async () => {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
      if (leaves.length) await leaves[0].view.render();
      await this.updateBadge();
    }, 2000, true);

    this.registerView(VIEW_TYPE, leaf => new CommentsPanel(leaf, this));

    this.ribbonIcon = this.addRibbonIcon('bell', 'Vault Comments', () => this.openPanel());
    this.ribbonIcon.addClass('vault-comments-ribbon');
    this.app.workspace.onLayoutReady(() => this.updateBadge());

    this.addCommand({
      id:   'vault-comments-insert',
      name: 'Insert Comment',
      editorCallback: editor => this.insertComment(editor),
    });

    this.addCommand({
      id:   'vault-comments-mark-read',
      name: 'Mark All Comments as Read',
      callback: async () => {
        await this.markAsRead();
        new Notice('All comments marked as read.');
        this._refreshPanel();
      },
    });

    this.addSettingTab(new VaultCommentsSettingTab(this.app, this));

    // Invalidate cache and refresh panel when files change (e.g. Dropbox sync)
    this.registerEvent(this.app.vault.on('modify', file => {
      this._cache.delete(file.path);
      this._refreshPanel();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this._cache.delete(oldPath);
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      this._cache.delete(file.path);
    }));
  }

  getUsername() { return this.data.users[this.hostname] || null; }
  getLastSeen() { return this.data.lastSeen[this.hostname] || 0; }

  async persistData() { await this.saveData(this.data); }

  async markAsRead() {
    this.data.lastSeen[this.hostname] = Date.now();
    await this.persistData();
    await this.updateBadge();
  }

  async updateBadge() {
    const username = this.getUsername();
    if (!username) { this.ribbonIcon.removeClass('has-unread'); return; }
    const lastSeen = this.getLastSeen();
    const comments = await this.scanComments();
    const hasUnread = comments.some(c => c.ts > lastSeen && c.notifyTags.includes(username));
    this.ribbonIcon.toggleClass('has-unread', hasUnread);
  }

  async scanComments() {
    const all = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cached = this._cache.get(file.path);
      if (cached && cached.mtime === file.stat.mtime) {
        all.push(...cached.comments);
        continue;
      }
      const content  = await this.app.vault.read(file);
      const comments = parseComments(file.path, content);
      this._cache.set(file.path, { mtime: file.stat.mtime, comments });
      all.push(...comments);
    }
    return all;
  }

  async openPanel() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      await existing[0].view.render();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async navigateTo(comment) {
    const file = this.app.vault.getAbstractFileByPath(comment.filePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const editor = leaf.view?.editor;
    if (editor) {
      const pos = { line: comment.lineFrom, ch: 0 };
      editor.setCursor(pos);
      editor.scrollIntoView({ from: pos, to: pos }, true);
    }
  }

  insertComment(editor) {
    const username = this.getUsername();
    if (!username) {
      new Notice('Set your username in Settings → Vault Comments first.');
      return;
    }
    const ts       = Date.now();
    const cursor   = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    const atStart  = lineText.slice(0, cursor.ch).trim() === '';
    const prefix   = atStart ? '' : '\n';
    const titleLine = `> [!comment] @${username} → #notify/`;
    const template  = `${prefix}${titleLine}\n> <!-- ts:${ts} -->\n> `;
    editor.replaceRange(template, cursor);
    editor.setCursor({ line: cursor.line + (atStart ? 0 : 1), ch: titleLine.length });
  }
}

module.exports = VaultCommentsPlugin;
