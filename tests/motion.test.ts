import test from "node:test";
import assert from "node:assert/strict";
import { newGame, advance } from "../src/game/engine.ts";
import { journeys } from "../src/game/motion.ts";
const setup = () =>
  newGame({ count: 3, humans: 3, difficulty: "normal", seed: 100 });
test("draw travels from bag to the revealed tile, or to Ra track", () => {
  const before = setup(),
    action = { type: "draw" } as const,
    after = advance(before, action),
    out = journeys({ before, action, after });
  assert.equal(out.length, 1);
  assert.equal(out[0].from, "bag");
  assert.equal(
    out[0].to,
    after.lastTile!.kind === "ra" ? "ra" : `tile-${after.lastTile!.id}`,
  );
  assert.equal(out[0].tile?.id, after.lastTile!.id);
});
test("bid uses acting player disk and targets that player quotation", () => {
  let before = setup();
  before = advance(before, { type: "invoke" });
  const action = {
      type: "bid",
      sun: before.players[before.current].suns[0],
    } as const,
    after = advance(before, action),
    out = journeys({ before, action, after });
  assert.equal(out.length, 1);
  assert.equal(out[0].from, `sun-${before.current}-${action.sun}`);
  assert.equal(out[0].to, `bid-${before.current}`);
});
test("winning lot and both exchanged disks travel to the actual winner after another player passes", () => {
  let before = setup();
  before = advance(before, { type: "draw" });
  before = advance(before, { type: "invoke" });
  const winner = before.current,
    sun = before.players[winner].suns[0];
  before = advance(before, { type: "bid", sun });
  before = advance(before, { type: "bid", sun: null });
  const action = { type: "bid", sun: null } as const,
    after = advance(before, action),
    out = journeys({ before, action, after });
  assert.equal(out.filter((f) => f.tile).length, before.market.length);
  assert.ok(
    out.filter((f) => f.tile).every((f) => f.to.startsWith(`owned-${winner}-`)),
  );
  assert.ok(
    out.some((f) => f.from === `sun-${winner}-${sun}` && f.to === "center"),
  );
  assert.ok(
    out.some(
      (f) => f.from === "center" && f.to === `sun-${winner}-${before.center}`,
    ),
  );
  assert.equal(out.length, before.market.length + 2);
});
