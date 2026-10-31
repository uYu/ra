import type { Action, Difficulty, State, Tile } from "./types.ts";
import { makeTiles, random } from "./data.ts";
import { legalActions, scoreEpoch } from "./engine.ts";
import { searchAction } from "./ai/search.ts";
import { policyAction } from "./ai/policy.ts";

// Play through the next epoch's scoring; from epoch two this reaches game end.
// Keep the low-level search API's historical default available to experiments.
export const hardSearchHorizon = "next-epoch" as const;
// Keep paired frozen-tree evaluation available as an explicit experiment.
export const hardSearchSampling = "tree" as const;
// Only public tiles and their remaining multiset are sent to the worker.
export function observe(s: State): State {
  const copy = structuredClone(s),
    seen = new Set(
      [
        ...s.market,
        ...s.discarded,
        ...s.pending,
        ...s.players.flatMap((p) => p.tiles),
      ].map((t) => t.id),
    );
  copy.bag = makeTiles().filter((t) => !seen.has(t.id));
  copy.config.seed = 0;
  copy.players.forEach((p, i) => {
    if (i !== s.current) p.score = 10;
  });
  copy.history = [];
  return copy;
}
function potential(s: State, player: number) {
  const future = { ...s, epoch: 3 },
    p = s.players[player];
  const now = scoreEpoch(s)[player].delta,
    later = scoreEpoch(future)[player].parts.古迹;
  const civ = new Set(
    p.tiles.filter((t) => t.kind === "civilization").map((t) => t.variant),
  ).size;
  return (
    now +
    (s.epoch < 3 ? later * (s.epoch === 1 ? 0.6 : 0.8) : 0) +
    (civ === 1 ? 1.4 : civ === 2 ? 3 : 0) +
    (s.epoch < 3
      ? p.tiles.filter((t) => t.kind === "pharaoh").length * 0.45 +
        p.tiles.filter((t) => t.kind === "nile").length * 0.55
      : 0)
  );
}
function applyLot(s: State, player: number, lot: Tile[]): State {
  const c = {
      ...s,
      players: s.players.map((p) => ({ ...p, tiles: [...p.tiles] })),
    },
    p = c.players[player];
  p.tiles.push(
    ...lot.filter(
      (t) => !["earthquake", "funeral", "war", "drought"].includes(t.kind),
    ),
  );
  for (const d of lot) {
    const k = (
      {
        earthquake: "monument",
        funeral: "pharaoh",
        war: "civilization",
        drought: "river",
      } as Record<string, string>
    )[d.kind];
    if (!k) continue;
    for (let n = 0; n < 2; n++) {
      let opts = p.tiles.filter((t) =>
        k === "river" ? t.kind === "nile" || t.kind === "flood" : t.kind === k,
      );
      if (k === "river" && opts.some((t) => t.kind === "flood"))
        opts = opts.filter((t) => t.kind === "flood");
      let best: Tile | undefined,
        bestScore = -Infinity;
      for (const t of opts) {
        p.tiles = p.tiles.filter((x) => x.id !== t.id);
        const v = potential(c, player);
        p.tiles.push(t);
        if (v > bestScore) {
          bestScore = v;
          best = t;
        }
      }
      if (best) p.tiles = p.tiles.filter((t) => t.id !== best.id);
    }
  }
  return c;
}
export function lotValue(s: State, player: number, lot = s.market) {
  return potential(applyLot(s, player, lot), player) - potential(s, player);
}
export function chooseAction(
  state: State,
  difficulty: Difficulty = state.config.difficulty,
): Action {
  // The public entry point sanitizes even callers outside the Web Worker.
  const s = observe(state);
  if (difficulty === "hard")
    return searchAction(s, {
      horizon: hardSearchHorizon,
      sampling: hardSearchSampling,
    }).action;
  if (difficulty === "normal") return policyAction(s);
  const actions = legalActions(s);
  if (!actions.length) throw new Error("没有合法行动");
  if (actions.length === 1) return actions[0];
  const rng = random((s.steps + 1) * 7919 + s.current * 109);
  if (s.phase === "epoch") return { type: "next" };
  if (s.phase === "disaster") return policyAction(s);
  const value = lotValue(s, s.current);
  if (s.phase === "auction") {
    const bids = actions
      .filter(
        (a): a is Extract<Action, { type: "bid" }> =>
          a.type === "bid" && a.sun !== null,
      )
      .sort((a, b) => a.sun! - b.sun!);
    const pass = actions.find((a) => a.type === "bid" && a.sun === null);
    if (!pass) return bids[0];
    return value > 1 && rng() < 0.7 && bids.length
      ? bids[Math.floor(rng() * bids.length)]
      : pass;
  }
  const gods = actions
    .filter((a): a is Extract<Action, { type: "god" }> => a.type === "god")
    .map((a) => ({
      a,
      value:
        lotValue(s, s.current, [s.market.find((t) => t.id === a.tileId)!]) - 2,
    }))
    .sort((a, b) => b.value - a.value);
  if (gods[0]?.value > 2) return gods[0].a;
  if (s.phase === "god") return { type: "finish" };
  if (!actions.some((a) => a.type === "draw")) return { type: "invoke" };
  return value > 3 && rng() < 0.45 ? { type: "invoke" } : { type: "draw" };
}
