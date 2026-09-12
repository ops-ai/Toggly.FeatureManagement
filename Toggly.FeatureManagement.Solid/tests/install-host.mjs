// Candidate package installation is ephemeral. Manifests keep registry versions.
import { execFileSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'solidstart-pack-'));
try{
 const packed=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',dir],{encoding:'utf8'}))[0];
 const overlays=[process.env.TOGGLY_NODE_CORE_TARBALL,process.env.TOGGLY_SIGNED_DEFS_TARBALL].filter(Boolean);
 execFileSync('npm',['install','--no-save','--package-lock=false','--fetch-timeout=20000','--fetch-retries=1',join(dir,packed.filename),...overlays],{cwd:'tests/host',stdio:'inherit'});
}finally{rmSync(dir,{recursive:true,force:true});}
