"""Render an original synthetic UI test fixture (not an edited user image)."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path('outputs/diagnostics/provider-compliance/fixtures')
root.mkdir(parents=True, exist_ok=True)
font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
image = Image.new('RGB', (1440, 900), '#eef1f7')
draw = ImageDraw.Draw(image)


def text(x, y, value, size=14, color='#24334b'):
    draw.text((x, y), value, fill=color, font=ImageFont.truetype(font_path, size))


draw.rectangle((0, 0, 1440, 60), fill='#19263d')
text(32, 18, 'MSP / Provider compliance fixture', 20, '#ffffff')
draw.rounded_rectangle((48, 98, 1392, 838), radius=12, fill='#ffffff')
text(80, 127, 'Generation settings', 28)
text(80, 188, 'Model', 14)
text(80, 213, 'Qwen / Qwen3.8-27B', 18)
text(770, 188, 'Reference ID (12 px)', 14)
text(770, 218, 'DX-8042 / BATCH K7M2', 12)
text(80, 284, 'Provider', 14)
draw.rounded_rectangle((80, 309, 472, 359), radius=5, outline='#8291a8', width=1)
text(95, 324, 'DeepInfra', 16)
draw.polygon(((440, 329), (454, 329), (447, 338)), fill='#24334b')
text(770, 284, 'Small text (14 px)', 14)
text(770, 316, 'Queue: 037 / Retry: 02 / Limit: 32768', 14)
for y, label, checked in ((420, 'Preserve history', True), (470, 'Enable fallback', False)):
    draw.rectangle((82, y, 101, y + 19), fill='#2855da' if checked else '#ffffff', outline='#8291a8')
    if checked:
        draw.line(((86, y + 9), (91, y + 14), (98, y + 4)), fill='white', width=2)
    text(115, y, label, 16)
text(770, 420, 'Footnote (10 px)', 14)
text(770, 450, 'audit-key: Z9Q4-L2V7', 10)
draw.rounded_rectangle((80, 580, 262, 624), radius=5, fill='#2855da')
text(116, 592, 'Run check', 16, '#ffffff')
draw.rounded_rectangle((280, 580, 462, 624), radius=5, fill='#e7eaf0')
text(333, 592, 'Export', 16, '#98a2b3')
text(80, 770, 'Synthetic test data. No user documents.', 12, '#64748b')
image.save(root / 'small-ui.png')
(root / 'small-ui.json').write_text(json.dumps({
    'size': [1440, 900], 'fontPixels': [10, 12, 14, 16, 18, 20, 28],
    'expected': {'reference': 'DX-8042 / BATCH K7M2', 'queue': '037', 'retry': '02', 'limit': '32768',
                 'auditKey': 'Z9Q4-L2V7', 'provider': 'DeepInfra', 'checked': 'Preserve history',
                 'unchecked': 'Enable fallback', 'enabledButton': 'Run check', 'disabledButton': 'Export'},
    'sha256': hashlib.sha256((root / 'small-ui.png').read_bytes()).hexdigest(),
}, indent=2) + '\n')
print('small-ui.png: 1440x900, text 10/12/14 px and UI states')
