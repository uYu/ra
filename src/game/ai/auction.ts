import type { SearchReport } from "./search.ts";
import type { State, Action } from "../types.ts";
import { observe } from "../ai.ts";
import { legalActions, simulate } from "../engine.ts";
import { sampleScenario } from "./sampling.ts";
import { policyAction } from "./policy.ts";
import { positionValues, futureValues, relative } from "./evaluation.ts";
export function enumerateAuction(s: State, transition = simulate) {
  const leaves: {
      state: State;
      winner: number;
      sun: number;
      raw: number[];
      utility: number[];
    }[] = [],
    nodes: {
      actor: number;
      leaf: number;
      actions: Action[];
      children: number[];
    }[] = [];
  function build(state: State, winner: number, sun: number): number {
    const id = nodes.length;
    nodes.push({ actor: state.current, leaf: -1, actions: [], children: [] });
    if (state.phase !== "auction") {
      let index = leaves.findIndex((x) => x.winner === winner && x.sun === sun);
      if (index < 0) {
        index = leaves.length;
        leaves.push({
          state,
          winner,
          sun,
          raw: state.players.map(() => 0),
          utility: state.players.map(() => 0),
        });
      }
      nodes[id].leaf = index;
      return id;
    }
    const actions = legalActions(state);
    nodes[id].actions = actions;
    for (const action of actions) {
      if (action.type !== "bid") throw Error("not a bid");
      const next = transition(state, action),
        w = action.sun === null ? winner : state.current,
        h = action.sun ?? sun;
      nodes[id].children.push(build(next, w, h));
    }
    return id;
  }
  build(s, s.auction!.winner, s.auction!.high);
  return { leaves, nodes };
}
export function solveAuction(
  tree: ReturnType<typeof enumerateAuction>,
  rounds: number,
) {
  function solve(id: number): number {
    const node = tree.nodes[id];
    if (node.leaf >= 0) return node.leaf;
    let best = -1,
      value = -Infinity;
    for (const c of node.children) {
      const leaf = solve(c),
        v = tree.leaves[leaf].utility[node.actor] / rounds;
      if (best < 0 || v > value + 1e-12) {
        best = leaf;
        value = v;
      }
    }
    return best;
  }
  const root = tree.nodes[0],
    outcomes = root.children.map(solve),
    utilities = outcomes.map(
      (l) => tree.leaves[l].utility[root.actor] / rounds,
    );
  let best = 0;
  utilities.forEach((v, i) => {
    if (v > utilities[best] + 1e-12) best = i;
  });
  return { action: root.actions[best], outcomes, utilities };
}
export function auctionSearch(
  state: State,
  budget: number,
  horizon: "epoch" | "next-epoch" | "game" = "next-epoch",
  timeMs?: number,
) {
  const started = performance.now(),
    deadline = timeMs === undefined ? Infinity : started + timeMs;
  const s = observe(state);
  s.players.forEach((p) => (p.score = 100));
  const tree = enumerateAuction(s),
    bag = [...s.bag].sort((a, b) => a.id - b.id),
    target = Math.min(3, s.epoch + (horizon === "next-epoch" ? 1 : 0)),
    limit = horizon === "game" ? 720 : horizon === "next-epoch" ? 480 : 240;
  const finished = (x: State) =>
    x.phase === "over" ||
    (horizon !== "game" && x.phase === "epoch" && x.epoch >= target);
  const squares = tree.leaves.map(() => s.players.map(() => 0));
  let transitions = tree.nodes.length - 1,
    completed = 0,
    truncated = 0,
    epochAdvances = 0;
  let rounds = 0;
  for (
    let j = 0;
    timeMs === undefined ? j < budget : j === 0 || performance.now() < deadline;
    j++
  ) {
    rounds++;
    const scenario = sampleScenario(s, j, bag);
    for (const leaf of tree.leaves) {
      let next = { ...leaf.state, bag: [...scenario.bag] },
        steps = s.auction!.order.length - s.auction!.index;
      while (!finished(next) && steps < limit) {
        if (next.phase === "epoch") epochAdvances++;
        next = simulate(next, policyAction(next, scenario.model));
        steps++;
        transitions++;
      }
      if (next.phase === "over") completed++;
      if (!finished(next)) truncated++;
      const residual =
          next.phase === "over" || next.phase === "epoch"
            ? futureValues(next)
            : positionValues(next),
        scores = next.players.map((p, i) => residual[i] + p.score - 100);
      for (let i = 0; i < s.players.length; i++) {
        const value = relative(scores, i, s.players.length === 2 ? 1 : 0.72);
        leaf.raw[i] += value;
        squares[tree.leaves.indexOf(leaf)][i] += value * value;
        leaf.utility[i] += Math.tanh(value / 20);
      }
    }
  }
  const solved = solveAuction(tree, rounds);
  const candidates = tree.nodes[0].actions.map((action, j) => {
    const leaf = tree.leaves[solved.outcomes[j]],
      value = leaf.raw[s.current] / rounds;
    return {
      action,
      value,
      error: Math.sqrt(
        Math.max(
          0,
          squares[solved.outcomes[j]][s.current] / rounds - value * value,
        ) / rounds,
      ),
      visits: rounds,
    };
  });
  const best = candidates.findIndex((c) => c.action === solved.action);
  candidates.unshift(...candidates.splice(best, 1));
  return {
    action: solved.action,
    candidates,
    samples: rounds * tree.leaves.length,
    transitions,
    completed,
    truncated,
    epochAdvances,
    nodes: tree.nodes.length,
    depth: s.auction!.order.length - s.auction!.index,
    scenarios: rounds,
    outcomeReuses: tree.nodes.length - tree.leaves.length,
    maxOutcomeBranches: tree.leaves.length,
  } satisfies SearchReport;
}
