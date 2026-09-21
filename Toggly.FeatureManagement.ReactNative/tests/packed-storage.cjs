const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { run } = require('./packed-process.cjs');
module.exports.verifyStorage = async function verifyStorage(packageDirectory, coreArchive, label, dependencies={}) {
  const root=mkdtempSync(join(tmpdir(), `toggly-native-storage-${label}-`));
  const env={...process.env,npm_config_cache:join(root,'npm-cache')};
  const execute=(command,args,cwd=root)=>run(command,args,{cwd,env,capture:true,timeoutMs:120000});
  try {
    console.log(`Owned storage host: ${root}`);
    if(process.env.TOGGLY_SHARED_ARTIFACTS)throw new Error('Storage acceptance requires registry dependencies');
    await execute('npm',['run','build'],packageDirectory);
    const packed=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',root],packageDirectory))[0];
    cpSync(join(packageDirectory,'tests/fixtures/packed-host'),root,{recursive:true});
    cpSync(join(__dirname,'telemetry-consumer.cjs'),join(root,'telemetry-consumer.cjs'));
    cpSync(join(root,packed.filename),join(root,'storage.tgz'));
    cpSync(coreArchive,join(root,'core.tgz'));
    const manifestPath=join(root,'package.json');const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
    const storageName=JSON.parse(readFileSync(join(packageDirectory,'package.json'),'utf8')).name;
    Object.assign(manifest.dependencies,dependencies,{[storageName]:'file:storage.tgz','@ops-ai/react-native-toggly-core':'file:core.tgz'});
    writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    const lockPath=join(packageDirectory,'tests/fixtures/packed-locks',`${label}.json`);
    if(process.env.TOGGLY_UPDATE_PACKED_LOCK==='1') {
      await execute('npm',['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund']);
      mkdirSync(resolve(lockPath,'..'),{recursive:true});cpSync(join(root,'package-lock.json'),lockPath);
      console.log(`Generated genuine storage lock ${label}; acceptance not run`);return;
    }
    cpSync(lockPath,join(root,'package-lock.json'));
    const lock=JSON.parse(readFileSync(lockPath,'utf8'));
    for(const [name,file] of [[storageName,'storage.tgz'],['@ops-ai/react-native-toggly-core','core.tgz']]){
      const bytes=readFileSync(join(root,file));assert.equal(lock.packages[`node_modules/${name}`].integrity,'sha512-'+createHash('sha512').update(bytes).digest('base64'));
      console.log(`${name} SHA256 ${createHash('sha256').update(bytes).digest('hex')}`);
    }
    await execute('npm',['ci','--ignore-scripts','--no-audit','--no-fund']);
    await execute('npm',['ls','--all']);
    const reporter=lock.packages['node_modules/@ops-ai/toggly-client-telemetry'];
    assert.equal(reporter.version,'1.1.0');assert.match(reporter.resolved,/^https:\/\/registry\.npmjs\.org\//);
    console.log(`Public reporter ${reporter.version} ${reporter.integrity}; host ${JSON.stringify(dependencies)}`);
    await execute('npm',['run','typecheck']);
    console.log(await execute('npm',['run','verify']));
  } finally {
    rmSync(root,{recursive:true,force:true});console.log(`Removed storage host: ${root}`);
  }
};
