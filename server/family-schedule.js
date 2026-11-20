export const FAMILY_DEFAULTS={paused:false,games:false,purchases:false,newChats:false,calls:false,bots:false,stories:false,channels:false,quietStart:22,quietEnd:7,quiet:false,quietDays:[0,1,2,3,4,5,6],timeZone:'Europe/Moscow'};
export function normalizeFamilyControls(body,current=FAMILY_DEFAULTS){
 const controls={...FAMILY_DEFAULTS,...current};
 for(const key of ['paused','games','purchases','newChats','calls','bots','stories','channels','quiet']){
  if(body[key]===undefined)continue;
  if(typeof body[key]!=='boolean')return null;
  controls[key]=body[key];
 }
 for(const key of ['quietStart','quietEnd']){
  if(body[key]===undefined)continue;
  if(!Number.isInteger(body[key])||body[key]<0||body[key]>23)return null;
  controls[key]=body[key];
 }
 if(body.quietDays!==undefined){
  if(!Array.isArray(body.quietDays)||!body.quietDays.length||body.quietDays.length>7||body.quietDays.some(n=>!Number.isInteger(n)||n<0||n>6))return null;
  controls.quietDays=[...new Set(body.quietDays)].sort();
 }
 if(body.timeZone!==undefined){
  if(typeof body.timeZone!=='string'||body.timeZone.length>64)return null;
  try{controls.timeZone=new Intl.DateTimeFormat('en',{timeZone:body.timeZone}).resolvedOptions().timeZone;}catch{return null;}
 }
 return controls;
}
export function quietNow(policy,date=new Date()){
 if(!policy?.quiet)return false;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:policy.timeZone||'Europe/Moscow',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 let day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday);const hour=Number(parts.hour);
 const {quietStart:start,quietEnd:end}=policy;
 // An overnight interval belongs to the day on which it starts.
 if(start>end&&hour<end)day=(day+6)%7;
 if(!(policy.quietDays||FAMILY_DEFAULTS.quietDays).includes(day))return false;
 return start===end|| (start<end?hour>=start&&hour<end:hour>=start||hour<end);
}
