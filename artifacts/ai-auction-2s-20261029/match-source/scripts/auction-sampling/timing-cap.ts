import assert from "node:assert/strict";
// Frozen original UCT stops at 1,000,000 iterations even in timed mode.
// Exhaustive auction sampling has no such cap. Preserve all other timing checks.
export function checkSearchTiming(elapsed: number, samples: number, exhaustive: boolean, timeMs: number) {
  if (elapsed >= timeMs * 0.95) return false;
  assert.ok(Number.isFinite(elapsed) && elapsed >= 0);
  assert.ok(!exhaustive && samples === 1000000,
    `Unexpected short search: elapsed=${elapsed}, samples=${samples}, exhaustive=${exhaustive}`);
  return true;
}
