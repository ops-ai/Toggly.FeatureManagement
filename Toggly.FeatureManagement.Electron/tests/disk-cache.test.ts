import {afterEach,expect,it} from 'vitest'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DiskFeatureCache,buildCacheFilePath} from '../src/main/cache.js'
const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function setup(){const root=await mkdtemp(join(tmpdir(),'electron-cache-pair-'));roots.push(root);return {root,cache:new DiskFeatureCache(root)}}
it('snapshots the complete body/revision before asynchronous filesystem work',async()=>{
 const {cache}=await setup();const flags={On:true};const pending=cache.write('app','Test','alice',{flags,revision:'old',updatedAt:1});flags.On=false;await pending
 expect((await cache.read('app','Test','alice'))?.flags).toEqual({On:true})
})
it.each([{On:1},{On:{requirement:'all',rules:[{property:'x',op:'eq',value:3}]}},[]])('rejects malformed cached definitions %j',async(flags)=>{
 const {cache,root}=await setup();await cache.write('app','Test','alice',{flags:{On:true},revision:'r',updatedAt:1})
 await writeFile(buildCacheFilePath(root,'app','Test','alice'),JSON.stringify({flags,revision:'r',updatedAt:1}))
 expect(await cache.read('app','Test','alice')).toBeNull()
})
it('rejects a different context whose legacy sanitized filename collides',async()=>{
 const {cache}=await setup();await cache.write('app','Test','a:b',{flags:{On:true},revision:'r',updatedAt:1})
 expect(await cache.read('app','Test','a_b')).toBeNull()
})
