# Image Resizer

An Obsidian plugin that adds a bindable command to resize **all embedded images
in the current document** to a fixed width.

## Command

**Resize all images in current document** — rewrites every image embed so its
display width equals the configured value. Bind it to a hotkey under
*Settings → Hotkeys*, or run it from the command palette.

It rewrites both embed styles (assuming a 1000px target and a source image
wider than 1000px):

| Before                         | After                               |
| ------------------------------ | ----------------------------------- |
| `![[image.png]]`               | `![[image.png\|1000]]`              |
| `![](image.png)`               | `![1000](image.png)`                |

### What it skips

- **Already-sized embeds.** If an embed already carries an explicit width
  (`![[image.png\|250]]`, `![[image.png\|250x400]]`, `![caption\|300](image.png)`),
  it is left exactly as-is.
- **Images that would be enlarged.** The command reads each image's natural
  pixel width and only adds a size when doing so would *shrink* the image. An
  image whose natural width is already ≤ the target is left untouched, so the
  command never upscales. If a natural width can't be determined (e.g. the file
  can't be resolved, or an SVG with no intrinsic width), the embed is resized as
  a best-effort fallback.
- **Non-image embeds** (e.g. `![[Some Note]]`) and plain links.

After running, a notice reports how many images were resized and how many were
skipped.

## Settings

- **Image width** — the pixel width images are resized to. Default: **1000**.
  Editable from *Settings → Community plugins → Image Resizer*.

## Building

```bash
npm install
npm run build   # type-checks and bundles to main.js
npm test        # runs the unit tests for the resize logic
```

## Installing into a vault

Copy `manifest.json`, `main.js` (and `styles.css` if present) into
`<vault>/.obsidian/plugins/image-resizer/`, then enable the plugin under
*Settings → Community plugins*.
