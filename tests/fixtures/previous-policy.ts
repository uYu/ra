import type { Action, State } from "../../src/game/types.ts";
import { legalActions, simulate, mustBid } from "../../src/game/engine.ts";
import {
  collectionAfter,
  positionValues,
  relative,
  reserveCost,
  drawsLeft,
} from "./previous-evaluation.ts";

export type OpponentModel = { cost: number[]; rivalry: number };
export const balancedModel = (s: State): OpponentModel => ({
  cost: s.players.map(() => 1),
  rivalry: 0.65,
});
export type AuctionPlan = {
  actions: Action[];
  values: number[];
  winner: number;
  sun: number;
};

// Every remaining bidder has exactly one choice. Enumerate that complete finite
// game, choosing each player's own best response rather than assuming a coalition.
export function auctionPlan(s: State, model = balancedModel(s)): AuctionPlan {
  const a = s.auction!;
  const base = positionValues(s),
    outcomes = new Map<string, number[]>();
  for (let i = 0; i < s.players.length; i++) {
    const won = collectionAfter(s, i, s.market);
    for (const sun of s.players[i].suns) {
      const changed: State = {
        ...won,
        players: won.players.map((p, j) =>
          j === i
            ? {
                ...p,
                suns: p.suns.filter((v) => v !== sun),
                used: [...p.used, s.center],
              }
            : p,
        ),
        center: sun,
      };
      const v = positionValues(changed);
      v[i] -= reserveCost(s, i, sun, model.cost[i]);
      outcomes.set(`${i}/${sun}`, v);
    }
  }
  function search(index: number, high: number, winner: number): AuctionPlan {
    if (index === a.order.length)
      return {
        actions: [],
        values: winner < 0 ? base : outcomes.get(`${winner}/${high}`)!,
        winner,
        sun: high,
      };
    const i = a.order[index],
      forced = i === a.caller && a.reason === "invoke" && high === 0;
    const bids: (number | null)[] = [
      ...(forced ? [] : [null]),
      ...s.players[i].suns.filter((sun) => sun > high).sort((x, y) => x - y),
    ];
    let best: AuctionPlan | undefined,
      value = -Infinity;
    for (const sun of bids) {
      const child = search(index + 1, sun ?? high, sun === null ? winner : i);
      const v = relative(child.values, i, model.rivalry);
      if (v > value + 1e-8) {
        best = { ...child, actions: [{ type: "bid", sun }, ...child.actions] };
        value = v;
      }
    }
    return best!;
  }
  return search(a.index, a.high, a.winner);
}

export function bestDiscard(s: State): Action {
  const player = s.current;
  let best: Action | undefined,
    value = -Infinity;
  // Identical variants produce equivalent futures; avoid evaluating every ID pair.
  const seen = new Set<string>();
  for (const a of legalActions(s)) {
    if (a.type !== "discard") continue;
    const key = a.ids
      .map((id) => {
        const t = s.players[player].tiles.find((t) => t.id === id)!;
        return `${t.kind}/${t.variant}`;
      })
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const next = {
      ...s,
      players: s.players.map((p, i) =>
        i === player
          ? {
              ...p,
              tiles: p.tiles.filter((t) => !a.ids.includes(t.id)),
            }
          : p,
      ),
    };
    const v = relative(positionValues(next), player);
    if (v > value) {
      value = v;
      best = a;
    }
  }
  return best!;
}

export function godChoices(s: State) {
  const before = positionValues(s),
    player = s.current,
    seen = new Set<string>();
  return legalActions(s)
    .filter((a): a is Extract<Action, { type: "god" }> => a.type === "god")
    .filter((a) => {
      const t = s.market.find((t) => t.id === a.tileId)!;
      const key = `${t.kind}/${t.variant}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((action) => {
      const t = s.market.find((t) => t.id === action.tileId)!;
      const withoutGod = {
        ...s,
        players: s.players.map((p, i) => {
          if (i !== player) return p;
          const god = p.tiles.find((t) => t.kind === "god")!;
          return { ...p, tiles: p.tiles.filter((t) => t.id !== god.id) };
        }),
      };
      const after = positionValues(collectionAfter(withoutGod, player, [t]));
      return {
        action,
        value: relative(after, player) - relative(before, player),
      };
    })
    .sort((a, b) => b.value - a.value);
}

// Inexpensive, public-information policy used for every player in rollouts.
export function policyAction(s: State, model = balancedModel(s)): Action {
  const actions = legalActions(s);
  if (!actions.length) throw new Error("没有合法行动");
  if (actions.length === 1) return actions[0];
  if (s.phase === "epoch") return { type: "next" };
  if (s.phase === "disaster") return bestDiscard(s);
  if (s.phase === "auction") return auctionPlan(s, model).actions[0];
  const gods = godChoices(s);
  if (gods[0]?.value > 0.7) return gods[0].action;
  if (s.phase === "god") return { type: "finish" };
  if (!actions.some((a) => a.type === "draw")) return { type: "invoke" };
  const next = simulate(s, { type: "invoke" });
  const plan = auctionPlan(next, model),
    base = positionValues(s);
  const gain =
    relative(plan.values, s.current, model.rivalry) -
    relative(base, s.current, model.rivalry);
  // Empty lots can be worthwhile when exchanging a low disk for the center.
  if (gain > (drawsLeft(s) < 7 ? 0.15 : 1.0)) return { type: "invoke" };
  return { type: "draw" };
}

export function candidateActions(s: State): Action[] {
  if (s.phase === "disaster") return [bestDiscard(s)];
  const actions = legalActions(s);
  if (s.phase === "auction") {
    // A voluntary invoker is forced to bid when everyone passed. Keep EVERY
    // affordable disk, including jumps that can block later bidders.
    if (mustBid(s)) return actions;
    return actions;
  }
  const gods = godChoices(s);
  return [
    ...actions.filter((a) => a.type !== "god"),
    ...gods.slice(0, 3).map((g) => g.action),
  ];
}
