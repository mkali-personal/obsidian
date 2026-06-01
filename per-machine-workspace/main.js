'use strict';

const { Plugin, TFile } = require('obsidian');
const os = require('os');

class PerMachineWorkspacePlugin extends Plugin {
  async onload() {
    this.hostname = os.hostname();
    this.app.workspace.onLayoutReady(() => this.restoreLastFile());
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file instanceof TFile) this.saveLastFile(file.path);
      })
    );
  }

  async restoreLastFile() {
    const data = await this.loadData() || {};
    const lastPath = data[this.hostname];
    if (!lastPath) return;
    const file = this.app.vault.getAbstractFileByPath(lastPath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  async saveLastFile(path) {
    const data = await this.loadData() || {};
    data[this.hostname] = path;
    await this.saveData(data);
  }
}

module.exports = PerMachineWorkspacePlugin;
