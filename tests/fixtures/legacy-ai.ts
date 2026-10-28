// Frozen pre-upgrade opponent for reproducible strength comparisons.
import type { Action, Difficulty, State, Tile } from "../../src/game/types.ts";
import { makeTiles, random, RA_LIMIT } from "../../src/game/data.ts";
import { legalActions, scoreEpoch } from "../../src/game/engine.ts";
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
  s: State,
  difficulty: Difficulty = s.config.difficulty,
): Action {
  const actions = legalActions(s);
  if (!actions.length) throw new Error("没有合法行动");
  if (actions.length === 1) return actions[0];
  const rng = random((s.steps + 1) * 7919 + s.current * 109),
    p = s.players[s.current];
  if (s.phase === "epoch") return { type: "next" };
  if (s.phase === "disaster") {
    return actions
      .map((a) => {
        if (a.type !== "discard") throw new Error("灾难阶段行动无效");
        const after = {
          ...s,
          players: s.players.map((q, i) =>
            i === s.current
              ? { ...q, tiles: q.tiles.filter((t) => !a.ids.includes(t.id)) }
              : q,
          ),
        };
        return { a, value: potential(after, s.current) };
      })
      .sort((a, b) => b.value - a.value)[0].a;
  }
  const value = lotValue(s, s.current),
    urgency = s.ra / RA_LIMIT[s.config.count];
  if (s.phase === "auction") {
    const bids = actions
      .filter(
        (a): a is Extract<Action, { type: "bid" }> =>
          a.type === "bid" && a.sun !== null,
      )
      .sort((a, b) => a.sun! - b.sun!);
    const pass = actions.find((a) => a.type === "bid" && a.sun === null);
    if (!pass) return bids[0];
    if (difficulty === "easy") {
      return value > 1 && rng() < 0.7 && bids.length
        ? bids[Math.floor(rng() * bids.length)]
        : pass;
    }
    const maxSun = Math.max(...p.suns, ...p.used),
      disks = p.suns.length;
    const options = bids
      .map((a) => {
        const sun = a.sun!,
          upgrade = (s.center - sun) * (s.epoch === 3 ? 0.22 : 0.32);
        const cost =
          (2.4 + (sun / maxSun) * 3.2) *
          (1 - urgency * 0.8) *
          (disks === 1 ? 1.3 : 1);
        const remaining = s.auction!.order.slice(s.auction!.index + 1),
          likelyOverbid = remaining.filter(
            (i) =>
              s.players[i].suns.some((n) => n > sun) && lotValue(s, i) > cost,
          ).length;
        return {
          a,
          v:
            value +
            upgrade -
            cost -
            (difficulty === "hard" ? likelyOverbid * 0.25 : 0),
        };
      })
      .sort((a, b) => b.v - a.v);
    return options[0]?.v > 0 ? options[0].a : pass;
  }
  const gods = actions
    .filter((a): a is Extract<Action, { type: "god" }> => a.type === "god")
    .map((a) => ({
      a,
      v: lotValue(s, s.current, [s.market.find((t) => t.id === a.tileId)!]) - 2,
    }))
    .sort((a, b) => b.v - a.v);
  if (gods[0]?.v > (difficulty === "easy" ? 2 : 0.6)) return gods[0].a;
  if (s.phase === "god") return { type: "finish" };
  if (!actions.some((a) => a.type === "draw")) return { type: "invoke" };
  if (difficulty === "easy")
    return value > 3 && rng() < 0.45 ? { type: "invoke" } : { type: "draw" };
  const maxOwn = Math.max(...p.suns),
    rivals = s.players.filter((_, i) => i !== s.current).flatMap((q) => q.suns),
    canWin = maxOwn > Math.max(0, ...rivals);
  let waitGain = 1.5;
  if (difficulty === "hard" && s.bag.length) {
    let total = 0;
    for (let i = 0; i < 64; i++) {
      const t = s.bag[Math.floor(rng() * s.bag.length)];
      total +=
        t.kind === "ra"
          ? -value * (s.ra + 1 >= RA_LIMIT[s.config.count] ? 1 : 0.1)
          : lotValue(s, s.current, [...s.market, t]) - value;
    }
    waitGain = total / 64;
  }
  if (
    value > 0.5 &&
    ((urgency > 0.65 && value > 2) ||
      (canWin && value > 4 && waitGain < 1.5) ||
      (!canWin && value > 2.5 && Math.min(...p.suns) < Math.min(...rivals)) ||
      value > 8)
  )
    return { type: "invoke" };
  return { type: "draw" };
}
