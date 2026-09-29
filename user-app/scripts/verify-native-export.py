"""Verify native objects and complete text against an independently produced PDF."""
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from pypdf import PdfReader
import pypdfium2 as pdfium

pptx, pdf = map(Path, sys.argv[1:3])
ns = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main', 'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
with ZipFile(pptx) as archive:
    root = ET.fromstring(archive.read('ppt/slides/slide1.xml'))
paragraphs = [''.join(t.text or '' for t in p.findall('.//a:t', ns)) for p in root.findall('.//a:p', ns)]
reader = PdfReader(pdf)
assert len(reader.pages) == 1
normalize = lambda s: re.sub(r'\s+', '', s)
text = normalize(reader.pages[0].extract_text())
missing = [p for p in paragraphs if p and normalize(p) not in text]
assert not missing, f'Text missing from independent render: {missing}'
result = {
    'pptx': pptx.name, 'pdf': pdf.name, 'pages': 1,
    'nativeShapes': len(root.findall('.//p:sp', ns)),
    'nativeGroups': len(root.findall('.//p:grpSp', ns)),
    'nativeImages': len(root.findall('.//p:pic', ns)),
    'textParagraphsVerified': len([p for p in paragraphs if p]),
    'pdfFonts': sorted({str(f.get_object().get('/BaseFont')) for f in reader.pages[0]['/Resources'].get('/Font', {}).values()}),
}
assert result['nativeShapes'] and result['textParagraphsVerified']
document = pdfium.PdfDocument(pdf)
document[0].render(scale=1.5).to_pil().save(pdf.with_suffix('.png'))
pdf.with_suffix('.verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps(result, ensure_ascii=False, indent=2))
