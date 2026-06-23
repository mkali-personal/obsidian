"""
find_orphans.py  -  Map every file in attachments/ to the notebook page(s) that reference it.

Scans all numbered HTML files in this directory, decodes their base64 blobs,
and builds a complete reference map.  Files with no referencing page are orphans.

Writes attachment_report.txt into the source directory.

Usage:
    python find_orphans.py <source_dir>
"""

import argparse
import base64
import io
import re
import sys
from collections import defaultdict
from pathlib import Path

from bs4 import BeautifulSoup

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Set as global in main() from the source argument
SOURCE_DIR     = None
# Match attachment paths anywhere in decoded content.
# Inline image paths appear inside JSON-encoded HTML as \"attachments/...\",
# so we cannot rely on surrounding quotes — match the path prefix directly.
ATTACH_PATH_RE = re.compile(r'(attachments/(?:original|inline|thumb)/[^\s"\'\\<>{}]+)')


def build_page_names(source_dir: Path) -> dict:
    """Returns {numbered_html: human_readable_page_name} from the navtree."""
    home = source_dir / "notebook_home_page.html"
    if not home.exists():
        return {}
    soup = BeautifulSoup(home.read_text(encoding="utf-8"), "html.parser")
    mapping = {}
    for li in soup.find_all("li", rel="page"):
        a = li.find("a", href=True)
        if a:
            href = a["href"].split("?")[0].split("#")[0]
            mapping[href] = a.get_text(strip=True)
    return mapping


def scan_references(source_dir: Path) -> dict:
    """Returns {attachment_posix_path: {html_filename, ...}}."""
    refs = defaultdict(set)
    for html_file in sorted(source_dir.glob("*.html")):
        if html_file.name == "notebook_home_page.html":
            continue
        text = html_file.read_text(encoding="utf-8")
        for b64 in re.findall(r'decodeBase64AndParseJSON\("([A-Za-z0-9+/=]+)"\)', text):
            try:
                decoded = base64.b64decode(b64).decode("utf-8")
                for m in ATTACH_PATH_RE.finditer(decoded):
                    path = m.group(1).rstrip(".,;)")
                    refs[path].add(html_file.name)
            except Exception:
                pass
    return refs


def main():
    global SOURCE_DIR

    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Path to the LabArchives source export directory")
    args = parser.parse_args()
    SOURCE_DIR = Path(args.source).resolve()

    if not SOURCE_DIR.exists():
        sys.exit(f"ERROR: source directory not found: {SOURCE_DIR}")

    attachments_dir = SOURCE_DIR / "attachments"
    if not attachments_dir.exists():
        sys.exit(f"ERROR: {attachments_dir} not found")

    print("Building page name map from notebook_home_page.html...")
    page_names = build_page_names(SOURCE_DIR)

    print("Scanning HTML files for attachment references...")
    refs = scan_references(SOURCE_DIR)
    print(f"  {len(refs)} unique attachment paths referenced across all pages.\n")

    all_files = sorted(f for f in attachments_dir.rglob("*") if f.is_file())
    print(f"  {len(all_files)} files in attachments/.\n")

    lines   = []
    orphans = []

    for f in all_files:
        rel   = f.relative_to(SOURCE_DIR).as_posix()
        pages = refs.get(rel, set())

        if not pages:
            orphans.append(rel)
            lines.append(f"[ORPHAN]  {rel}")
        else:
            lines.append(f"{rel}")
            for src in sorted(pages):
                name = page_names.get(src, "?")
                lines.append(f"          <- {src}  ({name})")

    lines += [
        "",
        "─" * 60,
        f"Total attachments : {len(all_files)}",
        f"Referenced        : {len(all_files) - len(orphans)}",
        f"Orphaned          : {len(orphans)}",
        "",
        "Orphaned files:",
    ]
    for o in orphans:
        lines.append(f"  {o}")

    report = "\n".join(lines)
    report_path = SOURCE_DIR / "attachment_report.txt"
    report_path.write_text(report, encoding="utf-8")

    # Print summary to console, full detail goes to file
    print(f"{'─'*60}")
    print(f"Total attachments : {len(all_files)}")
    print(f"Referenced        : {len(all_files) - len(orphans)}")
    print(f"Orphaned          : {len(orphans)}")
    print(f"\nFull report written to: {report_path}")
    print("(Each attachment is listed with the page(s) that reference it.)")


if __name__ == "__main__":
    main()
