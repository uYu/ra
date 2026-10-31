import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { miniRa } from "./cfr/games.ts";
const dir = resolve(process.argv[2] ?? "artifacts/ai-ra-cfr-20261029");
const read = async (name: string) =>
  JSON.parse(await readFile(join(dir, name), "utf8"));
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const p = await read("plan.json"),
  summary = await read("summary.json");
for (const [f, h] of Object.entries(p.hashes)) {
  assert.equal(hash(await readFile(f)), h);
  assert.equal(
    hash(await readFile(join(dir, "source", f.replaceAll("/", "__")))),
    h,
  );
}
assert.equal(hash(await readFile("src/game/ai/ra-ai.wasm")), p.productionWasm);
for (const [f, h] of Object.entries(p.models))
  assert.equal(hash(await readFile(f)), h);
const g = miniRa(2);
let oracleNodes = 0;
function oracle(s = g.initial()): number {
  oracleNodes++;
  const actor = g.actor(s);
  if (actor === -2) return g.utility(s)[0];
  if (actor === -1)
    return g
      .chance(s)
      .reduce((v, c) => v + c.probability * oracle(g.next(s, c.action)), 0);
  const values = g.actions(s).map((a) => oracle(g.next(s, a)));
  return actor === 0 ? Math.max(...values) : Math.min(...values);
}
const exactValue = oracle(),
  rows = [];
let pairs = 0;
for (const count of p.counts)
  for (const seed of p.trainingSeeds) {
    const r = await read(`count${count}-seed${seed}.json`);
    assert.equal(r.count, count);
    assert.equal(r.seed, seed);
    assert.deepEqual(
      r.checkpoints.map((c: any) => c.iterations),
      p.checkpoints,
    );
    if (count === 2)
      for (const c of r.checkpoints) {
        assert.ok(c.exact.bestResponses[0] >= exactValue - 1e-10);
        assert.ok(-c.exact.bestResponses[1] <= exactValue + 1e-10);
        assert.ok(
          Math.abs(c.exact.values.reduce((a: number, b: number) => a + b, 0)) <
            1e-10,
        );
        assert.ok(
          Math.abs(
            c.exact.nashConv -
              c.exact.bestResponses[0] -
              c.exact.bestResponses[1],
          ) < 1e-10,
        );
      }
    for (const baseline of p.baselines)
      for (let seat = 0; seat < count; seat++) {
        const m = r.matches.find(
          (x: any) => x.baseline === baseline && x.seat === seat,
        );
        assert.ok(m);
        assert.equal(m.records.length, p.evalGamesPerSeat);
        let d = 0,
          rd = 0,
          u = 0,
          cu = 0,
          rank = 0;
        for (let j = 0; j < m.records.length; j++) {
          const [trial, a, b, c, e] = m.records[j];
          assert.equal(trial, p.evalSeedBase + count * 10000 + seat * 1000 + j);
          assert.ok([a, b, c, e].every(Number.isFinite));
          assert.ok(c >= 0 && c <= 1 && e >= 0 && e <= 1);
          d += a - b;
          rd += c - e;
          u += a;
          cu += b;
          rank += c;
        }
        for (const [k, v] of Object.entries({
          utilityDelta: d / m.games,
          rankDelta: rd / m.games,
          meanUtility: u / m.games,
          controlUtility: cu / m.games,
          rankScore: rank / m.games,
        }))
          assert.ok(Math.abs(m[k] - v) < 1e-10, k);
        pairs += m.records.length;
        rows.push({ count, seed, ...m });
      }
  }
for (const result of summary.summary) {
  const selected = rows.filter(
    (x) => x.count === result.count && x.baseline === result.baseline,
  );
  for (const k of ["utilityDelta", "rankDelta", "rankScore"])
    assert.ok(
      Math.abs(
        result[k] - selected.reduce((s, x) => s + x[k], 0) / selected.length,
      ) < 1e-10,
    );
}
for (const c of summary.kuhn) {
  assert.ok(c.nashConv >= -1e-10);
}
const qa = {
  verified: true,
  sourceHashes: true,
  productionWasmAndModelsUnchanged: true,
  trainingRuns: p.counts.length * p.trainingSeeds.length,
  pairedEvaluationGames: pairs,
  individualEvaluationGames: pairs * 2,
  miniTwoPlayerExactMinimaxValue: exactValue,
  oracleNodes,
  kuhnExactValue: -1 / 18,
  scope: summary.scope,
  limitations: [
    "Independent metric/hash verification; official Ra engine is not involved.",
    "Two-auction cap and public additive scores materially simplify Ra.",
    "No comparison with production UCT or equal end-to-end training budget.",
    "Three training seeds; descriptive results only.",
  ],
};
await writeFile(join(dir, "verified.json"), JSON.stringify(qa, null, 2) + "\n");
console.log(JSON.stringify(qa, null, 2));
