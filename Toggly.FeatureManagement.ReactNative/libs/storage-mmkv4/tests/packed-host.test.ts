import { join } from 'node:path';
const { packCore } = require('../../../tests/packed-core.cjs');
const { verifyStorage } = require('../../../tests/packed-storage.cjs');
let corePackage: {archive:string;dispose():void};
beforeAll(async()=>{corePackage=await packCore();},120000);
afterAll(()=>corePackage?.dispose());
it('requires the Nitro line that supports the current React Native JSI hook',()=>{
 expect(require('../package.json').peerDependencies['react-native-nitro-modules']).toBe('^0.37.1');
});
it('installs, typechecks, and uses the packed adapter with MMKV 4 and Nitro',async()=>{
 await verifyStorage(join(__dirname,'..'),corePackage.archive,'4',{'@types/react':'19.2.18'});
},240000);
