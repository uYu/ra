import test from "node:test";
import assert from "node:assert/strict";
import { newGame, advance, legalActions } from "../src/game/engine.ts";
import {
  enumerateAuction,
  solveAuction,
} from "../scripts/auction-sampling/reference.ts";
import type { Action } from "../src/game/types.ts";
test("exhaustive auctions conserve physical disks and preserve the mandatory caller bid for 2–5 players", () => {
  for (const count of [2, 3, 4, 5]) {
    const s = advance(
        newGame({ count, humans: count, difficulty: "easy", seed: 71 }),
        { type: "invoke" },
      ),
      tree = enumerateAuction(s);
    const disks = [
      s.center,
      ...s.players.flatMap((p) => [...p.suns, ...p.used]),
    ].sort((a, b) => a - b);
    assert.ok(tree.leaves.length > 1);
    assert.ok(tree.leaves.every((l) => l.winner >= 0));
    assert.equal(
      new Set(tree.leaves.map((l) => `${l.winner}/${l.sun}`)).size,
      tree.leaves.length,
    );
    for (const leaf of tree.leaves) {
      assert.notEqual(leaf.state.phase, "auction");
      assert.deepEqual(
        [
          leaf.state.center,
          ...leaf.state.players.flatMap((p) => [...p.suns, ...p.used]),
        ].sort((a, b) => a - b),
        disks,
      );
      assert.equal(leaf.state.center, leaf.sun);
      assert.ok(leaf.state.players[leaf.winner].used.includes(s.center));
    }
    // Every native legal root choice is represented, including passing when allowed.
    assert.deepEqual(tree.nodes[0].actions, legalActions(s));
  }
});
test("backward induction uses each bidder own expected payoff, rather than making opponents help the root", () => {
  const state = newGame({ count: 2, humans: 2, difficulty: "easy", seed: 1 });
  const actions: Action[] = [
    { type: "bid", sun: 2 },
    { type: "bid", sun: 3 },
  ];
  const leaf = (utility: number[]) => ({
    state,
    winner: 0,
    sun: 2,
    raw: utility,
    utility,
  });
  const tree = {
    leaves: [leaf([5, 5]), leaf([10, 0]), leaf([0, 10])],
    nodes: [
      { actor: 0, leaf: -1, actions, children: [1, 2] },
      { actor: 0, leaf: 0, actions: [], children: [] },
      { actor: 1, leaf: -1, actions, children: [3, 4] },
      { actor: 0, leaf: 1, actions: [], children: [] },
      { actor: 0, leaf: 2, actions: [], children: [] },
    ],
  };
  const solved = solveAuction(tree, 1);
  assert.deepEqual(solved.action, actions[0]);
  assert.deepEqual(solved.outcomes, [0, 2]);
});
