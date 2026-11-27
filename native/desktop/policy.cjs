const HOME='https://81-90-31-167.sslip.io/';
const trusted=value=>{try{const u=new URL(value);return u.origin===new URL(HOME).origin&&!u.username&&!u.password;}catch{return false;}};
const external=value=>{try{return ['https:','http:','mailto:'].includes(new URL(value).protocol);}catch{return false;}};
module.exports={HOME,trusted,external};
