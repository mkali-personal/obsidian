"""
cleanup.py  -  Final cleanup of the organized notebook output.

Run AFTER reorganize.py AND html_to_md.py.

Deletes from "Lab Archives Data - Organized/":
  1. All .html content files in the notebook folders
     (aborts if any .html file has no .md counterpart — run html_to_md.py first)
  2. HTML infrastructure inside archive-supplementary/:
       stylesheets/   javascripts/   images/   numbered *.html files
  3. Orphaned attachments — files in attachments/ not referenced by any page
  4. Empty directories left behind after deletion

The source directory ("Lab Archives Data/") is never touched.

Usage:
    python cleanup.py <source_dir>
    python cleanup.py <source_dir> --dry-run
"""

import argparse
import base64
import io
import re
import shutil
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Set as globals in main() from the source argument
SOURCE_DIR = None
OUTPUT_DIR = None
ARCHIVE    = None

ATTACH_PATH_RE = re.compile(r"(attachments/(?:original|inline|thumb)/[^\s\"'\\<>{}]+)")


# ── Helpers ───────────────────────────────────────────────────────────────────

def find_referenced_attachments(source_dir: Path) -> set:
    refs = set()
    for html_file in source_dir.glob("*.html"):
        if html_file.name == "notebook_home_page.html":
            continue
        text = html_file.read_text(encoding="utf-8")
        for b64 in re.findall(r'decodeBase64AndParseJSON\("([A-Za-z0-9+/=]+)"\)', text):
            try:
                decoded = base64.b64decode(b64).decode("utf-8")
                for m in ATTACH_PATH_RE.finditer(decoded):
                    refs.add(m.group(1).rstrip(".,;)"))
            except Exception:
                pass
    return refs


def remove_empty_dirs(root: Path, dry_run: bool) -> int:
    removed = 0
    for dirpath in sorted(root.rglob("*"), reverse=True):
        if dirpath.is_dir() and not any(dirpath.iterdir()):
            if not dry_run:
                dirpath.rmdir()
            removed += 1
    return removed


# ── Step 1: delete .html content files ───────────────────────────────────────

def delete_html_content(dry_run: bool) -> int:
    html_files = [f for f in OUTPUT_DIR.rglob("*.html") if ARCHIVE not in f.parents]

    # Safety: every .html must have a .md counterpart
    missing_md = [f for f in html_files if not f.with_suffix(".md").exists()]
    if missing_md:
        print(f"  ABORT: {len(missing_md)} HTML file(s) have no .md counterpart.")
        print(f"  Run html_to_md.py first, then re-run cleanup.py.")
        for f in missing_md[:5]:
            print(f"    {f.relative_to(OUTPUT_DIR)}")
        if len(missing_md) > 5:
            print(f"    ... and {len(missing_md) - 5} more")
        sys.exit(1)

    print(f"[1/4] Deleting {len(html_files)} .html content files...")
    if not dry_run:
        for f in html_files:
            f.unlink()
    print(f"      Done.\n")
    return len(html_files)


# ── Step 2: delete HTML infrastructure from archive-supplementary ─────────────

def delete_html_infrastructure(dry_run: bool) -> int:
    infra_dirs = ["stylesheets", "javascripts", "images"]
    count = 0

    print("[2/4] Deleting HTML infrastructure from archive-supplementary/...")

    for d in infra_dirs:
        target = ARCHIVE / d
        if target.exists():
            n = sum(1 for _ in target.rglob("*") if _.is_file())
            if not dry_run:
                shutil.rmtree(target)
            print(f"  removed  {d}/  ({n} files)")
            count += n

    # Numbered .html files and notebook_home_page.html
    html_count = 0
    for f in sorted(ARCHIVE.glob("*.html")):
        if not dry_run:
            f.unlink()
        html_count += 1
    if html_count:
        print(f"  removed  {html_count} numbered .html files")
        count += html_count

    print(f"      Done.\n")
    return count


# ── Step 3: delete orphaned attachments ───────────────────────────────────────

def delete_orphaned_attachments(dry_run: bool) -> int:
    attach_dir = ARCHIVE / "attachments"
    if not attach_dir.exists():
        print("[3/4] No attachments/ folder found — skipping.\n")
        return 0

    print("[3/4] Scanning for orphaned attachments...")
    refs = find_referenced_attachments(SOURCE_DIR)

    orphans = []
    for f in attach_dir.rglob("*"):
        if not f.is_file():
            continue
        # Normalize to the same path format used in refs
        rel = f.relative_to(ARCHIVE).as_posix()
        if rel not in refs:
            orphans.append(f)

    print(f"      {len(orphans)} orphaned files found.")
    if not dry_run:
        for f in orphans:
            f.unlink()
    print(f"      Done.\n")
    return len(orphans)


# ── Step 4: remove empty directories ─────────────────────────────────────────

def clean_empty_dirs(dry_run: bool):
    print("[4/4] Removing empty directories...")
    n = remove_empty_dirs(OUTPUT_DIR, dry_run)
    print(f"      {n} empty directories removed.\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    global SOURCE_DIR, OUTPUT_DIR, ARCHIVE

    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Path to the LabArchives source export directory")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview what would be deleted without actually deleting")
    args = parser.parse_args()

    SOURCE_DIR = Path(args.source).resolve()
    OUTPUT_DIR = SOURCE_DIR.parent / (SOURCE_DIR.name + " - Organized")
    ARCHIVE    = OUTPUT_DIR / "archive-supplementary"

    if not SOURCE_DIR.exists():
        sys.exit(f"ERROR: source directory not found: {SOURCE_DIR}")
    if not OUTPUT_DIR.exists():
        sys.exit(f"ERROR: {OUTPUT_DIR} does not exist. Run reorganize.py first.")

    if args.dry_run:
        print(f"=== DRY RUN — nothing will be deleted ===")
    print(f"Output dir: {OUTPUT_DIR}\n")

    n1 = delete_html_content(args.dry_run)
    n2 = delete_html_infrastructure(args.dry_run)
    n3 = delete_orphaned_attachments(args.dry_run)
    clean_empty_dirs(args.dry_run)

    total = n1 + n2 + n3
    if args.dry_run:
        print(f"Dry run complete. Would delete ~{total} files.")
        print("Run without --dry-run to apply.")
    else:
        print(f"Cleanup complete. {total} files deleted.")


if __name__ == "__main__":
    main()
