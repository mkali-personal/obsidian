"""
reorganize.py  -  Single-script reorganization of LabArchives export.

Copies the source directory to a sibling folder called
  "{source_name} - Organized"
then reorganizes that copy, leaving the original untouched.
Re-running will overwrite the organized folder from scratch.

Steps:
  0. Copy source → sibling output dir (overwrite if exists)
  1. Parse notebook_home_page.html and copy each numbered HTML file into
     the original folder hierarchy at the output root.
  2. Move all support files (numbered HTMLs, attachments/, images/,
     stylesheets/, javascripts/, scripts, zip) into archive-supplementary/.
  3. Fix relative paths inside every content HTML file so references to
     attachments/, images/, stylesheets/, and javascripts/ resolve correctly
     through archive-supplementary/.

Usage:
    python reorganize.py <source_dir>
    python reorganize.py <source_dir> --dry-run
"""

import argparse
import base64
import io
import re
import shutil
import sys
from pathlib import Path

from bs4 import BeautifulSoup

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Set as globals in main() from the source argument
SOURCE_DIR = None
OUTPUT_DIR = None
BASE_DIR   = None
ARCHIVE    = None

# Dirs to move into archive-supplementary
SUPPORT_DIRS  = ["attachments", "images", "stylesheets", "javascripts"]
SUPPORT_GLOBS = ["*.html", "*.zip"]
SUPPORT_PY    = [
    "reconstruct.py", "fix_paths.py", "_scan.py",
    "reorganize.py", "html_to_md.py", "find_orphans.py", "cleanup.py",
]

RESOURCE_PREFIXES = ["attachments/", "images/", "stylesheets/", "javascripts/"]
B64_RE     = re.compile(r'(decodeBase64AndParseJSON\(")([A-Za-z0-9+/=]+)("\))')
ILLEGAL_WIN = re.compile(r'[\\/:*?"<>|]')


# ── Step 0: set up output dir ─────────────────────────────────────────────────

def _long(path: Path) -> Path:
    """Return path with \\?\ prefix to bypass Windows 260-char limit."""
    s = str(path.resolve())
    return Path("\\\\?\\" + s) if not s.startswith("\\\\?\\") else path


def setup_output():
    print(f"[0/3] Preparing output directory...")
    print(f"      {OUTPUT_DIR}")
    if OUTPUT_DIR.exists():
        shutil.rmtree(_long(OUTPUT_DIR))
    shutil.copytree(_long(SOURCE_DIR), _long(OUTPUT_DIR),
                    ignore=shutil.ignore_patterns(".claude", "../.idea"))
    print(f"      Done.\n")


# ── Step 1: reconstruct ───────────────────────────────────────────────────────

def sanitize(name: str) -> str:
    return ILLEGAL_WIN.sub("_", name).strip()[:200]


def walk_ul(ul_tag, path_stack, mappings):
    for li in ul_tag.find_all("li", recursive=False):
        rel = li.get("rel", "")
        if isinstance(rel, list):
            rel = rel[0]
        a = li.find("a", recursive=False)
        if not a:
            continue
        name = a.get_text(strip=True)
        if rel == "folder":
            path_stack.append(sanitize(name))
            child_ul = li.find("ul", recursive=False)
            if child_ul:
                walk_ul(child_ul, path_stack, mappings)
            path_stack.pop()
        elif rel == "page":
            href = a.get("href", "").split("?")[0].split("#")[0]
            mappings.append({"src": href, "path": list(path_stack), "name": sanitize(name)})


def reconstruct(dry_run: bool) -> list:
    home = BASE_DIR / "notebook_home_page.html"
    if not home.exists():
        sys.exit("ERROR: notebook_home_page.html not found")

    soup = BeautifulSoup(home.read_text(encoding="utf-8"), "html.parser")
    navtree = soup.find("div", id="navtree")
    if not navtree:
        sys.exit("ERROR: navtree div not found")
    root_ul = navtree.find("ul", recursive=False)
    if not root_ul:
        sys.exit("ERROR: no <ul> in navtree")

    mappings = []
    walk_ul(root_ul, [], mappings)
    print(f"[1/3] Reconstructing {len(mappings)} pages...")

    created = []
    skipped = collisions = 0
    seen = {}

    for m in mappings:
        src = BASE_DIR / m["src"]
        dest_dir = BASE_DIR / Path(*m["path"]) if m["path"] else BASE_DIR
        dest = dest_dir / (m["name"] + ".html")

        dest_key = str(dest).lower()
        if dest_key in seen:
            print(f"  COLLISION: {dest.relative_to(BASE_DIR)}")
            collisions += 1
        seen[dest_key] = m["src"]

        if not src.exists():
            print(f"  MISSING: {m['src']}")
            skipped += 1
            continue

        if not dry_run:
            dest_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
        created.append(dest)

    print(f"      {len(created)} pages, {skipped} missing, {collisions} collisions.\n")
    return created


# ── Step 2: move support files ────────────────────────────────────────────────

def move_to_archive(dry_run: bool):
    print("[2/3] Moving support files to archive-supplementary/...")
    if not dry_run:
        ARCHIVE.mkdir(exist_ok=True)

    count = 0

    for d in SUPPORT_DIRS:
        src = BASE_DIR / d
        if src.exists():
            if not dry_run:
                shutil.move(str(src), str(ARCHIVE / d))
            count += 1

    for pattern in SUPPORT_GLOBS:
        for f in sorted(BASE_DIR.glob(pattern)):
            if not dry_run:
                shutil.move(str(f), str(ARCHIVE / f.name))
            count += 1

    for script_name in SUPPORT_PY:
        src = BASE_DIR / script_name
        if src.exists():
            if not dry_run:
                shutil.move(str(src), str(ARCHIVE / script_name))
            count += 1

    print(f"      {count} items moved.\n")


# ── Step 3: fix paths ─────────────────────────────────────────────────────────

def fix_raw(text: str, prefix: str) -> str:
    for r in RESOURCE_PREFIXES:
        text = re.sub(r'(?<=["\'])' + re.escape(r), prefix + "archive-supplementary/" + r, text)
    return text


def fix_blob(match, prefix: str) -> str:
    open_tag, b64, close_tag = match.group(1), match.group(2), match.group(3)
    try:
        decoded = base64.b64decode(b64).decode("utf-8")
        fixed = fix_raw(decoded, prefix)
        if fixed == decoded:
            return match.group(0)
        return open_tag + base64.b64encode(fixed.encode("utf-8")).decode("ascii") + close_tag
    except Exception:
        return match.group(0)


def fix_paths(content_files: list, dry_run: bool):
    print(f"[3/3] Fixing resource paths in {len(content_files)} HTML files...")
    if dry_run:
        print(f"      [dry] would fix paths in {len(content_files)} files.\n")
        return
    changed = 0
    for f in sorted(content_files):
        depth = len(f.relative_to(BASE_DIR).parts) - 1
        prefix = "../" * depth
        text = f.read_text(encoding="utf-8")
        original = text
        text = B64_RE.sub(lambda m: fix_blob(m, prefix), text)
        text = fix_raw(text, prefix)
        if text != original:
            f.write_text(text, encoding="utf-8")
            changed += 1
    print(f"      {changed} files updated.\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    global SOURCE_DIR, OUTPUT_DIR, BASE_DIR, ARCHIVE

    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Path to the LabArchives source export directory")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview plan without touching any files")
    args = parser.parse_args()

    SOURCE_DIR = Path(args.source).resolve()
    OUTPUT_DIR = SOURCE_DIR.parent / (SOURCE_DIR.name + " - Organized")

    if not SOURCE_DIR.exists():
        sys.exit(f"ERROR: source directory not found: {SOURCE_DIR}")

    if args.dry_run:
        print(f"=== DRY RUN — no files will be changed ===")
        print(f"    Source : {SOURCE_DIR}")
        print(f"    Output : {OUTPUT_DIR}\n")
        BASE_DIR = SOURCE_DIR
        ARCHIVE  = SOURCE_DIR / "archive-supplementary"
    else:
        print(f"Source : {SOURCE_DIR}")
        print(f"Output : {OUTPUT_DIR}\n")
        setup_output()
        BASE_DIR = OUTPUT_DIR
        ARCHIVE  = OUTPUT_DIR / "archive-supplementary"

    content_files = reconstruct(args.dry_run)
    move_to_archive(args.dry_run)
    fix_paths(content_files, args.dry_run)

    if args.dry_run:
        print("Dry run complete. Run without --dry-run to apply.")
    else:
        print(f"Done. Organized notebook is at:\n  {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
