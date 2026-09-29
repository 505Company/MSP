import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {WebSocketServer} from 'ws'
import {chromium} from '@playwright/test'
import {isWorkerRefresh,protectWorkerFromRefresh} from '../scripts/worker-hmr.mjs'

test('worker refresh filter preserves ordinary messages and explicit cancellation',()=>{
 for(const value of [{type:'update'},{type:'full-reload'},{type:'prune'},{type:'error'},{type:'custom',event:'rsc:update'},{type:'custom',event:'rsc:prune'}])assert.equal(isWorkerRefresh(JSON.stringify(value)),true)
 for(const value of ['ping','null','{}',JSON.stringify({type:'connected'}),JSON.stringify({type:'custom',event:'cancel-job'}),JSON.stringify({type:'progress',completed:1})])assert.equal(isWorkerRefresh(value),false)
})

test('a real worker browser survives HMR while job and cancellation traffic still work',{skip:!process.env.MSP_BROWSER_PATH},async()=>{
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><body>worker</body></html>')})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const origin=`http://127.0.0.1:${server.address().port}`,wss=new WebSocketServer({server})
 wss.on('connection',socket=>socket.on('message',raw=>{
  if(String(raw)==='begin'){
   socket.send(JSON.stringify({type:'full-reload'}));socket.send(JSON.stringify({type:'custom',event:'rsc:update'}))
   socket.send(JSON.stringify({type:'progress',completed:1}));socket.send(JSON.stringify({type:'custom',event:'cancel-job'}))
  }
 }))
 let browser
 try{
  browser=await chromium.launch({executablePath:process.env.MSP_BROWSER_PATH,headless:true})
  const context=await browser.newContext();await protectWorkerFromRefresh(context,origin)
  const page=await context.newPage();await page.goto(origin)
  const received=await page.evaluate(origin=>new Promise(resolve=>{
   const received=[],ws=new WebSocket(origin.replace('http:','ws:')+'/?token=dev-test','vite-hmr')
   ws.onopen=()=>ws.send('begin')
   ws.onmessage=event=>{received.push(JSON.parse(event.data));if(received.at(-1).event==='cancel-job'){ws.close();resolve(received)}}
  }),origin)
  assert.deepEqual(received,[{type:'progress',completed:1},{type:'custom',event:'cancel-job'}])
  assert.equal(await page.locator('body').innerText(),'worker')
 }finally{await browser?.close();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve))}
})
