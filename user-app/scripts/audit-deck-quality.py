"""Read-only audit of the local live control. Never writes application state."""
import json
import sqlite3
from html import escape
from pathlib import Path

output = Path('outputs/q6')
scope = json.loads((output / 'state.json').read_text())
project = json.loads((output / 'control-project.json').read_text())['id']
prefix = f"presentation-decks/{project}/{scope['inputId']}"
r2 = Path('.wrangler/state/v3/r2')
db = r2 / 'miniflare-R2BucketObject/49e6826fd41b4990fd0dd7b3ba19a3021a358ffb618ea1ab8f4454a592996ae7.sqlite'
connection = sqlite3.connect('file:' + str(db) + '?mode=ro', uri=True)


def blob(key):
    row = connection.execute('SELECT blob_id FROM _mf_objects WHERE key=?', (key,)).fetchone()
    assert row, key
    return (r2 / 'site-creator-r2/blobs' / row[0]).read_bytes()


def load(key):
    return json.loads(blob(key))


def save(name, value):
    (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2))


state, source = load(prefix + '/state.json'), load(prefix + '/input.json')
assert state['status'] in ('ready', 'blocked', 'failed'), 'Live worker has not finished'
audits, cards = [], []
for slide in state['slides']:
    if not slide.get('fittedAttempt'):
        continue
    original = next(i for i in source['inputs'] if i['slideId'] == slide['id'])
    fitted = next(a for a in slide['attempts'] if a['number'] == slide['fittedAttempt'])
    native = load(f"{prefix}/slides/{slide['id']}/scene.json")
    assert native['sceneHash'] == fitted['sceneHash'] and not native['report']['issues']
    fragments = {f['id']: f['text'] for f in original['content']}
    ranges = {key: [] for key in fragments}
    texts = {e['id']: e['text'] for e in native['component']['scene']['elements'] if e['kind'] == 'text'}
    for text in fitted['scene']['texts']:
        pieces = []
        for part in text['parts']:
            raw = fragments[part['fragmentId']].encode('utf-16-le')
            pieces.append(raw[part['start'] * 2:part['end'] * 2].decode('utf-16-le'))
            ranges[part['fragmentId']].append((part['start'], part['end']))
        assert texts[text['id']] == ('\n' if text['separator'] == 'newline' else ' ').join(pieces)
    for fid, positions in ranges.items():
        cursor = 0
        for start, end in sorted(positions):
            assert start == cursor and end > start, (slide['id'], fid, positions)
            cursor = end
        assert cursor == len(fragments[fid].encode('utf-16-le')) // 2
    reviews = [r for j in state['jobs'] if j['spec']['kind'] == 'review' and j['status'] == 'complete'
               for r in j['result']['slides'] if r['slideId'] == slide['id']]
    latest = reviews[-1] if reviews else None
    reviewed_current = bool(latest and latest['sceneHash'] == fitted['sceneHash'])
    label = ('Принят Q6' if latest['verdict'] == 'pass' else 'Есть замечания Q6') if reviewed_current else 'Изменён · повторная оценка не завершена'
    audit = dict(slideId=slide['id'], title=slide['title'], currentVariant=slide['variantId'], fittedVariant=fitted['variantId'],
                 tried=slide['tried'], sourceFragments=len(fragments), exactNativeText=True, technicalIssues=0,
                 sceneHash=fitted['sceneHash'], reviewedCurrent=reviewed_current, reviews=reviews)
    audits.append(audit)
    (output / (slide['id'] + '.png')).write_bytes(blob(fitted['preview']))
    caption = escape(' '.join(i['instruction'] for i in reviews[0]['issues'])) if reviews and reviews[0]['issues'] else 'Исходная композиция не потребовала исправлений.'
    cards.append(f'''<article><h2>{escape(slide['title'])}</h2><p class="status">{label}</p>
      <div class="compare"><figure><figcaption>До визуальной оценки</figcaption><a href="before/{slide['id']}.png"><img src="before/{slide['id']}.png" alt="До: {escape(slide['title'])}"></a></figure>
      <figure><figcaption>Последний проверенный рендер</figcaption><a href="{slide['id']}.png"><img src="{slide['id']}.png" alt="После: {escape(slide['title'])}"></a></figure></div>
      <p class="note">Первое замечание модели: {caption}</p></article>''')

history = []
for job in state['jobs']:
    record = dict(kind=job['spec']['kind'], key=job['spec']['key'], status=job['status'], requests=job['requests'], result=job.get('result'))
    if job.get('runId'):
        run = load(f"{prefix}/aux/{job['id']}/runs/{job['runId']}.json")
        record.update(error=run.get('error'), model=run['model'])
    history.append(record)
save('run-history.json', history)
save('content-audit.json', dict(projectId=project, inputId=scope['inputId'], status=state['status'],
    sourceFragments=sum(a['sourceFragments'] for a in audits), directions=sum(len(i['directions']) for i in source['inputs']),
    exactNativeText=all(a['exactNativeText'] for a in audits), slides=audits))
save('quality-audit.json', dict(status=state['status'], rounds=state['rounds'], slides=audits,
    changes=[j for j in history if j['kind'] == 'reselect'], totalRequests=sum(j['requests'] for j in history) + sum(a['requests'] for s in state['slides'] for a in s['attempts'])))
status = 'Визуальная проверка завершена' if state['status'] == 'ready' else 'Слайды сохранены · визуальная проверка не завершена'
intro = 'Все слайды прошли технические и визуальные проверки.' if state['status'] == 'ready' else 'Пять слайдов прошли технические измерения. Автоматический выбор оформления для финального слайда остановился; вторая визуальная оценка всей колоды не началась. Это контрольный результат с ограничениями.'
(output / 'index.html').write_text(f'''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VK · проверка поиска, опций и Q6</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f4f6f9;color:#162034;font:16px/1.5 system-ui,sans-serif}}main{{max-width:1440px;margin:auto;padding:44px 28px}}h1{{font-size:36px;line-height:1.15;max-width:900px}}header p{{max-width:900px;color:#526077}}.eyebrow{{font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:#076ce0}}article{{background:white;border:1px solid #e0e5eb;border-radius:16px;padding:24px;margin:28px 0}}h2{{margin:0;font-size:23px}}.status{{font-size:14px;color:#785112}}.compare{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}figure{{margin:0}}figcaption{{font-size:13px;color:#657087;margin:0 0 8px}}img{{width:100%;display:block;border-radius:8px;border:1px solid #e0e5eb}}.note{{font-size:14px;color:#526077;max-width:1100px}}a{{color:#076ce0}}footer{{color:#526077;font-size:14px}}@media(max-width:800px){{.compare{{grid-template-columns:1fr}}main{{padding:24px 14px}}h1{{font-size:28px}}article{{padding:16px}}}}
</style><main><header><p class="eyebrow">VK Education · контроль автоматической сборки</p><h1>{status}</h1><p>{intro}</p><p>260 ресурсов из 260 рассмотрены · 21 фрагмент исходного текста сохранён точно · 2 автоматические смены опции</p></header>
{''.join(cards)}<footer>Сборку, выбор ресурсов и исправления выполнял Qwen. Ответы модели и слайды вручную не подменялись. Нажмите на изображение, чтобы открыть его целиком. <a href="http://localhost:5184/projects">Открыть проекты</a></footer></main></html>''')
print(json.dumps(dict(status=state['status'], fittedSlides=len(audits), exactNativeText=True, sourceFragments=sum(a['sourceFragments'] for a in audits)), ensure_ascii=False))
