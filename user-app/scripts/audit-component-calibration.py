"""Read-only evidence export from the local development R2 bucket."""
import json, sqlite3, base64
from pathlib import Path
root = Path('.wrangler/state/v3/r2')
db = next(p for p in (root/'miniflare-R2BucketObject').glob('*.sqlite') if p.name != 'metadata.sqlite')
connection = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
blobs = root/'site-creator-r2/blobs'
namespace = 'component-calibration/8d4274e6-7684-4427-a0ec-fbf1293d2424/'
reports, runs, proposals, catalogs, signatures = [], [], [], {}, []
current = None
for key, blob in connection.execute('select key,blob_id from _mf_objects where key like ?', (namespace+'%',)):
    path=blobs/blob
    if not path.exists(): continue
    if '/component-qualification-' in key:
        q=json.loads(path.read_text()); signatures.append({'componentId':q['componentId'],'signature':q.pop('signature',[])})
        preview=q.pop('preview',None)
        if not q['ready'] and preview:
            out=Path('outputs/stage-5-calibration/failed-previews');out.mkdir(parents=True,exist_ok=True)
            (out/(q['componentId']+'.png')).write_bytes(base64.b64decode(preview.split(',')[1]))
        reports.append(q)
    elif '/models/' in key and '/runs/' in key:
        run=json.loads(path.read_text())
        runs.append({k:run.get(k) for k in ['id','status','liveRequests','cacheHit','startedAt','finishedAt','resumedFromRunId','error']})
    elif '/proposals/' in key:
        p=json.loads(path.read_text()); proposals.append(p)
    elif '/catalogs/' in key:
        catalog=json.loads(path.read_text()); catalogs[catalog['id']]=catalog
    elif key.endswith('/current.json'):
        current=json.loads(path.read_text()).get('id')
out=Path('outputs/stage-5-calibration');out.mkdir(parents=True,exist_ok=True)
(out/'qualification-reports.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
(out/'model-runs.json').write_text(json.dumps(runs,ensure_ascii=False,indent=2))
(out/'proposals.json').write_text(json.dumps(proposals,ensure_ascii=False,indent=2))
(out/'signatures.json').write_text(json.dumps(signatures,ensure_ascii=False))
if current in catalogs:
    (out/'catalog.json').write_text(json.dumps(catalogs[current],ensure_ascii=False,indent=2))
source=json.loads(Path('outputs/q1-refinement/published-library.json').read_text())['library']
names={c['id']:c['name'] for c in source['components']}
print(json.dumps({'checked':len(reports),'passed':sum(q['ready'] for q in reports),'failed':[{'id':q['componentId'],'name':names.get(q['componentId']),'issues':[i['code'] for i in q['issues'] if i.get('severity')!='warning']} for q in reports if not q['ready']], 'parts':[{'id':p['id'],'families':len(p['result']['families']),'excluded':len(p['result']['excluded'])} for p in proposals], 'runs':[{'status':r['status'],'liveRequests':r['liveRequests'],'error':r['error']} for r in runs]},ensure_ascii=False))
