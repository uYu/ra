import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { newGame, legalActions, simulate } from "../src/game/engine.ts";
import { makeTiles, random } from "../src/game/data.ts";
import type { State, Action, Tile } from "../src/game/types.ts";
const directory =
  process.argv[2] ?? "artifacts/ai-ra-literature-study-20261028";
const path = join(directory, "stress-plan.json");
assert.ok(!existsSync(path), "Choose a new output; preserve old results");
const ai = await createWasmAi(await readFile(join(directory, "probe.wasm"))),
  native = (ai as any).native;
const configurations = JSON.parse(
  await readFile(join(directory, "plan.json"), "utf8"),
).configurations;
const all = makeTiles();
const tk = (t: Tile) => `${t.kind}/${t.variant}`;
const byId = new Map(all.map((t) => [t.id, t]));
const ak = (a: Action) =>
  a.type === "god"
    ? `god/${tk(byId.get(a.tileId)!)}`
    : a.type === "discard"
      ? `discard/${a.ids.map((id) => tk(byId.get(id)!)).sort()}`
      : JSON.stringify(a);
function actions(s: State) {
  const keys = new Set<string>();
  return legalActions(s).filter((a) => {
    const key = ak(a);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}
const fixtures = Array.from({ length: 24 }, (_, index) => {
  const seed = 1230001 + index,
    rng = random(seed),
    s = newGame({ count: 2, humans: 0, difficulty: "hard", seed });
  s.epoch = 3;
  s.ra = 5;
  s.current = 0;
  s.steps = 130 + index;
  s.history = [];
  s.log = [];
  const pool = [...all];
  const take = (kind: string) => {
    let eligible = pool.filter((t) => t.kind === kind);
    if (!eligible.length)
      eligible = pool.filter((t) =>
        [
          "monument",
          "civilization",
          "pharaoh",
          "nile",
          "flood",
          "gold",
        ].includes(t.kind),
      );
    assert.ok(eligible.length);
    const t = eligible[Math.floor(rng() * eligible.length)];
    pool.splice(pool.indexOf(t), 1);
    return t;
  };
  const kinds = [
    "monument",
    "civilization",
    "pharaoh",
    "nile",
    "flood",
    "gold",
  ];
  for (const p of s.players) {
    p.score = 100;
    p.used = p.suns.slice(2);
    p.suns = p.suns.slice(0, 2);
    p.tiles = [];
    for (let n = 0; n < 5 + (index % 4); n++)
      p.tiles.push(take(kinds[Math.floor(rng() * kinds.length)]));
  }
  if (index % 3 === 0) s.players[0].tiles.push(take("god"));
  s.market = [
    take(index % 2 ? "gold" : "flood"),
    take(kinds[Math.floor(rng() * kinds.length)]),
  ];
  if (index >= 16) s.market.push(take(index % 2 ? "war" : "earthquake"));
  s.bag = Array.from({ length: 13 }, () => take("ra"));
  for (let n = 0; n < 3; n++)
    s.bag.push(take(kinds[Math.floor(rng() * kinds.length)]));
  const used = new Set(
    [...s.bag, ...s.market, ...s.players.flatMap((p) => p.tiles)].map(
      (t) => t.id,
    ),
  );
  s.discarded = all.filter((t) => !used.has(t.id));
  if (index % 2) {
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
  assert.equal(used.size + s.discarded.length, 180);
  assert.equal(
    new Set([s.center, ...s.players.flatMap((p) => [...p.suns, ...p.used])])
      .size,
    9,
  );
  assert.equal(s.discarded.filter((t) => t.kind === "ra").length, 17);
  return { index, seed, state: s };
});
const plan = {
  seeds: [1230001, 1230024],
  fixtureCount: 24,
  fixtures,
  samples: 512,
  offsets: [0, 1000, 2000],
  oracleNodeCap: 30000,
  objective:
    "Exact terminal tanh((score0-score1)/20) chance minimax over all canonical legal actions",
  method:
    "New synthetic two-player final-epoch stress states, two usable suns each, 13 Ra + 3 ordinary bag tiles, random public collections, eight god holdings and eight disaster lots. Standard180-tile conservation and12 prior-epoch Ra counts checked. Not proven reachable by a complete history. Generated before evaluating any configuration.",
  configurations,
};
await writeFile(path, JSON.stringify(plan, null, 2) + "\n");
class Limit extends Error {}
function solve(state: State, useNative: boolean) {
  let nodes = 0;
  const cache = new Map<string, number>();
  const key = (s: State) =>
    JSON.stringify([
      s.phase,
      s.current,
      s.center,
      s.ra,
      s.resume,
      s.next,
      s.bag.map(tk).sort(),
      s.market.map(tk),
      s.pending.map(tk),
      s.players.map((p) => [
        p.score,
        [...p.suns].sort((a, b) => a - b),
        [...p.used].sort((a, b) => a - b),
        p.tiles.map(tk).sort(),
      ]),
      s.auction,
    ]);
  const transition = (s: State, a: Action) =>
    useNative ? ai.simulate(s, a) : simulate(s, a);
  function action(s: State, a: Action): number {
    if (a.type !== "draw") return value(transition(s, a));
    const groups = new Map<string, { tile: Tile; count: number }>();
    for (const t of s.bag) {
      const g = groups.get(tk(t));
      if (g) g.count++;
      else groups.set(tk(t), { tile: t, count: 1 });
    }
    let result = 0;
    for (const { tile, count } of groups.values())
      result +=
        (count / s.bag.length) *
        value(
          transition(
            { ...s, bag: [...s.bag.filter((t) => t.id !== tile.id), tile] },
            a,
          ),
        );
    return result;
  }
  function value(s: State): number {
    if (s.phase === "over")
      return Math.tanh((s.players[0].score - s.players[1].score) / 20);
    const k = key(s);
    if (cache.has(k)) return cache.get(k)!;
    if (++nodes > 30000) throw new Limit();
    const values = actions(s).map((a) => action(s, a)),
      v = s.current === 0 ? Math.max(...values) : Math.min(...values);
    cache.set(k, v);
    return v;
  }
  const rows = actions(state).map((a) => ({
    action: a,
    value: action(state, a),
  }));
  return { rows, nodes, best: Math.max(...rows.map((r) => r.value)) };
}
const results: any[] = [];
let referenceActions = 0;
for (const fixture of fixtures) {
  let oracle: ReturnType<typeof solve>;
  try {
    oracle = solve(fixture.state, true);
  } catch (e) {
    if (!(e instanceof Limit)) throw e;
    results.push({ index: fixture.index, capped: true });
    console.log(JSON.stringify({ index: fixture.index, capped: true }));
    continue;
  }
  if (oracle.nodes < 3000) {
    const reference = solve(fixture.state, false);
    for (const r of oracle.rows) {
      assert.ok(
        Math.abs(
          r.value -
            reference.rows.find((x) => ak(x.action) === ak(r.action))!.value,
        ) < 1e-9,
      );
      referenceActions++;
    }
  }
  const searches = [];
  for (const c of configurations)
    for (const offset of [0, 1000, 2000]) {
      native.configure_study(c.alpha, c.exploration, c.rollout);
      const report = ai.search(
        { ...fixture.state, steps: fixture.state.steps + offset },
        { samples: 512, horizon: "next-epoch", variant: c.variant },
      );
      const v = oracle.rows.find(
        (r) => ak(r.action) === ak(report.action),
      )!.value;
      const allowed = new Set(ai.candidates(fixture.state).map(ak));
      const bestAllowed = Math.max(
        ...oracle.rows
          .filter((r) => allowed.has(ak(r.action)))
          .map((r) => r.value),
      );
      searches.push({
        configuration: c.name,
        offset,
        regret: oracle.best - v,
        pruningRegret: oracle.best - bestAllowed,
        action: report.action,
        samples: report.samples,
        truncated: report.truncated,
      });
    }
  results.push({ index: fixture.index, oracle, searches });
  const summary = configurations.map((c: any) => {
    const rows = results
      .flatMap((r) => r.searches ?? [])
      .filter((r) => r.configuration === c.name);
    return {
      configuration: c.name,
      searches: rows.length,
      suboptimal: rows.filter((r) => r.regret > 1e-9).length,
      meanUtilityRegret: rows.reduce((s, r) => s + r.regret, 0) / rows.length,
      maxUtilityRegret: Math.max(0, ...rows.map((r) => r.regret)),
    };
  });
  await writeFile(
    join(directory, "stress-results.json"),
    JSON.stringify(
      {
        plan: "stress-plan.json",
        referenceActions,
        capped: results.filter((r) => r.capped).length,
        summary,
        results,
        caveats: [
          "Synthetic states, not full-game strength evidence; historical reachability not proved.",
          "Search opponents use sampled heuristic policies, oracle uses an adversarial opponent; external regret is not proof of a backup bug.",
          "Node-capped fixtures are excluded uniformly; no conclusions on their optimal actions.",
          "Seed offsets repeat the same state with different deterministic sampling sequences; they are not independent games.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      index: fixture.index,
      oracleNodes: oracle.nodes,
      completed: results.length,
      summary,
    }),
  );
}
