import re
from pathlib import Path

for f in sorted(Path('..').glob('*.html')):
    if f.name == 'notebook_home_page.html':
        continue
    text = f.read_text(encoding='utf-8')
    if 'attachments' in text:
        matches = re.findall(r'["\x27](attachments[^"\'<>\s]{1,150})["\x27]', text)
        if matches:
            print(f'--- {f.name} ---')
            for m in matches[:5]:
                print(' ', m)
