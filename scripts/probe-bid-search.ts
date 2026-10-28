import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { observe } from "../src/game/ai.ts";
const output = resolve(
  process.argv[2] ?? "artifacts/ai-bid-search-audit-20261028",
);
await mkdir(output, { recursive: true });
const source = await readFile("native/ra_ai.cpp", "utf8"),
  manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
let cpp = source;
const treeOnly = process.argv[3] === "tree-only";
const replace = (a: string, b: string) => {
  assert.equal(cpp.split(a).length - 1, 1, a.slice(0, 100));
  cpp = cpp.replace(a, b);
};
replace(
  "Report searchAction(",
  `int probeMode=0;
extern "C" void set_probe_mode(int mode){probeMode=mode;}
double rootProbe[256]{};
extern "C" double* root_probe_ptr(){return rootProbe;}
Report searchAction(`,
);
replace(
  "  Report report;",
  "  Report report;\n  std::fill(std::begin(rootProbe),std::end(rootProbe),0);",
);
replace(
  "    while(!finished(next)&&steps<64) {",
  "    while(!finished(next)&&steps<64&&(probeMode==2||probeMode==4?path.empty():probeMode==3?path.size()<2:true)) {",
);
replace(
  "e->utilities[i]+=reward==1?2*v-1:std::tanh(v/20);",
  "e->utilities[i]+=reward==1?2*v-1:((probeMode==1||probeMode==4)?v/20:std::tanh(v/20));",
);
replace(
  "    double value=e->sums[s.current]/e->visits;",
  `    double value=e->sums[s.current]/e->visits;
    int probeIndex=(int)rootProbe[0]++;if(probeIndex<50){rootProbe[1+probeIndex*4]=a.arg;rootProbe[2+probeIndex*4]=e->visits;rootProbe[3+probeIndex*4]=value;rootProbe[4+probeIndex*4]=e->utilities[s.current]/e->visits;}`,
);
const helper = String.raw`
struct FlatResult {State state;vector<Action>actions;vector<int>actors;int steps=0;};
FlatResult flatWorld(const State&s,const Action&rootAction,int scenario,int mode,bool trace) {
  FlatResult result;auto&next=result.state;next=s;next.recordDiscards=false;next.discarded.clear();
  for(int i=0;i<s.n;i++)next.players[i].score=100;
  std::sort(next.bag.begin(),next.bag.end());
  Random world((uint32_t)(s.steps+1)*7919u^(uint32_t)(s.current+1)*104729u^(uint32_t)(scenario+1)*15485863u);
  shuffle(next.bag,world);Model model;
  for(int i=0;i<s.n;i++)model.cost[i]=0.72+world.next()*0.68;
  model.rivalry=0.45+world.next()*0.45;
  if(mode==1){model.cost.fill(1);model.rivalry=.65;}
  if(mode==2){model.cost.fill(0);model.rivalry=.65;}
  Random choices((uint32_t)(scenario+1)*0x9e3779b9u);
  auto execute=[&](const Action&a){if(trace){result.actions.push_back(a);result.actors.push_back(next.current);}apply(next,a);result.steps++;};
  execute(rootAction);
  while(next.phase!=Over&&result.steps<720) {
    Plan plan;
    if(mode==3||(mode==4&&next.current==s.current)) {
      auto opts=legal(next);plan.actions[0]=opts[(int)(choices.next()*opts.size())];plan.size=1;
    }else if(next.phase==Auction)plan=auctionPlan(next,model);
    else{plan.actions[0]=policyAction(next,model);plan.size=1;}
    for(int j=0;j<plan.size&&next.phase!=Over&&result.steps<720;j++) {
      if(mode==4&&next.current==s.current){auto opts=legal(next);execute(opts[(int)(choices.next()*opts.size())]);break;}
      execute(plan.actions[j]);
    }
  }
  return result;
}
`;
replace(
  "// Versioned numeric ABI, bounded and checked before native indexing.",
  helper +
    "\n// Versioned numeric ABI, bounded and checked before native indexing.",
);
replace(
  "    else return -3;",
  String.raw`    else if(op==9) {
      int mode=read();if(mode<0||mode>4||samples<1||samples>100000)return -3;
      auto roots=legal(s);put(roots.size());
      vector<vector<double>>values(roots.size()),utilities(roots.size());
      for(int i=0;i<(int)roots.size();i++){
        double sum=0,square=0,utility=0,rootScore=0,diskTotal=0;int truncated=0;
        for(int k=0;k<samples;k++){
          auto r=flatWorld(s,roots[i],k,mode,false);auto&next=r.state;
          Values scores{};for(int p=0;p<s.n;p++)scores[p]=next.players[p].score-100;
          double v=relative(scores,s.n,s.current,s.n==2?1:.72),u=std::tanh(v/20);
          sum+=v;square+=v*v;utility+=u;rootScore+=scores[s.current];diskTotal+=sumList(next.players[s.current].suns)+sumList(next.players[s.current].used);
          truncated+=next.phase!=Over;values[i].push_back(v);utilities[i].push_back(u);
        }
        putAction(roots[i]);put(sum/samples);put(std::sqrt(std::max(0.,square/samples-(sum/samples)*(sum/samples))/samples));put(utility/samples);put(rootScore/samples);put(diskTotal/samples);put(truncated);
      }
      for(int i=1;i<(int)roots.size();i++){
        double sum=0,square=0,usum=0;int wins=0,losses=0;
        for(int k=0;k<samples;k++){double d=values[0][k]-values[i][k];sum+=d;square+=d*d;usum+=utilities[0][k]-utilities[i][k];wins+=d>1e-8;losses+=d< -1e-8;}
        put(sum/samples);put(std::sqrt(std::max(0.,square/samples-(sum/samples)*(sum/samples))/samples));put(usum/samples);put(wins);put(losses);
      }
    }
    else if(op==10){int mode=read(),scenario=read(),index=read();auto roots=legal(s);if(mode<0||mode>4||scenario<0||index<0||index>=(int)roots.size())return -3;
      auto r=flatWorld(s,roots[index],scenario,mode,true);put(r.actions.size());for(int i=0;i<(int)r.actions.size();i++){put(r.actors[i]);putAction(r.actions[i]);}for(int i=0;i<s.n;i++)put(r.state.players[i].score-100);
    }
    else return -3;`,
);
// sum() is the same utility used by scoring; keep the probe source isolated.
cpp = cpp.replaceAll(
  "sumList(next.players[s.current].suns)+sumList(next.players[s.current].used)",
  "sum(next.players[s.current].suns)+sum(next.players[s.current].used)",
);
// Avoid shadowing the core sum function with the accumulator.
cpp = cpp.replaceAll(
  "diskTotal+=sum(next.players[s.current].suns)+sum(next.players[s.current].used)",
  "for(int sun:next.players[s.current].suns)diskTotal+=sun;for(int sun:next.players[s.current].used)diskTotal+=sun",
);
await writeFile(output + "/probe.cpp", cpp);
const flags = manifest.flags.filter(
  (f: string) => !f.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run","_root_probe_ptr","_set_probe_mode"]',
);
const compilation = spawnSync(
  process.env.EMXX ?? "em++",
  [output + "/probe.cpp", ...flags, "-o", output + "/probe.wasm"],
  { stdio: "inherit", env: process.env },
);
assert.equal(compilation.status, 0);
const ai = await createWasmAi(await readFile(output + "/probe.wasm"));
const s = observe(
  JSON.parse(
    await readFile("tests/fixtures/last-bid-final-epoch.json", "utf8"),
  ),
);
const native = (ai as any).native;
const tree = [];
for (const mode of treeOnly ? [0, 1, 2, 3, 4] : [0])
  for (const variant of mode === 0 && treeOnly
    ? ["uct", "sh", "dpw"]
    : ["uct"]) {
    native.set_probe_mode(mode);
    const timeMs = 2000;
    const report = ai.search(s, {
      timeMs,
      horizon: "next-epoch",
      variant: variant as any,
    });
    const p = new Float64Array(
      native.memory.buffer,
      native.root_probe_ptr(),
      256,
    );
    const roots = Array.from({ length: p[0] }, (_, i) => ({
      sun: p[1 + i * 4],
      visits: p[2 + i * 4],
      mean: p[3 + i * 4],
      utility: p[4 + i * 4],
    }));
    tree.push({ mode, variant, timeMs, report, roots });
    console.log(
      JSON.stringify({
        event: "tree",
        mode,
        variant,
        timeMs,
        action: report.action,
        roots,
      }),
    );
  }
if (treeOnly) {
  await writeFile(
    output + "/summary.json",
    JSON.stringify(
      { sourceSha256: manifest.sourceSha256, tree, productionChanged: false },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}
const flat = [];
for (const mode of [0, 1, 2, 3, 4]) {
  const r = (ai as any).call(9, s, [mode], 4096);
  const count = r.number();
  const roots = Array.from({ length: count }, () => ({
    action: r.action(),
    mean: r.number(),
    stderr: r.number(),
    utility: r.number(),
    ownScore: r.number(),
    diskTotal: r.number(),
    truncated: r.number(),
  }));
  const paired = Array.from({ length: count - 1 }, () => ({
    meanDifference: r.number(),
    stderr: r.number(),
    utilityDifference: r.number(),
    wins: r.number(),
    losses: r.number(),
  }));
  flat.push({ mode, samples: 4096, roots, paired });
  console.log(JSON.stringify({ event: "flat", mode, roots, paired }));
}
const traces = [];
for (const mode of [0, 2])
  for (let scenario = 0; scenario < 50; scenario++) {
    const rows = [];
    for (const index of [0, 1]) {
      const r = (ai as any).call(10, s, [mode, scenario, index]);
      const count = r.number();
      const actions = Array.from({ length: count }, () => ({
        player: r.number(),
        action: r.action(),
      }));
      const scores = Array.from({ length: s.config.count }, () => r.number());
      rows.push({ index, actions, scores });
    }
    const value = (scores: number[]) =>
      scores[s.current] -
      (0.72 *
        scores.filter((_, i) => i !== s.current).reduce((a, b) => a + b, 0)) /
        (s.config.count - 1);
    if (value(rows[1].scores) > value(rows[0].scores) + 1) {
      traces.push({ mode, scenario, rows });
      break;
    }
  }
await writeFile(
  output + "/summary.json",
  JSON.stringify(
    {
      sourceSha256: manifest.sourceSha256,
      tree,
      flat,
      traces,
      productionChanged: false,
    },
    null,
    2,
  ) + "\n",
);
