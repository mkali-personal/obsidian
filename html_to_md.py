"""
html_to_md.py  -  Convert reorganized LabArchives HTML pages to Markdown.

Creates a .md file alongside each .html file in the organized output directory.
Follows the Obsidian wikilink convention for images: ![[filename.ext|1000]]
Each notebook entry is headed by its author and timestamp.
Attachment entries become markdown links.

Run AFTER reorganize.py.

Usage:
    python html_to_md.py <source_dir>
"""

import argparse
import base64
import io
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

try:
    from markdownify import markdownify
except ImportError:
    print("markdownify not found — installing...")
    result = subprocess.run([sys.executable, "-m", "pip", "install", "markdownify"])
    if result.returncode != 0:
        sys.exit("ERROR: could not install markdownify. Run:  pip install markdownify")
    from markdownify import markdownify

from bs4 import BeautifulSoup

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Set as globals in main() from the source argument
OUTPUT_DIR = None
ARCHIVE    = None

ENTRY_RE    = re.compile(r'dispatchSetEntry\("(\w+)",\s*decodeBase64AndParseJSON\("([A-Za-z0-9+/=]+)"\)\)')
FROALA_META = re.compile(r'<!--RTE_FROALA--><!--RTE_m\{.*?\}-->', re.DOTALL)
IMG_SRC_RE  = re.compile(r'<img\b[^>]*\bsrc="[^"]*?/([^/"]+\.[a-zA-Z0-9]+)"[^>]*/?>',  re.IGNORECASE)


def format_date(iso_str: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_str)
        offset = dt.utcoffset()
        hours = int(offset.total_seconds() / 3600)
        tz = f"GMT+{hours}" if hours >= 0 else f"GMT{hours}"
        hour12 = dt.hour % 12 or 12
        ampm = "AM" if dt.hour < 12 else "PM"
        return f"{dt.strftime('%b')} {dt.day}, {dt.year}, {hour12}:{dt.strftime('%M')} {ampm} {tz}"
    except Exception:
        return iso_str


def preprocess_html(html: str) -> str:
    """Fix HTML quirks that trip up markdownify."""
    soup = BeautifulSoup(html, "html.parser")

    # 1. Convert iframes to links (markdownify silently drops them)
    for iframe in soup.find_all("iframe"):
        src = iframe.get("src", "")
        if src:
            a = soup.new_tag("a", href=src)
            a.string = f"🔗 Embedded content: {src}"
            iframe.replace_with(a)
        else:
            iframe.decompose()

    # 2. Move <ul>/<ol> out of <p> and heading tags
    #    (markdownify inlines list items when they live inside a block container)
    for container in soup.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6"]):
        blocks = container.find_all(["ul", "ol"], recursive=False)
        if blocks:
            ref = container
            for block in blocks:
                block.extract()
                ref.insert_after(block)
                ref = block

    return str(soup)


def html_to_md(html: str) -> str:
    # Convert inline images to Obsidian wikilinks before any further processing
    html = IMG_SRC_RE.sub(lambda m: f"![[{m.group(1)}|1000]]", html)
    html = preprocess_html(html)
    md = markdownify(html, heading_style="ATX", bullets="-")
    # Collapse 3+ blank lines to 2
    md = re.sub(r'\n{3,}', '\n\n', md)
    return md.strip()


def entry_to_md(blob: dict) -> str | None:
    author   = blob.get("lastModifiedBy", "")
    updated  = blob.get("updatedAt", "")
    etype    = blob.get("type")
    data     = blob.get("data", "")

    header = f"{author}-{format_date(updated)}" if author and updated else author or None

    lines = []
    if header:
        lines.append(header)

    data = data or ""

    # Attachment entry (type 2 or has filename)
    if etype == 2 or "filename" in blob:
        filename = blob.get("filename", "")
        is_image = blob.get("isImage", False)
        url      = blob.get("urls", {}).get("urlLink", "")
        desc     = data.strip()
        # Image attachments render as inline previews; other files as links.
        # Use the prefixed filename from urlLink (e.g. "1172-260127160040.png")
        # because that is the actual filename on disk — bare filename won't resolve.
        if is_image and filename:
            prefixed = Path(url).name if url else filename
            lines.append(f"![[{prefixed}|1000]]")
        else:
            link = f"[{filename}]({url})" if url else filename
            lines.append(f"**📎** {link}")
        if desc:
            lines.append(f"> {desc}")
        return "\n".join(lines)

    # Rich text entry (type 1, Froala HTML)
    if "<!--RTE_FROALA-->" in data:
        body = FROALA_META.sub("", data).strip()
        md   = html_to_md(body)
        if md:
            lines.append(md)
            return "\n".join(lines)
        return None

    # Plain text / other
    if data.strip():
        lines.append(data.strip())
        return "\n".join(lines)

    return None


def process_file(html_path: Path) -> str:
    text = html_path.read_text(encoding="utf-8")

    soup  = BeautifulSoup(text, "html.parser")
    h1    = soup.select_one(".la-static-page-heading h1")
    title = h1.get_text(strip=True) if h1 else html_path.stem

    parts = []

    for _entry_id, b64 in ENTRY_RE.findall(text):
        try:
            blob = json.loads(base64.b64decode(b64).decode("utf-8"))
        except Exception:
            continue
        md = entry_to_md(blob)
        if md:
            parts.append(md)

    return "\n\n---\n\n".join(parts) + "\n"


def main():
    global OUTPUT_DIR, ARCHIVE

    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Path to the LabArchives source export directory")
    args = parser.parse_args()

    source_dir = Path(args.source).resolve()
    OUTPUT_DIR = source_dir.parent / (source_dir.name + " - Organized")
    ARCHIVE    = OUTPUT_DIR / "archive-supplementary"

    if not OUTPUT_DIR.exists():
        sys.exit(f"ERROR: {OUTPUT_DIR} does not exist. Run reorganize.py first.")

    html_files = [
        f for f in OUTPUT_DIR.rglob("*.html")
        if ARCHIVE not in f.parents
    ]

    print(f"Converting {len(html_files)} HTML files → Markdown in:")
    print(f"  {OUTPUT_DIR}\n")

    ok = errors = 0
    for f in sorted(html_files):
        try:
            content = process_file(f)
            f.with_suffix(".md").write_text(content, encoding="utf-8")
            ok += 1
        except Exception as e:
            print(f"  ERROR {f.relative_to(OUTPUT_DIR)}: {e}")
            errors += 1

    print(f"\nDone. {ok} markdown files created, {errors} errors.")


if __name__ == "__main__":
    main()
