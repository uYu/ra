import type { State } from "../types.ts";

/** Shared player-perspective MLP, trained only on scored epoch boundaries. */
export type ValueModel = {
  version: 1;
  inputs: number;
  hidden: number;
  weights: number[];
};
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
function holdings(s: State, player: number) {
  const p = s.players[player],
    m = Array<number>(8).fill(0);
  let ph = 0,
    nile = 0;
  for (const t of p.tiles) {
    if (t.kind === "monument") m[t.variant]++;
    if (t.kind === "pharaoh") ph++;
    if (t.kind === "nile") nile++;
  }
  // Monument identities are interchangeable. Histograms preserve exact sets.
  return [
    ...Array.from({ length: 6 }, (_, n) => m.filter((x) => x === n).length / 8),
    ph / 10,
    nile / 10,
    ...Array.from({ length: 16 }, (_, n) =>
      Number(p.suns.includes(n + 1) || p.used.includes(n + 1)),
    ),
  ];
}
export function valueFeatures(s: State, player: number): number[] {
  const own = holdings(s, player),
    others = s.players
      .map((_, i) => holdings(s, i))
      .filter((_, i) => i !== player);
  return [
    ...[2, 3, 4, 5].map((n) => Number(n === s.players.length)),
    Number(s.epoch === 1),
    Number(s.epoch === 2),
    s.center / 16,
    ...kinds.map((k) => s.bag.filter((t) => t.kind === k).length / 40),
    ...own,
    ...own.map(
      (_, j) => others.reduce((v, row) => v + row[j], 0) / others.length,
    ),
    ...own.map((_, j) => Math.max(...others.map((row) => row[j]))),
  ];
}
export const VALUE_INPUTS = 91;
export function validateValueModel(m: ValueModel) {
  if (
    m.version !== 1 ||
    m.inputs !== VALUE_INPUTS ||
    !Number.isInteger(m.hidden) ||
    m.hidden < 1 ||
    m.hidden > 48 ||
    m.weights.length !== m.hidden * (m.inputs + 2) + 1 ||
    m.weights.some((x) => !Number.isFinite(x))
  )
    throw new Error("Invalid value model");
}
export function learnedFuture(s: State, model: ValueModel): number[] {
  if (s.epoch === 3 || s.phase === "over") return s.players.map(() => 0);
  return s.players.map((_, i) => {
    const x = valueFeatures(s, i),
      { hidden: h, inputs: d, weights: w } = model;
    let y = w[h * (d + 1) + h];
    for (let j = 0; j < h; j++) {
      let z = w[j * (d + 1) + d];
      for (let k = 0; k < d; k++) z += w[j * (d + 1) + k] * x[k];
      y += w[h * (d + 1) + j] * Math.tanh(z);
    }
    return y * 40;
  });
}
export function encodeValueModel(model?: ValueModel): number[] {
  if (!model) return [0];
  validateValueModel(model);
  return [1, model.inputs, model.hidden, ...model.weights];
}
