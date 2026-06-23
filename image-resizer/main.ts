import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import { findImageEmbeds, resizeImageEmbeds } from "./resize";

interface ImageResizerSettings {
	width: number;
}

const DEFAULT_SETTINGS: ImageResizerSettings = {
	width: 1000,
};

export default class ImageResizerPlugin extends Plugin {
	settings: ImageResizerSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "resize-all-images",
			name: "Resize all images in current document",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				void this.resizeImagesInEditor(editor, view);
			},
		});

		this.addSettingTab(new ImageResizerSettingTab(this.app, this));
	}

	onunload() {}

	async resizeImagesInEditor(editor: Editor, view: MarkdownView) {
		const original = editor.getValue();
		const sourcePath = view.file?.path ?? "";

		// Measure the natural width of each unsized image up front so the
		// "only shrink" decision can be made. Already-sized embeds are skipped
		// by the transform and never need measuring.
		const naturalWidths = new Map<string, number | null>();
		for (const embed of findImageEmbeds(original)) {
			if (embed.currentWidth !== null) continue;
			if (!naturalWidths.has(embed.linkpath)) {
				naturalWidths.set(
					embed.linkpath,
					await this.getNaturalWidth(embed.linkpath, sourcePath)
				);
			}
		}

		const { content, resized, skipped } = resizeImageEmbeds(original, {
			width: this.settings.width,
			naturalWidth: (linkpath) => naturalWidths.get(linkpath) ?? null,
		});

		if (resized === 0 || content === original) {
			new Notice(
				skipped > 0
					? `No images resized (${skipped} already sized or smaller than ${this.settings.width}px).`
					: "No images to resize in this document."
			);
			return;
		}

		// Preserve cursor and scroll position across the full-document rewrite.
		const cursor = editor.getCursor();
		const scroll = editor.getScrollInfo();
		editor.setValue(content);
		editor.setCursor(cursor);
		editor.scrollTo(scroll.left, scroll.top);

		new Notice(
			`Resized ${resized} image${resized === 1 ? "" : "s"} to ${
				this.settings.width
			}px wide` + (skipped > 0 ? `; skipped ${skipped}.` : ".")
		);
	}

	/**
	 * Resolves an embed link to a file in the vault and returns the image's
	 * natural (intrinsic) pixel width, or null if it can't be determined.
	 */
	async getNaturalWidth(
		linkpath: string,
		sourcePath: string
	): Promise<number | null> {
		const file = this.app.metadataCache.getFirstLinkpathDest(
			linkpath,
			sourcePath
		);
		if (!file) return null;
		try {
			const data = await this.app.vault.readBinary(file);
			return await naturalWidthFromBinary(data);
		} catch (e) {
			return null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/**
 * Decodes image bytes and returns the natural width in pixels, or null if the
 * image can't be decoded (e.g. an SVG without an intrinsic width). Uses the
 * renderer's image decoder so every supported format works without per-format
 * header parsing.
 */
function naturalWidthFromBinary(data: ArrayBuffer): Promise<number | null> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(new Blob([data]));
		const img = new Image();
		img.onload = () => {
			const width = img.naturalWidth;
			URL.revokeObjectURL(url);
			resolve(width > 0 ? width : null);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(null);
		};
		img.src = url;
	});
}

class ImageResizerSettingTab extends PluginSettingTab {
	plugin: ImageResizerPlugin;

	constructor(app: App, plugin: ImageResizerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Image width")
			.setDesc(
				"Width (in pixels) that images are resized to when the command runs."
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.width))
					.setValue(String(this.plugin.settings.width))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (Number.isFinite(parsed) && parsed > 0) {
							this.plugin.settings.width = parsed;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
