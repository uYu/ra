import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, cp, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
const output = resolve(process.argv[2] ?? "artifacts/ai-auction-turn-20261030");
assert.ok(!existsSync(join(output, "build.json")), "Choose new directory");
await mkdir(output, { recursive: true });
const hash = (x: Uint8Array | string) =>
  createHash("sha256").update(x).digest("hex");
const source = await readFile("native/ra_ai.cpp", "utf8"),
  extension = await readFile("scripts/auction-sampling/probe.inc", "utf8"),
  manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
assert.equal(hash(source), manifest.sourceSha256);
const turnExtension = await readFile(
  "scripts/auction-sampling/turn.inc",
  "utf8",
);
let extended = extension
  .replace(
    "Report auctionSampleSearch(const State&s,int budget,int horizon,double timeMs)",
    "Report auctionSampleSearch(const State&s,int budget,int horizon,double timeMs,Plan* chosen=nullptr,int fixedTarget=0)",
  )
  .replace(
    "const int targetEpoch=std::min(3,s.epoch+(horizon==2?1:0));",
    "const int targetEpoch=fixedTarget?fixedTarget:std::min(3,s.epoch+(horizon==2?1:0));",
  )
  .replace(
    "  // Only the recommended action moves; preserve legal-order tie breaking.",
    `  if(chosen) {
    *chosen=Plan{};
    int id=0;
    while(tree[id].leaf<0) {
      const auto&node=tree[id];int pick=0;double utility=-INF;
      for(int j=0;j<(int)node.children.size();j++) {
        int outcome=solve(solve,node.children[j]);
        double v=leaves[outcome].utilities[node.actor]/rounds;
        if(j==0||v>utility+1e-12){pick=j;utility=v;}
      }
      chosen->actions[chosen->size++]=node.actions[pick];
      id=node.children[pick];
    }
    auto&leaf=leaves[tree[id].leaf];chosen->winner=leaf.winner;chosen->sun=leaf.sun;
    turnAuctionPlan[0]=chosen->size;
    for(int j=0;j<chosen->size;j++)turnAuctionPlan[j+1]=chosen->actions[j].arg;
  }
  // Only the recommended action moves; preserve legal-order tie breaking.`,
  );
let probe = source;
function replace(a: string, b: string) {
  assert.equal(probe.split(a).length - 1, 1, a);
  probe = probe.replace(a, b);
}
replace(
  "// Versioned numeric ABI, bounded and checked before native indexing.",
  extended +
    "\n" +
    turnExtension +
    "\n// Versioned numeric ABI, bounded and checked before native indexing.",
);
replace(
  "      auto r=searchAction(s,samples,horizon,variant,timeMs,hasModel?&model:nullptr,hasRollout?&rolloutModel:nullptr,reward,op==9);",
  "      std::fill(std::begin(turnAuctionMetrics),std::end(turnAuctionMetrics),0);\n      std::fill(std::begin(auctionStudyMetrics),std::end(auctionStudyMetrics),0);\n      if(auctionStudyMode&&(hasModel||hasRollout||reward||op!=0||variant))return -6;\n      auto r=auctionStudyMode&&s.phase==Auction&&legal(s).size()>1?auctionSampleSearch(s,samples,horizon,timeMs,auctionStudyMode==2?&selectedTurnPlan:nullptr):searchAction(s,samples,horizon,variant,timeMs,hasModel?&model:nullptr,hasRollout?&rolloutModel:nullptr,reward,op==9);",
);
// Declarations precede UCT; implementation follows it in the isolated extension.
replace(
  "Report searchAction(const State&s,int budget,int horizon,int variant,double timeMs,",
  `
extern int auctionStudyMode;
extern double turnAuctionMetrics[8];
extern double turnAuctionPlan[8];
Plan selectedTurnPlan;
Plan firstAuctionPlan(const State&,int,int);
Report searchAction(const State&s,int budget,int horizon,int variant,double timeMs,`,
);
replace(
  "  for(int k=0;k<iterations;k++) {",
  "  std::unordered_map<std::string,Plan> firstAuctionCache;\n  for(int k=0;k<iterations;k++) {",
);
replace(
  "    int steps=0;\n    while(!finished(next)&&steps<64)",
  `    int steps=0;
    bool sampledFirstAuction=false;
    auto consumeFirstAuction=[&]() {
      if(auctionStudyMode!=2||s.phase!=Turn||sampledFirstAuction||next.phase!=Auction||finished(next))return;
      sampledFirstAuction=true;
      std::string key=observation(next,next.current,true);
      appendInt(key,next.steps);
      for(int i=0;i<next.n;i++){appendInt(key,next.players[i].score);listKey(key,next.players[i].tiles);}
      auto knownBag=next.bag;std::sort(knownBag.begin(),knownBag.end());listKey(key,knownBag);
      listKey(key,next.market);listKey(key,next.pending);
      auto cached=firstAuctionCache.find(key);
      Plan plan;
      if(cached!=firstAuctionCache.end()){plan=cached->second;turnAuctionMetrics[7]++;}
      else {
        plan=firstAuctionPlan(next,horizon,targetEpoch);
        if(firstAuctionCache.size()<32768)firstAuctionCache.emplace(std::move(key),plan);
      }
      for(int j=0;j<plan.size;j++) {
        if(finished(next)||steps>=stepLimit)break;
        if(next.phase==Epoch)report.epochAdvances++;
        apply(next,plan.actions[j]);steps++;report.transitions++;
      }
    };
    while(!finished(next)&&steps<64)`,
);
replace(
  "      apply(next,actions[choice]);\n      report.transitions++;\n      steps++;",
  `      apply(next,actions[choice]);
      report.transitions++;
      steps++;
      consumeFirstAuction();`,
);
replace(
  "      while(!finished(next)&&next.current!=s.current&&steps<240) {\n        Plan plan;",
  `      while(!finished(next)&&next.current!=s.current&&steps<240) {
        consumeFirstAuction();
        if(finished(next)||next.current==s.current||steps>=240)break;
        Plan plan;`,
);
replace(
  "    while(!finished(next)&&steps<stepLimit) {\n      Plan plan;",
  `    while(!finished(next)&&steps<stepLimit) {
      consumeFirstAuction();
      if(finished(next)||steps>=stepLimit)break;
      Plan plan;`,
);

await writeFile(join(output, "probe.cpp"), probe);
await cp("src/game/ai/ra-ai.wasm", join(output, "baseline.wasm"));
const cache = join(await realpath(tmpdir()), "ra-search-probe-cache");
if (!existsSync(cache)) {
  const r = spawnSync("em-config", ["CACHE"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  await cp(r.stdout.trim().replace(/^["']|["']$/g, ""), cache, {
    recursive: true,
  });
}
const flags = manifest.flags.filter(
  (x: string) => !x.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run","_configure_auction_study","_auction_study_metrics","_auction_study_leaves","_turn_auction_metrics","_turn_auction_plan"]',
);
const c = spawnSync(
  process.env.EMXX ?? "em++",
  [join(output, "probe.cpp"), ...flags, "-o", join(output, "probe.wasm")],
  { stdio: "inherit", env: { ...process.env, EM_CACHE: cache } },
);
assert.equal(c.status, 0);
await writeFile(
  join(output, "build.json"),
  JSON.stringify(
    {
      sourceSha256: hash(source),
      extensionSha256: hash(extension),
      turnExtensionSha256: hash(turnExtension),
      innerRounds: 8,
      probeSha256: hash(probe),
      wasmSha256: hash(await readFile(join(output, "probe.wasm"))),
      baselineSha256: manifest.wasmSha256,
      flags,
      scope:
        "Mode 1 preserves validated current-auction baseline. Mode 2 keeps UCT at turn roots, replaces only first encountered auction per outer simulation with 8 independent common-scenario continuations and own-utility backward induction. Inner horizon shares root target. Later auctions unchanged; no production changes.",
    },
    null,
    2,
  ) + "\n",
);
console.log(output);
