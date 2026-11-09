import type { State } from "./types.ts";

export function isOwnPlayer(state: State, owner: number): boolean {
  if (!state.players[owner]?.human) return false;
  return state.config.humans === 1 ? owner === 0 : owner === state.current;
}

// Inspecting another player's board never grants access to their hidden disks.
export function canInspectUsedSuns(state: State, owner: number): boolean {
  return state.phase === "over" || isOwnPlayer(state, owner);
}
