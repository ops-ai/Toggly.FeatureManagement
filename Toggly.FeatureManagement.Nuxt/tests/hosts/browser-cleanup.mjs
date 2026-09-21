import assert from 'node:assert/strict'
import {bounded,withResources,launchBrowser} from './owned-resources.mjs'

// Use the actual Playwright BrowserServer in this process, including descendants.
export async function verifyBrowserCleanup(chromium) {
 let pid
 const launcher={launchServer:async options=>{const server=await chromium.launchServer(options);pid=server.process().pid;return server},connect:(...args)=>chromium.connect(...args)}
 await assert.rejects(withResources(async own=>{
  const browser=await launchBrowser(launcher,own)
  const page=await browser.newPage()
  await bounded(()=>page.evaluate(()=>new Promise(()=>{})),'actual browser evaluation',100)
 }),error=>String(error.cause).includes('actual browser evaluation timed out'))
 assert(pid,'actual Chrome started')
 const alive=()=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
 assert.equal(alive(),false,'actual Chrome survived owned cleanup')
 console.log('PASS real Playwright evaluation deadline and owned Chrome cleanup',pid)
}
