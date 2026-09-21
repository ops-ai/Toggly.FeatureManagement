import { join } from 'node:path';
const { packCore } = require('../../../tests/packed-core.cjs');
const { verifyStorage } = require('../../../tests/packed-storage.cjs');
let corePackage: {archive:string;dispose():void};
beforeAll(async()=>{corePackage=await packCore();},120000);
afterAll(()=>corePackage?.dispose());
for(const version of ['2.12.2','3.3.3'])it(`installs, typechecks, and runs with MMKV ${version}`,async()=>{
 await verifyStorage(join(__dirname,'..'),corePackage.archive,version,{'react-native-mmkv':version,'@types/react':'19.2.18'});
},240000);
