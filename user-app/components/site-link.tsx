"use client"

import * as React from "react"
import {useRouter} from 'next/navigation'
import { processingCount, processingServerSnapshot, subscribeProcessing } from "@/lib/uploads/processing-activity"
import { designProgressSnapshot, designProgressServerSnapshot, subscribeDesignProgress } from '@/lib/uploads/design-progress'

export function useProcessingActive() {
  const streams = React.useSyncExternalStore(subscribeProcessing, processingCount, processingServerSnapshot)
  const tasks = React.useSyncExternalStore(subscribeDesignProgress, designProgressSnapshot, designProgressServerSnapshot)
  return streams > 0 || tasks.some(t => t.owned && t.status === 'running')
}

// Client navigation preserves the upload continuation in the same document.
// Do not prefetch potentially large design-system pages or open extra tabs.
const SiteLink = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(function SiteLink(
  { href, target, rel, title, onClick, ...props }, ref
) {
  const router=useRouter()
  const safeRel = target === '_blank' ? `${rel ?? ''} noopener noreferrer`.trim() : rel
  return <a {...props} ref={ref} href={href} target={target} rel={safeRel} title={title} onClick={event=>{
    onClick?.(event)
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey
      ||(target&&target!=='_self')||props.download!=null||!href?.startsWith('/')||href.startsWith('//'))return
    event.preventDefault();router.push(href)
  }} />
})
export default SiteLink
