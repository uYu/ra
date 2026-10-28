import type { State, Player, Action } from "../types.ts";
import { candidateActions } from "./policy.ts";
export type RolloutModel = {
  version: 1;
  inputs: number;
  hidden: number;
  weights: number[];
};
export const POLICY_STATE_INPUTS = 263;
export const POLICY_ACTION_INPUTS = 24;
export const POLICY_INPUTS = POLICY_STATE_INPUTS + POLICY_ACTION_INPUTS;
const kinds = [
  "monument",
  "pharaoh",
  "god",
  "gold",
  "civilization",
  "nile",
  "flood",
  "ra",
  "earthquake",
  "funeral",
  "war",
  "drought",
];
const phases = ["turn", "auction", "disaster", "god", "epoch", "over"];
const types = ["draw", "invoke", "bid", "god", "finish", "discard", "next"];
function holdings(p: Player) {
  const m = Array<number>(8).fill(0),
    c = Array<number>(5).fill(0),
    counts = Array<number>(12).fill(0);
  for (const t of p.tiles) {
    counts[kinds.indexOf(t.kind)]++;
    if (t.kind === "monument") m[t.variant]++;
    if (t.kind === "civilization") c[t.variant]++;
  }
  return {
    m,
    c,
    x: [
      ...Array.from(
        { length: 6 },
        (_, i) => m.filter((n) => n === i).length / 8,
      ),
      ...Array.from(
        { length: 6 },
        (_, i) => c.filter((n) => n === i).length / 5,
      ),
      ...[1, 5, 6, 3, 2].map((k) => counts[k] / 10),
      ...Array.from({ length: 16 }, (_, i) => Number(p.suns.includes(i + 1))),
      ...Array.from({ length: 16 }, (_, i) => Number(p.used.includes(i + 1))),
    ],
  };
}
export function policyStateFeatures(s: State): number[] {
  const all = s.players.map(holdings),
    own = all[s.current],
    other = all.filter((_, i) => i !== s.current);
  let next = -1;
  if (s.auction) next = s.auction.order[s.auction.index + 1] ?? -1;
  else
    for (let offset = 1; offset < s.players.length; offset++) {
      const i = (s.current + offset) % s.players.length;
      if (s.players[i].suns.length) {
        next = i;
        break;
      }
    }
  const a = s.auction;
  return [
    ...[2, 3, 4, 5].map((n) => Number(n === s.players.length)),
    ...[1, 2, 3].map((n) => Number(n === s.epoch)),
    ...phases.map((p) => Number(p === s.phase)),
    s.ra / 10,
    s.center / 16,
    ...kinds.map((k) => s.bag.filter((t) => t.kind === k).length / 40),
    ...kinds.map((k) => s.market.filter((t) => t.kind === k).length / 8),
    ...kinds.map((k) => s.pending.filter((t) => t.kind === k).length / 2),
    Number(a?.caller === s.current),
    (a ? a.order.length - a.index : 0) / 5,
    (a?.high ?? 0) / 16,
    Number(
      Boolean(
        a && a.reason === "invoke" && a.caller === s.current && a.high === 0,
      ),
    ),
    ...own.x,
    ...own.x.map(
      (_, j) => other.reduce((v, p) => v + p.x[j], 0) / other.length,
    ),
    ...own.x.map((_, j) => Math.max(...other.map((p) => p.x[j]))),
    ...(next < 0 ? Array<number>(49).fill(0) : all[next].x),
    ...Array.from(
      { length: 6 },
      (_, n) =>
        s.market.filter((t) => t.kind === "monument" && own.m[t.variant] === n)
          .length / 8,
    ),
    ...Array.from(
      { length: 6 },
      (_, n) =>
        s.market.filter(
          (t) => t.kind === "civilization" && own.c[t.variant] === n,
        ).length / 5,
    ),
  ];
}
export function policyActionFeatures(s: State, a: Action): number[] {
  const p = s.players[s.current];
  const selected =
    a.type === "god"
      ? s.market.filter((t) => t.id === a.tileId)
      : a.type === "discard"
        ? p.tiles.filter((t) => a.ids.includes(t.id))
        : a.type === "bid" && a.sun !== null
          ? s.market
          : [];
  let mon = 0,
    civ = 0;
  for (const t of selected) {
    if (t.kind === "monument")
      mon += p.tiles.filter(
        (x) => x.kind === "monument" && x.variant === t.variant,
      ).length;
    if (t.kind === "civilization")
      civ += p.tiles.filter(
        (x) => x.kind === "civilization" && x.variant === t.variant,
      ).length;
  }
  return [
    ...types.map((t) => Number(t === a.type)),
    a.type === "bid" ? (a.sun ?? 0) / 16 : 0,
    Number(a.type === "bid" && a.sun === null),
    ...kinds.map((k) => selected.filter((t) => t.kind === k).length / 8),
    mon / 40,
    civ / 25,
    selected.length / 8,
  ];
}
export function validateRolloutModel(m: RolloutModel) {
  if (
    m.version !== 1 ||
    m.inputs !== POLICY_INPUTS ||
    !Number.isInteger(m.hidden) ||
    m.hidden < 1 ||
    m.hidden > 16 ||
    m.weights.length !== m.hidden * (m.inputs + 2) + 1 ||
    m.weights.some((x) => !Number.isFinite(x) || Math.abs(x) > 1e6)
  )
    throw new Error("Invalid rollout model");
}
export function rolloutScores(
  s: State,
  m: RolloutModel,
  actions = candidateActions(s),
) {
  const base = policyStateFeatures(s),
    w = m.weights,
    d = m.inputs,
    h = m.hidden;
  const state = Array.from({ length: h }, (_, j) => {
    let z = w[j * (d + 1) + d];
    for (let k = 0; k < base.length; k++) z += w[j * (d + 1) + k] * base[k];
    return z;
  });
  return actions.map((action) => {
    const x = policyActionFeatures(s, action);
    let y = w[h * (d + 1) + h];
    for (let j = 0; j < h; j++) {
      let z = state[j];
      for (let k = 0; k < x.length; k++)
        z += w[j * (d + 1) + base.length + k] * x[k];
      y += w[h * (d + 1) + j] * Math.tanh(z);
    }
    return { action, logit: y };
  });
}
export function rolloutAction(s: State, m: RolloutModel): Action {
  const actions = candidateActions(s);
  if (!actions.length) throw new Error("No rollout actions");
  if (actions.length === 1) return actions[0];
  const scores = rolloutScores(s, m, actions);
  let best = 0;
  for (let i = 1; i < scores.length; i++)
    if (scores[i].logit > scores[best].logit) best = i;
  return scores[best].action;
}
export function encodeRolloutModel(m?: RolloutModel): number[] {
  if (!m) return [0];
  validateRolloutModel(m);
  return [1, m.inputs, m.hidden, ...m.weights];
}
