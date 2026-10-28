import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { newGame } from "../src/game/engine.ts";
import { makeTiles, RA_LIMIT } from "../src/game/data.ts";
import type { State } from "../src/game/types.ts";

const output = resolve(process.argv[2] ?? "artifacts/ai-perf-lut-final-check");
await mkdir(output, { recursive: true });
const source = await readFile("native/ra_ai.cpp");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const build = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
assert.equal(sha(source), build.sourceSha256);
assert.equal(sha(await readFile("src/game/ai/ra-ai.wasm")), build.wasmSha256);
await copyFile("native/ra_ai.cpp", join(output, "ra_ai.cpp"));
const harness = `#include "ra_ai.cpp"
#include <cstring>
void legacyAppend(std::string&key,int value) {
  uint32_t v=(uint32_t)value;
  for(int j=0;j<4;j++)key.push_back((char)(v>>(8*j)));
}
bool sameKey(const vector<int>&v,bool tiles) {
  std::string fast,slow;
  listKey(fast,v,tiles);
  vector<int>values=v;
  if(tiles){for(int&i:values)i=kind(i)*8+variant(i);std::sort(values.begin(),values.end());}
  legacyAppend(slow,values.size());
  for(int x:values)legacyAppend(slow,x);
  return fast==slow;
}
double legacyRace(const std::array<int,5>&counts,int n,int i,double width) {
  double most=1,least=1;
  for(int j=0;j<n;j++)if(j!=i){double d=(counts[i]-counts[j])/width;most*=1/(1+std::exp(-d));least*=1/(1+std::exp(d));}
  return 5*most-2*least;
}
extern "C" int check_fast_paths() {
  initTiles();
  int checked=0;
  constexpr int sizes[]={0,1,2,7,8,32,180,360,1800};
  for(int id=0;id<180;id++)for(int size:sizes){if(!sameKey(vector<int>(size,id),true))return -1;checked++;}
  uint32_t rng=17;
  auto next=[&](){rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;return rng;};
  for(int sample=0;sample<512;sample++){
    vector<int>v;
    for(int n=sample%181;n>0;n--)v.push_back(next()%180);
    if(!sameKey(v,true))return -2;
    checked++;
  }
  if(!sameKey({-2147483647,-1,0,1,16,2147483647},false))return -3;
  checked++;
  for(int n=2;n<=5;n++)for(int sample=0;sample<512;sample++){
    std::array<int,5>counts{};
    for(int i=0;i<n;i++)counts[i]=next()%(sample%2?26:181);
    for(int i=0;i<n;i++)for(double width:{1.5,2.1,0.75}){
      double fast=softRace(counts,n,i,width),slow=legacyRace(counts,n,i,width);
      if(std::memcmp(&fast,&slow,sizeof(double)))return -4;
      checked++;
    }
  }
  std::array<std::array<int,5>,8>monumentIds{};
  std::array<std::array<int,5>,5>civilizationIds{};
  std::array<int,8>monumentCounts{};
  std::array<int,5>civilizationCounts{};
  for(int id=0;id<180;id++){
    int v=variant(id);
    if(kind(id)==Monument)monumentIds[v][monumentCounts[v]++]=id;
    if(kind(id)==Civilization)civilizationIds[v][civilizationCounts[v]++]=id;
  }
  Player p;
  p.tiles.reserve(40);
  for(int code=0;code<1679616;code++){
    p.tiles.clear();
    int remainder=code,different=0,two=0,extra=0;
    std::array<int,8>counts{};
    for(int v=0;v<8;v++){
      int count=remainder%6;remainder/=6;counts[v]=count;
      different+=count>0;two+=count==2;if(count>=3)extra+=(count-2)*5;
      for(int j=0;j<count;j++)p.tiles.push_back(monumentIds[v][j]);
    }
    auto fast=inventory(p);
    int score=(different==8?15:different==7?10:different)+extra;
    if(fast.m!=counts||fast.monumentDifferent!=different||fast.monumentTwo!=two||fast.monumentScore!=score)return -5;
    checked++;
  }
  for(int code=0;code<7776;code++){
    p.tiles.clear();
    int remainder=code,different=0;
    std::array<int,5>counts{};
    for(int v=0;v<5;v++){
      int count=remainder%6;remainder/=6;counts[v]=count;different+=count>0;
      for(int j=0;j<count;j++)p.tiles.push_back(civilizationIds[v][j]);
    }
    auto fast=inventory(p);
    if(fast.c!=counts||fast.civ!=different)return -6;
    checked++;
  }
  return checked;
}
`;
await writeFile(join(output, "check.cpp"), harness);
const exports =
  '["_abi_version","_input_ptr","_output_ptr","_run","_check_fast_paths"]';
const flags = build.flags.filter(
  (f: string) => !f.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  `-sEXPORTED_FUNCTIONS=${exports}`,
  "-fsanitize=undefined",
  "-fsanitize-trap=undefined",
);
const target = join(output, "ra-ai-ubsan.wasm");
const compiler = process.env.EMXX ?? "em++";
const compilation = spawnSync(
  compiler,
  [join(output, "check.cpp"), ...flags, "-o", target],
  { env: process.env, stdio: "inherit" },
);
assert.equal(
  compilation.status,
  0,
  compilation.error?.message ?? "Sanitizer build failed",
);
const instrumented = await createWasmAi(await readFile(target));
const diagnostic = instrumented as unknown as {
  native: { check_fast_paths(): number };
};
const checked = diagnostic.native.check_fast_paths();
assert.equal(checked, 1_711_029, `Fast-path mismatch: ${checked}`);
console.log(JSON.stringify({ stage: "exhaustive-fast-paths-passed", checked }));
const reference = await createWasmAi(
  await readFile("artifacts/ai-uct2s-source-snapshot/src/game/ai/ra-ai.wasm"),
);
const positions: { state: State }[] = JSON.parse(
  await readFile("artifacts/ai-perf-20261028/positions.json", "utf8"),
);
let searches = 0;
for (const { state } of positions)
  for (const variant of ["uct", "sh", "dpw"] as const)
    for (const horizon of ["epoch", "next-epoch", "game"] as const) {
      const options = { samples: 2, variant, horizon };
      assert.deepEqual(
        instrumented.search(state, options),
        reference.search(state, options),
      );
      searches++;
    }
for (const count of [2, 5]) {
  const state = newGame({ count, humans: 0, difficulty: "hard", seed: 73 });
  for (const player of state.players) {
    player.suns = Array.from({ length: 16 }, (_, i) => i + 1);
    player.used = [...player.suns];
  }
  const lastRa = state.bag.find((t) => t.kind === "ra")!;
  state.bag = [lastRa];
  state.discarded = makeTiles().filter((t) => t.id !== lastRa.id);
  state.ra = RA_LIMIT[count] - 1;
  state.current = 0;
  const options = { samples: 1, horizon: "next-epoch" as const };
  assert.deepEqual(
    instrumented.search(state, options),
    reference.search(state, options),
  );
}
assert.equal(sha(await readFile("native/ra_ai.cpp")), build.sourceSha256);
assert.equal(sha(await readFile("src/game/ai/ra-ai.wasm")), build.wasmSha256);
const report = {
  checkedAt: new Date().toISOString(),
  status: "passed",
  sanitizer: "undefined behavior checks with traps",
  checkedFastPaths: checked,
  exhaustiveMonumentCountVectors: 1679616,
  exhaustiveCivilizationCountVectors: 7776,
  keyComparisons: 2133,
  matchedSearches: searches,
  epochMergeBoundaryChecks: 2,
  sourceSha256: build.sourceSha256,
  productionWasmSha256: build.wasmSha256,
  instrumentedWasmSha256: sha(await readFile(target)),
  flags,
  productionFilesUnchanged: true,
};
await writeFile(
  join(output, "summary.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
