// Compare two derived systems of the same PPTX, without mutating either import.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
const [previousPath,currentPath,outputPath]=process.argv.slice(2)
if(!previousPath||!currentPath||!outputPath)throw new Error('Usage: node scripts/verify-source-system.mjs PREVIOUS_JSON CURRENT_JSON OUTPUT_JSON')
const old=(JSON.parse(await readFile(previousPath,'utf8'))).system,current=(JSON.parse(await readFile(currentPath,'utf8'))).system
assert.equal(current.sourceId,old.sourceId)
assert.deepEqual(current.ledger.map(r=>r.elementId).sort(),old.ledger.map(r=>r.elementId).sort())
assert.deepEqual(current.resources,old.resources.map(r=>({...r,componentIds:current.resources.find(c=>c.id===r.id).componentIds})))
assert.deepEqual(current.styles,old.styles)
const removed=old.constructions.filter(c=>!current.constructions.some(n=>n.id===c.id))
const tableParts=new Set(current.constructions.filter(c=>c.kind==='table').flatMap(c=>c.elementIds))
assert.ok(removed.every(c=>c.kind==='table-part'&&tableParts.has(c.rootId)),'Only internal table candidates may disappear; their source nodes must remain in complete tables')
assert.equal(new Set(current.scan.suppliedIds).size,current.scan.suppliedIds.length)
assert.ok(current.scan.batches.every(b=>b.bytes<=32000&&b.nodes.length<=160))
assert.ok(current.scan.batches.every(b=>{const ids=new Set([...b.nodes,...b.context].map(n=>n.id));return b.nodes.every(n=>!n.parentId||ids.has(n.parentId))}))
const result={sourceId:current.sourceId,summary:current.summary,previousCandidates:old.constructions.length,currentCandidates:current.constructions.length,retainedTablePartCandidates:removed.length,removedSourceRecords:0,changedResources:0,changedStyles:0,scanBatches:current.scan.batches.length,scanNodes:current.scan.suppliedIds.length,scanPending:current.scan.pending.length,maximumBatchBytes:Math.max(...current.scan.batches.map(b=>b.bytes)),modelCalls:0}
await writeFile(outputPath,JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
