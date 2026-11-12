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
    after.lastTile!.kind === "ra" ? "discard" : `tile-${after.lastTile!.id}`,
  );
  assert.equal(out[0].tile?.id, after.lastTile!.id);
});
test("a Ra draw reveals and discards a single continuous card", () => {
  const before = setup();
  const index = before.bag.findIndex((tile) => tile.kind === "ra");
  before.bag.push(...before.bag.splice(index, 1));
  const action = { type: "draw" } as const;
  const after = advance(before, action);
  const out = journeys({ before, action, after });
  assert.deepEqual(
    out.map(({ from, to }) => [from, to]),
    [["bag", "discard"]],
  );
  assert.equal(out[0].tile?.kind, "ra");
  assert.equal(out[0].via, "ra-reveal");
  assert.equal(
    after.market.some((tile) => tile.id === out[0].tile!.id),
    false,
  );
});
test("every ordinary tile kind draws from the pile into its own market slot", () => {
  for (const kind of [
    "monument",
    "pharaoh",
    "god",
    "gold",
    "nile",
    "flood",
    "civilization",
    "war",
    "drought",
    "earthquake",
    "funeral",
  ]) {
    const before = setup();
    const index = before.bag.findIndex((tile) => tile.kind === kind);
    assert.ok(index >= 0);
    before.bag.push(...before.bag.splice(index, 1));
    const action = { type: "draw" } as const;
    const after = advance(before, action);
    const out = journeys({ before, action, after });
    assert.equal(out.length, 1, kind);
    assert.equal(out[0].from, "bag", kind);
    assert.equal(out[0].to, `tile-${after.lastTile!.id}`, kind);
    assert.equal(out[0].via, undefined, kind);
    assert.ok(
      after.market.some((tile) => tile.id === out[0].tile!.id),
      kind,
    );
  }
});
test("the Ra card keeps its reveal path when it ends the epoch", () => {
  const before = setup();
  before.ra = 7;
  const index = before.bag.findIndex((tile) => tile.kind === "ra");
  before.bag.push(...before.bag.splice(index, 1));
  const action = { type: "draw" } as const;
  const after = advance(before, action);
  assert.equal(after.phase, "epoch");
  const out = journeys({ before, action, after });
  assert.equal(out.length, 1);
  assert.equal(out[0].via, "ra-reveal");
  assert.equal(out[0].to, "discard");
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
