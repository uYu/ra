import type { Player, State, Tile } from "../../src/game/types.ts";
import { RA_LIMIT, isDisaster } from "../../src/game/data.ts";

export function inventory(p: Player) {
  const m = Array<number>(8).fill(0),
    c = Array<number>(5).fill(0);
  let ph = 0,
    nile = 0,
    flood = 0,
    gold = 0,
    god = 0;
  for (const t of p.tiles) {
    if (t.kind === "monument") m[t.variant]++;
    else if (t.kind === "civilization") c[t.variant]++;
    else if (t.kind === "pharaoh") ph++;
    else if (t.kind === "nile") nile++;
    else if (t.kind === "flood") flood++;
    else if (t.kind === "gold") gold++;
    else if (t.kind === "god") god++;
  }
  return { m, c, ph, nile, flood, gold, god, civ: c.filter(Boolean).length };
}
export function monuments(m: number[]) {
  const different = m.filter(Boolean).length;
  return (
    (different === 8 ? 15 : different === 7 ? 10 : different) +
    m.reduce((v, n) => v + (n >= 3 ? (n - 2) * 5 : 0), 0)
  );
}
export function drawsLeft(s: State) {
  const ra = s.bag.filter((t) => t.kind === "ra").length;
  // Negative hypergeometric expectation, including the epoch-ending Ra tile.
  return Math.min(
    s.bag.length,
    ((RA_LIMIT[s.config.count] - s.ra) * (s.bag.length + 1)) / (ra + 1),
  );
}
const sum = (a: number[]) => a.reduce((v, n) => v + n, 0);
function softRace(counts: number[], i: number, width: number) {
  // Smooth the exact majority discontinuity so a lead can be defended and a
  // near tie pursued. Future growth makes a one-tile lead less than certain.
  let most = 1,
    least = 1;
  for (let j = 0; j < counts.length; j++)
    if (j !== i) {
      const d = (counts[i] - counts[j]) / width;
      most *= 1 / (1 + Math.exp(-d));
      least *= 1 / (1 + Math.exp(d));
    }
  return 5 * most - 2 * least;
}
function diskFuture(s: State, i: number) {
  const disks = s.players.flatMap((p) => [...p.suns, ...p.used]);
  const owned = [...s.players[i].suns, ...s.players[i].used];
  return owned.reduce(
    (v, sun) =>
      v +
      2.7 *
        (disks.filter((d) => d < sun).length / Math.max(1, disks.length - 1) -
          0.5),
    0,
  );
}
// Expected residual value AFTER this epoch's points have been banked. Never
// includes players' private score totals. Permanent holdings and suns are public.
export function futureValues(s: State): number[] {
  const years = 3 - s.epoch;
  if (!years) return s.players.map(() => 0);
  const all = s.players.map(inventory),
    ph = all.map((p) => p.ph);
  return all.map(
    (p, i) =>
      monuments(p.m) +
      p.m.reduce((v, n) => v + (n === 2 ? (1.35 * years) / 2 : 0), 0) +
      (p.m.filter(Boolean).length === 6 ? (1.1 * years) / 2 : 0) +
      years * (softRace(ph, i, 2.1) + p.nile * 0.63 + diskFuture(s, i)),
  );
}
export function positionValues(s: State): number[] {
  const all = s.players.map(inventory),
    ph = all.map((p) => p.ph),
    lo = Math.min(...ph),
    hi = Math.max(...ph),
    future = futureValues(s),
    draws = drawsLeft(s),
    active = sum(s.players.map((p) => p.suns.length)),
    floodLeft = s.bag.filter((t) => t.kind === "flood").length,
    allSuns = s.players.map((p) => sum([...p.suns, ...p.used])),
    sunLo = Math.min(...allSuns),
    sunHi = Math.max(...allSuns);
  return all.map((p, i) => {
    const share = s.players[i].suns.length / Math.max(1, active);
    const access = Math.min(1, (draws * share) / 9);
    const riverChance =
      1 - Math.exp((-floodLeft * draws * share) / Math.max(1, s.bag.length));
    const cv = p.civ === 0 ? -5 : p.civ >= 3 ? (p.civ - 2) * 5 : 0;
    return (
      (hi === lo ? 0 : ph[i] === hi ? 5 : ph[i] === lo ? -2 : 0) +
      (p.flood ? p.flood + p.nile : p.nile * riverChance) +
      cv +
      (p.civ === 1 ? 1.0 : p.civ === 2 ? 2.6 : 0) * access +
      p.gold * 3 +
      p.god * (2 + 0.65 * access) +
      0.25 * access * softRace(ph, i, 1.5) +
      future[i] +
      (s.epoch === 3
        ? monuments(p.m) +
          (sunHi === sunLo
            ? 0
            : allSuns[i] === sunHi
              ? 5
              : allSuns[i] === sunLo
                ? -5
                : 0) +
          p.m.reduce((v, n) => v + (n === 2 ? 1.15 * access : 0), 0)
        : 0)
    );
  });
}
// Value of keeping a usable disk for a DIFFERENT lot this epoch. A disk cannot
// be reused now; near the deadline its option value falls instead of hoarding.
export function reserveCost(s: State, player: number, sun: number, scale = 1) {
  const p = s.players[player],
    disks = s.players.flatMap((q) => q.suns),
    rank = disks.filter((d) => d < sun).length / Math.max(1, disks.length - 1),
    draws = drawsLeft(s),
    opportunities =
      draws / 4.2 + Math.max(0, RA_LIMIT[s.config.count] - s.ra - 1),
    availability = Math.min(1, opportunities / Math.max(1, disks.length - 1)),
    last = p.suns.length === 1 ? 1.1 : 1;
  return scale * (3.1 + 3.4 * rank) * availability * last;
}
export function relative(values: number[], player: number, rivalry = 0.65) {
  const others = values.filter((_, i) => i !== player);
  return values[player] - (rivalry * sum(others)) / Math.max(1, others.length);
}

// Resolve the collection part of an award, including optimal disaster discards.
// Droughts remove Floods first, even when this deactivates a large Nile holding.
export function collectionAfter(s: State, player: number, lot: Tile[]): State {
  const c = {
    ...s,
    players: s.players.map((p) => ({ ...p, tiles: [...p.tiles] })),
  };
  const p = c.players[player];
  p.tiles.push(...lot.filter((t) => !isDisaster(t.kind)));
  for (const d of lot.filter((t) => isDisaster(t.kind))) {
    for (let n = 0; n < 2; n++) {
      const kind = (
        {
          earthquake: "monument",
          funeral: "pharaoh",
          war: "civilization",
        } as Record<string, string>
      )[d.kind];
      let opts = p.tiles.filter((t) =>
        d.kind === "drought"
          ? t.kind === "nile" || t.kind === "flood"
          : t.kind === kind,
      );
      if (d.kind === "drought" && opts.some((t) => t.kind === "flood"))
        opts = opts.filter((t) => t.kind === "flood");
      // Tiles of the same variant are strategically interchangeable.
      opts = opts.filter(
        (t, j) =>
          opts.findIndex(
            (x) => x.kind === t.kind && x.variant === t.variant,
          ) === j,
      );
      let best = opts[0],
        value = -Infinity;
      for (const t of opts) {
        const before = p.tiles;
        p.tiles = before.filter((x) => x.id !== t.id);
        const v = relative(positionValues(c), player);
        p.tiles = before;
        if (v > value) {
          best = t;
          value = v;
        }
      }
      if (best) p.tiles = p.tiles.filter((t) => t.id !== best.id);
    }
  }
  return c;
}
