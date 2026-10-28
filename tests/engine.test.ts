import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  eligibleDiscards,
  legalActions,
  mustBid,
  newGame,
  ranking,
  requiredDiscards,
  scoreEpoch,
} from "../src/game/engine.ts";
import { GROUPS, makeTiles, RA_LIMIT } from "../src/game/data.ts";
import { chooseAction, observe } from "../src/game/ai.ts";
import { createSave, parseSave, replay } from "../src/game/storage.ts";
import type { Action, Kind, State, Tile } from "../src/game/types.ts";

const setup = (count = 3, seed = 42) =>
  newGame({ count, humans: 0, difficulty: "normal", seed });
function give(s: State, player: number, kind: Kind, n = 1, variant = 0) {
  const tiles = s.bag
    .filter((t) => t.kind === kind && t.variant === variant)
    .slice(0, n);
  assert.equal(tiles.length, n);
  s.bag = s.bag.filter((t) => !tiles.includes(t));
  s.players[player].tiles.push(...tiles);
  return tiles;
}
function market(s: State, kinds: Kind[]) {
  for (const kind of kinds) {
    const t = s.bag.find((t) => t.kind === kind)!;
    s.bag = s.bag.filter((x) => x.id !== t.id);
    s.market.push(t);
  }
}
function forceDraw(s: State, kind: Kind) {
  const i = s.bag.findIndex((t) => t.kind === kind);
  const t = s.bag.splice(i, 1)[0];
  s.bag.push(t);
  return advance(s, { type: "draw" });
}
function allPass(s: State) {
  while (s.phase === "auction") s = advance(s, { type: "bid", sun: null });
  return s;
}
function invariants(s: State) {
  const tiles = [
    ...s.bag,
    ...s.market,
    ...s.discarded,
    ...s.pending,
    ...s.players.flatMap((p) => p.tiles),
  ];
  assert.equal(tiles.length, 180);
  assert.equal(new Set(tiles.map((t) => t.id)).size, 180);
  const suns = [s.center, ...s.players.flatMap((p) => [...p.suns, ...p.used])];
  assert.equal(new Set(suns).size, suns.length);
  assert.equal(suns.length, GROUPS[s.config.count].flat().length + 1);
  assert.ok(s.market.length <= 8);
  assert.ok(s.players.every((p) => p.score >= 0));
  if (["turn", "auction", "god", "disaster"].includes(s.phase))
    assert.ok(s.players[s.current].suns.length > 0 || s.phase === "disaster");
}
test("180 tiles, correct composition, deterministic shuffled initial groups and highest sun first", () => {
  const tiles = makeTiles();
  assert.equal(tiles.length, 180);
  assert.equal(tiles.filter((t) => t.kind === "ra").length, 30);
  for (const n of [2, 3, 4, 5]) {
    const s = setup(n);
    assert.deepEqual(s, setup(n));
    assert.equal(
      s.players[s.current].suns.at(-1),
      Math.max(...GROUPS[n].flat()),
    );
    assert.deepEqual(
      s.players.map((p) => p.suns).sort(),
      [...GROUPS[n]].sort(),
    );
    invariants(s);
  }
});
test("drawing a normal tile advances to next active player, and full track disallows draw", () => {
  let s = setup();
  const actor = s.current;
  s = forceDraw(s, "gold");
  assert.equal(s.market[0].kind, "gold");
  assert.equal(s.current, (actor + 1) % 3);
  market(s, ["gold", "gold", "gold", "gold", "nile", "nile", "nile"]);
  assert.equal(s.market.length, 8);
  assert.throws(() => advance(s, { type: "draw" }));
});
test("invoker must bid after all other players pass when market is not full", () => {
  let s = setup();
  const caller = s.current;
  s = advance(s, { type: "invoke" });
  assert.equal(s.current, (caller + 1) % 3);
  s = advance(s, { type: "bid", sun: null });
  s = advance(s, { type: "bid", sun: null });
  assert.equal(s.current, caller);
  assert.equal(mustBid(s), true);
  assert.throws(() => advance(s, { type: "bid", sun: null }));
});
test("Ra drawn all-pass retains market; full invoke all-pass discards market", () => {
  let s = setup();
  market(s, ["gold"]);
  s = forceDraw(s, "ra");
  s = allPass(s);
  assert.equal(s.market.length, 1);
  assert.equal(s.ra, 1);
  market(s, ["gold", "gold", "gold", "gold", "nile", "nile", "nile"]);
  s = advance(s, { type: "invoke" });
  s = allPass(s);
  assert.equal(s.market.length, 0);
  invariants(s);
});
test("bids only increase; winner swaps disk, losers keep disks; turn resumes after caller", () => {
  let s = setup(4);
  market(s, ["gold", "nile"]);
  const caller = s.current;
  s = advance(s, { type: "invoke" });
  const winner = s.current,
    sun = s.players[winner].suns[0];
  s = advance(s, { type: "bid", sun });
  assert.throws(() => advance(s, { type: "bid", sun }));
  while (s.phase === "auction") s = advance(s, { type: "bid", sun: null });
  assert.equal(s.center, sun);
  assert.deepEqual(s.players[winner].used, [1]);
  assert.equal(s.players[winner].suns.includes(sun), false);
  assert.equal(s.players[winner].tiles.length, 2);
  assert.equal(s.current, (caller + 1) % 4);
  invariants(s);
});
test("last Ra ends epoch immediately with no auction and no award", () => {
  let s = setup();
  market(s, ["gold"]);
  s.ra = RA_LIMIT[3] - 1;
  s = forceDraw(s, "ra");
  assert.equal(s.phase, "epoch");
  assert.equal(s.auction, null);
  assert.equal(s.market.length, 1);
  assert.equal(s.players.flatMap((p) => p.tiles).length, 0);
});
test("god exchanges can repeat in one turn and cannot acquire another god", () => {
  let s = setup();
  const actor = s.current;
  give(s, actor, "god", 2);
  market(s, ["gold", "nile", "god"]);
  const targets = s.market.slice(0, 2);
  assert.throws(() => advance(s, { type: "god", tileId: s.market[2].id }));
  s = advance(s, { type: "god", tileId: targets[0].id });
  assert.equal(s.phase, "god");
  assert.equal(s.current, actor);
  s = advance(s, { type: "god", tileId: targets[1].id });
  assert.equal(s.phase, "god");
  assert.equal(s.current, actor);
  s = advance(s, { type: "finish" });
  assert.equal(s.current, (actor + 1) % 3);
  invariants(s);
});
test("disasters include newly acquired tiles, require exact distinct choices, and resume god action", () => {
  let s = setup();
  const actor = s.current;
  give(s, actor, "god");
  give(s, actor, "civilization", 1, 0);
  const [other] = give(s, actor, "civilization", 1, 1);
  market(s, ["war"]);
  s = advance(s, { type: "god", tileId: s.market[0].id });
  assert.equal(s.phase, "disaster");
  assert.equal(requiredDiscards(s), 2);
  assert.throws(() =>
    advance(s, { type: "discard", ids: [other.id, other.id] }),
  );
  const a = legalActions(s)[0];
  s = advance(s, a);
  assert.equal(s.phase, "god");
  assert.equal(s.players[actor].tiles.length, 0);
  invariants(s);
});
test("drought forces floods before Nile, but allows choosing Nile when fewer than 2 floods", () => {
  let s = setup();
  const actor = s.current;
  give(s, actor, "god");
  const flood = give(s, actor, "flood"),
    nile = give(s, actor, "nile", 3);
  market(s, ["drought"]);
  s = advance(s, { type: "god", tileId: s.market[0].id });
  assert.equal(eligibleDiscards(s).length, 4);
  assert.throws(() =>
    advance(s, { type: "discard", ids: [nile[0].id, nile[1].id] }),
  );
  s = advance(s, { type: "discard", ids: [flood[0].id, nile[1].id] });
  assert.equal(
    s.players[actor].tiles.filter((t) => t.kind === "nile").length,
    2,
  );
  invariants(s);
});
test("empty disaster silently resolves and all suns used triggers scoring after disaster", () => {
  let s = setup(2);
  const caller = s.current;
  for (const p of s.players) {
    p.used.push(...p.suns.slice(1));
    p.suns = p.suns.slice(0, 1);
  }
  const winner = (caller + 1) % 2;
  const old = s.players[caller].suns.pop()!;
  s.players[caller].used.push(old);
  s.current = winner;
  market(s, ["earthquake"]);
  s = advance(s, { type: "invoke" });
  s = advance(s, { type: "bid", sun: s.players[winner].suns[0] });
  assert.equal(s.phase, "epoch");
  invariants(s);
});
test("scoring all categories, diversity and multiplicity; totals floor at zero", () => {
  const s = setup();
  s.epoch = 3;
  give(s, 0, "pharaoh", 3);
  give(s, 1, "pharaoh", 1);
  give(s, 0, "nile", 3);
  give(s, 0, "flood", 2);
  give(s, 0, "gold", 2);
  give(s, 0, "god", 1);
  for (let v = 0; v < 5; v++) give(s, 0, "civilization", 1, v);
  for (let v = 0; v < 8; v++) give(s, 0, "monument", v === 0 ? 3 : 1, v);
  const rows = scoreEpoch(s);
  assert.equal(rows[0].parts.法老, 5);
  assert.equal(rows[2].parts.法老, -2);
  assert.equal(rows[0].parts.河流, 5);
  assert.equal(rows[0].parts.文明, 15);
  assert.equal(rows[0].parts.黄金, 6);
  assert.equal(rows[0].parts.神祇, 2);
  assert.equal(rows[0].parts.古迹, 20);
  s.players[2].score = 0;
  assert.equal(scoreEpoch(s)[2].total, 0);
});
test("ties for Pharaoh extremes award all, all equal award nobody; dry Nile scores zero", () => {
  const s = setup();
  assert.equal(scoreEpoch(s)[0].parts.法老, 0);
  give(s, 0, "pharaoh");
  give(s, 1, "pharaoh");
  give(s, 2, "nile", 4);
  const rows = scoreEpoch(s);
  assert.equal(rows[0].parts.法老, 5);
  assert.equal(rows[1].parts.法老, 5);
  assert.equal(rows[2].parts.法老, -2);
  assert.equal(rows[2].parts.河流, 0);
});
test("next epoch clears temporary tiles and market, preserves permanent tiles and reactivates disks", () => {
  let s = setup();
  give(s, 0, "monument");
  give(s, 0, "pharaoh");
  give(s, 0, "nile");
  give(s, 0, "flood");
  give(s, 0, "gold");
  give(s, 0, "god");
  give(s, 0, "civilization");
  market(s, ["gold"]);
  s.ra = RA_LIMIT[3] - 1;
  s = forceDraw(s, "ra");
  const remaining = s.bag.length;
  s = advance(s, { type: "next" });
  assert.equal(s.epoch, 2);
  assert.equal(s.ra, 0);
  assert.deepEqual(
    s.players[0].tiles.map((t) => t.kind),
    ["monument", "pharaoh", "nile"],
  );
  assert.equal(s.bag.length, remaining);
  assert.equal(s.market.length, 0);
  assert.equal(
    s.players[s.current].suns.includes(
      Math.max(...s.players.flatMap((p) => p.suns)),
    ),
    true,
  );
  invariants(s);
});
test("winning tie breaks by highest owned sun", () => {
  const s = setup();
  s.players.forEach((p) => (p.score = 30));
  assert.equal(ranking(s)[0].player, s.current);
});
test("AI observation is independent of hidden bag order, seed and opponents scores", () => {
  const a = setup(),
    b = structuredClone(a);
  b.bag.reverse();
  b.config.seed = 888;
  for (let i = 0; i < b.players.length; i++)
    if (i !== b.current) b.players[i].score = 999;
  assert.deepEqual(observe(a), observe(b));
  assert.notDeepEqual(observe(a).bag, a.bag);
});
test("legal action rejection does not mutate original state", () => {
  const s = setup(),
    copy = structuredClone(s);
  assert.throws(() => advance(s, { type: "bid", sun: 100 }));
  assert.deepEqual(s, copy);
});
test("validated saves replay precisely and reject corrupt action logs", () => {
  let s = setup();
  const save = createSave(s.config);
  for (let i = 0; i < 50; i++) {
    const a = chooseAction(observe(s));
    save.actions.push(a);
    s = advance(s, a);
  }
  const parsed = parseSave(JSON.stringify(save));
  assert.deepEqual(replay(parsed), s);
  assert.throws(() =>
    parseSave(
      JSON.stringify({ ...save, actions: [{ type: "bid", sun: 999 }] }),
    ),
  );
  assert.throws(() => parseSave("{bad"));
  assert.throws(() =>
    parseSave(
      JSON.stringify({ ...save, config: { ...save.config, count: 9 } }),
    ),
  );
});
test("complete AI games for all player counts and difficulties preserve every tile and sun", () => {
  for (const difficulty of ["easy", "normal", "hard"] as const)
    for (const count of [2, 3, 4, 5])
      for (let seed = 1; seed <= 3; seed++) {
        let s = newGame({ count, humans: 0, difficulty, seed });
        for (let n = 0; n < 1500 && s.phase !== "over"; n++) {
          const a: Action = chooseAction(observe(s), difficulty);
          s = advance(s, a);
          invariants(s);
        }
        assert.equal(
          s.phase,
          "over",
          `${count}/${difficulty}/${seed} stuck at ${s.phase}`,
        );
        assert.equal(s.history.length, 3);
      }
});
