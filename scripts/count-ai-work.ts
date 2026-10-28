import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import type { State } from "../src/game/types.ts";

const output = resolve(process.argv[2] ?? "artifacts/ai-perf-detail-20261028");
const workload = resolve(process.argv[3] ?? output);
await mkdir(output, { recursive: true });
const source = await readFile("native/ra_ai.cpp", "utf8");
const sha = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
const build = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
assert.equal(sha(source), build.sourceSha256);
const contexts = [
  "other",
  "decode",
  "search",
  "policy",
  "auction",
  "collection",
  "god",
  "candidates",
  "evaluation",
  "positionCache",
  "future",
  "inventory",
  "reserve",
  "race",
  "draws",
  "observation",
  "keys",
  "actionKey",
  "rules",
  "sampling",
  "stateCopy",
];
const work = [
  "inventoryTiles",
  "bagRaItems",
  "bagFloodItems",
  "bagScanItems",
  "riverExp",
  "riverUnused",
  "racePairs",
  "raceTable",
  "raceFallbackExp",
  "auctionNodes",
  "auctionLeaves",
  "outcomeValues",
  "turnProbes",
  "directAuctions",
  "treeAuctions",
  "rolloutAuctions",
  "unusedAuctionBase",
  "godEmpty",
  "godTargets",
  "keyInputItems",
  "keyOutputBytes",
  "tileTrialCopies",
  "tileTrialItems",
  "uctEdges",
  "rewardTanh",
  "copyBagItems",
  "copyDiscardItems",
  "copyHoldingItems",
  "copyDiskItems",
  "copyOtherItems",
];
const copies = [
  "root",
  "turnProbe",
  "auctionWorkspace",
  "collection",
  "god",
  "discard",
];
const size = contexts.length * 4 + work.length + copies.length * 2;
let instrumented =
  `#include <cstdlib>
#include <cstdint>
#include <array>
#include <new>
namespace Perf {
enum class Context {${contexts.join(",")}};
enum class Work {${work.join(",")}};
enum class Copy {${copies.join(",")}};
constexpr int N=${contexts.length},W=${work.length},C=${copies.length};
std::array<uint64_t,${size}>data{};
bool active=false;
int target=0;
Context current=Context::other;
void add(Work w,uint64_t n=1){if(active)data[4*N+(int)w]+=n;}
struct Scope {
  Context previous;
  Scope(Context c):previous(current){current=c;if(active)data[(int)c]++;}
  ~Scope(){current=previous;}
};
void allocated(size_t n){if(active){data[N+(int)current]++;data[2*N+(int)current]+=n;}}
void freed(void*p){if(active&&p)data[3*N+(int)current]++;}
}
void* operator new(size_t n){Perf::allocated(n);void*p=std::malloc(n?n:1);if(!p)__builtin_trap();return p;}
void* operator new[](size_t n){return ::operator new(n);}
void operator delete(void*p)noexcept{Perf::freed(p);std::free(p);}
void operator delete[](void*p)noexcept{::operator delete(p);}
void operator delete(void*p,size_t)noexcept{::operator delete(p);}
void operator delete[](void*p,size_t)noexcept{::operator delete(p);}
extern "C" void perf_reset(){Perf::active=false;Perf::data.fill(0);Perf::target=0;Perf::current=Perf::Context::other;Perf::active=true;}
extern "C" void perf_target(int n){Perf::target=n>0&&n<1000000?n:0;}
extern "C" uint64_t*perf_ptr(){Perf::active=false;return Perf::data.data();}
` + source;
function replaceOnce(before: string, after: string) {
  assert.equal(
    instrumented.split(before).length - 1,
    1,
    `Injection target: ${before}`,
  );
  instrumented = instrumented.replace(before, after);
}
replaceOnce(
  "using Values=std::array<double,5>;",
  `State perfCopy(const State&s,Perf::Copy site) {
  Perf::Scope scope(Perf::Context::stateCopy);
  if(Perf::active){
    uint64_t holdings=0,disks=0;
    for(const auto&p:s.players){holdings+=p.tiles.size();disks+=p.suns.size()+p.used.size();}
    uint64_t other=s.auction.order.size()+2*s.auction.bids.size()+s.market.size()+s.pending.size();
    Perf::data[4*Perf::N+Perf::W+(int)site]++;
    Perf::data[4*Perf::N+Perf::W+Perf::C+(int)site]+=s.bag.size()+s.discarded.size()+holdings+disks+other;
    Perf::add(Perf::Work::copyBagItems,s.bag.size());Perf::add(Perf::Work::copyDiscardItems,s.discarded.size());
    Perf::add(Perf::Work::copyHoldingItems,holdings);Perf::add(Perf::Work::copyDiskItems,disks);Perf::add(Perf::Work::copyOtherItems,other);
  }
  return s;
}
using Values=std::array<double,5>;`,
);
replaceOnce(
  source.includes("State next=searchState;")
    ? "    State next=searchState;\n    next.bag=bag;"
    : "    State next=s;\n    next.bag=bag;",
  `    State next=perfCopy(${source.includes("State next=searchState;") ? "searchState" : "s"},Perf::Copy::root);\n    next.bag=bag;`,
);
replaceOnce(
  "  State next=s;\n  apply(next,{Invoke});",
  "  State next=perfCopy(s,Perf::Copy::turnProbe);\n  apply(next,{Invoke});",
);
replaceOnce(
  "    State next=s;\n    eraseId",
  "    State next=perfCopy(s,Perf::Copy::discard);\n    eraseId",
);
replaceOnce("  State c=s;", "  State c=perfCopy(s,Perf::Copy::collection);");
replaceOnce(
  "  State won=s;",
  "  State won=perfCopy(s,Perf::Copy::auctionWorkspace);",
);
replaceOnce(
  "    State without=s;",
  "    State without=perfCopy(s,Perf::Copy::god);",
);
const functions: Record<string, string> = {
  readState: "decode",
  searchAction: "search",
  policyAction: "policy",
  auctionPlan: "auction",
  collectInto: "collection",
  collectionAfter: "collection",
  godChoices: "god",
  bestDiscard: "collection",
  candidates: "candidates",
  positionValues: "evaluation",
  positionCache: "positionCache",
  futureValues: "future",
  inventory: "inventory",
  reserveCost: "reserve",
  softRace: "race",
  drawsLeft: "draws",
  observation: "observation",
  listKey: "keys",
  actionKey: "actionKey",
  apply: "rules",
  shuffle: "sampling",
};
for (const [name, context] of Object.entries(functions)) {
  const pattern = new RegExp(`^([^\\n]*\\b${name}\\([^\\n]*\\) \\{\\n)`, "gm");
  assert.equal([...instrumented.matchAll(pattern)].length, 1, name);
  instrumented = instrumented.replace(
    pattern,
    `$1  Perf::Scope perfScope(Perf::Context::${context});\n`,
  );
}
replaceOnce(
  "  Inventory v;",
  "  Inventory v;\n  Perf::add(Perf::Work::inventoryTiles,p.tiles.size());",
);
if (source.includes("int bagCount(")) {
  replaceOnce(
    "    s.bagCounts.fill(0);",
    "    Perf::add(Perf::Work::bagScanItems,s.bag.size());\n    s.bagCounts.fill(0);",
  );
} else {
  replaceOnce(
    "  double ra=countKind(s.bag,Ra);",
    "  Perf::add(Perf::Work::bagRaItems,s.bag.size());\n  double ra=countKind(s.bag,Ra);",
  );
  replaceOnce(
    "  double draws=drawsLeft(s),floodLeft=countKind(s.bag,Flood);",
    "  Perf::add(Perf::Work::bagFloodItems,s.bag.size());\n  double draws=drawsLeft(s),floodLeft=countKind(s.bag,Flood);",
  );
}
replaceOnce(
  "    c.river[i]=1-std::exp",
  "    Perf::add(Perf::Work::riverExp);\n    Perf::add(Perf::Work::riverUnused,c.all[i].flood>0||c.all[i].nile==0);\n    c.river[i]=1-std::exp",
);
replaceOnce(
  "  for(int j=0;j<n;j++)if(j!=i) {",
  "  for(int j=0;j<n;j++)if(j!=i) {\n    Perf::add(Perf::Work::racePairs);",
);
replaceOnce(
  "      const auto&factor=raceFactors",
  "      Perf::add(Perf::Work::raceTable);\n      const auto&factor=raceFactors",
);
replaceOnce(
  "      double d=delta/width;",
  "      Perf::add(Perf::Work::raceFallbackExp,2);\n      double d=delta/width;",
);
replaceOnce(
  "  auto&a=s.auction;\n  auto base=positionValues(s);",
  "  auto&a=s.auction;\n  Perf::add(Perf::Work::unusedAuctionBase,a.winner>=0||a.reason==1);\n  auto base=positionValues(s);",
);
replaceOnce(
  "      auto v=positionValues(won,&cache);",
  "      Perf::add(Perf::Work::outcomeValues);\n      auto v=positionValues(won,&cache);",
);
replaceOnce(
  "  auto search=[&](auto&&self,int index,int high,int winner)->Plan {",
  "  auto search=[&](auto&&self,int index,int high,int winner)->Plan {\n    Perf::add(Perf::Work::auctionNodes);",
);
replaceOnce(
  "    if(index==(int)a.order.size()) {",
  "    if(index==(int)a.order.size()) {\n      Perf::add(Perf::Work::auctionLeaves);",
);
replaceOnce(
  "Action bestDiscard(const State&s)",
  `Plan perfAuction(const State&s,const Model&m,Perf::Work reason){Perf::add(reason);return auctionPlan(s,m);}
Action bestDiscard(const State&s)`,
);
replaceOnce(
  "if(s.phase==Auction)return auctionPlan(s,model).actions[0];",
  "if(s.phase==Auction)return perfAuction(s,model,Perf::Work::directAuctions).actions[0];",
);
replaceOnce(
  "  auto plan=auctionPlan(next,model);",
  "  auto plan=perfAuction(next,model,Perf::Work::turnProbes);",
);
let auctionBatch = 0;
instrumented = instrumented.replaceAll(
  "else if(next.phase==Auction)plan=auctionPlan(next,model);",
  () =>
    `else if(next.phase==Auction)plan=perfAuction(next,model,Perf::Work::${auctionBatch++ === 0 ? "treeAuctions" : "rolloutAuctions"});`,
);
assert.equal(auctionBatch, 2);
replaceOnce(
  "  return choices;",
  "  Perf::add(Perf::Work::godEmpty,choices.empty());\n  Perf::add(Perf::Work::godTargets,choices.size());\n  return choices;",
);
replaceOnce(
  "  return k;",
  "  Perf::add(Perf::Work::keyOutputBytes,k.size());\n  return k;",
);
replaceOnce(
  "  size_t start=key.size();",
  "  Perf::add(Perf::Work::keyInputItems,v.size());\n  size_t start=key.size();",
);
replaceOnce(
  "      auto before=p.tiles;",
  "      Perf::add(Perf::Work::tileTrialCopies);\n      Perf::add(Perf::Work::tileTrialItems,p.tiles.size());\n      auto before=p.tiles;",
);
replaceOnce(
  "          double uct=",
  "          Perf::add(Perf::Work::uctEdges);\n          double uct=",
);
replaceOnce(
  "        e->utilities[i]+=reward==1?2*v-1:std::tanh(v/20);",
  "        Perf::add(Perf::Work::rewardTanh,reward==0);\n        e->utilities[i]+=reward==1?2*v-1:std::tanh(v/20);",
);
replaceOnce(
  "  int iterations=timed?1000000:budget*(int)rootActions.size();",
  "  int iterations=Perf::target>0?Perf::target:(timed?1000000:budget*(int)rootActions.size());",
);
await writeFile(join(output, "counter.cpp"), instrumented);
const flags = build.flags.filter(
  (f: string) => !f.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run","_perf_reset","_perf_target","_perf_ptr"]',
);
const target = join(output, "ra-ai-counters.wasm");
const compiler = process.env.EMXX ?? "em++";
const compilation = spawnSync(
  compiler,
  [join(output, "counter.cpp"), ...flags, "-o", target],
  { env: process.env, stdio: "inherit" },
);
assert.equal(
  compilation.status,
  0,
  compilation.error?.message ?? "Counter build failed",
);
const counters = await createWasmAi(await readFile(target));
const production = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
const native = (
  counters as unknown as {
    native: {
      memory: WebAssembly.Memory;
      perf_reset(): void;
      perf_target(n: number): void;
      perf_ptr(): number;
    };
  }
).native;
const positions: {
  count: number;
  epoch: number;
  phase: string;
  state: State;
}[] = JSON.parse(await readFile(join(workload, "positions.json"), "utf8"));
const profile = JSON.parse(
  await readFile(join(workload, "summary.json"), "utf8"),
);
if (workload === output)
  assert.equal(profile.productionWasmSha256, build.wasmSha256);
const rows = [];
for (const p of positions) {
  native.perf_reset();
  native.perf_ptr();
  const options = {
    samples: 128,
    variant: "uct" as const,
    horizon: "epoch" as const,
  };
  assert.deepEqual(
    counters.search(p.state, options),
    production.search(p.state, options),
  );
  const original = profile.profileRows.find(
    (r: any) =>
      r.count === p.count &&
      r.epoch === p.epoch &&
      r.phase === p.phase &&
      r.repeat === 0,
  );
  assert.ok(original && original.samples > 0 && original.samples < 1_000_000);
  native.perf_reset();
  native.perf_target(original.samples);
  const report = counters.search(p.state, options);
  const data = Array.from(
    new BigUint64Array(native.memory.buffer, native.perf_ptr(), size),
    Number,
  );
  assert.equal(report.samples, original.samples);
  assert.equal(
    report.transitions,
    original.transitions,
    "Replayed profile workload changed",
  );
  const calls = Object.fromEntries(
    contexts.map((name, i) => [
      name,
      {
        calls: data[i],
        allocations: data[contexts.length + i],
        requestedBytes: data[contexts.length * 2 + i],
        frees: data[contexts.length * 3 + i],
      },
    ]),
  );
  const counts = Object.fromEntries(
    work.map((name, i) => [name, data[contexts.length * 4 + i]]),
  );
  const copyCounts = Object.fromEntries(
    copies.map((name, i) => [
      name,
      {
        copies: data[contexts.length * 4 + work.length + i],
        vectorItems:
          data[contexts.length * 4 + work.length + copies.length + i],
      },
    ]),
  );
  assert.equal(copyCounts.root.copies, report.samples);
  assert.equal(
    calls.auction.calls,
    counts.turnProbes +
      counts.directAuctions +
      counts.treeAuctions +
      counts.rolloutAuctions,
  );
  assert.equal(calls.rules.calls, report.transitions + counts.turnProbes);
  rows.push({
    count: p.count,
    epoch: p.epoch,
    phase: p.phase,
    productionProfileRepeat: 0,
    samples: report.samples,
    transitions: report.transitions,
    depth: report.depth,
    calls,
    counts,
    copies: copyCounts,
  });
  console.log(
    JSON.stringify({
      stage: "counted",
      count: p.count,
      epoch: p.epoch,
      phase: p.phase,
      samples: report.samples,
      auctions: calls.auction.calls,
      allocations: Object.values(calls).reduce((n, c) => n + c.allocations, 0),
    }),
  );
}
assert.equal(sha(await readFile("native/ra_ai.cpp")), build.sourceSha256);
assert.equal(sha(await readFile("src/game/ai/ra-ai.wasm")), build.wasmSha256);
const result = {
  createdAt: new Date().toISOString(),
  sourceSha256: build.sourceSha256,
  productionWasmSha256: build.wasmSha256,
  counterWasmSha256: sha(await readFile(target)),
  workloadDirectory: workload,
  workloadWasmSha256: profile.productionWasmSha256,
  method:
    "Separate counted build replays each production CPU-profile position with exactly its first repetition simulation count; transitions match. Full fixed-128 reports also match production. Counts and logical requested bytes are diagnostic work measures, not timing measurements or peak memory. No production files changed.",
  contexts,
  work,
  copies,
  rows,
};
await writeFile(
  join(output, "work-counts.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({ stage: "complete", positions: rows.length, output }),
);
