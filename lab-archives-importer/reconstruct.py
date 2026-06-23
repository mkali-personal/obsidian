"""
Reconstructs the original LabArchives directory structure from notebook_home_page.html.

Usage:
    python reconstruct.py           # live run (copies files)
    python reconstruct.py --dry-run # preview only, no files touched

Files are copied (not moved) so the originals remain intact.
Output is placed in a new subfolder called "reconstructed/" inside this directory.
"""

import argparse
import io
import re
import shutil
import sys
from pathlib import Path

# Force UTF-8 output so non-ASCII page names print correctly on any terminal
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from bs4 import BeautifulSoup

BASE_DIR = Path(__file__).parent
HOME_PAGE = BASE_DIR / "notebook_home_page.html"
OUTPUT_DIR = BASE_DIR / "reconstructed"

ILLEGAL_WIN = re.compile(r'[\\/:*?"<>|]')


def sanitize(name: str) -> str:
    name = ILLEGAL_WIN.sub("_", name).strip()
    return name[:200] if len(name) > 200 else name


def walk_ul(ul_tag, path_stack: list, mappings: list):
    for li in ul_tag.find_all("li", recursive=False):
        rel = li.get("rel", [""])[0] if isinstance(li.get("rel"), list) else li.get("rel", "")
        a = li.find("a", recursive=False)
        if a is None:
            continue
        name = a.get_text(strip=True)

        if rel == "folder":
            path_stack.append(sanitize(name))
            child_ul = li.find("ul", recursive=False)
            if child_ul:
                walk_ul(child_ul, path_stack, mappings)
            path_stack.pop()

        elif rel == "page":
            href = a.get("href", "")
            src_file = href.split("?")[0].split("#")[0]  # strip query/anchor
            mappings.append({
                "src": src_file,
                "path": list(path_stack),
                "name": sanitize(name),
            })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview without copying files")
    args = parser.parse_args()

    if not HOME_PAGE.exists():
        sys.exit(f"ERROR: {HOME_PAGE} not found")

    soup = BeautifulSoup(HOME_PAGE.read_text(encoding="utf-8"), "html.parser")
    navtree_div = soup.find("div", id="navtree")
    if navtree_div is None:
        sys.exit("ERROR: <div id='navtree'> not found in notebook_home_page.html")

    root_ul = navtree_div.find("ul", recursive=False)
    if root_ul is None:
        sys.exit("ERROR: No <ul> found inside navtree div")

    mappings = []
    walk_ul(root_ul, [], mappings)

    print(f"Found {len(mappings)} pages in the tree.\n")

    copied = skipped = collisions = 0
    seen_dest = {}

    for m in mappings:
        src = BASE_DIR / m["src"]
        dest_dir = OUTPUT_DIR / Path(*m["path"]) if m["path"] else OUTPUT_DIR
        dest = dest_dir / (m["name"] + ".html")

        # collision detection
        dest_key = str(dest).lower()
        if dest_key in seen_dest:
            print(f"  COLLISION: {dest} already claimed by {seen_dest[dest_key]}")
            collisions += 1
        seen_dest[dest_key] = m["src"]

        if not src.exists():
            print(f"  MISSING src: {m['src']} -> {dest.relative_to(OUTPUT_DIR)}")
            skipped += 1
            continue

        if args.dry_run:
            print(f"  [dry] {m['src']:>10}  ->  {dest.relative_to(OUTPUT_DIR)}")
        else:
            dest_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            copied += 1

    print()
    if args.dry_run:
        print(f"Dry run complete. {len(mappings)} pages found, {skipped} missing sources, {collisions} name collisions.")
        print("Run without --dry-run to copy files.")
    else:
        print(f"Done. {copied} files copied, {skipped} skipped (source not found), {collisions} name collisions.")
        print(f"Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
