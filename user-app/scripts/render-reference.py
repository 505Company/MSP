"""Read a LibreOffice-produced PDF and compare it with saved browser reconstructions."""
from pathlib import Path
import sys
import pypdfium2 as pdfium
from PIL import Image, ImageDraw
from pypdf import PdfReader

folder = Path(sys.argv[1] if len(sys.argv) > 1 else 'outputs/independent-reference')
path = folder / 'Шаблон презентации VK Education.pdf'
pdf = pdfium.PdfDocument(path)
fonts = set()
for page in PdfReader(path).pages:
    for font in page['/Resources'].get('/Font', {}).values():
        fonts.add(str(font.get_object().get('/BaseFont')))
print('PDF pages:', len(pdf), 'fonts:', ', '.join(sorted(fonts)))
for start, slides in enumerate([[3, 7, 8], [13, 18, 20], [25, 30, 38], [1, 50, 52]]):
    width = 768
    rows = []
    for number in slides:
        page = pdf[number-1]
        reference = page.render(scale=width/page.get_width()).to_pil().convert('RGB')
        web = Image.open(folder / f'web-s{number:02d}.jpg').convert('RGB')
        web = web.resize(reference.size)
        row = Image.new('RGB', (width*2, reference.height+28), 'white')
        draw = ImageDraw.Draw(row)
        draw.text((12, 8), f'LibreOffice / slide {number}', fill='black')
        draw.text((width+12, 8), f'Web / slide {number}', fill='black')
        row.paste(reference, (0, 28)); row.paste(web, (width, 28))
        rows.append(row)
    canvas = Image.new('RGB', (width*2, sum(r.height for r in rows)), '#ddd')
    y = 0
    for row in rows:
        canvas.paste(row, (0, y)); y += row.height
    canvas.save(folder / f'comparison-{start+1}.png')
