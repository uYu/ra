import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, cp, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import type { State } from "../src/game/types.ts";

const output = resolve(
  process.argv[2] ?? "artifacts/ai-ra-literature-study-20261028",
);
assert.ok(
  !existsSync(join(output, "plan.json")),
  "Choose a new output; do not overwrite an existing experiment",
);
await mkdir(output, { recursive: true });
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const source = await readFile("native/ra_ai.cpp", "utf8"),
  manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
assert.equal(hash(source), manifest.sourceSha256);
const configurations = [
  {
    name: "uct-original",
    variant: "uct",
    alpha: 0.5,
    exploration: 1.4,
    rollout: -1,
  },
  {
    name: "dpw-original",
    variant: "dpw",
    alpha: 0.5,
    exploration: 1.4,
    rollout: -1,
  },
  {
    name: "dpw-slow",
    variant: "dpw",
    alpha: 0.1,
    exploration: 1.4,
    rollout: -1,
  },
  {
    name: "dpw-slow-zero",
    variant: "dpw",
    alpha: 0.1,
    exploration: 1.4,
    rollout: 0,
  },
  {
    name: "dpw-slow-zero-c05",
    variant: "dpw",
    alpha: 0.1,
    exploration: 0.5,
    rollout: 0,
  },
  {
    name: "uct-zero-c05",
    variant: "uct",
    alpha: 0.5,
    exploration: 0.5,
    rollout: 0,
  },
  {
    name: "dpw-slow-eight-c05",
    variant: "dpw",
    alpha: 0.1,
    exploration: 0.5,
    rollout: 8,
  },
  {
    name: "uct-full-c05",
    variant: "uct",
    alpha: 0.5,
    exploration: 0.5,
    rollout: -1,
  },
] as const;
const rawPositions = await readFile(
  "artifacts/ai-perf-20261028/positions.json",
  "utf8",
);
const oracleBytes = await readFile(
  "artifacts/ai-endgame-oracle-legal-deck-20261028.json",
  "utf8",
);
const plan = {
  sourceSha256: hash(source),
  productionWasmSha256: manifest.wasmSha256,
  paper: "https://arxiv.org/pdf/1304.6057",
  configurations,
  method:
    "Isolated ablation: retained observer-only tree, sampled opponents, original tanh, policy prior and evaluator. Not a reproduction of the paper's two-player zero-sum fully observed implementation. C=.5 is a test value, not a justified conversion of paper C=50.",
  fixedSamples: 128,
  oracleSamples: 128,
  oracleOffsets: [0, 1000, 2000],
  recordedTimeMs: 2000,
  heldoutTimeMs: 2000,
  heldoutSelection:
    "Existing 24-position corpus: second-epoch turn position for each of 2,3,4,5 players, independent of the step255 case",
  positionsSha256: hash(rawPositions),
  oracleFixturesSha256: hash(oracleBytes),
  productionChanged: false,
  modelsChanged: false,
};
await writeFile(
  join(output, "plan.json"),
  JSON.stringify(plan, null, 2) + "\n",
);
await writeFile(join(output, "baseline.cpp"), source);
await cp("src/game/ai/ra-ai.wasm", join(output, "baseline.wasm"));
let cpp = source;
function replace(a: string, b: string) {
  assert.equal(cpp.split(a).length - 1, 1, a);
  cpp = cpp.replace(a, b);
}
replace(
  "Report searchAction(",
  `double probeAlpha=.5,probeC=1.4;int probeRollout=-1;double probeMetrics[4]{};
extern "C" void configure_study(double alpha,double exploration,int rollout){probeAlpha=alpha;probeC=exploration;probeRollout=rollout;}
extern "C" double* study_metrics(){return probeMetrics;}
Report searchAction(`,
);
replace(
  "  Report report;",
  "  Report report;\n  std::fill(std::begin(probeMetrics),std::end(probeMetrics),0);",
);
replace(
  "2*std::sqrt(branch->visits+1.0)",
  "2*std::pow(branch->visits+1.0,probeAlpha)",
);
replace(
  "2*std::sqrt(edge->visits+1.0)",
  "2*std::pow(edge->visits+1.0,probeAlpha)",
);
replace(
  "+1.4*std::sqrt(std::log(branch->visits+1.0)/e->visits)",
  "+probeC*std::sqrt(std::log(branch->visits+1.0)/e->visits)",
);
replace(
  "    while(!finished(next)&&steps<stepLimit) {\n      Plan plan;",
  "    int rolloutSteps=0;\n    while(!finished(next)&&steps<stepLimit&&(probeRollout<0||rolloutSteps<probeRollout)) {\n      Plan plan;",
);
replace(
  "        if(finished(next)||steps>=stepLimit)break;\n        if(next.phase==Epoch)",
  "        if(finished(next)||steps>=stepLimit||(probeRollout>=0&&rolloutSteps>=probeRollout))break;\n        rolloutSteps++;\n        if(next.phase==Epoch)",
);
replace(
  "    if(!finished(next))report.truncated++;\n    auto residual=",
  "    if(!finished(next)){if(probeRollout>=0&&rolloutSteps>=probeRollout)probeMetrics[0]++;else report.truncated++;}\n    probeMetrics[1]+=rolloutSteps;\n    auto residual=",
);
await writeFile(join(output, "probe.cpp"), cpp);
const cache = join(await realpath(tmpdir()), "ra-search-probe-cache");
if (!existsSync(cache)) {
  const r = spawnSync("em-config", ["CACHE"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  await cp(r.stdout.trim().replace(/^["']|["']$/g, ""), cache, {
    recursive: true,
  });
}
const flags = manifest.flags.filter(
  (s: string) => !s.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run","_configure_study","_study_metrics"]',
);
const compiled = spawnSync(
  process.env.EMXX ?? "em++",
  [join(output, "probe.cpp"), ...flags, "-o", join(output, "probe.wasm")],
  { stdio: "inherit", env: { ...process.env, EM_CACHE: cache } },
);
assert.equal(compiled.status, 0);
const ai = await createWasmAi(await readFile(join(output, "probe.wasm"))),
  baseline = await createWasmAi(await readFile(join(output, "baseline.wasm"))),
  native = (ai as any).native;
const positions = JSON.parse(rawPositions) as {
  count: number;
  epoch: number;
  phase: string;
  state: State;
}[];
let equivalence = 0;
// pow(x,.5) may round differently from sqrt, but integer widths must agree.
for (let n = 1; n <= 1000000; n++)
  assert.equal(Math.ceil(2 * Math.pow(n, 0.5)), Math.ceil(2 * Math.sqrt(n)));
for (const p of positions)
  for (const variant of ["uct", "dpw"] as const) {
    native.configure_study(0.5, 1.4, -1);
    const options = { samples: 8, horizon: "next-epoch" as const, variant };
    assert.deepEqual(
      ai.search(p.state, options),
      baseline.search(p.state, options),
    );
    equivalence++;
  }
const fixed: any[] = [],
  oracle: any[] = [],
  timed: any[] = [];
const fixtures = JSON.parse(oracleBytes).results;
const known = JSON.parse(
  await readFile(
    "artifacts/ai-search-exploration-20261028/oracle-checks.json",
    "utf8",
  ),
);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const run = (s: State, c: (typeof configurations)[number], timeMs?: number) => {
  native.configure_study(c.alpha, c.exploration, c.rollout);
  const started = performance.now();
  const report = ai.search(s, {
    samples: 128,
    horizon: "next-epoch",
    variant: c.variant,
    ...(timeMs === undefined ? {} : { timeMs }),
  });
  const metrics = new Float64Array(
    native.memory.buffer,
    native.study_metrics(),
    4,
  );
  const row = {
    configuration: c.name,
    ms: performance.now() - started,
    plannedCutoffs: metrics[0],
    rolloutTransitions: metrics[1],
    report,
  };
  assert.ok(
    report.candidates.every(
      (c) => Number.isFinite(c.value) && Number.isFinite(c.error),
    ),
  );
  return row;
};
const summarize = () => ({
  plan,
  equivalenceChecks: equivalence,
  fixed,
  oracleSummary: configurations.map((c) => {
    const r = oracle.filter((r) => r.configuration === c.name);
    return {
      configuration: c.name,
      searches: r.length,
      suboptimal: r.filter((r) => r.regret > 1e-9).length,
      meanUtilityRegret:
        r.reduce((n, r) => n + r.regret, 0) / Math.max(1, r.length),
      maxUtilityRegret: Math.max(0, ...r.map((r) => r.regret)),
    };
  }),
  oracle,
  timed,
});
const save = () =>
  writeFile(
    join(output, "summary.json"),
    JSON.stringify(summarize(), null, 2) + "\n",
  );
for (const c of configurations) {
  for (const p of positions)
    fixed.push({
      count: p.count,
      epoch: p.epoch,
      phase: p.phase,
      ...run(p.state, c),
    });
  for (const fixture of fixtures)
    for (const offset of [0, 1000, 2000]) {
      const r = run(
        { ...fixture.state, steps: fixture.state.steps + offset },
        c,
      );
      const exact = known.rows.find(
        (x: any) => x.index === fixture.index,
      ).oracle;
      const value = exact.rows.find((x: any) =>
        same(x.action, r.report.action),
      )?.value;
      assert.ok(Number.isFinite(value));
      oracle.push({
        index: fixture.index,
        offset,
        regret: exact.best - value,
        ...r,
      });
    }
  const r = summarize().oracleSummary.find((r) => r.configuration === c.name);
  console.log(JSON.stringify({ stage: "fixed-and-oracle", ...r }));
  await save();
}
const recorded: State = JSON.parse(
  await readFile("tests/fixtures/last-bid-final-epoch.json", "utf8"),
);
const targets = [
  { label: "recorded-step255", state: recorded },
  ...positions
    .filter((p) => p.epoch === 2 && p.phase === "turn")
    .map((p) => ({ label: `heldout-${p.count}p-epoch2-turn`, state: p.state })),
];
for (let index = 0; index < targets.length; index++) {
  const target = targets[index];
  // Rotate serial order; equal wall-time, no simultaneous CPU work.
  const order = [
    ...configurations.slice(index),
    ...configurations.slice(0, index),
  ];
  for (const c of order) {
    const r = run(target.state, c, 2000);
    timed.push({ label: target.label, ...r });
    console.log(
      JSON.stringify({
        stage: "timed",
        label: target.label,
        configuration: c.name,
        ms: r.ms,
        action: r.report.action,
        samples: r.report.samples,
        depth: r.report.depth,
        plannedCutoffs: r.plannedCutoffs,
        truncated: r.report.truncated,
      }),
    );
    await save();
  }
}
assert.equal(hash(await readFile("native/ra_ai.cpp")), manifest.sourceSha256);
assert.equal(
  hash(await readFile("src/game/ai/ra-ai.wasm")),
  manifest.wasmSha256,
);
await writeFile(
  join(output, "qa.json"),
  JSON.stringify(
    {
      productionUnchanged: true,
      modelsUnchanged: true,
      equivalenceChecks: equivalence,
      widthBoundaryChecks: 1000000,
      configurationCount: configurations.length,
      fixedSearches: fixed.length,
      oracleSearches: oracle.length,
      timedSearches: timed.length,
      probeSourceSha256: hash(cpp),
      probeWasmSha256: hash(await readFile(join(output, "probe.wasm"))),
      limitations: [
        "Not a reproduction: current sampled opponents, information-set keys, evaluator, policy prior and tanh objective retained.",
        "Short rollout intentionally evaluates nonterminal leaves; plannedCutoffs do not count as safety-cap truncation.",
        "Historical exact puzzles are easy and have been inspected before; not a new playing-strength test set.",
        "Timed actions on held-out positions lack exact ground truth; sample throughput alone is not strength.",
        "No tournament and no default configuration change.",
      ],
    },
    null,
    2,
  ) + "\n",
);
