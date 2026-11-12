import type { Action, State, Tile } from "./types.ts";
import { describeMove } from "./presentation.ts";
export type Box = { x: number; y: number; width: number; height: number };
export type Motion = {
  id: number;
  before: State;
  after: State;
  action: Action;
  origins: Record<string, Box>;
};
export type Journey = {
  from: string;
  to: string;
  tile?: Tile;
  sun?: number;
  delay: number;
};
export const MOTION_TIMING = {
  draw: 1500,
  ra: 1500,
  tile: 1100,
  sun: 850,
  reveal: 260,
  revealDelay: 160,
  boat: 600,
  boatDelay: 350,
} as const;
export function journeys(
  m: Pick<Motion, "before" | "after" | "action">,
): Journey[] {
  const { before, after, action } = m,
    move = describeMove(before, action, after),
    who = move.winner ?? move.actor;
  const owned = (t: Tile) => `owned-${who}-${t.kind}-${t.variant}`;
  const out: Journey[] = [];
  if (action.type === "draw") {
    const t = after.lastTile!;
    out.push({
      from: "bag",
      to: t.kind === "ra" ? "discard" : `tile-${t.id}`,
      tile: t,
      delay: 0,
    });
  }
  if (action.type === "bid" && action.sun !== null && move.kind !== "win")
    out.push({
      from: `sun-${before.current}-${action.sun}`,
      to: `bid-${before.current}`,
      sun: action.sun,
      delay: 0,
    });
  if (move.kind === "win") {
    move.tiles.forEach((tile, i) =>
      out.push({
        from: `tile-${tile.id}`,
        to: owned(tile),
        tile,
        delay: 170 + i * 65,
      }),
    );
    const sun =
      action.type === "bid" && action.sun !== null
        ? action.sun
        : before.auction!.high;
    out.push({ from: `sun-${who}-${sun}`, to: "center", sun, delay: 180 });
    out.push({
      from: "center",
      to: `sun-${who}-${before.center}`,
      sun: before.center,
      delay: 500,
    });
  }
  if (action.type === "god") {
    const t = move.tiles[0],
      god = before.players[who].tiles.find((t) => t.kind === "god")!;
    out.push({
      from: `owned-${who}-god-${god.variant}`,
      to: "discard",
      tile: god,
      delay: 0,
    });
    out.push({ from: `tile-${t.id}`, to: owned(t), tile: t, delay: 230 });
  }
  if (action.type === "discard")
    move.tiles.forEach((t, i) =>
      out.push({ from: owned(t), to: "discard", tile: t, delay: i * 90 }),
    );
  return out;
}
