import {
  rolloutAction,
  validateRolloutModel,
  type RolloutModel,
} from "./rollout.ts";
import { learnedFuture, validateValueModel, type ValueModel } from "./value.ts";
import type { Action, State } from "../types.ts";
import { random, shuffle } from "../data.ts";
import { RootHalving } from "./halving.ts";
import { simulate } from "../engine.ts";
import { sampleScenario } from "./sampling.ts";
import { futureValues, positionValues, relative } from "./evaluation.ts";
import {
  auctionPlan,
  balancedModel,
  candidateActions,
  policyAction,
} from "./policy.ts";

export type SearchOptions = {
  /** Fixed total budget = samples × root candidates. A time budget overrides this cap. */
  samples?: number;
  /** Experimental ranking of predicted future gains; accumulated hidden scores stay masked. */
  reward?: "relative" | "future-rank";
  /** Experimental epoch-boundary evaluator; policy and rewards stay unchanged. */
  valueModel?: ValueModel;
  /** Replace simulated action selection only; root priors and leaf values stay unchanged. */
  rolloutModel?: RolloutModel;
  /** Score this epoch, this and the next epoch, or the full game. */
  horizon?: "epoch" | "next-epoch" | "game";
  variant?: "uct" | "sh" | "dpw";
  /** Soft wall-time budget; finish the current rollout and cover every root action. */
  timeMs?: number;
};
export type SearchReport = {
  action: Action;
  samples: number;
  transitions: number;
  completed: number;
  /** Rollouts stopped by the transition cap before reaching their horizon. */
  truncated: number;
  epochAdvances: number;
  nodes: number;
  depth: number;
  scenarios: number;
  outcomeReuses: number;
  maxOutcomeBranches: number;
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
  particles: {
    key: string;
    state: State;
    model: ReturnType<typeof balancedModel>;
    steps: number;
    resets: number;
    deltas: number[];
    weight: number;
    child: Node;
  }[];
};
type Node = { visits: number; edges: Map<string, Edge>; preferred?: string };
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
  if (options.valueModel) validateValueModel(options.valueModel);
  if (options.rolloutModel) validateRolloutModel(options.rolloutModel);
  const reward = options.reward ?? "relative";
  if (!["relative", "future-rank"].includes(reward))
    throw new Error("未知搜索奖励");
  const candidates = candidateActions(s);
  if (!candidates.length) throw new Error("没有合法行动");
  const budget = options.samples ?? 32;
  if (!Number.isInteger(budget) || budget < 1 || budget > 512)
    throw new Error("搜索采样次数应为 1–512 的整数");
  const variant = options.variant ?? "uct";
  if (!["uct", "sh", "dpw"].includes(variant)) throw new Error("未知搜索算法");
  const timed = options.timeMs !== undefined;
  if (
    timed &&
    (!Number.isFinite(options.timeMs) ||
      options.timeMs! < 1 ||
      options.timeMs! > 1000)
  )
    throw new Error("思考时间应为 1–1000 毫秒");
  const deadline = timed ? performance.now() + options.timeMs! : Infinity;
  if (candidates.length === 1)
    return {
      action: candidates[0],
      samples: 0,
      transitions: 0,
      completed: 0,
      truncated: 0,
      epochAdvances: 0,
      nodes: 1,
      depth: 0,
      scenarios: 0,
      outcomeReuses: 0,
      maxOutcomeBranches: 0,
      candidates: [{ action: candidates[0], value: 0, error: 0, visits: 0 }],
    };
  const root = node(),
    count = s.players.length,
    bag = [...s.bag].sort((a, b) => a.id - b.id);
  const rng = random(
    Math.imul(s.steps + 1, 7919) ^ Math.imul(s.current + 1, 104729),
  );
  const chanceRng = random(
    Math.imul(s.steps + 1, 7919) ^
      Math.imul(s.current + 1, 104729) ^
      0x6a09e667,
  );
  let transitions = 0,
    completed = 0,
    truncated = 0,
    epochAdvances = 0,
    nodes = 1,
    depth = 0,
    outcomeReuses = 0,
    maxOutcomeBranches = 0,
    samples = 0;
  const iterations = timed ? 1_000_000 : budget * candidates.length;
  const halving =
    variant === "sh"
      ? new RootHalving(candidates.length, iterations, timed)
      : undefined;
  const rootMeans = () =>
    candidates.map((a) => {
      const e = root.edges.get(actionKey(s, a));
      return e?.visits ? e.utilities[s.current] / e.visits : -Infinity;
    });
  const horizon = options.horizon ?? "epoch";
  const targetEpoch = Math.min(3, s.epoch + (horizon === "next-epoch" ? 1 : 0));
  const stepLimit =
    horizon === "game" ? 720 : horizon === "next-epoch" ? 480 : 240;
  const finished = (state: State) =>
    state.phase === "over" ||
    (horizon !== "game" &&
      state.phase === "epoch" &&
      state.epoch >= targetEpoch);
  for (let k = 0; k < iterations; k++) {
    if (k >= candidates.length && timed && performance.now() >= deadline) break;
    let next: State = {
      ...s,
      bag,
      history: [],
      log: [],
      players: s.players.map((p) => ({ ...p, score: 100 })),
    };
    let model = balancedModel(s);
    const path: { node: Node; edge: Edge }[] = [];
    let branch = root,
      steps = 0;
    while (!finished(next) && steps < 64) {
      const actions = branch === root ? candidates : candidateActions(next);
      let choices = actions.map((action) => ({
        action,
        key: actionKey(next, action),
      }));
      // Cache a public-information policy prior per information set. It guides
      // the first expansion and decays with visits; it never replaces rollouts.
      branch.preferred ??= actionKey(next, policyAction(next));
      if (variant === "dpw" && branch !== root) {
        const width = Math.ceil(2 * Math.sqrt(branch.visits + 1));
        choices = [
          ...choices.filter((c) => c.key === branch.preferred),
          ...choices.filter((c) => c.key !== branch.preferred),
        ].slice(0, width);
      }
      // Every action is still explored before revisiting any existing edge.
      const untried = choices.filter((c) => !branch.edges.has(c.key));
      let choice =
        branch === root && halving
          ? choices[halving.choose()]
          : (untried.find((c) => c.key === branch.preferred) ??
            untried[Math.floor(rng() * untried.length)]);
      if (!choice) {
        let best = -Infinity;
        for (const c of choices) {
          const e = branch.edges.get(c.key)!;
          const uct =
            e.utilities[next.current] / e.visits +
            1.4 * Math.sqrt(Math.log(branch.visits + 1) / e.visits) +
            (c.key === branch.preferred ? 0.8 / (e.visits + 1) : 0);
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
          particles: [],
        };
        branch.edges.set(choice.key, edge);
      }
      if (branch === root) {
        const scenario = sampleScenario(s, edge.visits, bag);
        next = { ...next, bag: scenario.bag };
        model = scenario.model;
      }
      path.push({ node: branch, edge });
      // DPW samples only retained generative particles when the outcome width
      // is full. Nodes remain keyed by PUBLIC observations. Hidden bag order is
      // freshly determinized on reuse; cached opponent score totals are rebased.
      if (
        variant === "dpw" &&
        edge.outcomes.size >= Math.ceil(2 * Math.sqrt(edge.visits + 1))
      ) {
        let ticket = Math.floor(
          chanceRng() * edge.particles.reduce((n, p) => n + p.weight, 0),
        );
        const particle = edge.particles.find((p) => (ticket -= p.weight) < 0)!;
        next = {
          ...particle.state,
          bag: shuffle(
            [...particle.state.bag].sort((a, b) => a.id - b.id),
            chanceRng,
          ),
          players: particle.state.players.map((p, i) => ({
            ...p,
            score: next.players[i].score + particle.deltas[i],
          })),
        };
        model = particle.model;
        steps += particle.steps;
        epochAdvances += particle.resets;
        outcomeReuses++;
        branch = particle.child;
        continue;
      }
      const beforeSteps = steps,
        beforeResets = epochAdvances,
        beforeScores = next.players.map((p) => p.score);
      if (next.phase === "epoch") epochAdvances++;
      next = simulate(next, choice.action);
      transitions++;
      steps++;
      // Advance opponents to the observer's next decision. Record the entire
      // resulting public position: several intervening draws may have occurred.
      while (!finished(next) && next.current !== s.current && steps < 240) {
        // A solved auction continuation remains valid after each bid. Reuse
        // it until the observer acts instead of solving the same tree again.
        const actions = options.rolloutModel
          ? [rolloutAction(next, options.rolloutModel)]
          : next.phase === "auction"
            ? auctionPlan(next, model).actions
            : [policyAction(next, model)];
        for (const action of actions) {
          if (finished(next) || next.current === s.current || steps >= 240)
            break;
          if (next.phase === "epoch") epochAdvances++;
          next = simulate(next, action);
          transitions++;
          steps++;
        }
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
        // A cached transition must also distinguish disaster/god resumption
        // and pending turn/auction order. Preserve the reference UCT key.
        ...(variant === "dpw"
          ? [next.resume, next.next, next.auction?.order, next.auction?.bids]
          : []),
      ]);
      let child = edge.outcomes.get(observed);
      if (!child) {
        child = node();
        edge.outcomes.set(observed, child);
        nodes++;
      }
      maxOutcomeBranches = Math.max(maxOutcomeBranches, edge.outcomes.size);
      if (variant === "dpw") {
        const old = edge.particles.find((p) => p.key === observed);
        const particle = {
          key: observed,
          state: next,
          model,
          steps: steps - beforeSteps,
          resets: epochAdvances - beforeResets,
          deltas: next.players.map((p, i) => p.score - beforeScores[i]),
          weight: (old?.weight ?? 0) + 1,
          child,
        };
        if (old) Object.assign(old, particle);
        else edge.particles.push(particle);
      }
      branch = child;
      if (expanding) break;
    }
    depth = Math.max(depth, path.length);
    // Exact auction enumeration is used only AFTER tree selection/expansion.
    // The observer's bid decisions inside the tree remain UCT branches.
    while (!finished(next) && steps < stepLimit) {
      const actions = options.rolloutModel
        ? [rolloutAction(next, options.rolloutModel)]
        : next.phase === "auction"
          ? auctionPlan(next, model).actions
          : [policyAction(next, model)];
      for (const action of actions) {
        if (finished(next) || steps >= stepLimit) break;
        if (next.phase === "epoch") epochAdvances++;
        next = simulate(next, action);
        transitions++;
        steps++;
      }
    }
    if (next.phase === "over") completed++;
    if (!finished(next)) truncated++;
    const residual =
      next.phase === "over" || next.phase === "epoch"
        ? options.valueModel
          ? learnedFuture(next, options.valueModel)
          : futureValues(next)
        : positionValues(next);
    const scores = residual.map((v, i) => v + next.players[i].score - 100);
    // Relative rewards account for opponents gaining points as well as our own.
    const rewards = scores.map((_, i) =>
      reward === "future-rank"
        ? scores.reduce(
            (sum, v, j) =>
              sum +
              (i === j ? 0 : scores[i] > v ? 1 : scores[i] === v ? 0.5 : 0),
            0,
          ) /
          (count - 1)
        : relative(scores, i, count === 2 ? 1 : 0.72),
    );
    for (const item of path) {
      item.node.visits++;
      item.edge.visits++;
      rewards.forEach((v, i) => {
        item.edge.sums[i] += v;
        item.edge.squares[i] += v * v;
        item.edge.utilities[i] +=
          reward === "future-rank" ? 2 * v - 1 : Math.tanh(v / 20);
      });
    }
    samples++;
    halving?.record(rootMeans());
  }
  const selected = halving ? candidates[halving.best(rootMeans())] : undefined;
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
    .sort(
      (a, b) =>
        Number(b.action === selected) - Number(a.action === selected) ||
        b.visits - a.visits ||
        b.value - a.value,
    );
  return {
    action: results[0].action,
    samples,
    transitions,
    completed,
    truncated,
    epochAdvances,
    nodes,
    depth,
    scenarios: Math.max(...results.map((c) => c.visits)),
    outcomeReuses,
    maxOutcomeBranches,
    candidates: results,
  };
}
