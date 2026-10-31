import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { legalActions, simulate } from "../src/game/engine.ts";
import { makeTiles } from "../src/game/data.ts";
import type { State, Action } from "../src/game/types.ts";

// These held-out synthetic puzzles predate this probe. Exact chance minimax uses
// the SAME terminal tanh utility. Opponent search still models a sampled policy,
// so regret is an external diagnostic, not an equality expectation.
const input = "artifacts/ai-endgame-oracle-legal-deck-20261028.json";
const fixtures = JSON.parse(await readFile(input, "utf8")).results;
const probe = await createWasmAi(
  await readFile("artifacts/ai-search-exploration-20261028/probe.wasm"),
);
const prod = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
const native = (probe as any).native;
const tiles = makeTiles();
const tileKey = (id: number) => `${tiles[id].kind}/${tiles[id].variant}`;
const ak = (a: Action) =>
  a.type === "god"
    ? `god/${tileKey(a.tileId)}`
    : a.type === "discard"
      ? `discard/${a.ids.map(tileKey).sort()}`
      : JSON.stringify(a);
const canonical = (s: State) => {
  const seen = new Set<string>();
  return legalActions(s).filter((a) => {
    const k = ak(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
let referenceChecks = 0;
function solve(state: State, useNative: boolean) {
  const cache = new Map<string, number>();
  let nodes = 0;
  const transition = (s: State, a: Action) =>
    useNative ? prod.simulate(s, a) : simulate(s, a);
  const key = (s: State) =>
    JSON.stringify([
      s.phase,
      s.current,
      s.epoch,
      s.ra,
      s.center,
      s.resume,
      s.next,
      s.bag.map((t) => tileKey(t.id)).sort(),
      s.market.map((t) => tileKey(t.id)),
      s.pending.map((t) => tileKey(t.id)),
      s.players.map((p) => [
        p.score,
        p.suns,
        p.used,
        p.tiles.map((t) => tileKey(t.id)).sort(),
      ]),
      s.auction,
    ]);
  function action(s: State, a: Action): number {
    if (a.type !== "draw") return value(transition(s, a));
    const groups = new Map<string, { id: number; count: number }>();
    for (const t of s.bag) {
      const k = tileKey(t.id),
        r = groups.get(k);
      if (r) r.count++;
      else groups.set(k, { id: t.id, count: 1 });
    }
    let sum = 0;
    for (const g of groups.values()) {
      const t = s.bag.find((t) => t.id === g.id)!;
      sum +=
        (g.count / s.bag.length) *
        value(
          transition(
            { ...s, bag: [...s.bag.filter((t) => t.id !== g.id), t] },
            a,
          ),
        );
    }
    return sum;
  }
  function value(s: State): number {
    if (s.phase === "over")
      return Math.tanh((s.players[0].score - s.players[1].score) / 20);
    const k = key(s);
    if (cache.has(k)) return cache.get(k)!;
    assert.ok(++nodes <= 100000, "oracle node cap");
    const values = canonical(s).map((a) => action(s, a));
    const v = s.current === 0 ? Math.max(...values) : Math.min(...values);
    cache.set(k, v);
    return v;
  }
  const rows = canonical(state).map((a) => ({
    action: a,
    value: action(state, a),
  }));
  return { rows, nodes, best: Math.max(...rows.map((r) => r.value)) };
}
const rows: any[] = [];
let equivalenceChecks = 0;
for (const fixture of fixtures) {
  const s: State = fixture.state;
  assert.equal(s.current, 0);
  assert.equal(s.epoch, 3);
  const oracle = solve(s, true),
    reference = solve(s, false);
  for (const r of oracle.rows) {
    assert.ok(
      Math.abs(
        r.value -
          reference.rows.find((x) => ak(x.action) === ak(r.action))!.value,
      ) < 1e-9,
    );
    referenceChecks++;
  }
  native.configure_probe(0, 0, 1.4, 1.4, 64);
  assert.deepEqual(
    probe.search(s, { samples: 128, horizon: "next-epoch" }),
    prod.search(s, { samples: 128, horizon: "next-epoch" }),
  );
  equivalenceChecks++;
  const searches = [];
  for (const innerC of [1.4, 0.35, 0])
    for (const offset of [0, 1000, 2000]) {
      native.configure_probe(3072, 0, innerC, 1.4, 64);
      const report = probe.search(
        { ...s, steps: s.steps + offset },
        { samples: 128, horizon: "next-epoch" },
      );
      const v = oracle.rows.find(
        (r) => ak(r.action) === ak(report.action),
      )!.value;
      searches.push({
        innerC,
        offset,
        action: report.action,
        utility: v,
        regret: oracle.best - v,
        truncated: report.truncated,
      });
    }
  rows.push({ index: fixture.index, oracle, searches });
}
const summary = [1.4, 0.35, 0].map((innerC) => {
  const r = rows.flatMap((r) => r.searches).filter((r) => r.innerC === innerC);
  return {
    innerC,
    searches: r.length,
    suboptimal: r.filter((r) => r.regret > 1e-9).length,
    meanUtilityRegret: r.reduce((a, b) => a + b.regret, 0) / r.length,
    maxUtilityRegret: Math.max(...r.map((r) => r.regret)),
    truncated: r.reduce((a, b) => a + b.truncated, 0),
  };
});
const result = {
  fixtures: input,
  objective:
    "Exact two-player chance minimax of terminal tanh((score0-score1)/20), no score floor encountered from equal initial 100",
  caveats: [
    "Synthetic late endgames; historical reachability is not proved.",
    "Production opponents are sampled heuristic policies, not minimax. External regret cannot establish a search implementation bug.",
    "Step offsets vary deterministic search seeds without changing the game position; repetitions are dependent, not independent games.",
    "No playing-strength claim and no production parameter change.",
  ],
  referenceChecks,
  equivalenceChecks,
  summary,
  rows,
};
await writeFile(
  "artifacts/ai-search-exploration-20261028/oracle-checks.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({ referenceChecks, equivalenceChecks, summary }, null, 2),
);
