import type { State } from "./types.ts";

// A shared-screen game belongs to the human whose turn it is. Inspecting
// another player board must never grant access to that player's hidden disks.
export function canInspectUsedSuns(state: State, owner: number): boolean {
  if (state.phase === "over") return true;
  if (!state.players[owner]?.human) return false;
  return state.config.humans === 1 ? owner === 0 : owner === state.current;
}
