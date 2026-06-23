// Pure, dependency-free image-embed resizing logic.
// Kept separate from main.ts so it can be unit-tested without the Obsidian runtime.

export const IMAGE_EXTENSIONS = [
	"png",
	"jpg",
	"jpeg",
	"gif",
	"bmp",
	"svg",
	"webp",
	"avif",
];

/** Returns true if the given link/path points at an embeddable image. */
function isImagePath(path: string): boolean {
	// Strip subpath (#heading) and query (?v=) fragments before testing extension.
	const clean = path.split("#")[0].split("?")[0].trim();
	const dot = clean.lastIndexOf(".");
	if (dot === -1) return false;
	const ext = clean.slice(dot + 1).toLowerCase();
	return IMAGE_EXTENSIONS.includes(ext);
}

/** A single embedded image found in the document. */
export interface ImageEmbed {
	/** Index of the embed's first character in the source content. */
	start: number;
	/** Index just past the embed's last character. */
	end: number;
	/** The exact text that was matched. */
	raw: string;
	/** The link/path used to resolve the underlying image file on disk. */
	linkpath: string;
	/** The explicit display width already on the embed, or null if it has none. */
	currentWidth: number | null;
	/** Builds the embed text with the given display width applied. */
	render: (width: number) => string;
}

/**
 * Finds every embedded image in `content`, both Obsidian wikilink embeds
 * (`![[image.png|...]]`) and standard Markdown image embeds (`![alt|...](image.png)`).
 *
 * Non-image embeds (e.g. `![[Some Note]]`) and plain links are not returned.
 * The caller decides what to do with each embed; this function only parses.
 */
export function findImageEmbeds(content: string): ImageEmbed[] {
	const embeds: ImageEmbed[] = [];

	// --- Wikilink embeds: ![[ path | size ]] ---------------------------------
	const wikiEmbed = /!\[\[([^\[\]]+?)\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = wikiEmbed.exec(content)) !== null) {
		const inner = m[1];
		// The path is everything up to the first pipe; anything after is the size.
		const pipeIdx = inner.indexOf("|");
		const path = (pipeIdx === -1 ? inner : inner.slice(0, pipeIdx)).trim();
		if (!isImagePath(path)) continue;

		const sizeStr = pipeIdx === -1 ? "" : inner.slice(pipeIdx + 1).trim();
		const sizeMatch = sizeStr.match(/^(\d+)(?:x\d+)?$/);

		embeds.push({
			start: m.index,
			end: m.index + m[0].length,
			raw: m[0],
			linkpath: path,
			currentWidth: sizeMatch ? parseInt(sizeMatch[1], 10) : null,
			render: (width) => `![[${path}|${width}]]`,
		});
	}

	// --- Markdown embeds: ![alt|size](path) ----------------------------------
	const mdEmbed = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
	while ((m = mdEmbed.exec(content)) !== null) {
		const alt = m[1];
		const url = m[2];
		const title = m[3] || "";
		if (!isImagePath(url)) continue;

		// In Markdown image embeds Obsidian reads the size from the alt text,
		// as a trailing `|width` (or `|widthxheight`).
		const sizeMatch = alt.match(/\|\s*(\d+)(?:x\d+)?\s*$/);
		const altBase = alt.replace(/\|\s*\d+(?:x\d+)?\s*$/, "");

		embeds.push({
			start: m.index,
			end: m.index + m[0].length,
			raw: m[0],
			linkpath: url,
			currentWidth: sizeMatch ? parseInt(sizeMatch[1], 10) : null,
			render: (width) =>
				`![${altBase ? `${altBase}|${width}` : width}](${url}${title})`,
		});
	}

	embeds.sort((a, b) => a.start - b.start);
	return embeds;
}

export interface ResizeOptions {
	/** Target display width to apply. */
	width: number;
	/**
	 * Optional lookup of an image's natural (intrinsic) pixel width by linkpath.
	 * Return a positive number if known, or null/undefined if it can't be
	 * determined. When a natural width is known and is <= the target width,
	 * the embed is left alone so images are only ever shrunk, never upscaled.
	 */
	naturalWidth?: (linkpath: string) => number | null | undefined;
}

export interface ResizeResult {
	content: string;
	/** How many embeds were rewritten. */
	resized: number;
	/** How many image embeds were left untouched. */
	skipped: number;
}

/**
 * Rewrites embedded images in `content` so their display width equals
 * `opts.width`, subject to two guards:
 *
 *  1. Embeds that already carry an explicit width are skipped.
 *  2. If a natural width is known for an embed and applying the target width
 *     would enlarge (upscale) the image, it is skipped — images are only
 *     ever shrunk. When the natural width is unknown the embed is resized.
 */
export function resizeImageEmbeds(
	content: string,
	opts: ResizeOptions
): ResizeResult {
	const embeds = findImageEmbeds(content);
	let resized = 0;
	let skipped = 0;
	let result = content;

	// Apply replacements from last to first so earlier offsets stay valid.
	for (let i = embeds.length - 1; i >= 0; i--) {
		const embed = embeds[i];

		// Guard 1: already has an explicit width -> leave it alone.
		if (embed.currentWidth !== null) {
			skipped++;
			continue;
		}

		// Guard 2: only shrink. If we know the natural width and the target
		// wouldn't make it smaller, skip. Unknown natural width -> proceed.
		const natural = opts.naturalWidth?.(embed.linkpath);
		if (typeof natural === "number" && natural > 0 && natural <= opts.width) {
			skipped++;
			continue;
		}

		const replacement = embed.render(opts.width);
		result =
			result.slice(0, embed.start) +
			replacement +
			result.slice(embed.end);
		resized++;
	}

	return { content: result, resized, skipped };
}
