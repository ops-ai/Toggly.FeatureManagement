import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './packed-process.cjs';
const family = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(family, 'tests/fixtures/packed-native');
const temp = await mkdtemp(join(tmpdir(), 'toggly-packed-native-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env, npm_config_cache: join(temp, 'npm-cache') };
const execute = (command,args,cwd=temp,capture=false) => run(command,args,{cwd,capture,env});
try {
  if (process.env.TOGGLY_SHARED_ARTIFACTS) throw new Error('Packed acceptance requires public registry dependencies');
  console.log(`Owned native host: ${temp}`);
  await execute(process.execPath, ['--test', join(family,'tests/packed-process.test.mjs')]);
  await cp(fixture, temp, { recursive: true });
  for (const [name,archive] of [['core','core.tgz'],['react-native','adapter.tgz']]) {
    const cwd = join(family, 'libs', name);
    await execute(npm, ['run', 'build'], cwd);
    const packed = JSON.parse(await execute(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], cwd, true));
    await cp(join(temp,packed[0].filename),join(temp,archive));
    const digest = createHash('sha256').update(await readFile(join(temp,archive))).digest('hex');
    console.log(`${name} archive SHA256 ${digest}`);
  }
  if (process.env.TOGGLY_UPDATE_PACKED_LOCK === '1') {
    await execute(npm, ['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund','./core.tgz','./adapter.tgz']);
    for (const file of ['package.json','package-lock.json']) await cp(join(temp,file),join(fixture,file));
    console.log('Genuine npm packed fixture lock generated; no host acceptance claimed.');
  } else {
    const lock=JSON.parse(await readFile(join(temp,'package-lock.json'),'utf8'));
    for (const [name,archive] of [['react-native-toggly-core','core.tgz'],['react-native-toggly','adapter.tgz']]) {
      const integrity='sha512-'+createHash('sha512').update(await readFile(join(temp,archive))).digest('base64');
      if (lock.packages[`node_modules/@ops-ai/${name}`].integrity!==integrity) throw new Error(`Packed ${name} changed: regenerate its genuine npm fixture lock`);
    }
    await execute(npm,['ci','--ignore-scripts','--no-audit','--no-fund']);
    await execute(npm,['ls','--all']);
    const reporter=JSON.parse(await readFile(join(temp,'node_modules/@ops-ai/toggly-client-telemetry/package.json'),'utf8'));
    const provenance=lock.packages['node_modules/@ops-ai/toggly-client-telemetry'];
    if(reporter.version!=='1.1.0'||!provenance.resolved.startsWith('https://registry.npmjs.org/'))throw new Error('Expected genuine public reporter1.1.0');
    console.log(`Public reporter ${reporter.version}, ${provenance.resolved}, ${provenance.integrity}`);
    await execute(join(temp,'node_modules/.bin/tsc'),['--noEmit','--strict','--target','ES2020','--module','Node16','--moduleResolution','Node16','--lib','ES2020','--esModuleInterop','consumer.ts']);
    await execute(process.execPath,['verify.cjs']);
    await execute(process.execPath,['build.cjs']);
  }
} finally {
  await rm(temp,{recursive:true,force:true});
  console.log(`Removed native host: ${temp}`);
}
