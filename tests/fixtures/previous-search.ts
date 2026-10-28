import type { Action, State } from "../../src/game/types.ts";
import { random, shuffle } from "../../src/game/data.ts";
import { simulate } from "../../src/game/engine.ts";
import {
  futureValues,
  positionValues,
  relative,
} from "../../src/game/ai/evaluation.ts";
import {
  auctionPlan,
  balancedModel,
  candidateActions,
  policyAction,
} from "../../src/game/ai/policy.ts";

export type SearchOptions = { samples?: number };
export type SearchReport = {
  action: Action;
  samples: number;
  transitions: number;
  candidates: { action: Action; value: number; error: number }[];
};

// Common random numbers: each candidate sees the SAME unseen tile order and
// opponent preferences within a sample. This reduces noise in action comparisons.
// We search only the current epoch, then value remaining permanent holdings and
// future disk strength. No actual future bag order or private score is used.
export function searchAction(
  s: State,
  options: SearchOptions = {},
): SearchReport {
  const candidates = candidateActions(s);
  if (!candidates.length) throw new Error("没有合法行动");
  if (candidates.length === 1)
    return {
      action: candidates[0],
      samples: 0,
      transitions: 0,
      candidates: [{ action: candidates[0], value: 0, error: 0 }],
    };
  const rng = random(
      Math.imul(s.steps + 1, 7919) ^ Math.imul(s.current + 1, 104729),
    ),
    samples = Math.max(1, Math.floor(options.samples ?? 24)),
    totals = candidates.map(() => 0),
    squares = candidates.map(() => 0);
  let transitions = 0;
  for (let k = 0; k < samples; k++) {
    const world: State = {
      ...s,
      bag: shuffle(s.bag, rng),
      history: [],
      log: [],
      // Normalize all cumulative totals; opponents' hidden token totals must
      // neither leak into search nor masquerade as a known 10-point score.
      players: s.players.map((p) => ({ ...p, score: 100 })),
    };
    const model = balancedModel(s);
    model.cost = s.players.map(() => 0.72 + rng() * 0.68);
    model.rivalry = 0.45 + rng() * 0.45;
    for (let c = 0; c < candidates.length; c++) {
      let next = simulate(world, candidates[c]);
      transitions++;
      let steps = 0;
      while (next.phase !== "epoch" && next.phase !== "over" && steps < 240) {
        if (next.phase === "auction") {
          // Solve a whole auction once instead of recomputing its identical
          // continuation after each simulated bidder.
          const plan = auctionPlan(next, model);
          for (const action of plan.actions) {
            next = simulate(next, action);
            transitions++;
            steps++;
          }
        } else {
          next = simulate(next, policyAction(next, model));
          transitions++;
          steps++;
        }
      }
      const later = futureValues(next);
      const values =
        next.phase === "epoch" || next.phase === "over"
          ? next.players.map((p, i) => p.score - 100 + later[i])
          : positionValues(next);
      const value = relative(
        values,
        s.current,
        s.players.length === 2 ? 1 : 0.72,
      );
      totals[c] += value;
      squares[c] += value * value;
    }
  }
  const results = candidates
    .map((action, i) => ({
      action,
      value: totals[i] / samples,
      error: Math.sqrt(
        Math.max(0, squares[i] / samples - (totals[i] / samples) ** 2) /
          samples,
      ),
    }))
    .sort((a, b) => b.value - a.value);
  return {
    action: results[0].action,
    samples,
    transitions,
    candidates: results,
  };
}
