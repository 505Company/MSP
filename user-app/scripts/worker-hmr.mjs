// A worker keeps one code snapshot for the lifetime of its leased job. Vite
// refresh must not unmount the runner and abort a paid model request. The next
// job gets a fresh context and loads the current application normally.
export function isWorkerRefresh(message) {
  try {
    const value=JSON.parse(String(message))
    return ['update','full-reload','prune','error'].includes(value?.type)
      || value?.type==='custom'&&['rsc:update','rsc:prune'].includes(value.event)
  } catch { return false }
}
export async function protectWorkerFromRefresh(context,origin) {
  const expected=new URL(origin)
  await context.routeWebSocket(url=>url.host===expected.host&&url.pathname==='/',ws=>{
    const server=ws.connectToServer()
    server.onMessage(message=>{if(!isWorkerRefresh(message))ws.send(message)})
  })
}
