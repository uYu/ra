import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recorder, saveTrace } from "../scripts/lib/decision-trace.ts";
import { newGame, advance, ranking } from "../src/game/engine.ts";
import { policyAction } from "../src/game/ai/policy.ts";
import { parseSave, replay } from "../src/game/storage.ts";
test("recorded decisions save as importable game and reproduce every final state field", async () => {
  let s = newGame({ count: 3, seed: 948011, humans: 0, difficulty: "normal" });
  const rec = recorder(s.config);
  while (s.phase !== "over") {
    const action = policyAction(s);
    rec.record(
      s,
      {
        action,
        samples: 0,
        transitions: 0,
        completed: 0,
        truncated: 0,
        epochAdvances: 0,
        nodes: 1,
        depth: 0,
        scenarios: 0,
        outcomeReuses: 0,
        maxOutcomeBranches: 0,
        candidates: [{ action, value: 0, error: 0, visits: 0 }],
      },
      0,
    );
    s = advance(s, action);
  }
  const trace = rec.finish(s, { test: true });
  assert.equal(trace.actions.length, s.steps);
  assert.equal(trace.audit.decisions.length, s.steps);
  assert.deepEqual(trace.audit.ranking, ranking(s));
  trace.audit.decisions.forEach((d, i) => assert.equal(d.step, i + 1));
  const dir = await mkdtemp(join(tmpdir(), "ra-trace-"));
  try {
    const path = join(dir, "replays", "game.json");
    await saveTrace(path, trace);
    const save = parseSave(await readFile(path, "utf8"));
    assert.deepEqual(replay(save), s);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.throws(() => recorder(s.config).finish(s, {}), /Incomplete trace/);
});
