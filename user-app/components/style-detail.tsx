"use client"
import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from './site-link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useWorkspaceData } from './workspace-data'
import { DesignSystemExplorer } from './design-system-explorer'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'
import type { CheckpointResult } from '@/lib/digital-designer/pipeline'
import type { UploadJob } from '@/lib/uploads/domain'
import type { BankStyle } from '@/lib/workspace/types'
import type { ScanRun } from '@/lib/design-system/semantic-scan'
import { AutomaticDesignSystem } from './automatic-design-system'
import { DeleteBankStyle } from './delete-bank-style'
import { subscribeUploadCancellation } from '@/lib/uploads/cancellation-client'
export function StyleDetail({ routePrefix = '' }: { routePrefix?: string } = {}) {
  const bankPath = `${routePrefix}/styles`
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { data, error, reload } = useWorkspaceData<{ upload: UploadJob; visual: VisualManifest | null; checkpoint: CheckpointResult | null }>(`/api/uploads/${id}/design-system`)
  const { data: bank } = useWorkspaceData<{ styles: BankStyle[] }>('/api/style-bank')
  const { data: scan, reload: reloadScan } = useWorkspaceData<{ run: ScanRun | null }>(`/api/uploads/${id}/semantic-scan`)
  const { data: capability } = useWorkspaceData<{ configured: boolean }>('/api/capabilities/qwen')
  const style = bank?.styles.find(s => s.id === id)
  const processing = scan?.run?.status === 'running' || !scan?.run && data?.upload.status === 'processing'
  useEffect(() => subscribeUploadCancellation(deletedId => { if (deletedId === id) router.replace(bankPath) }), [id, router, bankPath])
  useEffect(() => {
    const refresh = () => { reload(); reloadScan() }
    window.addEventListener('style-bank:uploads-changed', refresh)
    const timer = processing ? setInterval(reloadScan, 5000) : undefined
    return () => { window.removeEventListener('style-bank:uploads-changed', refresh); clearInterval(timer) }
  }, [processing, reload, reloadScan])
  return <div className="ws-page pw">
    <Link className="ws-back" href={bankPath}><ArrowLeft size={15} />Банк стилей</Link>
    <header className="ws-heading"><div><h1>{style?.name ?? data?.upload.fileName.replace(/\.pptx$/i, '') ?? 'Дизайн-система'}</h1></div>{style && <div className="ws-style-actions"><Link className="pw-primary" href={`${routePrefix ? routePrefix + "/create" : "/projects"}?template=${id}`}>Создать презентацию<ArrowRight size={17} /></Link><DeleteBankStyle style={style} onDeleted={() => router.push(bankPath)} /></div>}</header>
    {error && <div className="ws-empty" role="alert"><p>{error}</p><button className="pw-outline" onClick={reload}>Повторить</button></div>}
    {!data && !error && <p role="status">Открываем дизайн-систему…</p>}
    <AutomaticDesignSystem uploadId={id} label={style?.name??data?.upload.fileName} enabled={!!capability?.configured&&!!data?.visual&&data.upload.status!=='cancelled'}/>
    {data?.visual && data.upload.status!=='cancelled' && <DesignSystemExplorer key={`${id}:${scan?.run?.catalogId??''}`} uploadId={id} automated={!!capability?.configured} visual={data.visual} checkpoint={data.checkpoint} />}
    {data?.upload.status==='cancelled' && <p>Дизайн-система удалена из банка.</p>}
    {data && !data.visual && <div className="ws-empty"><p>У этого импорта пока нет визуального разбора.</p><Link className="pw-outline" href={bankPath}>Добавить PPTX в банке стилей</Link></div>}
  </div>
}
