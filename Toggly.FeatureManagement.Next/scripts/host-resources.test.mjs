import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp, mkdir, readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {withResources} from './host-resources.mjs'
test('failed verification and failed cleanup still remove independent owned temporary resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toggly-next-cleanup-'))
  try {
    await mkdir(join(root,'good')); await mkdir(join(root,'bad'))
    await assert.rejects(withResources(async defer => {
      defer(()=>rm(join(root,'good'),{recursive:true}))
      defer(()=>rm(join(root,'bad')))
      throw Error('original verification failure')
    }), error=>error instanceof AggregateError && error.errors.length===2 && error.errors[0].message==='original verification failure' && error.errors[1].code==='ERR_FS_EISDIR')
    assert.deepEqual(await readdir(root), ['bad'])
  } finally {await rm(root,{recursive:true,force:true})}
})
