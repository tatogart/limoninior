// Local-only beta preview. Never points at the production database or enables admin access.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const port=Number(process.argv[2]||3195);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a port between 1024 and 65535.');
const data=mkdtempSync(path.join(tmpdir(),'limo-beta-preview-'));
Object.assign(process.env,{DATA_DIR:data,PORT:String(port),HOST:'127.0.0.1',APP_ORIGIN:'http://127.0.0.1:'+port,NODE_ENV:'development',DEV_LOGIN:'1',GOOGLE_CLIENT_ID:'',ADMIN_EMAILS:'',ADMIN_USERNAMES:'',ADMIN_TOTP_SECRET:''});
process.once('exit',()=>rmSync(data,{recursive:true,force:true}));
process.once('SIGINT',()=>process.exit(0));
process.once('SIGTERM',()=>process.exit(0));
await import('../server/index.js');
const {createBetaCode}=await import('../server/beta.js');
const invite=createBetaCode(0,{label:'Local preview only',maxUses:10,days:1});
console.log('\nLOCAL DRAFT — isolated temporary database');
console.log('Open: http://127.0.0.1:'+port+'/beta');
console.log('Create a local test account, then enter: '+invite.code);
console.log('Production data is not used. Ctrl+C stops the preview and removes test data.\n');
