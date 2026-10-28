import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { observe } from "../src/game/ai.ts";
import { legalActions } from "../src/game/engine.ts";
import type { State } from "../src/game/types.ts";
import type { SearchReport } from "../src/game/ai/search.ts";

const output = resolve(
  process.argv[2] ?? "artifacts/ai-opponent-tree-20261028",
);
const release = process.argv[3] === "release";
await mkdir(output, { recursive: true });
const source = await readFile("native/ra_ai.cpp", "utf8");
const manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
const sha = (x: string | Uint8Array) =>
  createHash("sha256").update(x).digest("hex");
assert.equal(sha(source), manifest.sourceSha256);
assert.equal(sha(await readFile(manifest.target)), manifest.wasmSha256);
let prototype = source;
function replaceOnce(before: string, after: string) {
  assert.equal(prototype.split(before).length - 1, 1, before);
  prototype = prototype.replace(before, after);
}
const support = `int diagnosticOpponentTree=0;
std::array<uint64_t,20>diagnosticTreeStats{};
extern "C" void set_opponent_tree(int mode){if(mode<0||mode>3)__builtin_trap();diagnosticOpponentTree=mode;}
extern "C" uint64_t*tree_stats(){return diagnosticTreeStats.data();}
double actorUct(const Edge&e,int actor,int parentVisits,bool preferred) {
  return e.utilities[actor]/e.visits+1.4*std::sqrt(std::log(parentVisits+1.0)/e.visits)+(preferred?0.8/(e.visits+1):0);
}
std::string treeObservation(const State&s,int observer,bool dpw) {
  auto key=observation(s,observer,dpw||diagnosticOpponentTree>0);
  // These are simulated public gains from a normalized 100 start, never
  // the real hidden scores: searchAction rebases every player's total.
  if(diagnosticOpponentTree>0)for(int i=0;i<s.n;i++)appendInt(key,s.players[i].score-100);
  return key;
}
extern "C" int check_actor_utilities() {
  Edge a,b;a.visits=b.visits=100;
  a.utilities={80,-20,0,0,0};b.utilities={-10,70,0,0,0};
  if(!(actorUct(a,0,200,false)>actorUct(b,0,200,false)))return -1;
  if(!(actorUct(a,1,200,false)<actorUct(b,1,200,false)))return -2;
  a.utilities={-80,20,90,0,0};b.utilities={70,80,10,0,0};
  // Player 1 prefers B even though it also benefits the root player:
  // opponents maximize their own utility, rather than forming a coalition.
  if(!(actorUct(a,1,200,false)<actorUct(b,1,200,false)))return -3;
  if(!(actorUct(a,2,200,false)>actorUct(b,2,200,false)))return -4;
  return 4;
}
`;
replaceOnce("Report searchAction(", support + "Report searchAction(");
replaceOnce(
  "  Report report;",
  "  Report report;\n  diagnosticTreeStats.fill(0);",
);
replaceOnce(
  "      auto actions=branch==&root?rootActions:candidates(next);",
  `      diagnosticTreeStats[next.current]++;
      if(next.phase==Auction)diagnosticTreeStats[5+next.current]++;
      auto actions=branch==&root?rootActions:candidates(next);`,
);
replaceOnce(
  "          double uct=e->utilities[next.current]/e->visits+1.4*std::sqrt(std::log(branch->visits+1.0)/e->visits)+(keys[i]==branch->preferred?0.8/(e->visits+1):0);",
  "          double uct=actorUct(*e,next.current,branch->visits,keys[i]==branch->preferred);",
);
replaceOnce(
  "      if(choice<0) {\n        double best=-INF;",
  "      if(choice<0) {\n        diagnosticTreeStats[10+next.current]++;\n        double best=-INF;",
);
replaceOnce(
  "      while(!finished(next)&&next.current!=s.current&&steps<240) {",
  `      while(!finished(next)&&next.current!=s.current&&steps<240&&
        (diagnosticOpponentTree==0||diagnosticOpponentTree==3||(diagnosticOpponentTree==1&&next.phase!=Auction))) {`,
);
replaceOnce(
  "      auto observed=observation(next,s.current,variant==2);",
  "      auto observed=treeObservation(next,s.current,variant==2);",
);
assert.equal(
  prototype.split("        apply(next,plan.actions[j]);").length - 1,
  2,
);
prototype = prototype.replaceAll(
  "        apply(next,plan.actions[j]);",
  "        diagnosticTreeStats[15+next.current]++;\n        apply(next,plan.actions[j]);",
);
const cpp = join(output, "opponent-tree.cpp"),
  wasm = join(output, "opponent-tree.wasm");
await writeFile(cpp, prototype);
const flags = manifest.flags.filter(
  (f: string) => !f.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run","_set_opponent_tree","_tree_stats","_check_actor_utilities"]',
);
if (!release) flags.push("-fsanitize=undefined", "-fsanitize-trap=undefined");
const compiled = spawnSync(
  process.env.EMXX ?? "em++",
  [cpp, ...flags, "-o", wasm],
  { env: process.env, stdio: "inherit" },
);
assert.equal(compiled.status, 0, "Prototype compilation failed");
const experiment = await createWasmAi(await readFile(wasm));
const native = (
  experiment as unknown as {
    native: {
      memory: WebAssembly.Memory;
      set_opponent_tree(n: number): void;
      tree_stats(): number;
      check_actor_utilities(): number;
    };
  }
).native;
assert.equal(native.check_actor_utilities(), 4);
const stats = () => {
  const values = Array.from(
    new BigUint64Array(native.memory.buffer, native.tree_stats(), 20),
    Number,
  );
  return {
    treeByActor: values.slice(0, 5),
    auctionByActor: values.slice(5, 10),
    uctByActor: values.slice(10, 15),
    policyByActor: values.slice(15, 20),
  };
};
await cp("src/game", join(output, "reference/game"), { recursive: true });
const tsPath = join(output, "reference/game/ai/search.ts");
let ts = await readFile(tsPath, "utf8");
const tsReplace = (before: string, after: string) => {
  assert.equal(ts.split(before).length - 1, 1, before);
  ts = ts.replace(before, after);
};
tsReplace(
  "export type SearchOptions = {",
  "export type SearchOptions = {\n  opponentTree?: 0 | 1 | 2 | 3;",
);
tsReplace(
  '  const reward = options.reward ?? "relative";',
  '  const opponentTree=options.opponentTree??0;\n  const reward = options.reward ?? "relative";',
);
tsReplace(
  "      while (!finished(next) && next.current !== s.current && steps < 240) {",
  `      while (!finished(next) && next.current !== s.current && steps < 240 &&
        (opponentTree===0||opponentTree===3||(opponentTree===1&&next.phase!=="auction"))) {`,
);
tsReplace(
  'variant === "dpw"\n          ? [next.resume, next.next, next.auction?.order, next.auction?.bids]',
  'variant === "dpw" || opponentTree>0\n          ? [next.resume, next.next, next.auction?.order, next.auction?.bids]',
);
tsReplace(
  "      let child = edge.outcomes.get(observed);",
  `      const treeKey=opponentTree>0?observed+JSON.stringify(next.players.map(p=>p.score-100)):observed;
      let child = edge.outcomes.get(treeKey);`,
);
tsReplace(
  "        edge.outcomes.set(observed, child);",
  "        edge.outcomes.set(treeKey, child);",
);
// Particle keys use the same complete information-set partition as outcomes.
tsReplace(
  "const old = edge.particles.find((p) => p.key === observed);",
  "const old = edge.particles.find((p) => p.key === treeKey);",
);
tsReplace("          key: observed,", "          key: treeKey,");
await writeFile(tsPath, ts);
const reference = await import(pathToFileURL(tsPath).href);
const production = await createWasmAi(await readFile(manifest.target));
const positions: {
  count: number;
  epoch: number;
  phase: string;
  state: State;
}[] = JSON.parse(
  await readFile("artifacts/ai-perf-20261028/positions.json", "utf8"),
);
function equivalent(a: SearchReport, b: SearchReport, label: string) {
  const x = structuredClone(a),
    y = structuredClone(b);
  for (let i = 0; i < x.candidates.length; i++)
    for (const k of ["value", "error"] as const) {
      assert.ok(
        Math.abs(x.candidates[i][k] - y.candidates[i][k]) < 1e-8,
        label + "/" + k,
      );
      x.candidates[i][k] = 0;
      y.candidates[i][k] = 0;
    }
  assert.deepEqual(x, y, label);
}
let legacyChecks = 0,
  referenceChecks = 0,
  privacyChecks = 0;
const actorCoverage: any[] = [];
for (const mode of [0, 3, 1, 2]) {
  native.set_opponent_tree(mode);
  for (const p of positions)
    for (const variant of ["uct", "sh", "dpw"] as const)
      for (const horizon of ["epoch", "next-epoch", "game"] as const) {
        const options = { samples: 2, variant, horizon };
        const actual = experiment.search(p.state, options),
          coverage = stats();
        assert.ok(
          legalActions(p.state).some(
            (a) => JSON.stringify(a) === JSON.stringify(actual.action),
          ),
        );
        if (mode === 0) {
          assert.deepEqual(actual, production.search(p.state, options));
          legacyChecks++;
        }
        const expected = reference.searchAction(observe(p.state), {
          ...options,
          opponentTree: mode,
        });
        equivalent(
          actual,
          expected,
          `${mode}/${p.count}/${p.epoch}/${p.phase}/${variant}/${horizon}`,
        );
        referenceChecks++;
        if (variant === "uct" && horizon === "epoch")
          actorCoverage.push({
            mode,
            count: p.count,
            epoch: p.epoch,
            phase: p.phase,
            observer: p.state.current,
            ...coverage,
          });
      }
  for (const p of positions.filter(
    (p) => p.epoch === 2 && p.phase === "auction",
  )) {
    const a = experiment.search(p.state, { samples: 8 }),
      changed = structuredClone(p.state);
    changed.bag.reverse();
    changed.config.seed = 123456789;
    changed.players.forEach((p, i) => {
      p.score += 111 * (i + 1);
    });
    assert.deepEqual(experiment.search(changed, { samples: 8 }), a);
    privacyChecks++;
  }
}
for (const count of [2, 3, 4, 5]) {
  const selected = positions.find(
    (p) => p.count === count && p.epoch === 2 && p.phase === "auction",
  )!;
  native.set_opponent_tree(0);
  const old = experiment.search(selected.state, { samples: 64 }),
    legacy = stats();
  assert.equal(
    legacy.treeByActor.reduce(
      (s, n, i) => s + (i === selected.state.current ? 0 : n),
      0,
    ),
    0,
  );
  for (const mode of [1, 2]) {
    native.set_opponent_tree(mode);
    experiment.search(selected.state, { samples: 64 });
    const actual = stats();
    assert.ok(
      actual.auctionByActor.some(
        (n, i) => i !== selected.state.current && n > 0,
      ),
      "Opponent bids must enter the tree",
    );
    assert.ok(
      actual.uctByActor.some((n, i) => i !== selected.state.current && n > 0),
      "Opponent UCT choices must be revisited",
    );
    actorCoverage.push({
      mode,
      count,
      observer: selected.state.current,
      samplesPerRoot: 64,
      ...actual,
    });
  }
  native.set_opponent_tree(0);
  assert.deepEqual(experiment.search(selected.state, { samples: 64 }), old);
}
const oracle = JSON.parse(
  await readFile(
    "artifacts/ai-endgame-oracle-legal-deck-20261028.json",
    "utf8",
  ),
);
const quality: any[] = [];
const catalog = new Map(
  oracle.results
    .flatMap((r: any) => [
      ...r.state.bag,
      ...r.state.market,
      ...r.state.discarded,
      ...r.state.players.flatMap((p: any) => p.tiles),
    ])
    .map((t: any) => [t.id, t]),
);
const tileKey = (id: number) => {
  const t: any = catalog.get(id);
  return `${t.kind}/${t.variant}`;
};
const key = (a: any) =>
  a.type === "god"
    ? `g/${tileKey(a.tileId)}`
    : a.type === "discard"
      ? `d/${a.ids.map(tileKey).sort().join("|")}`
      : JSON.stringify(a);
for (const mode of [0, 3, 1, 2])
  for (const samples of [32, 128]) {
    native.set_opponent_tree(mode);
    for (const p of oracle.results) {
      const r = experiment.search(p.state, { samples }),
        loss: any = {};
      for (const objective of ["margin", "win"]) {
        const v = p.objectives[objective];
        const chosen = v.actions.find(
          (x: any) => key(x.action) === key(r.action),
        );
        assert.ok(chosen);
        loss[objective] = v.best - chosen.value;
      }
      quality.push({ mode, samples, index: p.index, action: r.action, loss });
    }
  }
native.set_opponent_tree(1);
const timeStarted = performance.now();
const timed = experiment.search(
  positions.find((p) => p.count === 3 && p.phase === "auction")!.state,
  { timeMs: 2000 },
);
const timeElapsed = performance.now() - timeStarted;
assert.ok(
  timeElapsed >= 1900 && timeElapsed < 10000,
  "Two-second prototype budget",
);
assert.ok(timed.samples > 0 && timed.samples < 1_000_000);
const timeCoverage = stats();
assert.ok(
  timeCoverage.auctionByActor.some(
    (n, i) =>
      i !==
        positions.find((p) => p.count === 3 && p.phase === "auction")!.state
          .current && n > 0,
  ),
);
assert.equal(sha(await readFile(manifest.source)), manifest.sourceSha256);
assert.equal(sha(await readFile(manifest.target)), manifest.wasmSha256);
const qualitySummary = [0, 3, 1, 2].flatMap((mode) =>
  [32, 128].map((samples) => {
    const rows = quality.filter(
      (r) => r.mode === mode && r.samples === samples,
    );
    return {
      mode,
      samples,
      cases: rows.length,
      marginRegretCases: rows.filter((r) => r.loss.margin > 1e-8).length,
      winRegretCases: rows.filter((r) => r.loss.win > 1e-8).length,
      totalMarginRegret: rows.reduce((s, r) => s + r.loss.margin, 0),
      totalWinRegret: rows.reduce((s, r) => s + r.loss.win, 0),
    };
  }),
);
const report = {
  createdAt: new Date().toISOString(),
  modes: {
    0: "legacy observer-only tree",
    1: "opponent auction nodes in tree",
    2: "all actors in tree",
    3: "observer-only tree with complete-key control",
  },
  sourceSha256: manifest.sourceSha256,
  productionWasmSha256: manifest.wasmSha256,
  prototypeSourceSha256: sha(prototype),
  prototypeWasmSha256: sha(await readFile(wasm)),
  sanitizer: release ? "none (O3 release)" : "undefined behavior traps",
  flags,
  actorUtilityChecks: 4,
  legacyChecks,
  referenceChecks,
  privacyChecks,
  actorCoverage,
  qualitySummary,
  quality,
  timed: {
    samples: timed.samples,
    elapsedMs: timeElapsed,
    actorCoverage: timeCoverage,
  },
  productionFilesUnchanged: true,
  noTournamentGames: true,
  caveats: [
    "This is an isolated algorithm prototype, not a verified playing-strength improvement.",
    "The 20 synthetic final-epoch fixtures are narrow and only two restrict discard candidates; hidden score and multi-player quality are not established.",
    "Tree nodes use the acting player's own utility. Leaf rollouts remain policy-based; a complete-information key adds only simulated public score deltas, never true hidden totals.",
    "Instrumentation and sanitizer overhead make this unsuitable as a production throughput benchmark.",
  ],
};
await writeFile(
  join(output, "summary.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { legacyChecks, referenceChecks, privacyChecks, qualitySummary },
    null,
    2,
  ),
);
