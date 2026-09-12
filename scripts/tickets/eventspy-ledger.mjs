import { mkdir,readFile,rename,rm,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EVENTSPY_COVERAGE,isSafeEventSpyGameId } from "../../src/lib/tickets/eventspy-coverage.mjs";
export const EVENTSPY_MAX_ATTEMPTS=2;
export const eventSpyPacificDate=now=>{const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`};
const error=(message,code)=>Object.assign(new Error(message),{code});
const valid=(v,today)=>v?.schemaVersion===2&&Array.isArray(v.days)&&v.days.length<=3&&v.days.every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&x.date<=today&&Number.isSafeInteger(x.attempts)&&x.attempts>=0&&x.attempts<=2&&Array.isArray(x.attemptIds)&&x.attemptIds.length===x.attempts&&new Set(x.attemptIds).size===x.attemptIds.length);
export const eventSpyGameRoot=(root,gameId)=>{if(!isSafeEventSpyGameId(gameId))throw error("Unsafe EventSpy game ID.","EVENTSPY_GAME_INVALID");return join(root,"games",String(gameId))};
export async function readEventSpyLedger(root,gameId,now=Date.now()){const today=eventSpyPacificDate(now),path=join(eventSpyGameRoot(root,gameId),"attempt-ledger.json");try{const value=JSON.parse(await readFile(path,"utf8"));if(!valid(value,today))throw error("EventSpy attempt ledger is malformed or future-dated.","EVENTSPY_LEDGER_INVALID");return value}catch(e){if(e.code==="ENOENT")return{schemaVersion:2,gameId:String(gameId),days:[]};throw e}}
export async function reserveEventSpyAttempt(root,gameIdOrNow,nowOrOptions=Date.now(),maybeOptions={}){
 // Conservative compatibility: the historical singleton maps only to the Patriots game.
 const legacy=typeof gameIdOrNow==="number",gameId=legacy?EVENTSPY_COVERAGE[0].gameId:String(gameIdOrNow),now=legacy?gameIdOrNow:nowOrOptions,options=legacy?(nowOrOptions??{}):maybeOptions,gameRoot=eventSpyGameRoot(root,gameId);await mkdir(gameRoot,{recursive:true});const lock=join(gameRoot,".attempt-ledger.lock");
 for(let spin=0;;spin++){try{await mkdir(lock);break}catch(e){if(e.code!=="EEXIST")throw e;if(spin>=200)throw error("EventSpy game ledger is locked.","EVENTSPY_LOCKED");await new Promise(r=>setTimeout(r,5))}}
 try{const today=eventSpyPacificDate(now);let ledger=await readEventSpyLedger(root,gameId,now);if(ledger.gameId!==gameId)throw error("EventSpy ledger game identity is invalid.","EVENTSPY_LEDGER_INVALID");let row=ledger.days.find(x=>x.date===today);if(!row){row={date:today,attempts:0,attemptIds:[]};ledger.days.push(row)}if(row.attempts>=EVENTSPY_MAX_ATTEMPTS){const denied={allowed:false,outcome:"EVENTSPY_DAILY_LIMIT",gameId,date:today,attempts:row.attempts};if(legacy)delete denied.gameId;return denied}row.attempts++;const attemptId=`${today}:${row.attempts}`;row.attemptIds.push(attemptId);ledger.days=ledger.days.filter(x=>x.date>=today).slice(-2);const temp=join(gameRoot,`.attempt-ledger-${randomUUID()}.tmp`);await writeFile(temp,`${JSON.stringify(ledger,null,2)}\n`,{flag:"wx",mode:0o600});await(options.beforeRename?.()??Promise.resolve());await rename(temp,join(gameRoot,"attempt-ledger.json"));return{allowed:true,outcome:"EVENTSPY_ATTEMPT_RESERVED",gameId,date:today,attempts:row.attempts,attemptId}
 }finally{await rm(lock,{recursive:true,force:true})}
}
