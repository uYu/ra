import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Session } from "node:inspector";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { newGame, simulate } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { candidateActions, policyAction } from "../src/game/ai/policy.ts";
import type { State } from "../src/game/types.ts";
import type { SearchReport } from "../src/game/ai/search.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i], process.argv[i + 1]);
const output = resolve(args.get("--out") ?? "artifacts/ai-perf-20261028");
const integer = (key: string, fallback: number, max: number) => {
  const n = Number(args.get(key) ?? fallback);
  assert.ok(Number.isInteger(n) && n > 0 && n <= max, key);
  return n;
};
const samples = integer("--samples", 128, 512);
const repeats = integer("--repeats", 3, 20);
const intervalUs = integer("--interval-us", 200, 10000);
const timeMs = args.has("--time-ms")
  ? integer("--time-ms", 2000, 2000)
  : undefined;
const hash = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const plan = JSON.parse(await readFile("artifacts/ai-uct2s-plan.json", "utf8"));
const study = JSON.parse(
  await readFile("artifacts/ai-uct2s-control.json", "utf8"),
);
const protectedHashes: Record<string, string> = {};
for (const [path, expected] of Object.entries(plan.hashes)) {
  const actual = hash(await readFile(path));
  if (study.status === "running")
    assert.equal(actual, expected, `Active experiment source changed: ${path}`);
  protectedHashes[path] = actual;
}
const verifyProtected = async () => {
  for (const [path, expected] of Object.entries(protectedHashes))
    assert.equal(
      hash(await readFile(path)),
      expected,
      `Protected source changed: ${path}`,
    );
};
await mkdir(output, { recursive: true });
const build = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
const source = join(output, "ra_ai.cpp");
const target = join(output, "ra-ai-profile.wasm");
await copyFile("native/ra_ai.cpp", source);
const compiler = process.env.EMXX ?? "em++";
const flags = [...build.flags, "--profiling-funcs"];
const compiled = spawnSync(compiler, [source, ...flags, "-o", target], {
  env: process.env,
  stdio: "inherit",
});
assert.equal(
  compiled.status,
  0,
  compiled.error?.message ?? "Profile build failed",
);
const productionBytes = await readFile("src/game/ai/ra-ai.wasm");
const profileBytes = await readFile(target);

// Names live in custom sections. Compare all executable/data sections byte for byte.
function executableSections(bytes: Uint8Array) {
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)];
  let cursor = 8;
  while (cursor < bytes.length) {
    const start = cursor;
    const section = bytes[cursor++];
    let length = 0,
      shift = 0,
      byte = 0;
    do {
      byte = bytes[cursor++];
      length += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    cursor += length;
    assert.ok(cursor <= bytes.length);
    if (section !== 0) chunks.push(bytes.subarray(start, cursor));
  }
  return Buffer.concat(chunks);
}
const identicalExecutableSections = executableSections(productionBytes).equals(
  executableSections(profileBytes),
);
assert.ok(
  identicalExecutableSections,
  "Profile build changed executable sections",
);
const production = await createWasmAi(productionBytes);
const profiled = await createWasmAi(profileBytes);
const positions: {
  count: number;
  epoch: number;
  phase: string;
  state: State;
}[] = [];
for (const count of [2, 3, 4, 5]) {
  let state = newGame({
    count,
    seed: 97000 + count,
    humans: 0,
    difficulty: "normal",
  });
  const buckets = new Map<string, State[]>();
  while (state.phase !== "over" && state.steps < 1600) {
    if (
      ["turn", "auction"].includes(state.phase) &&
      candidateActions(state).length > 1
    ) {
      const key = `${state.epoch}/${state.phase}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(observe(state));
      buckets.set(key, bucket);
    }
    state = simulate(state, policyAction(state));
  }
  assert.equal(state.phase, "over");
  for (const epoch of [1, 2, 3])
    for (const phase of ["turn", "auction"]) {
      const bucket = buckets.get(`${epoch}/${phase}`)!;
      assert.ok(
        bucket?.length,
        `Missing representative position ${count}/${epoch}/${phase}`,
      );
      positions.push({
        count,
        epoch,
        phase,
        state: bucket[Math.floor(bucket.length / 2)],
      });
    }
}
await writeFile(
  join(output, "positions.json"),
  JSON.stringify(positions) + "\n",
);
const options = { samples, variant: "uct" as const, horizon: "epoch" as const };
for (const { state } of positions) {
  production.search(state, { samples: 4 });
  profiled.search(state, { samples: 4 });
}
const baseline = new Map<State, SearchReport>();
const baselineRows = [];
for (const p of positions) {
  const start = performance.now();
  const result = production.search(p.state, options);
  const ms = performance.now() - start;
  assert.deepEqual(profiled.search(p.state, options), result);
  baseline.set(p.state, result);
  baselineRows.push({
    count: p.count,
    epoch: p.epoch,
    phase: p.phase,
    ms,
    samples: result.samples,
    transitions: result.transitions,
  });
}
console.log(
  JSON.stringify({
    stage: "baseline-validated",
    positions: positions.length,
    identicalExecutableSections,
  }),
);

type Frame = { functionName: string; url: string; lineNumber: number };
type ProfileNode = { id: number; callFrame: Frame; children?: number[] };
type Profile = {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
};
function summarize(profile: Profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parents = new Map<number, number>();
  for (const n of profile.nodes)
    for (const id of n.children ?? []) parents.set(id, n.id);
  const functions = new Map<
    string,
    { name: string; url: string; self: number; inclusive: number }
  >();
  const categories = new Map<string, number>();
  let wasmSamples = 0,
    wasmSelfSamples = 0;
  const category = (frames: Frame[]) => {
    if (!frames[0].url.startsWith("wasm:")) return "js-and-profiler";
    for (const f of frames) {
      const n = f.functionName;
      if (
        /^(?:_?malloc|_?free|_?realloc|_?calloc|_?memcpy|_?memmove|_?memset|emmalloc)|operator (?:new|delete)/.test(
          n,
        )
      )
        return "allocation-and-memory";
      if (
        /State::State|State::operator=|Player::Player|Player::operator=/.test(n)
      )
        return "state-copy";
      if (
        /positionCache|positionValues|futureValues|softRace|reserveCost|drawsLeft|inventory\(|monuments\(/.test(
          n,
        )
      )
        return "evaluation";
      if (/observation\(|listKey\(|appendInt\(|actionKey\(/.test(n))
        return "observation-and-keys";
      if (/auctionPlan/.test(n)) return "auction-plan";
      if (
        /policyAction|godChoices|bestDiscard|collectInto|collectionAfter|candidates\(/.test(
          n,
        )
      )
        return "other-policy";
      if (
        /^apply\(|resolveAuction|startAuction|endEpoch|finishTurn|settle\(|acquire\(|epochScores/.test(
          n,
        )
      )
        return "rules";
      if (/shuffle\(|Random::/.test(n)) return "sampling";
      if (/searchAction\(/.test(n)) return "search-and-other-inlined-work";
    }
    return frames.some((f) => f.url.startsWith("wasm:"))
      ? "other-wasm"
      : "js-and-profiler";
  };
  for (const id of profile.samples) {
    const frames: Frame[] = [];
    let current: number | undefined = id;
    while (current !== undefined) {
      const n = nodes.get(current)!;
      frames.push(n.callFrame);
      current = parents.get(current);
    }
    if (frames.some((f) => f.url.startsWith("wasm:"))) wasmSamples++;
    if (frames[0].url.startsWith("wasm:")) wasmSelfSamples++;
    const c = category(frames);
    categories.set(c, (categories.get(c) ?? 0) + 1);
    const seen = new Set<string>();
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const key = `${f.url}/${f.functionName}`;
      const row = functions.get(key) ?? {
        name: f.functionName,
        url: f.url,
        self: 0,
        inclusive: 0,
      };
      if (i === 0) row.self++;
      if (!seen.has(key)) row.inclusive++;
      functions.set(key, row);
      seen.add(key);
    }
  }
  const total = profile.samples.length;
  return {
    samples: total,
    wasmSamples,
    wasmSelfSamples,
    wasmSelfPercent: (100 * wasmSelfSamples) / total,
    wasmPercent: (100 * wasmSamples) / total,
    durationMs: (profile.endTime - profile.startTime) / 1000,
    categories: [...categories]
      .map(([name, hits]) => ({ name, hits, percent: (100 * hits) / total }))
      .sort((a, b) => b.hits - a.hits),
    functions: [...functions.values()]
      .map((f) => ({
        ...f,
        selfPercent: (100 * f.self) / total,
        inclusivePercent: (100 * f.inclusive) / total,
      }))
      .sort((a, b) => b.self - a.self),
  };
}
const session = new Session();
session.connect();
const post = (method: string, params = {}) =>
  new Promise<any>((resolve, reject) => {
    session.post(method, params, (error, result) =>
      error ? reject(error) : resolve(result),
    );
  });
await post("Profiler.enable");
await post("Profiler.setSamplingInterval", { interval: intervalUs });
const groups = [];
const profileRows = [];
try {
  for (const count of [2, 3, 4, 5])
    for (const phase of ["turn", "auction"]) {
      const selected = positions.filter(
        (p) => p.count === count && p.phase === phase,
      );
      await post("Profiler.start");
      for (let repeat = 0; repeat < repeats; repeat++)
        for (const p of selected) {
          const start = performance.now();
          const result = profiled.search(p.state, {
            ...options,
            ...(timeMs ? { timeMs } : {}),
          });
          const ms = performance.now() - start;
          if (!timeMs)
            assert.deepEqual(
              result,
              baseline.get(p.state),
              "Profile search differs from production",
            );
          profileRows.push({
            count,
            phase,
            epoch: p.epoch,
            repeat,
            ms,
            samples: result.samples,
            transitions: result.transitions,
          });
        }
      const { profile } = (await post("Profiler.stop")) as { profile: Profile };
      const path = join(output, `${count}p-${phase}.cpuprofile`);
      await writeFile(path, JSON.stringify(profile));
      const summary = summarize(profile);
      groups.push({ count, phase, path, ...summary });
      console.log(
        JSON.stringify({
          stage: "profiled",
          count,
          phase,
          samples: summary.samples,
          wasmPercent: summary.wasmPercent,
          top: summary.functions.slice(0, 6),
        }),
      );
    }
} finally {
  session.disconnect();
}
await verifyProtected();
const report = {
  createdAt: new Date().toISOString(),
  method:
    "V8 inspector CPU stack sampling of an O3 Wasm build with function names retained. Raw sample counts estimate CPU occupancy; no per-function clock instrumentation.",
  caveats: [
    study.status === "running"
      ? "This separate single-process workload runs alongside the untouched tournament; absolute timings are diagnostic, not isolated latency benchmarks."
      : "The tournament is complete. This separate profiling workload runs no tournament games; sampling overhead means timings are diagnostic, not unprofiled latency benchmarks.",
    "Optimized inlined callees are attributed to the surviving caller. Inclusive function percentages overlap and must not be added.",
    "Categories use the nearest recognized frame; allocation-and-memory includes recognizable allocator/memory routines, not all copying. Exact ownership of inlined work may require further isolated experiments.",
    "Positions are deterministic normal-policy mid-epoch public states, one turn and one auction per player count and epoch, rather than a frequency-weighted sample of the ongoing tournament.",
  ],
  compiler,
  flags,
  intervalUs,
  samplesPerRoot: samples,
  mode: timeMs ? "time" : "fixed",
  timeMs: timeMs ?? null,
  repeats,
  positions: positions.length,
  identicalExecutableSections,
  identicalFixedBudgetReports: true,
  protectedSourcesUnchanged: true,
  protectedAgainstRunningStudy: study.status === "running",
  productionSourceSha256: hash(await readFile("native/ra_ai.cpp")),
  productionWasmSha256: hash(productionBytes),
  profileWasmSha256: hash(profileBytes),
  protectedHashes,
  baselineRows,
  profileRows,
  groups,
};
await writeFile(
  join(output, "summary.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    stage: "complete",
    output,
    groups: groups.length,
    protectedSourcesUnchanged: true,
    identicalFixedBudgetReports: true,
  }),
);
