"""
Fixes broken relative paths in reconstructed HTML files.

Paths like attachments/, images/, stylesheets/, javascripts/ were relative
to the original flat root. After moving files into subdirectories they break.
This script prepends the correct number of '../' for each file's depth.

Usage:
    python fix_paths.py           # live run (edits files in-place)
    python fix_paths.py --dry-run # preview only
"""

import argparse
import base64
import io
import re
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).parent
RECONSTRUCTED = BASE_DIR / "reconstructed"

# Root-level dirs that need path-fixing
ROOT_DIRS = ["attachments/", "images/", "stylesheets/", "javascripts/"]

# Regex to find decodeBase64AndParseJSON blobs in HTML
B64_RE = re.compile(r'(decodeBase64AndParseJSON\(")([A-Za-z0-9+/=]+)("\))')


def prefix_for(html_file: Path) -> str:
    """Return '../' repeated enough times to reach BASE_DIR from html_file."""
    depth = len(html_file.relative_to(BASE_DIR).parts) - 1  # -1 for the file itself
    return "../" * depth


def fix_text(text: str, prefix: str) -> str:
    """Fix root-relative paths directly in HTML text."""
    for d in ROOT_DIRS:
        # Match only when the path starts after quote/equals, not already prefixed
        text = re.sub(
            r'(?<=["\'])' + re.escape(d),
            prefix + d,
            text
        )
    return text


def fix_blob(match: re.Match, prefix: str) -> str:
    """Decode a base64 blob, fix paths inside it, re-encode."""
    open_tag, b64, close_tag = match.group(1), match.group(2), match.group(3)
    try:
        decoded = base64.b64decode(b64).decode("utf-8")
        fixed = fix_text(decoded, prefix)
        if fixed == decoded:
            return match.group(0)  # nothing changed
        re_encoded = base64.b64encode(fixed.encode("utf-8")).decode("ascii")
        return open_tag + re_encoded + close_tag
    except Exception:
        return match.group(0)  # leave untouched on error


def process_file(html_file: Path, dry_run: bool) -> bool:
    prefix = prefix_for(html_file)
    if not prefix:
        return False  # file is at root level, nothing to fix

    text = html_file.read_text(encoding="utf-8")
    original = text

    # 1. Fix paths inside base64 blobs
    text = B64_RE.sub(lambda m: fix_blob(m, prefix), text)

    # 2. Fix remaining root-relative paths directly in HTML
    text = fix_text(text, prefix)

    if text == original:
        return False

    if not dry_run:
        html_file.write_text(text, encoding="utf-8")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    html_files = list(RECONSTRUCTED.rglob("*.html"))
    print(f"Found {len(html_files)} HTML files in reconstructed/\n")

    changed = unchanged = 0
    for f in sorted(html_files):
        modified = process_file(f, args.dry_run)
        rel = f.relative_to(RECONSTRUCTED)
        if modified:
            prefix = prefix_for(f)
            tag = "[dry]" if args.dry_run else "fixed"
            print(f"  [{tag}] {rel}  (prefix: {prefix!r})")
            changed += 1
        else:
            unchanged += 1

    print()
    if args.dry_run:
        print(f"Dry run: {changed} files would be updated, {unchanged} already correct.")
    else:
        print(f"Done: {changed} files updated, {unchanged} unchanged.")


if __name__ == "__main__":
    main()
