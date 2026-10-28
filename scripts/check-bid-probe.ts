import assert from "node:assert/strict";
import fs from "node:fs";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { observe } from "../src/game/ai.ts";
import { simulate, legalActions } from "../src/game/engine.ts";
import { sampleScenario } from "../src/game/ai/sampling.ts";
import { auctionPlan, policyAction } from "../src/game/ai/policy.ts";
const s = observe(
  JSON.parse(
    fs.readFileSync("tests/fixtures/last-bid-final-epoch.json", "utf8"),
  ),
);
const probe = await createWasmAi(
  fs.readFileSync("artifacts/ai-bid-search-audit-20261028/probe.wasm"),
);
const prod = await createWasmAi(fs.readFileSync("src/game/ai/ra-ai.wasm"));
assert.deepEqual(
  probe.search(s, { samples: 128, horizon: "next-epoch" }),
  prod.search(s, { samples: 128, horizon: "next-epoch" }),
);
let checks = 0,
  actionsChecked = 0;
for (let scene = 0; scene < 16; scene++)
  for (let index = 0; index < 3; index++) {
    const r = (probe as any).call(10, s, [0, scene, index]);
    const n = r.number();
    const expected = Array.from({ length: n }, () => ({
      player: r.number(),
      action: r.action(),
    }));
    const scores = Array.from({ length: s.config.count }, () => r.number());
    const world = sampleScenario(
      s,
      scene,
      [...s.bag].sort((a, b) => a.id - b.id),
    );
    let next = {
      ...structuredClone(s),
      bag: world.bag,
      players: s.players.map((p) => ({ ...p, score: 100 })),
    };
    let cursor = 0;
    const apply = (a: any) => {
      assert.equal(next.current, expected[cursor].player);
      assert.deepEqual(a, expected[cursor].action);
      next = simulate(next, a);
      cursor++;
      actionsChecked++;
    };
    apply(legalActions(s)[index]);
    while (next.phase !== "over" && cursor < 720) {
      const actions =
        next.phase === "auction"
          ? auctionPlan(next, world.model).actions
          : [policyAction(next, world.model)];
      for (const a of actions) {
        if (next.phase === "over") break;
        apply(a);
      }
    }
    assert.equal(cursor, n);
    assert.deepEqual(
      next.players.map((p) => p.score - 100),
      scores,
    );
    checks++;
  }
fs.writeFileSync(
  "artifacts/ai-bid-search-audit-20261028/reference-checks.json",
  JSON.stringify(
    {
      baselineFixedReportEqual: true,
      independentTSTrajectories: checks,
      actionsChecked,
      passed: true,
    },
    null,
    2,
  ) + "\n",
);
console.log({ checks, actionsChecked, passed: true });
