import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
app.use(cors());
app.use(express.json({limit:'256kb'}));
const PORT = Number(process.env.PORT || 8787);
const DATA_FILE = path.resolve(process.env.DATA_FILE || './data.json');
function load(){ try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}catch{return {subscriptions:{}};} }
function save(db){ fs.writeFileSync(DATA_FILE, JSON.stringify(db,null,2)); }
function validTime(s){return /^([01]\d|2[0-3]):[0-5]\d$/.test(s||'');}
function hmInWindow(hm,start,end){ const m=x=>Number(x.slice(0,2))*60+Number(x.slice(3)); let a=m(start),b=m(end),n=m(hm); return a<=b ? n>=a&&n<=b : n>=a||n<=b; }
function localHM(timeZone){ return new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace('24:','00:'); }
function eventTimes(push){ const out=[]; let [h,m]=push.first.split(':').map(Number), base=h*60+m; for(let i=0;i<4;i++){let total=base+i*(push.interval||120); let hh=Math.floor(total/60)%24, mm=total%60; let hm=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0'); if(hmInWindow(hm,push.windowStart,push.windowEnd)) out.push({hm,index:i});} return out; }
function makeEvents(words,push){ const mid=Math.ceil(words.length/2), a=words.slice(0,mid), b=words.slice(mid); const modes=['en-to-uz','uz-to-en','uz-to-en','en-to-uz']; return eventTimes(push).map((x)=>({index:x.index,hm:x.hm,mode:modes[x.index],words:x.index%2===0?a:b})); }
if(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY){ webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY); }
app.get('/health',(req,res)=>res.json({ok:true,service:'English Master Push',time:new Date().toISOString()}));
app.get('/vapid-public-key',(req,res)=>res.json({publicKey:process.env.VAPID_PUBLIC_KEY||null}));
app.post('/subscribe',(req,res)=>{
  const {subscription,userId,timezone,push}=req.body||{};
  if(!subscription?.endpoint) return res.status(400).json({error:'subscription.endpoint required'});
  if(!userId) return res.status(400).json({error:'userId required'});
  if(!timezone) return res.status(400).json({error:'timezone required'});
  const db=load();
  db.subscriptions[userId]={subscription,timezone,push:{enabled:true,windowStart:'08:00',windowEnd:'20:00',first:'12:00',interval:120,...push},updatedAt:new Date().toISOString()};
  save(db); res.json({ok:true,userId});
});
app.post('/settings',(req,res)=>{
  const {userId,timezone,push}=req.body||{}; const db=load(); if(!db.subscriptions[userId]) return res.status(404).json({error:'not subscribed'});
  const p=db.subscriptions[userId]; if(timezone)p.timezone=timezone; if(push)p.push={...p.push,...push}; p.updatedAt=new Date().toISOString(); save(db); res.json({ok:true});
});
app.delete('/subscribe/:userId',(req,res)=>{const db=load(); delete db.subscriptions[req.params.userId]; save(db); res.json({ok:true});});
app.post('/test-push',async(req,res)=>{
  try{ if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys missing'); const {subscription}=req.body; await webpush.sendNotification(subscription,JSON.stringify({title:'English Master test',body:'Push ishlayapti. Endi so‘zlarni active recall qiling.',url:process.env.APP_URL||'/'})); res.json({ok:true}); }
  catch(e){res.status(500).json({ok:false,error:e.body||e.message});}
});

async function tick(){
  if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY) return;
  const db=load(); const now=new Date(); const dayKey=now.toISOString().slice(0,10);
  for(const [userId,p] of Object.entries(db.subscriptions||{})){
    if(!p.push?.enabled) continue;
    const hm=localHM(p.timezone||'UTC');
    const events=makeEvents(p.words||[],p.push);
    const ev=events.find(x=>x.hm===hm); if(!ev||!ev.words?.length) continue;
    const key=`${dayKey}:${hm}:${ev.index}`; p.sent=p.sent||{}; if(p.sent[key]) continue;
    const labels=ev.words.map(w=>ev.mode==='en-to-uz'?w.text:w.meaning);
    const body=ev.mode==='en-to-uz'?`🇬🇧 ${labels.join(', ')} — o‘zbekcha tarjimasini yozing.`:`🇺🇿 ${labels.join(', ')} — inglizchasini yozing.`;
    try{
      await webpush.sendNotification(p.subscription,JSON.stringify({title:`English Master · Quiz ${ev.index+1}/4`,body,url:(process.env.APP_URL||'/')+`?push=${encodeURIComponent(ev.index)}`}));
      p.sent[key]=true;
    }catch(e){ if(e.statusCode===404||e.statusCode===410) delete db.subscriptions[userId]; }
  }
  save(db);
}
cron.schedule('* * * * *',tick);
app.listen(PORT,()=>console.log(`English Master Push Server on :${PORT}`));
