import type { State, Tile } from "../types.ts";
import { random, shuffle } from "../data.ts";

// Root actions use scenario 0 on their first visit, scenario 1 on their second,
// etc. Selection randomness is separate, so exploring one branch more often
// cannot change the other branches' unseen worlds or opponent preferences.
export function sampleScenario(s: State, index: number, bag: Tile[] = s.bag) {
  const rng = random(
    Math.imul(s.steps + 1, 7919) ^
      Math.imul(s.current + 1, 104729) ^
      Math.imul(index + 1, 15485863),
  );
  return {
    bag: shuffle(bag, rng),
    model: {
      cost: s.players.map(() => 0.72 + rng() * 0.68),
      rivalry: 0.45 + rng() * 0.45,
    },
  };
}
