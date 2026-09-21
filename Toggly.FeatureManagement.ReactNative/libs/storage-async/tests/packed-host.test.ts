import { join } from 'node:path';
const { packCore } = require('../../../tests/packed-core.cjs');
const { verifyStorage } = require('../../../tests/packed-storage.cjs');
let corePackage: {archive:string;dispose():void};
beforeAll(async()=>{corePackage=await packCore();},120000);
afterAll(()=>corePackage?.dispose());
const hosts=[
 {asyncStorage:'1.24.0',react:'18.3.1',reactNative:'0.76.2',typesReact:'18.3.31'},
 {asyncStorage:'2.2.0',expo:'57.0.22',react:'19.2.3',reactNative:'0.86.3',typesReact:'19.2.18'},
 {asyncStorage:'3.1.1',react:'19.2.3',reactNative:'0.87.1',typesReact:'19.2.18'},
];
for(const host of hosts)it(`installs, typechecks, and uses the default AsyncStorage API on ${host.asyncStorage}`,async()=>{
 await verifyStorage(join(__dirname,'..'),corePackage.archive,host.asyncStorage,{
  '@react-native-async-storage/async-storage':host.asyncStorage,'@types/react':host.typesReact,react:host.react,'react-native':host.reactNative,...(host.expo?{expo:host.expo}:{})
 });
},240000);
