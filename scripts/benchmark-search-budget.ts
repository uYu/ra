import { readFile, writeFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { newGame, advance, ranking, simulate } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { policyAction, candidateActions } from "../src/game/ai/policy.ts";
import { searchAction } from "../src/game/ai/search.ts";
import type { State } from "../src/game/types.ts";
const ai = await createWasmAi(
  await readFile(new URL("../src/game/ai/ra-ai.wasm", import.meta.url)),
);
const candidateSamples = 96,
  opponentSamples = 32;
const started = performance.now();

// Measure actual TS32 vs Wasm96 cost on the same 24 public positions. 96 is
// conservative relative to the previously measured 3.25x speedup. It is NOT
// a hard per-decision time limit; record the observed cost instead of assuming it.
const positions: State[] = [];
for (const count of [2, 3, 4, 5]) {
  let s = newGame({
    count,
    humans: 0,
    difficulty: "normal",
    seed: 9500 + count,
  });
  const epochs = [0, 0, 0];
  while (s.phase !== "over" && s.steps < 1500) {
    if (
      s.steps % 7 === 0 &&
      epochs[s.epoch - 1] < 2 &&
      candidateActions(s).length > 1
    ) {
      positions.push(s);
      epochs[s.epoch - 1]++;
    }
    s = simulate(s, policyAction(s));
  }
}
searchAction(observe(positions[0]), { samples: 4 });
ai.search(positions[0], { samples: 4 });
const costs = [];
for (let i = 0; i < positions.length; i++)
  for (const backend of i % 2 ? ["ts32", "wasm96"] : ["wasm96", "ts32"]) {
    const s = positions[i],
      t = performance.now();
    const report =
      backend === "ts32"
        ? searchAction(observe(s), { samples: 32 })
        : ai.search(s, { samples: 96 });
    costs.push({
      backend,
      position: i,
      count: s.config.count,
      epoch: s.epoch,
      phase: s.phase,
      ms: performance.now() - t,
      samples: report.samples,
      action: report.action,
    });
  }
const costSummary = ["ts32", "wasm96"].map((backend) => {
  const rows = costs.filter((r) => r.backend === backend),
    times = rows.map((r) => r.ms).sort((a, b) => a - b);
  return {
    backend,
    totalMs: times.reduce((a, b) => a + b, 0),
    medianMs: times[Math.floor(times.length / 2)],
    p95Ms: times[Math.floor(times.length * 0.95)],
    simulations: rows.reduce((n, r) => n + r.samples, 0),
  };
});
console.log(JSON.stringify({ costSummary }, null, 2));

// Isolate SEARCH-BUDGET strength: both sides run the SAME compiled algorithm.
// Wasm32 represents the existing algorithm at 32; its agreement with TS32 is
// checked separately. This avoids making the other players needlessly slow.
// These games do NOT constitute a strict equal-wall-time TS-vs-Wasm tournament.
const games = [];
for (const count of [3, 5])
  for (const seed of [10401, 10402])
    for (let seat = 0; seat < count; seat++) {
      let s = newGame({ count, humans: 0, difficulty: "hard", seed });
      let candidateMs = 0,
        opponentMs = 0,
        candidateDecisions = 0,
        opponentDecisions = 0;
      while (s.phase !== "over" && s.steps < 1600) {
        const candidate = s.current === seat,
          t = performance.now();
        const report = ai.search(s, {
          samples: candidate ? candidateSamples : opponentSamples,
        });
        const elapsed = performance.now() - t;
        if (candidate) {
          candidateMs += elapsed;
          candidateDecisions++;
        } else {
          opponentMs += elapsed;
          opponentDecisions++;
        }
        s = advance(s, report.action);
      }
      if (s.phase !== "over")
        throw new Error(`unfinished ${count}/${seed}/${seat}`);
      const row = {
        count,
        seed,
        seat,
        rank: ranking(s).findIndex((r) => r.player === seat) + 1,
        score: s.players[seat].score,
        margin:
          s.players[seat].score -
          Math.max(
            ...s.players.filter((_, i) => i !== seat).map((p) => p.score),
          ),
        steps: s.steps,
        candidateMs,
        opponentMs,
        candidateDecisions,
        opponentDecisions,
      };
      games.push(row);
      console.log(JSON.stringify(row));
    }
const summary = [3, 5].map((count) => {
  const rows = games.filter((g) => g.count === count);
  return {
    count,
    games: rows.length,
    wins: rows.filter((g) => g.rank === 1).length,
    winRate: rows.filter((g) => g.rank === 1).length / rows.length,
    chance: 1 / count,
    margin: rows.reduce((v, g) => v + g.margin, 0) / rows.length,
  };
});
const report = {
  candidateSamples,
  opponentSamples,
  seeds: [10401, 10402],
  allSeats: true,
  costSummary,
  summary,
  games,
  costs,
  seconds: (performance.now() - started) / 1000,
  caveat:
    "Both tournament sides use the same Wasm core at different sample budgets; not a strict equal-wall-time TS-vs-Wasm tournament.",
};
console.log(
  JSON.stringify({ ...report, games: undefined, costs: undefined }, null, 2),
);
if (process.argv[2])
  await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n");
