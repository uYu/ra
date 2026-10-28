import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { ranking } from "../src/game/engine.ts";
import { replay } from "../src/game/storage.ts";
import type { Trace } from "./lib/decision-trace.ts";

type Game = {
  count: number;
  seed: number;
  seat: number;
  rank: number;
  score: number;
  margin: number;
  steps: number;
  replayPath: string;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function interval95(blocks: number[]) {
  let state = 0x5a17c02;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const draws = Array.from({ length: 100000 }, () =>
    mean(blocks.map(() => blocks[Math.floor(next() * blocks.length)])),
  ).sort((a, b) => a - b);
  return [draws[2500], draws[97500]];
}
assert.deepEqual(interval95([0.5, 0.5]), [0.5, 0.5]);
const input = process.argv[2];
if (!input)
  throw new Error("Usage: summarize-budget.ts RESULT.json [SUMMARY.json]");
const output = process.argv[3] ?? input.replace(/\.json$/, "-summary.json");
assert.notEqual(output, input);
const raw = JSON.parse(await readFile(input, "utf8"));
assert.equal(
  raw.status,
  "complete",
  "Incomplete runs cannot produce a final report",
);
const { config, seeds, start, counts } = raw.identity;
assert.equal(config.engine, "current");
assert.equal(config.reward, "relative");
assert.equal(config.opponentVariant, "uct");
assert.equal(config.samples, 32);
assert.equal(config.opponentFixed, true);
assert.equal(config.valueModel, undefined);
assert.equal(config.rolloutModel, undefined);
assert.ok(config.timeMs >= 1 && config.timeMs <= 2000);
assert.deepEqual(raw.identity.variants, ["uct"]);
assert.deepEqual(raw.identity.modes, ["time"]);
assert.equal(
  raw.plannedGames,
  seeds * counts.reduce((a: number, b: number) => a + b, 0),
);
assert.equal(raw.finishedGames, raw.plannedGames);
const games: Game[] = raw.games;
assert.equal(games.length, raw.plannedGames);
const score = (g: Game) => (g.count - g.rank) / (g.count - 1);
const timings: Record<
  string,
  {
    ms: number[];
    samples: number;
    transitions: number;
    nodes: number;
    depth: number;
    truncated: number;
  }
> = {};
const seen = new Set<string>();
let decisions = 0;
for (const g of games) {
  assert.ok(counts.includes(g.count));
  assert.ok(g.seed >= start && g.seed < start + seeds);
  assert.ok(Number.isInteger(g.seat) && g.seat >= 0 && g.seat < g.count);
  const key = `${g.seed}/${g.count}/${g.seat}`;
  assert.ok(!seen.has(key), `Duplicate ${key}`);
  seen.add(key);
  const trace: Trace = JSON.parse(await readFile(g.replayPath, "utf8"));
  assert.equal(trace.actions.length, g.steps);
  assert.equal(trace.audit.decisions.length, g.steps);
  assert.equal(trace.config.seed, g.seed);
  assert.equal(trace.config.count, g.count);
  assert.equal(trace.audit.metadata.timeMs, config.timeMs);
  assert.equal(trace.audit.metadata.opponentFixed, true);
  const build = trace.audit.metadata.build as {
    sourceSha256: string;
    wasmSha256: string;
  };
  assert.equal(build.sourceSha256, raw.identity.sourceSha256);
  assert.equal(build.wasmSha256, raw.identity.wasmSha256);
  assert.equal(
    createHash("sha256").update(JSON.stringify(trace.actions)).digest("hex"),
    trace.audit.actionsSha256,
  );
  const final = replay(trace);
  assert.equal(final.phase, "over");
  assert.deepEqual(final.history, trace.audit.history);
  assert.deepEqual(ranking(final), trace.audit.ranking);
  assert.equal(
    ranking(final).findIndex((p) => p.player === g.seat) + 1,
    g.rank,
  );
  assert.equal(final.players[g.seat].score, g.score);
  assert.equal(
    final.players[g.seat].score -
      Math.max(
        ...final.players.filter((_, i) => i !== g.seat).map((p) => p.score),
      ),
    g.margin,
  );
  trace.audit.decisions.forEach((d, i) => {
    assert.equal(d.step, i + 1);
    assert.deepEqual(d.report.action, trace.actions[i]);
    if (!d.report.samples) return;
    const candidate = d.player === g.seat;
    assert.ok(d.report.candidates.every((c) => c.visits >= 1));
    assert.equal(
      d.report.candidates.reduce((n, c) => n + c.visits, 0),
      d.report.samples,
    );
    if (candidate) {
      assert.ok(
        d.elapsedMs >= config.timeMs * 0.95,
        `Budget was not spent in ${key}/${d.step}`,
      );
      assert.ok(d.report.samples < 1_000_000, "Iteration safety cap reached");
    } else assert.equal(d.report.samples, 32 * d.report.candidates.length);
    for (const suffix of ["all", d.phase]) {
      const k = `${candidate ? "candidate" : "opponent"}/${suffix}`;
      const row = (timings[k] ??= {
        ms: [],
        samples: 0,
        transitions: 0,
        nodes: 0,
        depth: 0,
        truncated: 0,
      });
      row.ms.push(d.elapsedMs);
      row.samples += d.report.samples;
      row.transitions += d.report.transitions;
      row.nodes += d.report.nodes;
      row.depth += d.report.depth;
      row.truncated += d.report.truncated;
    }
  });
  decisions += g.steps;
}
const blocks = Array.from({ length: seeds }, (_, i) => {
  const seed = start + i;
  const byCount = counts.map((count: number) => {
    const rows = games.filter((g) => g.seed === seed && g.count === count);
    assert.deepEqual(
      rows.map((g) => g.seat).sort((a, b) => a - b),
      Array.from({ length: count }, (_, j) => j),
    );
    return { count, score: mean(rows.map(score)) };
  });
  return {
    seed,
    score: mean(byCount.map((r: { score: number }) => r.score)),
    byCount,
  };
});
const summary = {
  status: "complete",
  input,
  identity: raw.identity,
  games: games.length,
  seedBlocks: seeds,
  replayCount: games.length,
  decisions,
  primary:
    "Player counts weighted equally; normalized rank score (players-rank)/(players-1); 50% equal-strength reference",
  normalizedRankScore: mean(blocks.map((b) => b.score)),
  interval95: interval95(blocks.map((b) => b.score)),
  byCount: counts.map((count: number) => {
    const rows = games.filter((g) => g.count === count);
    return {
      count,
      games: rows.length,
      meanRank: mean(rows.map((g) => g.rank)),
      referenceMeanRank: (count + 1) / 2,
      normalizedRankScore: mean(rows.map(score)),
      interval95: interval95(
        blocks.map(
          (b) =>
            b.byCount.find((r: { count: number }) => r.count === count)!.score,
        ),
      ),
      firstPlaces: rows.filter((g) => g.rank === 1).length,
      referenceFirstPlaces: rows.length / count,
      meanMargin: mean(rows.map((g) => g.margin)),
    };
  }),
  blocks,
  timing: Object.entries(timings).map(([sidePhase, r]) => {
    const sorted = [...r.ms].sort((a, b) => a - b);
    return {
      sidePhase,
      searched: sorted.length,
      meanMs: mean(sorted),
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      maxMs: sorted.at(-1),
      meanSamples: r.samples / sorted.length,
      meanTransitions: r.transitions / sorted.length,
      meanNodes: r.nodes / sorted.length,
      meanDepth: r.depth / sorted.length,
      truncated: r.truncated,
    };
  }),
  caveat:
    "Bootstrap resamples entire seed blocks. Six seeds give a preliminary diagnostic with limited power for small gains. Parallel timings and simulation ratios compare different encountered positions, not pure serial speed. An interval including 50% does not establish equivalence or prove a directional error.",
};
await writeFile(output, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
