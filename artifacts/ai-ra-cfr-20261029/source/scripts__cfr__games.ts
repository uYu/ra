import type { Game } from "./core.ts";
type KuhnState = { cards: number[]; history: string };
export const kuhn: Game<KuhnState> = {
  players: 2,
  initial: () => ({ cards: [], history: "" }),
  actor: (s) =>
    !s.cards.length
      ? -1
      : ["pp", "bp", "bb", "pbp", "pbb"].includes(s.history)
        ? -2
        : s.history.length % 2,
  actions: () => ["p", "b"],
  next: (s, a) =>
    !s.cards.length
      ? { cards: a.split("").map(Number), history: "" }
      : { ...s, history: s.history + a },
  info: (s, i) => i + ":" + s.cards[i] + ":" + s.history,
  chance: () =>
    ["01", "02", "10", "12", "20", "21"].map((action) => ({
      action,
      probability: 1 / 6,
    })),
  utility: (s) => {
    let u: number;
    if (s.history === "bp") u = 1;
    else if (s.history === "pbp") u = -1;
    else u = (s.cards[0] > s.cards[1] ? 1 : -1) * (s.history === "pp" ? 1 : 2);
    return [u, -u];
  },
};
export type MiniState = {
  phase: "turn" | "chance" | "auction" | "over";
  current: number;
  suns: number[][];
  used: number[][];
  scores: number[];
  center: number;
  bag: number[];
  pot: number;
  ra: number;
  auctions: number;
  caller: number;
  reason: string;
  order: number[];
  index: number;
  high: number;
  winner: number;
  history: string;
};
// Deliberately small, fully public, single-epoch Ra-inspired game, NOT official Ra.
// Two numbered disks/player; gold +2, relic +3, disaster -1, two Ra tiles.
// First Ra calls an auction, second Ra ends the epoch immediately.
// A two-auction cap bounds the prototype tree independently of player count.
export function miniRa(players: number): Game<MiniState> {
  function eligible(s: MiniState, after: number) {
    for (let k = 1; k <= players; k++) {
      const i = (after + k) % players;
      if (s.suns[i].length) return i;
    }
    return -1;
  }
  function stop(s: MiniState) {
    if (++s.auctions === 2 || !s.suns.some((x) => x.length) || !s.bag.length) {
      s.phase = "over";
      return s;
    }
    s.phase = "turn";
    s.current = eligible(s, s.caller);
    return s;
  }
  function auction(s: MiniState, reason: string) {
    s.phase = "auction";
    s.caller = s.current;
    s.reason = reason;
    s.order = [];
    for (let k = 1; k <= players; k++) {
      const i = (s.caller + k) % players;
      if (s.suns[i].length) s.order.push(i);
    }
    s.index = 0;
    s.high = 0;
    s.winner = -1;
    s.current = s.order[0];
    return s;
  }
  return {
    players,
    initial: () => ({
      phase: "turn",
      current: players - 1,
      suns: Array.from({ length: players }, (_, i) => [2 * i + 2, 2 * i + 3]),
      used: Array.from({ length: players }, () => []),
      scores: Array(players).fill(0),
      center: 1,
      bag: [-1, 0, 0, 2, 3],
      pot: 0,
      ra: 0,
      auctions: 0,
      caller: players - 1,
      reason: "",
      order: [],
      index: 0,
      high: 0,
      winner: -1,
      history: "",
    }),
    actor: (s) =>
      s.phase === "over" ? -2 : s.phase === "chance" ? -1 : s.current,
    actions: (s) =>
      s.phase === "turn"
        ? ["draw", "invoke"]
        : [
            ...s.suns[s.current].filter((x) => x > s.high).map(String),
            ...(!(
              s.current === s.caller &&
              s.reason === "invoke" &&
              s.high === 0
            )
              ? ["pass"]
              : []),
          ],
    chance: (s) =>
      [...new Set(s.bag)].map((x) => ({
        action: String(x),
        probability: s.bag.filter((v) => v === x).length / s.bag.length,
      })),
    info: (s) => s.history, // Complete PUBLIC history, perfect recall; no bag order exposed.
    next: (state, a) => {
      const s = structuredClone(state);
      s.history += (s.phase === "chance" ? "C" : s.current) + ":" + a + ";";
      if (s.phase === "turn") {
        if (a === "invoke") return auction(s, "invoke");
        s.phase = "chance";
        return s;
      }
      if (s.phase === "chance") {
        const tile = Number(a);
        s.bag.splice(s.bag.indexOf(tile), 1);
        if (tile === 0) {
          if (++s.ra === 2) {
            s.phase = "over";
            return s;
          }
          return auction(s, "draw");
        }
        s.pot += tile;
        if (!s.bag.length) {
          s.phase = "over";
          return s;
        }
        s.current = eligible(s, s.current);
        s.phase = "turn";
        return s;
      }
      if (a !== "pass") {
        s.high = Number(a);
        s.winner = s.current;
      }
      if (++s.index < s.order.length) {
        s.current = s.order[s.index];
        return s;
      }
      if (s.winner >= 0) {
        const w = s.winner;
        s.scores[w] += s.pot;
        s.suns[w].splice(s.suns[w].indexOf(s.high), 1);
        s.used[w].push(s.center);
        s.center = s.high;
        s.pot = 0;
      }
      return stop(s);
    },
    utility: (s) => {
      const totals = s.suns.map((v, i) =>
        [...v, ...s.used[i]].reduce((a, b) => a + b, 0),
      );
      const scores = s.scores.map(
        (x, i) =>
          x +
          (totals[i] === Math.max(...totals) ? 2 : 0) -
          (totals[i] === Math.min(...totals) ? 2 : 0),
      );
      // Centered score is constant-sum zero for every player count. This does NOT
      // restore two-player convergence guarantees in multiplayer games.
      const mean = scores.reduce((a, b) => a + b, 0) / players;
      return scores.map((x) => x - mean);
    },
  };
}
