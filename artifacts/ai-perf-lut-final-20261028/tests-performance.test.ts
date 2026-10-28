import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { createWasmAi as createFrozen } from "../src/game/ai/wasm-frozen-uct5.ts";
import { newGame } from "../src/game/engine.ts";
import { auctionPlan } from "../src/game/ai/policy.ts";
import { makeTiles } from "../src/game/data.ts";
import type { Kind, State } from "../src/game/types.ts";

const current = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
const frozen = await createFrozen(
  await readFile("artifacts/frozen-uct5/ra-ai.wasm"),
);
function take(s: State, kind: Kind, variant = 0) {
  const i = s.bag.findIndex((t) => t.kind === kind && t.variant === variant);
  assert.ok(i >= 0);
  return s.bag.splice(i, 1)[0];
}
function auction(count: number, epoch: number, forced: boolean) {
  const s = newGame({
    count,
    humans: 0,
    difficulty: "hard",
    seed: 72000 + count,
  });
  s.epoch = epoch;
  for (let i = 0; i < count; i++) {
    s.players[i].tiles.push(
      take(s, "pharaoh"),
      take(s, "nile"),
      take(s, "monument", i),
      take(s, "monument", i),
      take(s, "civilization", i % 5),
    );
  }
  s.players[0].tiles.push(take(s, "flood"));
  s.market = [
    take(s, "gold"),
    take(s, "monument", 7),
    take(s, "flood"),
    take(s, "drought"),
    take(s, "earthquake"),
    take(s, "war"),
    take(s, "funeral"),
  ];
  s.phase = "auction";
  s.current = forced ? count - 1 : 1;
  const high = forced ? 0 : s.players[0].suns[0];
  s.auction = {
    caller: count - 1,
    reason: forced ? "invoke" : "draw",
    order: Array.from({ length: count }, (_, i) => i),
    index: s.current,
    high,
    winner: forced ? -1 : 0,
    bids: Array.from({ length: s.current }, (_, i) => ({
      player: i,
      sun: forced ? null : high,
    })),
  };
  return s;
}

test("optimized auction workspace preserves partial winners, forced bids and disaster outcomes", () => {
  for (const count of [2, 3, 4, 5])
    for (const epoch of [1, 2, 3])
      for (const forced of [false, true]) {
        const s = auction(count, epoch, forced),
          before = structuredClone(s);
        const actual = current.auction(s);
        assert.deepEqual(actual, frozen.auction(s));
        const expected = auctionPlan(s);
        assert.deepEqual(actual.actions, expected.actions);
        assert.equal(actual.winner, expected.winner);
        assert.equal(actual.sun, expected.sun);
        actual.values.forEach((v, i) =>
          assert.ok(Math.abs(v - expected.values[i]) < 1e-9),
        );
        assert.deepEqual(
          current.search(s, { samples: 4 }),
          frozen.search(s, { samples: 4 }),
        );
        assert.deepEqual(s, before);
      }
});

test("auction caches are local to an award and cannot survive a later call", () => {
  const a = auction(5, 1, false),
    b = auction(3, 3, true);
  const expected = current.auction(a);
  current.auction(b);
  assert.deepEqual(current.auction(a), expected);
  a.players[0].tiles.push(take(a, "pharaoh"));
  a.players[1].used.push(a.players[1].suns.pop()!);
  assert.deepEqual(current.auction(a), frozen.auction(a));
});

test("race lookup preserves all physical Pharaoh differences and oversized fallback", () => {
  const pharaohs = makeTiles().filter((t) => t.kind === "pharaoh");
  for (const count of [2, 5])
    for (const epoch of [1, 2, 3])
      for (let delta = -25; delta <= 25; delta++) {
        const s = newGame({ count, humans: 0, difficulty: "hard", seed: 73 });
        s.epoch = epoch;
        s.players[delta >= 0 ? 0 : 1].tiles = pharaohs.slice(
          0,
          Math.abs(delta),
        );
        const used = new Set(
          s.players.flatMap((p) => p.tiles.map((t) => t.id)),
        );
        s.bag = s.bag.filter((t) => !used.has(t.id));
        assert.deepEqual(current.evaluate(s), frozen.evaluate(s));
      }
  const s = newGame({ count: 2, humans: 0, difficulty: "hard", seed: 73 });
  s.players[0].tiles = Array.from({ length: 31 }, () => pharaohs[0]);
  assert.deepEqual(current.evaluate(s), frozen.evaluate(s));
});

test("inventory bitsets preserve all monument and civilization presence masks", () => {
  const tiles = makeTiles();
  for (let mask = 0; mask < 256; mask++) {
    const s = newGame({ count: 2, humans: 0, difficulty: "hard", seed: 73 });
    s.epoch = 3;
    s.players[0].tiles = tiles
      .filter((t) => t.kind === "monument" && mask & (1 << t.variant))
      .filter(
        (t) =>
          tiles
            .filter((x) => x.kind === t.kind && x.variant === t.variant)
            .findIndex((x) => x.id === t.id) <
          (t.variant % 5) + 1,
      );
    s.players[1].tiles = tiles.filter(
      (t) => t.kind === "civilization" && mask & (1 << t.variant),
    );
    const used = new Set(s.players.flatMap((p) => p.tiles.map((t) => t.id)));
    s.bag = s.bag.filter((t) => !used.has(t.id));
    assert.deepEqual(current.evaluate(s), frozen.evaluate(s));
  }
});

test("auction scratch capacity covers protocol disks merged by an epoch reset", () => {
  const s = newGame({ count: 2, humans: 0, difficulty: "hard", seed: 73 });
  const disks = Array.from({ length: 16 }, (_, i) => i + 1);
  s.players[0].suns = [...disks];
  s.players[0].used = [...disks];
  const lastRa = s.bag.find((t) => t.kind === "ra")!;
  s.bag = [lastRa];
  s.discarded = makeTiles().filter((t) => t.id !== lastRa.id);
  s.ra = 5;
  s.current = 0;
  const options = { samples: 1, horizon: "next-epoch" as const };
  assert.deepEqual(current.search(s, options), frozen.search(s, options));
});
