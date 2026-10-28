import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { legalActions, advance } from "../src/game/engine.ts";
import { candidateActions, auctionPlan } from "../src/game/ai/policy.ts";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import type { State } from "../src/game/types.ts";
const ai = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
const regression: State = JSON.parse(
  await readFile("tests/fixtures/last-bid-final-epoch.json", "utf8"),
);

test("recorded step255 retains all legal root alternatives without a bespoke last-bid rule", () => {
  const before = structuredClone(regression),
    legal = legalActions(regression);
  assert.deepEqual(
    legal,
    [1, 4, 13].map((sun) => ({ type: "bid", sun })),
  );
  assert.deepEqual(candidateActions(regression), legal);
  assert.deepEqual(ai.candidates(regression), legal);
  assert.deepEqual(ai.policy(regression), { type: "bid", sun: 1 });
  assert.deepEqual(auctionPlan(regression).actions[0], { type: "bid", sun: 1 });
  const one = advance(regression, { type: "bid", sun: 1 }),
    four = advance(regression, { type: "bid", sun: 4 });
  assert.deepEqual(one.players[3].tiles, four.players[3].tiles);
  assert.deepEqual(one.players[3].used, four.players[3].used);
  assert.deepEqual(one.players[3].suns, [4, 13]);
  assert.deepEqual(four.players[3].suns, [1, 13]);
  assert.deepEqual(regression, before);
});
