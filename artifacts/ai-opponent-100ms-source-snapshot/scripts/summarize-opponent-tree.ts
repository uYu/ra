import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {advance,newGame,ranking} from '../src/game/engine.ts';
const input=process.argv[2];
const raw=JSON.parse(await readFile(input,'utf8'));
const sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const bytes=await readFile(raw.identity.planPath);
assert.equal(sha(bytes),raw.identity.planSha256);
const plan=JSON.parse(bytes.toString());
for(const [p,h] of Object.entries(plan.hashes)) assert.equal(sha(await readFile(p)),h,p);
assert.equal(raw.status,'complete');
assert.equal(raw.finishedGames,plan.jobs.length);
assert.equal(raw.plannedGames,plan.jobs.length);
assert.equal(raw.games.length,plan.jobs.length);
assert.deepEqual(raw.identity.schedule,plan.jobs);
assert.deepEqual(raw.identity.seedPairs,plan.seedPairs);
assert.equal(plan.candidate.treeMode,1);assert.equal(plan.opponent.treeMode,0);
assert.equal(plan.candidate.timeMs,plan.opponent.timeMs);
const key=(j:any)=>`${j.seed}/${j.count}/${j.seat}`;
const pending=new Map(plan.jobs.map((j:any)=>[key(j),j]));
const mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
const score=(g:any)=>(g.count-g.rank)/(g.count-1);
const total:any={candidate:{},opponent:{}};
let decisions=0;
for(const g of raw.games){
 const job=pending.get(key(g));assert.ok(job);pending.delete(key(g));assert.equal(g.pair,(job as any).pair);
 const t=JSON.parse(await readFile(g.replayPath,'utf8')),m=t.audit.metadata;
 assert.deepEqual(m.job,job);assert.equal(m.planSha256,raw.identity.planSha256);
 assert.equal(t.config.seed,g.seed);assert.equal(t.config.count,g.count);
 assert.equal(m.timeMs,plan.candidate.timeMs);assert.equal(m.opponentTimeMs,plan.opponent.timeMs);
 assert.equal(m.candidateTreeMode,1);assert.equal(m.opponentTreeMode,0);
 assert.equal(m.engine,'current');assert.equal(m.reward,'relative');assert.equal(m.opponentVariant,'uct');assert.equal(m.opponentFixed,false);
 assert.equal(m.modelSha256,null);assert.equal(m.rolloutModelSha256,null);
 for(const side of ['candidate','opponent']){
  const b=m[side==='candidate'?'build':'opponentBuild'];
  assert.equal(b.wasmSha256,plan[side].wasmSha256);assert.equal(b.sourceSha256,plan[side].sourceSha256);
 }
 assert.equal(sha(JSON.stringify(t.actions)),t.audit.actionsSha256);
 assert.equal(t.actions.length,g.steps);assert.equal(t.audit.decisions.length,g.steps);
 let s=newGame(t.config);
 const stats:any={candidate:{},opponent:{}};
 for(let i=0;i<t.audit.decisions.length;i++){
  const d=t.audit.decisions[i],r=d.report,side=d.player===g.seat?'candidate':'opponent',a=stats[side];
  assert.equal(d.step,s.steps+1);assert.equal(d.player,s.current);assert.equal(d.epoch,s.epoch);assert.equal(d.phase,s.phase);
  assert.deepEqual(r.action,t.actions[i]);assert.equal(r.treeMode,plan[side].treeMode);
  assert.ok(Number.isInteger(r.opponentTreeSelections)&&r.opponentTreeSelections>=0);
  assert.equal(r.opponentTreeSelections,side==='candidate'?r.opponentAuctionTreeSelections:0);
  assert.ok(Number.isFinite(d.elapsedMs)&&d.elapsedMs>=0);
  const add=(k:string,v:number)=>a[k]=(a[k]??0)+v;
  add('decisions',1);add('ms',d.elapsedMs);a.maxMs=Math.max(a.maxMs??0,d.elapsedMs);
  add('searched',Number(r.samples>0));
  if(r.samples){
   assert.ok(d.elapsedMs>=plan[side].timeMs*.95);assert.ok(r.samples<1000000);
   assert.ok(r.candidates.every((c:any)=>c.visits>=1));assert.equal(r.candidates.reduce((n:number,c:any)=>n+c.visits,0),r.samples);
   add('searchMs',d.elapsedMs);add('overshootMs',Math.max(0,d.elapsedMs-plan[side].timeMs));add('overrunCalls',Number(d.elapsedMs>plan[side].timeMs+10));
  }
  for(const k of ['samples','transitions','nodes','outcomeReuses','truncated','opponentTreeSelections','opponentAuctionTreeSelections'])add(k,r[k]);
  a.depth=Math.max(a.depth??0,r.depth);a.maxOutcomeBranches=Math.max(a.maxOutcomeBranches??0,r.maxOutcomeBranches);
  s=advance(s,r.action);
 }
 assert.equal(s.phase,'over');assert.equal(s.steps,g.steps);assert.deepEqual(s.history,t.audit.history);assert.deepEqual(ranking(s),t.audit.ranking);
 assert.equal(ranking(s).findIndex((p:any)=>p.player===g.seat)+1,g.rank);assert.equal(s.players[g.seat].score,g.score);
 assert.equal(g.margin,g.score-Math.max(...s.players.filter((_:any,i:number)=>i!==g.seat).map((p:any)=>p.score)));
 for(const side of ['candidate','opponent'])for(const [k,v] of Object.entries(g.stats[side])){
  const actual=stats[side][k]??0;assert.ok(Math.abs(actual-(v as number))<1e-6,`${key(g)}/${side}/${k}`);
  if(k==='depth'||k==='maxMs'||k==='maxOutcomeBranches')total[side][k]=Math.max(total[side][k]??0,actual);
  else total[side][k]=(total[side][k]??0)+actual;
 }
 decisions+=g.steps;
}
assert.equal(pending.size,0);assert.ok(total.candidate.opponentTreeSelections>0);assert.equal(total.opponent.opponentTreeSelections,0);
const byCount=plan.design.counts.map((count:number)=>{
 const games=raw.games.filter((g:any)=>g.count===count);
 const pairs=plan.seedPairs.filter((p:any)=>p.count===count).map((p:any)=>{
  const rows=games.filter((g:any)=>g.seed===p.seed);
  assert.deepEqual(rows.map((g:any)=>g.seat).sort((a:number,b:number)=>a-b),[...p.seats].sort((a:number,b:number)=>a-b));
  assert.equal(rows.length,2);return {seed:p.seed,score:mean(rows.map(score))};
 });
 return {count,games:games.length,meanRank:mean(games.map((g:any)=>g.rank)),referenceMeanRank:(count+1)/2,rankScore:mean(games.map(score)),wins:games.filter((g:any)=>g.rank===1).length,pairs};
});
let rng=0x7a1fca2;const rand=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return (rng>>>0)/4294967296;};
const draws=Array.from({length:100000},()=>mean(byCount.map((c:any)=>mean(c.pairs.map(()=>c.pairs[Math.floor(rand()*c.pairs.length)].score))))).sort((a,b)=>a-b);
const timing=Object.fromEntries(Object.entries(total).map(([side,t]:any)=>[side,{...t,meanMs:t.searchMs/t.searched,meanSamples:t.samples/t.searched}]));
const summary={status:'verified',input,planSha256:raw.identity.planSha256,frozenFiles:Object.keys(plan.hashes).length,games:raw.games.length,decisions,rankScore:mean(byCount.map((c:any)=>c.rankScore)),reference:.5,interval95:[draws[2500],draws[97500]],bootstrap:'100000 draws, resample whole paired seeds independently within each player count; equal weight counts',byCount,timing,caveats:['50 games at 100ms are a preliminary comparison, not a 2s strength verdict.','Each game has one candidate against legacy opponents. Tree leaves still use heuristic rollouts.','Candidate also uses the complete observation key needed for opponent nodes; mode3 key-only ablation is not tested here.','Different encountered positions and parallel contention mean samples ratio is not a pure speed ratio.']};
const output=process.argv[3]??input.replace(/\.json$/,'-summary.json');assert.notEqual(input,output);await writeFile(output,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
