import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import {
  newGame,
  legalActions,
  simulate,
  ranking,
} from "../src/game/engine.ts";
import { makeTiles, random } from "../src/game/data.ts";
import type { Action, State, Tile } from "../src/game/types.ts";

const output = process.argv[2] ?? "artifacts/ai-endgame-oracle-20261028.json";
const ai = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
const build = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
const all = makeTiles(),
  byId = new Map(all.map((t) => [t.id, t]));
const tileKey = (t: Tile) => `${t.kind}/${t.variant}`;
const actionKey = (a: Action) =>
  a.type === "god"
    ? `god/${tileKey(byId.get(a.tileId)!)}`
    : a.type === "discard"
      ? `discard/${a.ids
          .map((id) => tileKey(byId.get(id)!))
          .sort()
          .join("|")}`
      : JSON.stringify(a);
function actions(s: State) {
  const seen = new Set<string>();
  return legalActions(s).filter((a) => {
    const k = actionKey(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const sortedTiles = (v: Tile[]) => v.map(tileKey).sort();
function stateKey(s: State) {
  return JSON.stringify([
    s.phase,
    s.current,
    s.center,
    s.ra,
    s.resume,
    s.next,
    sortedTiles(s.bag),
    s.market.map(tileKey),
    s.pending.map(tileKey),
    s.players.map((p) => [
      p.score,
      [...p.suns].sort((a, b) => a - b),
      [...p.used].sort((a, b) => a - b),
      sortedTiles(p.tiles),
    ]),
    s.auction ?? null,
  ]);
}
function chanceGroups(s: State) {
  const groups = new Map<string, { tile: Tile; count: number }>();
  for (const t of s.bag) {
    const k = tileKey(t),
      row = groups.get(k);
    if (row) row.count++;
    else groups.set(k, { tile: t, count: 1 });
  }
  return [...groups.values()];
}
class Limit extends Error {}
class Oracle {
  cache = new Map<string, number>();
  nodes = 0;
  hits = 0;
  readonly objective: "margin" | "win";
  readonly native: boolean;
  readonly limit: number;
  constructor(objective: "margin" | "win", native = true, limit = 100000) {
    this.objective = objective;
    this.native = native;
    this.limit = limit;
  }
  terminal(s: State) {
    return this.objective === "margin"
      ? s.players[0].score - s.players[1].score
      : Number(ranking(s)[0].player === 0);
  }
  transition(s: State, a: Action) {
    return this.native ? ai.simulate(s, a) : simulate(s, a);
  }
  value(s: State): number {
    assert.equal(s.epoch, 3);
    assert.equal(s.players.length, 2);
    const key = stateKey(s);
    if (this.native && this.cache.has(key)) {
      this.hits++;
      return this.cache.get(key)!;
    }
    if (++this.nodes > this.limit)
      throw new Limit("Exact enumeration node cap");
    let value: number;
    if (s.phase === "over") value = this.terminal(s);
    else {
      const opts = actions(s);
      assert.ok(opts.length);
      const values = opts.map((a) => this.action(s, a));
      value = s.current === 0 ? Math.max(...values) : Math.min(...values);
    }
    if (this.native) this.cache.set(key, value);
    return value;
  }
  action(s: State, a: Action): number {
    if (a.type !== "draw") return this.value(this.transition(s, a));
    let value = 0;
    for (const { tile, count } of chanceGroups(s)) {
      const drawState = {
        ...s,
        bag: [...s.bag.filter((t) => t.id !== tile.id), tile],
      };
      value +=
        (count / s.bag.length) * this.value(this.transition(drawState, a));
    }
    return value;
  }
  evaluate(s: State) {
    const rows = actions(s).map((action) => ({
      action,
      value: this.action(s, action),
    }));
    const best =
      s.current === 0
        ? Math.max(...rows.map((r) => r.value))
        : Math.min(...rows.map((r) => r.value));
    return { rows, best };
  }
}
function conserve(s: State) {
  const visible = [
    ...s.bag,
    ...s.market,
    ...s.pending,
    ...s.players.flatMap((p) => p.tiles),
  ];
  assert.equal(new Set(visible.map((t) => t.id)).size, visible.length);
  const used = new Set(visible.map((t) => t.id));
  s.discarded = all.filter((t) => !used.has(t.id));
  assert.equal(visible.length + s.discarded.length, 180);
  const disks = [s.center, ...s.players.flatMap((p) => [...p.suns, ...p.used])];
  assert.equal(new Set(disks).size, disks.length);
  const discardedRa = s.discarded.filter((t) => t.kind === "ra").length;
  assert.equal(
    discardedRa - s.ra,
    12,
    "Fixtures assume two prior epochs of six Ra each",
  );
}
function puzzle(index: number): State {
  const s = newGame({
    count: 2,
    humans: 0,
    difficulty: "hard",
    seed: 880000 + index,
  });
  const rng = random(42001 + index);
  s.epoch = 3;
  s.ra = 4 + (index % 2);
  s.phase = "turn";
  s.current = 0;
  s.steps = 100 + index;
  s.history = [];
  s.log = [];
  for (const p of s.players) {
    p.score = 100;
    const usable = 1 + (index % 7 === 0 ? 1 : 0);
    p.used = p.suns.slice(usable);
    p.suns = p.suns.slice(0, usable);
  }
  const available = [...all];
  const take = (kind: string, variant?: number) => {
    const n = available.findIndex(
      (t) =>
        t.kind === kind && (variant === undefined || t.variant === variant),
    );
    assert.ok(n >= 0, kind);
    return available.splice(n, 1)[0];
  };
  const kinds = [
    "monument",
    "civilization",
    "pharaoh",
    "nile",
    "flood",
    "gold",
  ];
  const marketGold = take("gold");
  for (let i = 0; i < 2; i++)
    for (let n = 0; n < 4 + (index % 6); n++) {
      const pool = available.filter((t) => kinds.includes(t.kind));
      const t = pool[Math.floor(rng() * pool.length)];
      s.players[i].tiles.push(take(t.kind, t.variant));
    }
  s.market = [
    marketGold,
    take(
      index % 3 === 0 ? "monument" : index % 3 === 1 ? "civilization" : "flood",
    ),
  ];
  // Preserve the standard Ra inventory: at most twelve were drawn in the
  // previous two epochs. Few non-Ra tiles keep exact enumeration manageable.
  s.bag = Array.from({ length: 30 - 12 - s.ra }, () => take("ra"));
  s.bag.push(take(kinds[Math.floor(rng() * kinds.length)]));
  if (index % 2) s.bag.push(take(index % 3 === 0 ? "war" : "monument"));
  if (index % 4 === 0) {
    s.phase = "disaster";
    s.pending = [take(index % 8 === 0 ? "earthquake" : "war")];
    s.resume = "turn";
    s.next = 1;
  } else if (index % 4 === 1) {
    s.phase = "auction";
    s.auction = {
      caller: 1,
      reason: "invoke",
      order: [0, 1],
      index: 0,
      high: 0,
      winner: -1,
      bids: [],
    };
  }
  conserve(s);
  return s;
}
// A known terminal position has no search/heuristic component.
const terminal = puzzle(2);
terminal.phase = "over";
terminal.players[0].score = 110;
terminal.players[1].score = 100;
assert.equal(new Oracle("margin").value(terminal), 10);
assert.equal(new Oracle("win").value(terminal), 1);
const results: any[] = [];
let referenceChecks = 0;
for (let index = 0; index < 24; index++) {
  const s = puzzle(index),
    root = actions(s);
  if (root.length < 2) continue;
  const restricted = new Set(ai.candidates(s).map(actionKey)),
    policy = ai.policy(s);
  const data: any = {
    index,
    state: s,
    phase: s.phase,
    legal: root.length,
    offered: restricted.size,
    bag: s.bag.map(tileKey),
    suns: s.players.map((p) => p.suns),
    publicScores: s.players.map((p) => p.score),
    policy,
    objectives: {},
  };
  const before = JSON.stringify(s);
  for (const objective of ["margin", "win"] as const) {
    const oracle = new Oracle(objective);
    try {
      const { rows, best } = oracle.evaluate(s);
      const allowed = rows.filter((r) => restricted.has(actionKey(r.action)));
      assert.ok(allowed.length);
      const limitedBest =
        s.current === 0
          ? Math.max(...allowed.map((r) => r.value))
          : Math.min(...allowed.map((r) => r.value));
      const policyValue = rows.find(
        (r) => actionKey(r.action) === actionKey(policy),
      )!.value;
      const sign = s.current === 0 ? 1 : -1;
      data.objectives[objective] = {
        best,
        limitedBest,
        policyValue,
        policyRegret: sign * (best - policyValue),
        pruningRegret: sign * (best - limitedBest),
        nodes: oracle.nodes,
        cacheHits: oracle.hits,
        actions: rows,
      };
      // Independent TS transitions and no memoization validate small cases.
      if (oracle.nodes < 4000) {
        const reference = new Oracle(objective, false, 100000);
        const checked = reference.evaluate(s);
        for (const r of rows)
          assert.ok(
            Math.abs(
              r.value -
                checked.rows.find(
                  (x) => actionKey(x.action) === actionKey(r.action),
                )!.value,
            ) < 1e-9,
          );
        referenceChecks++;
      }
    } catch (error) {
      if (!(error instanceof Limit)) throw error;
      data.objectives[objective] = { limited: true, nodes: oracle.nodes };
    }
  }
  assert.equal(JSON.stringify(s), before, "Oracle must not mutate a fixture");
  results.push(data);
}
const summarize = (objective: string) => {
  const rows = results.filter(
    (r) => r.objectives[objective] && !r.objectives[objective].limited,
  );
  return {
    cases: rows.length,
    policySuboptimal: rows.filter(
      (r) => r.objectives[objective].policyRegret > 1e-9,
    ).length,
    pruningSuboptimal: rows.filter(
      (r) => r.objectives[objective].pruningRegret > 1e-9,
    ).length,
    cappedCases: results.filter((r) => r.objectives[objective]?.limited).length,
    maxPolicyRegret: Math.max(
      0,
      ...rows.map((r) => r.objectives[objective].policyRegret),
    ),
    maxPruningRegret: Math.max(
      0,
      ...rows.map((r) => r.objectives[objective].pruningRegret),
    ),
  };
};
const report = {
  createdAt: new Date().toISOString(),
  candidateRestrictionCases: results.filter((r) => r.offered < r.legal).length,
  godChoiceCases: results.filter((r) =>
    r.objectives.margin?.actions?.some((x: any) => x.action.type === "god"),
  ).length,
  sourceSha256: build.sourceSha256,
  wasmSha256: build.wasmSha256,
  method:
    "Exact chance enumeration and adversarial two-player backward induction in synthetic final-epoch puzzles. Standard 180-tile conservation and prior/current epoch Ra counts are respected: 15 physical bag tiles (13-14 Ra plus 1-2 non-Ra). Known equal public initial scores 100, 1-2 usable disks per player, all canonical legal actions. Draw probabilities use the public remaining multiset; no future-order peeking. Each objective is solved separately, with a 100000-node cap; capped cases excluded from exact conclusions.",
  caveats: [
    "Synthetic fully specified two-player endgames, not full-game Ra playing-strength evidence.",
    "Deck and Ra-counter constraints are checked, but full reachability from a standard game's complete history is not proven.",
    "Opponent scores are deliberately public and equal in these fixtures; no real hidden score is used.",
    "Policy regret is relative to the stated win or margin objective, not proof of an error in historical games.",
    "The current MCTS itself is not benchmarked here; its restricted candidate set and heuristic policy are audited.",
    "Only two retained fixtures restrict candidates and none exercise god exchanges; the pruning check has narrow coverage.",
  ],
  referenceChecks,
  margin: summarize("margin"),
  win: summarize("win"),
  results,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    { referenceChecks, margin: report.margin, win: report.win },
    null,
    2,
  ),
);
