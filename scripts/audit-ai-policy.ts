import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { newGame, advance, legalActions, ranking } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { makeTiles } from "../src/game/data.ts";
import type { Action } from "../src/game/types.ts";

const input = process.argv[2] ?? "artifacts/ai-version-2s-control.json";
const output = process.argv[3] ?? "artifacts/ai-policy-audit-20261028.json";
const raw = JSON.parse(await readFile(input, "utf8"));
assert.equal(raw.status, "stopped");
const plan = JSON.parse(await readFile(raw.identity.planPath, "utf8"));
const ai = await createWasmAi(
  await readFile(`${plan.candidate.root}/src/game/ai/ra-ai.wasm`),
);
const tiles = new Map(makeTiles().map((t) => [t.id, t]));
const tileKey = (id: number) => {
  const t = tiles.get(id)!;
  return `${t.kind}/${t.variant}`;
};
const key = (a: Action) =>
  a.type === "god"
    ? `god/${tileKey(a.tileId)}`
    : a.type === "discard"
      ? `discard/${a.ids.map(tileKey).sort().join("|")}`
      : JSON.stringify(a);
const groups = new Map<string, any>();
const examples: any[] = [];
let actions = 0;
for (const game of raw.games) {
  const trace = JSON.parse(await readFile(game.replayPath, "utf8"));
  let s = newGame(trace.config);
  for (const d of trace.audit.decisions) {
    assert.equal(d.player, s.current);
    assert.equal(d.epoch, s.epoch);
    assert.equal(d.phase, s.phase);
    const side = d.player === game.seat ? "candidate" : "opponent";
    const id = `${side}/${s.phase}`;
    const row = groups.get(id) ?? {
      side,
      phase: s.phase,
      decisions: 0,
      nontrivialLegal: 0,
      collapsedToOne: 0,
      searched: 0,
      policyDisagreements: 0,
      disagreementsAt75PercentVisits: 0,
      simulations: 0,
      nodes: 0,
      depthSum: 0,
      godMoreThanThree: 0,
    };
    const legal = legalActions(s),
      canonicalLegal = new Set(legal.map(key));
    row.decisions++;
    if (canonicalLegal.size > 1) {
      row.nontrivialLegal++;
      if (d.report.candidates.length === 1) {
        row.collapsedToOne++;
        if (examples.length < 12)
          examples.push({
            path: game.replayPath,
            seed: game.seed,
            count: game.count,
            step: d.step,
            player: d.player,
            phase: s.phase,
            epoch: s.epoch,
            canonicalLegal: canonicalLegal.size,
            offered: 1,
            chosen: d.report.action,
          });
      }
    }
    if (new Set(legal.filter((a) => a.type === "god").map(key)).size > 3)
      row.godMoreThanThree++;
    if (d.report.samples > 0) {
      const prediction = ai.policy(observe(s));
      const disagree = key(prediction) !== key(d.report.action);
      row.searched++;
      row.policyDisagreements += Number(disagree);
      const chosen = d.report.candidates.find(
        (c: any) => key(c.action) === key(d.report.action),
      );
      assert.ok(chosen);
      row.disagreementsAt75PercentVisits += Number(
        disagree && chosen.visits / d.report.samples >= 0.75,
      );
      row.simulations += d.report.samples;
      row.nodes += d.report.nodes;
      row.depthSum += d.report.depth;
    }
    groups.set(id, row);
    s = advance(s, d.report.action);
    actions++;
  }
  assert.equal(s.phase, "over");
  assert.deepEqual(ranking(s), trace.audit.ranking);
}
const rows = [...groups.values()].map((r) => ({
  ...r,
  policyDisagreementRate: r.searched
    ? r.policyDisagreements / r.searched
    : null,
  meanMaxDepth: r.searched ? r.depthSum / r.searched : null,
  nodesPerSimulation: r.simulations ? r.nodes / r.simulations : null,
}));
const result = {
  createdAt: new Date().toISOString(),
  input,
  completedGames: raw.games.length,
  plannedGames: raw.plannedGames,
  actionsReplayed: actions,
  method:
    "Read-only audit of completed stopped-run replays. Canonical legal actions deduplicate physical tile IDs of the same kind/variant. Compare actual MCTS choices against the balanced heuristic prior/reference; default rollouts use sampled costs/rivalry from the same policy family. No new simulations or games, no terminal confidence interval.",
  caveats: [
    "Policy disagreement is evidence of model mismatch, not proof that either action is optimal.",
    "This comparison does not estimate the predictive calibration of the entire sampled opponent-model mixture.",
    "The 54 completed games were stopped on user request after viewing interim results; this is diagnostic data, not a completed confirmatory strength experiment.",
    "Collapsed candidates may be equivalent under the current evaluator; exclusion alone does not establish a mistake.",
  ],
  groups: rows,
  examples,
};
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({ games: raw.games.length, actions, groups: rows }, null, 2),
);
