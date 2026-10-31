import type { Difficulty } from "./types.ts";
export type Preferences = {
  speed: number;
  sound: boolean;
  difficulty: Difficulty;
  count: number;
  humans: number;
};
export function readPreferences(): Preferences {
  const defaults: Preferences = {
    speed: 1000,
    sound: false,
    difficulty: "normal",
    count: 3,
    humans: 1,
  };
  try {
    const p = JSON.parse(localStorage.getItem("ra-preferences-v1") ?? "null");
    if (!p) return defaults;
    return {
      speed: [350, 1000, 2000].includes(p.speed) ? p.speed : 1000,
      sound: p.sound === true,
      difficulty: ["easy", "normal", "hard"].includes(p.difficulty)
        ? p.difficulty
        : "normal",
      count: [2, 3, 4, 5].includes(p.count) ? p.count : 3,
      humans:
        Number.isInteger(p.humans) && p.humans >= 1 && p.humans <= 5
          ? p.humans
          : 1,
    };
  } catch {
    return defaults;
  }
}
export function writePreferences(p: Preferences) {
  try {
    localStorage.setItem("ra-preferences-v1", JSON.stringify(p));
  } catch {
    /* A preference write failure must not interrupt play. */
  }
}
