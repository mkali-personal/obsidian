# LabArchives Reorganization Scripts

These scripts reorganize a raw LabArchives offline export into a clean,
Obsidian-compatible folder structure.

The scripts live in a git repository and operate on a **separate source
directory** that you point them to.  The source is never modified.

---

## Prerequisites

- Python 3.11+
- `pip install beautifulsoup4 markdownify`

---

## Usage

All scripts take the path to the LabArchives source export as their first argument.
The organized output is always created as a sibling folder named
`<source_name> - Organized` next to the source directory.

### 1. `reorganize.py`
Rebuilds the original notebook hierarchy at the output root, moves raw files
into `archive-supplementary/`, and fixes all internal HTML paths.

```
python reorganize.py "C:\path\to\Lab Archives Data - source"
python reorganize.py "C:\path\to\Lab Archives Data - source" --dry-run
```

Re-running always overwrites the output folder from scratch.

---

### 2. `html_to_md.py`
Converts every HTML page to Markdown alongside it.
Images become Obsidian wikilinks (`![[filename.jpg|1000]]`).

```
python html_to_md.py "C:\path\to\Lab Archives Data - source"
```

---

### 3. `find_orphans.py`  *(optional)*
Scans source HTML files and maps each file in `attachments/` to the
page(s) that reference it.  Orphaned files are flagged.
Writes `attachment_report.txt` into the source directory.

```
python find_orphans.py "C:\path\to\Lab Archives Data - source"
```

---

### 4. `cleanup.py`  *(optional — irreversible)*
Deletes from the output directory:
- All `.html` content files (requires `.md` counterpart for each)
- HTML infrastructure (`stylesheets/`, `javascripts/`, `images/`, numbered `.html` files)
- Orphaned attachments
- Empty directories

```
python cleanup.py "C:\path\to\Lab Archives Data - source" --dry-run
python cleanup.py "C:\path\to\Lab Archives Data - source"
```

---

## Output structure

After steps 1–2 (and optionally 4):

```
Lab Archives Data - source - Organized/
├── Code/
├── Common/
├── EMNV/
├── Interesting Papers/
├── LaBBS/
├── Laser Phase Plate/
├── Purchases and Orders/
└── archive-supplementary/
    └── attachments/       ← images and files embedded in pages
```

Each page appears as `Page Name.html` + `Page Name.md`
(or only `.md` after `cleanup.py`).
