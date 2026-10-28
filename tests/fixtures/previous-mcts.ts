import type { Action, State } from "../../src/game/types.ts";
import { random, shuffle } from "../../src/game/data.ts";
import { simulate } from "../../src/game/engine.ts";
import {
  futureValues,
  positionValues,
  relative,
} from "./previous-evaluation.ts";
import {
  auctionPlan,
  balancedModel,
  candidateActions,
  policyAction,
} from "./previous-policy.ts";

export type SearchOptions = {
  /** Simulation budget per root candidate; the tree allocates it using UCT. */
  samples?: number;
  horizon?: "epoch" | "game";
};
export type SearchReport = {
  action: Action;
  samples: number;
  transitions: number;
  completed: number;
  epochAdvances: number;
  nodes: number;
  depth: number;
  candidates: {
    action: Action;
    value: number;
    error: number;
    visits: number;
  }[];
};
type Edge = {
  visits: number;
  sums: number[];
  squares: number[];
  utilities: number[];
  outcomes: Map<string, Node>;
};
type Node = { visits: number; edges: Map<string, Edge> };
const node = (): Node => ({ visits: 0, edges: new Map() });

// Tile IDs are interchangeable within a variant. Nodes never depend on the
// sampled hidden bag, and equivalent public draws share their continuation.
function actionKey(s: State, a: Action) {
  const tile = (id: number) => {
    const t = [...s.market, ...s.players[s.current].tiles].find(
      (t) => t.id === id,
    )!;
    return `${t.kind}/${t.variant}`;
  };
  if (a.type === "bid") return `bid/${a.sun}`;
  if (a.type === "god") return `god/${tile(a.tileId)}`;
  if (a.type === "discard")
    return `discard/${a.ids.map(tile).sort().join(",")}`;
  return a.type;
}

// Information-set MCTS: determinize the unseen multiset each iteration, select
// with UCT at the acting AI's decisions, expand one edge, then roll out.
// Opponents follow sampled auction preferences rather than underexplored UCT.
// A draw creates a PUBLIC observation branch, never a hidden-order branch.
export function searchAction(
  s: State,
  options: SearchOptions = {},
): SearchReport {
  const candidates = candidateActions(s);
  if (!candidates.length) throw new Error("没有合法行动");
  const budget = options.samples ?? 32;
  if (!Number.isInteger(budget) || budget < 1 || budget > 512)
    throw new Error("搜索采样次数应为 1–512 的整数");
  if (candidates.length === 1)
    return {
      action: candidates[0],
      samples: 0,
      transitions: 0,
      completed: 0,
      epochAdvances: 0,
      nodes: 1,
      depth: 0,
      candidates: [{ action: candidates[0], value: 0, error: 0, visits: 0 }],
    };
  const root = node(),
    count = s.players.length;
  const rng = random(
    Math.imul(s.steps + 1, 7919) ^ Math.imul(s.current + 1, 104729),
  );
  let transitions = 0,
    completed = 0,
    epochAdvances = 0,
    nodes = 1,
    depth = 0;
  const iterations = budget * candidates.length;
  const finished = (state: State) =>
    state.phase === "over" ||
    (options.horizon !== "game" && state.phase === "epoch");
  for (let k = 0; k < iterations; k++) {
    let next: State = {
      ...s,
      bag: shuffle(s.bag, rng),
      history: [],
      log: [],
      players: s.players.map((p) => ({ ...p, score: 100 })),
    };
    const model = balancedModel(s);
    model.cost = s.players.map(() => 0.72 + rng() * 0.68);
    model.rivalry = 0.45 + rng() * 0.45;
    const path: { node: Node; edge: Edge }[] = [];
    let branch = root,
      steps = 0;
    while (!finished(next) && steps < 64) {
      const actions = branch === root ? candidates : candidateActions(next);
      const choices = actions.map((action) => ({
        action,
        key: actionKey(next, action),
      }));
      // Randomize unexplored actions to avoid an ordering bias with tiny budgets.
      const untried = choices.filter((c) => !branch.edges.has(c.key));
      let choice = untried[Math.floor(rng() * untried.length)];
      if (!choice) {
        let best = -Infinity;
        for (const c of choices) {
          const e = branch.edges.get(c.key)!;
          const uct =
            e.utilities[next.current] / e.visits +
            1.4 * Math.sqrt(Math.log(branch.visits + 1) / e.visits);
          if (uct > best) {
            best = uct;
            choice = c;
          }
        }
      }
      let edge = branch.edges.get(choice.key);
      const expanding = !edge;
      if (!edge) {
        edge = {
          visits: 0,
          sums: Array(count).fill(0),
          squares: Array(count).fill(0),
          utilities: Array(count).fill(0),
          outcomes: new Map(),
        };
        branch.edges.set(choice.key, edge);
      }
      path.push({ node: branch, edge });
      if (next.phase === "epoch") epochAdvances++;
      next = simulate(next, choice.action);
      transitions++;
      steps++;
      // Advance opponents to the observer's next decision. Record the entire
      // resulting public position: several intervening draws may have occurred.
      while (!finished(next) && next.current !== s.current && steps < 240) {
        if (next.phase === "epoch") epochAdvances++;
        next = simulate(next, policyAction(next, model));
        transitions++;
        steps++;
      }
      const tiles = (ts: State["market"]) =>
        ts.map((t) => `${t.kind}/${t.variant}`).sort();
      const observed = JSON.stringify([
        next.epoch,
        next.phase,
        next.current,
        next.ra,
        next.center,
        next.auction && [
          next.auction.caller,
          next.auction.reason,
          next.auction.index,
          next.auction.high,
          next.auction.winner,
        ],
        tiles(next.market),
        tiles(next.pending),
        // Remaining composition is public; its sampled ORDER must never key a node.
        tiles(next.bag),
        next.players[s.current].score,
        next.players.map((p) => [p.suns, p.used, tiles(p.tiles)]),
      ]);
      let child = edge.outcomes.get(observed);
      if (!child) {
        child = node();
        edge.outcomes.set(observed, child);
        nodes++;
      }
      branch = child;
      if (expanding) break;
    }
    depth = Math.max(depth, path.length);
    // Exact auction enumeration is used only AFTER tree selection/expansion.
    // The observer's bid decisions inside the tree remain UCT branches.
    while (
      !finished(next) &&
      steps < (options.horizon === "game" ? 720 : 240)
    ) {
      const actions =
        next.phase === "auction"
          ? auctionPlan(next, model).actions
          : [policyAction(next, model)];
      for (const action of actions) {
        if (next.phase === "epoch") epochAdvances++;
        next = simulate(next, action);
        transitions++;
        steps++;
      }
    }
    if (next.phase === "over") completed++;
    const residual =
      next.phase === "over" || next.phase === "epoch"
        ? futureValues(next)
        : positionValues(next);
    const scores = residual.map((v, i) => v + next.players[i].score - 100);
    // Relative rewards account for opponents gaining points as well as our own.
    const rewards = scores.map((_, i) =>
      relative(scores, i, count === 2 ? 1 : 0.72),
    );
    for (const item of path) {
      item.node.visits++;
      item.edge.visits++;
      rewards.forEach((v, i) => {
        item.edge.sums[i] += v;
        item.edge.squares[i] += v * v;
        item.edge.utilities[i] += Math.tanh(v / 20);
      });
    }
  }
  const results = candidates
    .map((action) => {
      const e = root.edges.get(actionKey(s, action))!,
        n = e.visits;
      const value = e.sums[s.current] / n;
      return {
        action,
        value,
        visits: n,
        error: Math.sqrt(
          Math.max(0, e.squares[s.current] / n - value * value) / n,
        ),
      };
    })
    .sort((a, b) => b.visits - a.visits || b.value - a.value);
  return {
    action: results[0].action,
    samples: iterations,
    transitions,
    completed,
    epochAdvances,
    nodes,
    depth,
    candidates: results,
  };
}
