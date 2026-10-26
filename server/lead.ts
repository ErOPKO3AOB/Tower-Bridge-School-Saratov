import type {IncomingMessage,ServerResponse} from 'node:http';
import {mkdir,open,readFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {normalizePhone,validateLead,type LeadPayload} from '../src/lib/lead';

export function leadMiddleware(env:Record<string,string>={}){
 const rate=new Map<string,{count:number;at:number}>();
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const reply=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  if(req.method!=='POST'){res.setHeader('Allow','POST');reply(405,{error:'Метод не поддерживается'});return}
  if(!req.headers['content-type']?.includes('application/json')){reply(415,{error:'Ожидается JSON'});return}
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`){reply(403,{error:'Недопустимый источник запроса'});return}
  const now=Date.now();for(const [k,v]of rate)if(now-v.at>60000)rate.delete(k);
  const ip=req.socket.remoteAddress||'local',entry=rate.get(ip)||{count:0,at:now};
  if(entry.count>=10){reply(429,{error:'Слишком много попыток. Попробуйте через минуту.'});return}entry.count++;rate.set(ip,entry);
  try{
   const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>16384){reply(413,{error:'Заявка слишком большая'});return}chunks.push(buffer)}const body=Buffer.concat(chunks).toString('utf8');
   let p:unknown;try{p=JSON.parse(body)}catch{reply(400,{error:'Некорректный JSON'});return}
   const errors=validateLead(p);if(Object.keys(errors).length){reply(400,{errors,error:'Проверьте поля формы'});return}
   const payload=p as LeadPayload;
   const directory=resolve(env.LEAD_STORAGE_DIR||'.local/leads');await mkdir(directory,{recursive:true});
   const file=resolve(directory,`${payload.requestId}.json`);
   const record={id:payload.requestId,requestId:payload.requestId,createdAt:new Date().toISOString(),parentName:payload.parentName.trim(),phone:normalizePhone(payload.phone),direction:payload.direction,time:payload.time,age:payload.age,childName:payload.childName,comment:payload.comment,consent:payload.consent,utm:payload.utm};
   try{const handle=await open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(record,null,2),'utf8')}finally{await handle.close()}}
   catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await readFile(file,'utf8');reply(200,{ok:true,id:payload.requestId,delivered:false});return}
   let delivered=false;
   if(env.LEAD_WEBHOOK_URL){try{const response=await fetch(env.LEAD_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json',...(env.LEAD_WEBHOOK_TOKEN?{Authorization:`Bearer ${env.LEAD_WEBHOOK_TOKEN}`}:{})},body:JSON.stringify(record),signal:AbortSignal.timeout(8000)});delivered=response.ok;await appendFile(resolve(directory,'delivery.jsonl'),JSON.stringify({id:record.id,at:new Date().toISOString(),delivered})+'\n',{mode:0o600})}catch{console.warn('[lead] Notification failed; request remains in private storage.')}}
   reply(200,{ok:true,id:record.id,delivered});
  }catch{reply(503,{error:'Не удалось сохранить заявку. Попробуйте ещё раз или позвоните в школу.'})}
 };
}
