import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createWasmAi } from "../src/game/ai/wasm.ts";
const directory = resolve(
  process.argv[2] ?? "artifacts/ai-search-frozen-policy-20261028",
);
await mkdir(directory, { recursive: true });
const parent = "artifacts/ai-search-exploration-20261028";
const manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
let cpp = await readFile(join(parent, "probe.cpp"), "utf8");
const marker = "  return report;\n}\n// Versioned numeric ABI";
assert.equal(cpp.split(marker).length - 1, 1);
cpp = cpp.replace(
  "Report searchAction(",
  `int evaluationSamples=0,evaluationOffset=100000,evaluationMode=0;
double evaluation[256]{},evaluationTrace[32768]{};
extern "C" double* evaluation_trace_ptr(){return evaluationTrace;}
extern "C" double* evaluation_ptr(){return evaluation;}
extern "C" void configure_evaluation(int samples,int offset,int mode){evaluationSamples=samples;evaluationOffset=offset;evaluationMode=mode;}
Report searchAction(`,
);
cpp = cpp.replace(
  marker,
  String.raw`
  std::fill(std::begin(evaluation),std::end(evaluation),0);
  evaluation[0]=rootActions.size();
  int traceHead=1;evaluationTrace[0]=0;
  vector<vector<double>>values(rootActions.size()),utils(rootActions.size());
  for(int aindex=0;evaluationSamples>0&&aindex<(int)rootActions.size();aindex++){
    int hits=0,misses=0,truncated=0;
    for(int scene=0;scene<evaluationSamples;scene++){
      State next=searchState;for(int i=0;i<s.n;i++)next.players[i].score=100;
      Random world((uint32_t)(s.steps+1)*7919u^(uint32_t)(s.current+1)*104729u^(uint32_t)(evaluationOffset+scene+1)*15485863u);
      next.bag=bag;shuffle(next.bag,world);Model model;
      for(int i=0;i<s.n;i++)model.cost[i]=.72+world.next()*.68;
      model.rivalry=.45+world.next()*.45;
      int steps=0,traceCount=0,countIndex=0;
      bool trace=scene<2;
      if(trace){evaluationTrace[traceHead++]=aindex;evaluationTrace[traceHead++]=scene;countIndex=traceHead++;}
      auto execute=[&](const Action&a){
        if(trace){evaluationTrace[traceHead++]=next.current;evaluationTrace[traceHead++]=a.type;evaluationTrace[traceHead++]=a.arg;evaluationTrace[traceHead++]=a.second;evaluationTrace[traceHead++]=a.count;traceCount++;}
        apply(next,a);steps++;
      };
      auto advanceOpponents=[&](){
        while(!finished(next)&&next.current!=s.current&&steps<stepLimit){
          Plan plan;if(next.phase==Auction)plan=auctionPlan(next,model);
          else{plan.actions[0]=policyAction(next,model);plan.size=1;}
          for(int j=0;j<plan.size&&!finished(next)&&next.current!=s.current&&steps<stepLimit;j++)execute(plan.actions[j]);
        }
      };
      Edge*edge=root.get(actionKey(rootActions[aindex]));
      execute(rootActions[aindex]);advanceOpponents();
      Node*branch=nullptr;
      auto findChild=[&](){branch=nullptr;if(edge){auto it=edge->outcomes.find(observation(next,s.current,false));if(it!=edge->outcomes.end())branch=it->second.get();}};
      findChild();
      while(!finished(next)&&steps<stepLimit){
        if(evaluationMode!=2&&branch){
          auto opts=candidates(next);int best=-1;double bestValue=-INF;
          for(int j=0;j<(int)opts.size();j++){
            auto*e=branch->get(actionKey(opts[j]));if(!e||!e->visits)continue;
            double v=evaluationMode==0?e->utilities[s.current]/e->visits:e->visits;
            if(v>bestValue){bestValue=v;best=j;}
          }
          if(best>=0){hits++;edge=branch->get(actionKey(opts[best]));execute(opts[best]);advanceOpponents();findChild();continue;}
        }
        misses++;branch=nullptr;edge=nullptr;
        Plan plan;if(next.phase==Auction)plan=auctionPlan(next,model);
        else{plan.actions[0]=policyAction(next,model);plan.size=1;}
        for(int j=0;j<plan.size&&!finished(next)&&steps<stepLimit;j++)execute(plan.actions[j]);
      }
      truncated+=!finished(next);
      auto residual=(next.phase==Over||next.phase==Epoch)?futureValues(next):positionValues(next);
      Values scores{};for(int i=0;i<s.n;i++)scores[i]=residual[i]+next.players[i].score-100;
      double value=relative(scores,s.n,s.current,s.n==2?1:.72);
      if(trace){evaluationTrace[countIndex]=traceCount;for(int i=0;i<s.n;i++)evaluationTrace[traceHead++]=scores[i];evaluationTrace[0]++;}
      values[aindex].push_back(value);utils[aindex].push_back(std::tanh(value/20));
    }
    int b=1+aindex*10;evaluation[b++]=rootActions[aindex].arg;
    for(auto*rows:{&values[aindex],&utils[aindex]}){
      double sum=0,square=0;for(double v:*rows){sum+=v;square+=v*v;}
      evaluation[b++]=sum/evaluationSamples;evaluation[b++]=std::sqrt(std::max(0.,square/evaluationSamples-(sum/evaluationSamples)*(sum/evaluationSamples))/evaluationSamples);
    }
    evaluation[b++]=hits;evaluation[b++]=misses;evaluation[b++]=truncated;
    if(aindex>0){double sum=0,square=0,usum=0;for(int k=0;k<evaluationSamples;k++){double d=values[0][k]-values[aindex][k];sum+=d;square+=d*d;usum+=utils[0][k]-utils[aindex][k];}
      evaluation[100+(aindex-1)*3]=sum/evaluationSamples;
      evaluation[101+(aindex-1)*3]=std::sqrt(std::max(0.,square/evaluationSamples-(sum/evaluationSamples)*(sum/evaluationSamples))/evaluationSamples);
      evaluation[102+(aindex-1)*3]=usum/evaluationSamples;
    }
  }
  return report;
}
// Versioned numeric ABI`,
);
await writeFile(join(directory, "probe.cpp"), cpp);
const flags = manifest.flags.filter(
  (f: string) => !f.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run","_probe_roots","_configure_probe","_evaluation_ptr","_configure_evaluation","_evaluation_trace_ptr"]',
);
const r = spawnSync(
  process.env.EMXX ?? "em++",
  [join(directory, "probe.cpp"), ...flags, "-o", join(directory, "probe.wasm")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EM_CACHE: join(await realpath(tmpdir()), "ra-search-probe-cache"),
    },
  },
);
assert.equal(r.status, 0);
const ai = await createWasmAi(await readFile(join(directory, "probe.wasm"))),
  native = (ai as any).native;
const s = JSON.parse(
  await readFile("tests/fixtures/last-bid-final-epoch.json", "utf8"),
);
const prod = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
native.configure_probe(0, 0, 1.4, 1.4, 64);
native.configure_evaluation(0, 100000, 0);
assert.deepEqual(
  ai.search(s, { samples: 128, horizon: "next-epoch" }),
  prod.search(s, { samples: 128, horizon: "next-epoch" }),
);
if (process.argv[3] === "build-only") process.exit(0);
const rows: any[] = [];
for (const innerC of [1.4, 0.35])
  for (const mode of [0, 1, 2]) {
    native.configure_probe(32768, 0, innerC, 1.4, 64);
    native.configure_evaluation(4096, 100000, mode);
    const report = ai.search(s, { samples: 128, horizon: "next-epoch" });
    const data = new Float64Array(
      native.memory.buffer,
      native.evaluation_ptr(),
      256,
    );
    const roots = Array.from({ length: data[0] }, (_, i) => {
      const b = 1 + i * 10;
      return {
        sun: data[b],
        mean: data[b + 1],
        stderr: data[b + 2],
        utility: data[b + 3],
        utilityStderr: data[b + 4],
        treeHits: data[b + 5],
        fallbackPlans: data[b + 6],
        truncated: data[b + 7],
      };
    });
    const paired = Array.from({ length: data[0] - 1 }, (_, i) => ({
      meanDifference: data[100 + i * 3],
      stderr: data[101 + i * 3],
      utilityDifference: data[102 + i * 3],
    }));
    const row = {
      innerC,
      mode,
      evaluationSamples: 4096,
      evaluationOffset: 100000,
      report,
      roots,
      paired,
    };
    rows.push(row);
    console.log(
      JSON.stringify({
        innerC,
        mode,
        trainingAction: report.action,
        roots,
        paired,
      }),
    );
    await writeFile(
      join(directory, "summary.json"),
      JSON.stringify(
        {
          productionWasmSha256: manifest.wasmSha256,
          baselineFixedReportEqual: true,
          rows,
        },
        null,
        2,
      ) + "\n",
    );
  }
assert.equal(
  createHash("sha256")
    .update(await readFile("src/game/ai/ra-ai.wasm"))
    .digest("hex"),
  manifest.wasmSha256,
);
