import {randomBytes} from 'node:crypto'
import {spawn,type ChildProcess} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import type {Plugin} from 'vite'

/** Local supervision mirrors a separately managed Node renderer in production.
 * The credential is ephemeral, server-only, and never embedded in client code. */
export function localProcessingWorker(enabled:boolean):{token?:string;plugin:Plugin}{
 const token=enabled?randomBytes(32).toString('hex'):undefined
 let child:ChildProcess|undefined,closed=false,restart:ReturnType<typeof setTimeout>|undefined
 return {token,plugin:{name:'msp-background-processing',apply:'serve',configureServer(server){
  if(!enabled)return
  const start=()=>{
   if(closed||!server.httpServer?.listening)return
   const address=server.httpServer.address()
   if(!address||typeof address==='string')return
   child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/processing-worker.mjs',import.meta.url))],{
    cwd:server.config.root,stdio:['ignore','inherit','inherit','ipc'],env:{...process.env,MSP_WORKER_ORIGIN:`http://127.0.0.1:${address.port}`,MSP_WORKER_TOKEN:token},
   })
   child.on('error',()=>server.config.logger.warn('Background processor could not start. Saved jobs remain queued.'))
   child.on('exit',()=>{child=undefined;if(!closed)restart=setTimeout(start,5000)})
  }
  server.httpServer?.once('listening',start)
  server.httpServer?.once('close',()=>{closed=true;clearTimeout(restart);child?.kill('SIGTERM')})
 }}}
}
