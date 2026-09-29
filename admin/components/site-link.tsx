"use client"

import * as React from "react"
import { processingCount, processingServerSnapshot, subscribeProcessing } from "@/lib/uploads/processing-activity"

export function useProcessingActive() { return React.useSyncExternalStore(subscribeProcessing, processingCount, processingServerSnapshot) > 0 }

// Native links also work in the published Worker build. While an upload's
// response is being drained, keep its document alive and open navigation aside.
const SiteLink = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(function SiteLink(
  { href, target, rel, title, ...props }, ref
) {
  const active = useProcessingActive()
  const destination = target ?? (active && href?.startsWith("/") ? "_blank" : undefined)
  return <a {...props} ref={ref} href={href} target={destination}
    rel={destination === "_blank" ? `${rel ?? ""} noopener noreferrer`.trim() : rel}
    title={title ?? (destination === "_blank" ? "Откроется в новой вкладке, чтобы анализ продолжился" : undefined)} />
})
export default SiteLink
