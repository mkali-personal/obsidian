import { test } from "node:test";
import assert from "node:assert/strict";
import { resizeImageEmbeds, findImageEmbeds } from "./resize.ts";

test("adds a size to an unsized wikilink image embed", () => {
	const input = "![[archive/Pasted image 20260622102734.png]]";
	const { content, resized, skipped } = resizeImageEmbeds(input, {
		width: 1000,
	});
	assert.equal(content, "![[archive/Pasted image 20260622102734.png|1000]]");
	assert.equal(resized, 1);
	assert.equal(skipped, 0);
});

test("skips a wikilink embed that already has a width", () => {
	const input = "![[archive/Pasted image 20260622102734.png|250]]";
	const { content, resized, skipped } = resizeImageEmbeds(input, {
		width: 1000,
	});
	assert.equal(content, input); // unchanged
	assert.equal(resized, 0);
	assert.equal(skipped, 1);
});

test("skips an embed with a width x height size", () => {
	const input = "![[img.png|250x400]]";
	const { content, resized, skipped } = resizeImageEmbeds(input, {
		width: 1000,
	});
	assert.equal(content, input);
	assert.equal(resized, 0);
	assert.equal(skipped, 1);
});

test("leaves non-image wikilink embeds and links untouched", () => {
	const input = "![[Some Note]] and [[other.png]] and [[note.md]]";
	const { content, resized, skipped } = resizeImageEmbeds(input, {
		width: 1000,
	});
	assert.equal(content, input);
	assert.equal(resized, 0);
	assert.equal(skipped, 0);
});

test("handles markdown image embeds via alt-text size", () => {
	const input = "![](attachments/photo.jpg)";
	const { content, resized } = resizeImageEmbeds(input, { width: 1000 });
	assert.equal(content, "![1000](attachments/photo.jpg)");
	assert.equal(resized, 1);
});

test("skips a markdown image embed that already has a size", () => {
	const input = "![caption|300](photo.jpg)";
	const { content, resized, skipped } = resizeImageEmbeds(input, {
		width: 1000,
	});
	assert.equal(content, input);
	assert.equal(resized, 0);
	assert.equal(skipped, 1);
});

test("only shrinks: resizes when natural width is larger than target", () => {
	const input = "![[big.png]]";
	const { content, resized, skipped } = resizeImageEmbeds(input, {
		width: 1000,
		naturalWidth: () => 1500,
	});
	assert.equal(content, "![[big.png|1000]]");
	assert.equal(resized, 1);
	assert.equal(skipped, 0);
});

test("only shrinks: skips when natural width is smaller than target", () => {
	const input = "![[small.png]]";
	const { content, resized, skipped } = resizeImageEmbeds(input, {
		width: 1000,
		naturalWidth: () => 800,
	});
	assert.equal(content, input);
	assert.equal(resized, 0);
	assert.equal(skipped, 1);
});

test("only shrinks: skips when natural width equals target (no change)", () => {
	const input = "![[exact.png]]";
	const { resized, skipped } = resizeImageEmbeds(input, {
		width: 1000,
		naturalWidth: () => 1000,
	});
	assert.equal(resized, 0);
	assert.equal(skipped, 1);
});

test("resizes when natural width is unknown (best effort)", () => {
	const input = "![[mystery.png]]";
	const { content, resized } = resizeImageEmbeds(input, {
		width: 1000,
		naturalWidth: () => null,
	});
	assert.equal(content, "![[mystery.png|1000]]");
	assert.equal(resized, 1);
});

test("mixed document: resizes only the larger, unsized images", () => {
	const input = [
		"intro",
		"![[a.png]]", // unsized, natural 2000 -> resize
		"text ![[b.jpeg|50]] text", // already sized -> skip
		"![[c.png]]", // unsized, natural 400 -> skip (would upscale)
		"![[d.pdf]]", // not an image -> ignored
		"![alt](e.webp)", // unsized md, unknown -> resize
	].join("\n");
	const natural = { "a.png": 2000, "c.png": 400 };
	const { content, resized, skipped } = resizeImageEmbeds(input, {
		width: 1000,
		naturalWidth: (lp) => natural[lp] ?? null,
	});
	assert.equal(resized, 2);
	assert.equal(skipped, 2);
	assert.ok(content.includes("![[a.png|1000]]"));
	assert.ok(content.includes("![[b.jpeg|50]]")); // untouched
	assert.ok(content.includes("![[c.png]]")); // untouched
	assert.ok(content.includes("![alt|1000](e.webp)"));
});

test("findImageEmbeds reports current width and offsets", () => {
	const input = "x ![[a.png]] y ![[b.png|640]]";
	const embeds = findImageEmbeds(input);
	assert.equal(embeds.length, 2);
	assert.equal(embeds[0].linkpath, "a.png");
	assert.equal(embeds[0].currentWidth, null);
	assert.equal(embeds[1].linkpath, "b.png");
	assert.equal(embeds[1].currentWidth, 640);
	// offsets round-trip back to the matched text
	assert.equal(input.slice(embeds[0].start, embeds[0].end), "![[a.png]]");
});
