import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { MCCFR, evaluate, bestResponse, rng, pick } from "./cfr/core.ts";
import type { Policy, Game } from "./cfr/core.ts";
import { kuhn, miniRa } from "./cfr/games.ts";
import type { MiniState } from "./cfr/games.ts";
const output = resolve(process.argv[2] ?? "artifacts/ai-ra-cfr-20261029");
assert.ok(!existsSync(join(output, "plan.json")), "Use a new output directory");
await mkdir(output, { recursive: true });
const files = [
  "scripts/cfr/core.ts",
  "scripts/cfr/games.ts",
  "scripts/study-ra-cfr.ts",
  "tests/cfr.test.ts",
];
const hash = (x: string | Uint8Array) =>
  createHash("sha256").update(x).digest("hex");
const hashes = Object.fromEntries(
  await Promise.all(files.map(async (f) => [f, hash(await readFile(f))])),
);
const plan = {
  algorithm:
    "Importance-corrected external-sampling MCCFR, tabular regret matching, alternating player updates, full-support opponent proposal .9*sigma+.1*uniform; unweighted iterations and unbiased own-reach/sample-reach average strategy",
  trainingSeeds: [271, 811, 1459],
  checkpoints: [0, 1000, 5000, 20000],
  counts: [2, 3, 4, 5],
  evalGamesPerSeat: 500,
  evalSeedBase: 2300001,
  baselines: ["uniform", "greedy"],
  hashes,
  productionWasm: hash(await readFile("src/game/ai/ra-ai.wasm")),
  models: Object.fromEntries(
    await Promise.all(
      ["artifacts/ai-value-model.json", "artifacts/ai-rollout-model.json"].map(
        async (f) => [f, hash(await readFile(f))],
      ),
    ),
  ),
  scope:
    "Kuhn correctness and a separate Ra-inspired miniature. Fully public additive tile scores, 5 tiles, 2 disks/player, +2/-2 terminal disk-sum extrema, one epoch, maximum TWO auctions. No official Ra engine, collection scoring, hidden points, god/disasters choices or production MCTS comparison. No neural models. Multiplayer zero-total centered utilities do NOT imply Nash convergence.",
  primary:
    "Two-player exact NashConv=sum_i(BR_i-profileValue_i); multiplayer paired change in own centered-score utility against each baseline, comparing trained seat versus same-seat all-baseline control. Rank-score change auxiliary. Fixed player-count-specific starting disks; all candidate seats evaluated. Three training seeds descriptive, not confirmatory.",
  references: [
    "https://johanson.ca/publications/poker/2007-nips-cfr/2007-nips-cfr.pdf",
    "https://papers.neurips.cc/paper_files/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html",
    "https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/algorithms/external_sampling_mccfr.h",
  ],
};
await writeFile(
  join(output, "plan.json"),
  JSON.stringify(plan, null, 2) + "\n",
);
await mkdir(join(output, "source"));
for (const f of files)
  await cp(f, join(output, "source", f.replaceAll("/", "__")));
const uniform: Policy<MiniState> = (_s, a) => a.map(() => 1 / a.length);
function heuristic(g: Game<MiniState>): Policy<MiniState> {
  return (s, actions) => {
    let choice: string;
    if (s.phase === "turn") choice = s.pot >= 2 ? "invoke" : "draw";
    else {
      const base = g.utility(s)[s.current];
      let best = actions.includes("pass") ? base : -Infinity;
      choice = actions[0];
      if (actions.includes("pass")) choice = "pass";
      for (const a of actions)
        if (a !== "pass") {
          const c = structuredClone(s),
            i = s.current,
            sun = Number(a);
          c.scores[i] += c.pot;
          c.suns[i] = c.suns[i].filter((x) => x !== sun);
          c.used[i].push(c.center);
          c.center = sun;
          const value = g.utility(c)[i];
          if (value > best + 1e-9) {
            best = value;
            choice = a;
          }
        }
    }
    return actions.map((a) => Number(a === choice));
  };
}
function play(g: Game<MiniState>, policies: Policy<MiniState>[], seed: number) {
  let s = g.initial(),
    steps = 0;
  const chance = rng(seed),
    choices = policies.map((_, i) => rng(seed ^ ((i + 1) * 104729)));
  let known = 0,
    decisions = 0;
  while (g.actor(s) !== -2) {
    assert.ok(++steps < 100);
    const actor = g.actor(s);
    if (actor === -1) {
      const c = g.chance(s);
      s = g.next(
        s,
        c[
          pick(
            c.map((x) => x.probability),
            chance,
          )
        ].action,
      );
    } else {
      const a = g.actions(s),
        p = policies[actor](s, a);
      assert.equal(p.length, a.length);
      assert.ok(p.every((v) => v >= 0 && Number.isFinite(v)));
      assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-8);
      s = g.next(s, a[pick(p, choices[actor])]);
      decisions++;
    }
  }
  const u = g.utility(s),
    rank = u.map((v) => {
      const higher = u.filter((x) => x > v + 1e-9).length,
        ties = u.filter((x) => Math.abs(x - v) < 1e-9).length;
      return 1 - (higher + (ties - 1) / 2) / (g.players - 1);
    });
  return { utility: u, rank, steps, known, decisions };
}
const results: any[] = [];
const kuhnResults = [];
for (const seed of plan.trainingSeeds) {
  const c = new MCCFR(kuhn, seed);
  for (const t of plan.checkpoints) {
    c.train(t - c.iterations);
    const values = evaluate(kuhn, c.policy),
      br = [0, 1].map((i) => bestResponse(kuhn, c.policy, i).value);
    kuhnResults.push({
      seed,
      iterations: t,
      value: values[0],
      nashConv: br[0] + br[1],
    });
  }
}
await writeFile(
  join(output, "kuhn.json"),
  JSON.stringify(kuhnResults, null, 2) + "\n",
);
for (const count of plan.counts)
  for (const seed of plan.trainingSeeds) {
    const g = miniRa(count),
      c = new MCCFR(g, seed),
      started = performance.now(),
      checkpoints = [];
    for (const t of plan.checkpoints) {
      c.train(t - c.iterations);
      const exact =
        count === 2
          ? (() => {
              const values = evaluate(g, c.policy),
                br = [0, 1].map((i) => bestResponse(g, c.policy, i).value);
              return {
                values,
                bestResponses: br,
                nashConv: br.reduce((v, x, i) => v + x - values[i], 0),
              };
            })()
          : null;
      checkpoints.push({
        iterations: t,
        nodes: c.nodes,
        infosets: c.rows.size,
        ms: performance.now() - started,
        exact,
      });
      console.log(
        JSON.stringify({
          count,
          seed,
          iterations: t,
          infosets: c.rows.size,
          exact,
        }),
      );
    }
    for (const row of c.rows.values())
      assert.ok([...row.average, ...row.regrets].every(Number.isFinite));
    const matches = [];
    for (const baseline of plan.baselines) {
      const reference = baseline === "uniform" ? uniform : heuristic(g);
      for (let seat = 0; seat < count; seat++) {
        let delta = 0,
          rankDelta = 0,
          utility = 0,
          controlUtility = 0,
          rank = 0,
          covered = 0,
          decisions = 0;
        const records = [];
        const trained: Policy<MiniState> = (s, a) => {
          decisions++;
          if (c.rows.has(g.info(s, g.actor(s)))) covered++;
          return c.policy(s, a);
        };
        for (let j = 0; j < plan.evalGamesPerSeat; j++) {
          const trialSeed = plan.evalSeedBase + count * 10000 + seat * 1000 + j;
          const p = Array.from({ length: count }, (_, i) =>
            i === seat ? trained : reference,
          );
          const actual = play(g, p, trialSeed),
            control = play(g, Array(count).fill(reference), trialSeed);
          const d = actual.utility[seat] - control.utility[seat],
            rd = actual.rank[seat] - control.rank[seat];
          delta += d;
          rankDelta += rd;
          utility += actual.utility[seat];
          controlUtility += control.utility[seat];
          rank += actual.rank[seat];
          records.push([
            trialSeed,
            actual.utility[seat],
            control.utility[seat],
            actual.rank[seat],
            control.rank[seat],
          ]);
        }
        matches.push({
          baseline,
          seat,
          games: plan.evalGamesPerSeat,
          meanUtility: utility / plan.evalGamesPerSeat,
          controlUtility: controlUtility / plan.evalGamesPerSeat,
          utilityDelta: delta / plan.evalGamesPerSeat,
          rankScore: rank / plan.evalGamesPerSeat,
          rankDelta: rankDelta / plan.evalGamesPerSeat,
          covered,
          decisions,
          records,
        });
      }
    }
    const row = { count, seed, checkpoints, matches };
    results.push(row);
    await writeFile(
      join(output, `count${count}-seed${seed}.json`),
      JSON.stringify(row) + "\n",
    );
    // A deployment-sized policy snapshot is deliberately not exported: this is
    // an isolated toy-game experiment, not a production artifact.
    c.rows.clear();
    (globalThis as any).gc?.();
  }
const summary = plan.counts.flatMap((count) =>
  plan.baselines.map((baseline) => {
    const rows = results
      .filter((x) => x.count === count)
      .flatMap((x) => x.matches.filter((m: any) => m.baseline === baseline));
    const mean = (key: string) =>
      rows.reduce((s: number, x: any) => s + x[key], 0) / rows.length;
    return {
      count,
      baseline,
      trainingSeeds: plan.trainingSeeds.length,
      games: rows.length * plan.evalGamesPerSeat,
      utilityDelta: mean("utilityDelta"),
      rankDelta: mean("rankDelta"),
      rankScore: mean("rankScore"),
      coverage:
        rows.reduce((s: number, x: any) => s + x.covered, 0) /
        rows.reduce((s: number, x: any) => s + x.decisions, 0),
    };
  }),
);
for (const f of files) assert.equal(hash(await readFile(f)), hashes[f]);
assert.equal(
  hash(await readFile("src/game/ai/ra-ai.wasm")),
  plan.productionWasm,
);
for (const [f, h] of Object.entries(plan.models))
  assert.equal(hash(await readFile(f)), h);
await writeFile(
  join(output, "summary.json"),
  JSON.stringify(
    {
      scope: plan.scope,
      kuhn: kuhnResults,
      summary,
      exactTwoPlayer: results
        .filter((x) => x.count === 2)
        .map((x) => ({ seed: x.seed, checkpoints: x.checkpoints })),
      sourceAndProductionHashesVerified: true,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
