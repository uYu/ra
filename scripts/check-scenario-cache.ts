import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import type { State } from "../src/game/types.ts";

const output = resolve(process.argv[2] ?? "artifacts/ai-scenario-cache-check");
const slots = Number(process.argv[3] ?? 64);
assert.ok(Number.isInteger(slots) && slots > 0 && slots <= 1024);
await mkdir(output, { recursive: true });
const source = await readFile("native/ra_ai.cpp", "utf8");
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const build = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
assert.equal(sha(source), build.sourceSha256);
assert.equal(sha(await readFile(build.target)), build.wasmSha256);
let prototype = source;
function replaceOnce(before: string, after: string) {
  assert.equal(prototype.split(before).length - 1, 1, before);
  prototype = prototype.replace(before, after);
}
replaceOnce(
  "  RootHalving halving(rootActions.size(),iterations,timed);",
  `  RootHalving halving(rootActions.size(),iterations,timed);
  struct Scenario { int visit=0; decltype(bag) tiles; Model model; };
  ${slots <= 128 ? `std::array<Scenario,${slots}>scenarioCache;` : `vector<Scenario>scenarioCache(${slots});`}`,
);
replaceOnce(
  `        Random world((uint32_t)(s.steps+1)*7919u^(uint32_t)(s.current+1)*104729u^(uint32_t)(edge->visits+1)*15485863u);
        next.bag=bag;
        shuffle(next.bag,world);
        for(int i=0;i<s.n;i++)model.cost[i]=0.72+world.next()*0.68;
        model.rivalry=0.45+world.next()*0.45;`,
  `        int visit=edge->visits+1;
        auto&scenario=scenarioCache[visit%scenarioCache.size()];
        if(scenario.visit!=visit) {
          Random world((uint32_t)(s.steps+1)*7919u^(uint32_t)(s.current+1)*104729u^(uint32_t)visit*15485863u);
          scenario.tiles=bag;
          shuffle(scenario.tiles,world);
          for(int i=0;i<s.n;i++)scenario.model.cost[i]=0.72+world.next()*0.68;
          scenario.model.rivalry=0.45+world.next()*0.45;
          scenario.visit=visit;
        }
        next.bag=scenario.tiles;
        model=scenario.model;`,
);
const cpp = join(output, "scenario-cache.cpp");
const wasm = join(output, "scenario-cache.wasm");
await writeFile(cpp, prototype);
const compilation = spawnSync(
  process.env.EMXX ?? "em++",
  [cpp, ...build.flags, "-o", wasm],
  { env: process.env, stdio: "inherit" },
);
assert.equal(compilation.status, 0, "Scenario cache compilation failed");
const current = await createWasmAi(await readFile(build.target));
const cached = await createWasmAi(await readFile(wasm));
const positions: {
  count: number;
  epoch: number;
  phase: string;
  state: State;
}[] = JSON.parse(
  await readFile("artifacts/ai-perf-20261028/positions.json", "utf8"),
);
let searches = 0;
for (const p of positions)
  for (const variant of ["uct", "sh", "dpw"] as const)
    for (const horizon of ["epoch", "next-epoch", "game"] as const) {
      const options = { samples: 4, variant, horizon };
      assert.deepEqual(
        cached.search(p.state, options),
        current.search(p.state, options),
      );
      searches++;
    }
const options = {
  samples: 256,
  variant: "uct" as const,
  horizon: "epoch" as const,
};
for (const p of positions) {
  current.search(p.state, options);
  cached.search(p.state, options);
}
const rows: {
  count: number;
  position: number;
  repeat: number;
  backend: string;
  ms: number;
  samples: number;
}[] = [];
for (let repeat = 0; repeat < 10; repeat++)
  for (let position = 0; position < positions.length; position++) {
    const p = positions[position];
    const order =
      (position + repeat) % 2 ? ["cached", "current"] : ["current", "cached"];
    const reports = [];
    for (const backend of order) {
      const ai = backend === "cached" ? cached : current;
      const start = performance.now();
      const report = ai.search(p.state, options);
      const ms = performance.now() - start;
      reports.push(report);
      rows.push({
        count: p.count,
        position,
        repeat,
        backend,
        ms,
        samples: report.samples,
      });
    }
    assert.deepEqual(reports[0], reports[1]);
  }
const byCount = [2, 3, 4, 5].map((count) => {
  const total = (backend: string) =>
    rows
      .filter((r) => r.count === count && r.backend === backend)
      .reduce((s, r) => s + r.ms, 0);
  return {
    count,
    currentMs: total("current"),
    cachedMs: total("cached"),
    speedup: total("current") / total("cached"),
  };
});
const total = (backend: string) =>
  rows.filter((r) => r.backend === backend).reduce((s, r) => s + r.ms, 0);
assert.equal(sha(await readFile(build.source)), build.sourceSha256);
assert.equal(sha(await readFile(build.target)), build.wasmSha256);
const result = {
  createdAt: new Date().toISOString(),
  slots,
  method:
    "Isolated bounded memoization of the existing root-visit seed; preserves each root action's world sequence. 24 positions, 3 variants x 3 horizons fixed-budget report equality; 10 rotated-order paired fixed-256 repetitions. No tournament or production changes.",
  sourceSha256: build.sourceSha256,
  productionWasmSha256: build.wasmSha256,
  prototypeWasmSha256: sha(await readFile(wasm)),
  matchedVariantHorizonSearches: searches,
  matchedBenchmarkPairs: rows.length / 2,
  byCount,
  speedup: total("current") / total("cached"),
  rows,
};
await writeFile(
  join(output, "summary.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      byCount,
      speedup: result.speedup,
      matchedBenchmarkPairs: result.matchedBenchmarkPairs,
    },
    null,
    2,
  ),
);
