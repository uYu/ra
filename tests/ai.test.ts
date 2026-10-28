import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  legalActions,
  newGame,
  simulate,
} from "../src/game/engine.ts";
import { chooseAction, observe } from "../src/game/ai.ts";
import { futureValues, positionValues } from "../src/game/ai/evaluation.ts";
import {
  futureValues as previousFuture,
  positionValues as previousPosition,
} from "./fixtures/previous-evaluation.ts";
import { sampleScenario } from "../src/game/ai/sampling.ts";
import { searchAction } from "../src/game/ai/search.ts";
import {
  auctionPlan,
  bestDiscard,
  godChoices,
  policyAction,
} from "../src/game/ai/policy.ts";
import type { Kind, State } from "../src/game/types.ts";

function take(s: State, kind: Kind, variant = 0) {
  const i = s.bag.findIndex((t) => t.kind === kind && t.variant === variant);
  assert.ok(i >= 0);
  return s.bag.splice(i, 1)[0];
}
function setup() {
  return newGame({ count: 2, humans: 0, difficulty: "hard", seed: 87 });
}

test("auction search jumps over a later bidder instead of always bidding the cheapest sun", () => {
  const s = setup();
  s.epoch = 2;
  s.ra = 5;
  s.current = 0;
  s.phase = "auction";
  s.players[0].suns = [6, 11];
  s.players[1].suns = [9];
  s.players.forEach((p) => (p.used = []));
  s.market = Array.from({ length: 4 }, () => take(s, "gold"));
  s.bag = s.bag.filter((t) => t.kind === "ra");
  s.auction = {
    caller: 1,
    reason: "draw",
    order: [0, 1],
    index: 0,
    high: 0,
    winner: -1,
    bids: [],
  };
  assert.deepEqual(auctionPlan(s).actions[0], { type: "bid", sun: 11 });
  assert.deepEqual(searchAction(observe(s), { samples: 12 }).action, {
    type: "bid",
    sun: 11,
  });
});

test("a voluntary invoker still chooses a legal forced bid for a harmful lot", () => {
  let s = setup();
  s.current = 0;
  s.players[0].tiles.push(
    ...Array.from({ length: 4 }, () => take(s, "nile")),
    take(s, "flood"),
  );
  s.market.push(take(s, "drought"));
  s = advance(s, { type: "invoke" });
  s = advance(s, { type: "bid", sun: null });
  const action = chooseAction(s, "hard");
  assert.equal(action.type, "bid");
  assert.notEqual((action as { sun: number | null }).sun, null);
  assert.ok(
    legalActions(s).some((a) => JSON.stringify(a) === JSON.stringify(action)),
  );
});

test("war discards duplicate civilizations and preserves four distinct types", () => {
  const s = setup();
  s.current = 0;
  s.phase = "disaster";
  for (let v = 0; v < 5; v++)
    s.players[0].tiles.push(take(s, "civilization", v));
  s.players[0].tiles.push(take(s, "civilization", 0));
  s.pending = [take(s, "war")];
  const action = bestDiscard(s);
  const next = advance(s, action);
  assert.equal(new Set(next.players[0].tiles.map((t) => t.variant)).size, 4);
});

test("god exchange recognizes Flood activation and de-duplicates identical targets", () => {
  const s = setup();
  s.current = 0;
  s.epoch = 3;
  s.players[0].tiles.push(take(s, "god"));
  for (let n = 0; n < 6; n++) s.players[0].tiles.push(take(s, "nile"));
  const flood = take(s, "flood");
  s.market.push(take(s, "gold"), flood, take(s, "flood"));
  const gods = godChoices(s);
  assert.equal(gods.length, 2);
  assert.deepEqual(gods[0].action, { type: "god", tileId: flood.id });
});

test("hard search is deterministic and cannot use the real bag, seed, or hidden scores", () => {
  const a = setup(),
    b = structuredClone(a);
  b.bag.reverse();
  b.config.seed = 91;
  b.players[1 - b.current].score = 999;
  b.history = [[{ name: "secret", parts: {}, delta: 999, total: 999 }]];
  const original = structuredClone(a);
  assert.deepEqual(chooseAction(a, "hard"), chooseAction(b, "hard"));
  assert.deepEqual(a, original);
});

test("simulation transitions share real rules, match full games, and leave the source immutable", () => {
  for (const count of [2, 3, 4, 5]) {
    let s = newGame({
      count,
      humans: 0,
      difficulty: "normal",
      seed: 197 + count,
    });
    while (s.phase !== "over" && s.steps < 1500) {
      const action = chooseAction(observe(s), "normal"),
        original = structuredClone(s);
      const fast = simulate(s, action),
        full = advance(s, action);
      assert.deepEqual({ ...fast, log: [] }, { ...full, log: [] });
      assert.deepEqual(s, original);
      s = full;
    }
    assert.equal(s.phase, "over");
  }
});

test("game rollouts cross both epoch resets and finish with actual final scoring", () => {
  const s = observe(setup());
  const report = searchAction(s, { samples: 2, horizon: "game" });
  assert.equal(report.completed, report.candidates.length * 2);
  assert.equal(report.epochAdvances, report.completed * 2);
  const short = searchAction(s, { samples: 2, horizon: "epoch" });
  assert.equal(short.completed, 0);
  assert.equal(short.epochAdvances, 0);
  assert.ok(report.transitions > short.transitions);
});

test("invalid sample budgets cannot silently yield a NaN decision or hang", () => {
  for (const samples of [NaN, Infinity, 0, -1, 1.5, 513])
    assert.throws(() => searchAction(observe(setup()), { samples }), /采样/);
});

test("MCTS expands multiple decision levels and allocates visits using UCT", () => {
  const s = observe(setup());
  const report = searchAction(s, { samples: 24 });
  assert.equal(report.samples, report.candidates.length * 24);
  assert.equal(
    report.candidates.reduce((n, c) => n + c.visits, 0),
    report.samples,
  );
  assert.ok(report.depth > 1);
  assert.ok(report.nodes > report.candidates.length + 1);
  assert.ok(new Set(report.candidates.map((c) => c.visits)).size > 1);
  assert.ok(
    report.candidates.every((c) => c.visits > 0 && Number.isFinite(c.value)),
  );
});

test("scenario sampling keeps the public multiset and opponent preferences reproducible across interleaved visits", () => {
  const s = observe(setup()),
    original = structuredClone(s);
  const first = sampleScenario(s, 0);
  for (let i = 1; i < 30; i++) sampleScenario(s, i);
  assert.deepEqual(sampleScenario(s, 0), first);
  assert.deepEqual(
    first.bag.map((t) => t.id).sort((a, b) => a - b),
    s.bag.map((t) => t.id).sort((a, b) => a - b),
  );
  assert.notDeepEqual(sampleScenario(s, 1), first);
  const hidden = structuredClone(original);
  hidden.bag.reverse();
  hidden.config.seed = 999;
  hidden.players[1].score = 999;
  assert.deepEqual(sampleScenario(observe(hidden), 0), first);
  assert.deepEqual(s, original);
});

test("a misleading policy prior can be overturned by actual final rewards", () => {
  const s = setup();
  s.epoch = 3;
  s.ra = 5;
  s.current = 0;
  s.phase = "auction";
  s.center = 1;
  s.players[0].suns = [8];
  s.players[0].used = [2, 3, 4];
  s.players[1].suns = [5];
  s.players[1].used = [6, 7, 9];
  s.market = [take(s, "monument")];
  s.bag = [take(s, "ra")];
  s.auction = {
    caller: 1,
    reason: "draw",
    order: [1, 0],
    index: 1,
    high: 0,
    winner: -1,
    bids: [{ player: 1, sun: null }],
  };
  // The heuristic overprices reserving the last disk. With only the final Ra
  // left, winning the monument is a certain extra final point.
  assert.deepEqual(policyAction(s), { type: "bid", sun: null });
  const report = searchAction(s);
  assert.deepEqual(report.action, { type: "bid", sun: 8 });
  assert.ok(report.candidates.every((c) => c.visits > 0));
  assert.equal(report.completed, report.samples);
});

test("batched auction continuations agree with recomputing each bidder's best response", () => {
  let auctions = 0;
  for (const count of [2, 3, 4, 5]) {
    let s = newGame({
      count,
      humans: 0,
      difficulty: "normal",
      seed: 9100 + count,
    });
    const model = {
      cost: s.players.map((_, i) => 0.7 + i * 0.2),
      rivalry: 0.75,
    };
    while (s.phase !== "over" && s.steps < 1500) {
      if (s.phase === "auction") {
        const plan = auctionPlan(s, model);
        for (const action of plan.actions) {
          assert.deepEqual(action, policyAction(s, model));
          s = simulate(s, action);
        }
        auctions++;
      } else s = simulate(s, policyAction(s, model));
    }
    assert.equal(s.phase, "over");
  }
  assert.ok(auctions > 30);
});

test("cached inventory and disk rankings preserve exact values throughout complete games", () => {
  for (const count of [2, 3, 4, 5]) {
    let s = newGame({
      count,
      humans: 0,
      difficulty: "normal",
      seed: 9400 + count,
    });
    while (s.phase !== "over" && s.steps < 1500) {
      assert.deepEqual(futureValues(s), previousFuture(s));
      assert.deepEqual(positionValues(s), previousPosition(s));
      s = simulate(s, policyAction(s));
    }
    assert.equal(s.phase, "over");
    assert.deepEqual(positionValues(s), previousPosition(s));
  }
});
