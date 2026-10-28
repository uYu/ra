import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directories = process.argv.slice(2);
assert.ok(directories.length, "Pass one or more profile output directories");
const results = [];
for (const directory of directories) {
  const raw = JSON.parse(
    await readFile(join(directory, "summary.json"), "utf8"),
  );
  assert.equal(raw.identicalExecutableSections, true);
  assert.equal(raw.identicalFixedBudgetReports, true);
  assert.equal(raw.protectedSourcesUnchanged, true);
  assert.equal(raw.groups.length, 8);
  const byCount = [];
  const memoryOwners = new Map<string, number>();
  let totalSamples = 0,
    wasmSelfSamples = 0;
  for (const group of raw.groups) {
    const profile = JSON.parse(await readFile(group.path, "utf8"));
    assert.equal(profile.samples.length, group.samples);
    const nodes = new Map<number, any>(
      profile.nodes.map((n: any) => [n.id, n]),
    );
    const parents = new Map<number, number>();
    for (const n of profile.nodes)
      for (const child of n.children ?? []) parents.set(child, n.id);
    for (const id of profile.samples) {
      totalSamples++;
      const leaf = nodes.get(id).callFrame;
      if (leaf.url.startsWith("wasm:")) wasmSelfSamples++;
      if (
        !/^(?:attempt_allocate|emmalloc|_?malloc|_?free|_?realloc|_?calloc|_?memcpy|_?memmove|_?memset)|operator (?:new|delete)/.test(
          leaf.functionName,
        )
      )
        continue;
      let current: number | undefined = id;
      let owner = "tree-or-other-inlined-caller";
      while (current !== undefined) {
        const name: string = nodes.get(current).callFrame.functionName;
        if (
          /State::State|Player::Player|~State|~Player|State::operator=|Player::operator=/.test(
            name,
          )
        ) {
          owner = "state-copy-or-destruction";
          break;
        }
        if (/positionValues|futureValues|inventory\(/.test(name)) {
          owner = "evaluation";
          break;
        }
        if (/observation\(|listKey\(|appendInt\(|actionKey\(/.test(name)) {
          owner = "observation-and-keys";
          break;
        }
        if (/auctionPlan/.test(name)) {
          owner = "auction-plan-or-inlined-temporaries";
          break;
        }
        if (/policyAction|godChoices|bestDiscard|collectionAfter/.test(name)) {
          owner = "other-policy";
          break;
        }
        if (/^apply\(|acquire\(|settle\(/.test(name)) {
          owner = "rules";
          break;
        }
        current = parents.get(current);
      }
      memoryOwners.set(owner, (memoryOwners.get(owner) ?? 0) + 1);
    }
  }
  for (const count of [2, 3, 4, 5]) {
    const groups = raw.groups.filter((g: any) => g.count === count);
    const total = groups.reduce((n: number, g: any) => n + g.samples, 0);
    const categories = new Map<string, number>();
    const inclusive = new Map<string, number>();
    const self = new Map<string, number>();
    for (const g of groups) {
      assert.equal(
        g.categories.reduce((n: number, c: any) => n + c.hits, 0),
        g.samples,
      );
      for (const c of g.categories)
        categories.set(c.name, (categories.get(c.name) ?? 0) + c.hits);
      for (const f of g.functions) {
        inclusive.set(f.name, (inclusive.get(f.name) ?? 0) + f.inclusive);
        self.set(f.name, (self.get(f.name) ?? 0) + f.self);
      }
    }
    const pct = (hits: number) => (100 * hits) / total;
    byCount.push({
      count,
      samples: total,
      categories: [...categories]
        .map(([name, hits]) => ({ name, percent: pct(hits) }))
        .sort((a, b) => b.percent - a.percent),
      inclusive: [...inclusive]
        .filter(([name]) =>
          /^(?:auctionPlan\(|positionValues\(|futureValues\(|State::State\(|Player::Player\(|listKey\()/.test(
            name,
          ),
        )
        .map(([name, hits]) => ({ name, percent: pct(hits) }))
        .sort((a, b) => b.percent - a.percent),
      topSelf: [...self]
        .map(([name, hits]) => ({ name, percent: pct(hits) }))
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 12),
    });
  }
  const memoryHits = [...memoryOwners.values()].reduce((a, b) => a + b, 0);
  results.push({
    directory,
    mode: raw.mode ?? "fixed",
    timeMs: raw.timeMs ?? null,
    positions: raw.positions,
    samplesPerRoot: raw.samplesPerRoot,
    repeats: raw.repeats,
    totalSamples,
    wasmSelfPercent: (100 * wasmSelfSamples) / totalSamples,
    verified: {
      identicalExecutableSections: true,
      identicalFixedBudgetReports: true,
      protectedSourcesUnchanged: true,
    },
    byCount,
    allocatorAndMemorySelfPercent: (100 * memoryHits) / totalSamples,
    memoryOwners: [...memoryOwners]
      .map(([name, hits]) => ({
        name,
        percentOfAllSamples: (100 * hits) / totalSamples,
        percentOfMemorySamples: (100 * hits) / memoryHits,
      }))
      .sort((a, b) => b.percentOfAllSamples - a.percentOfAllSamples),
  });
}
const result = {
  createdAt: new Date().toISOString(),
  method:
    "Within each player count, turn and auction CPU samples are pooled. Categories are disjoint nearest-recognized-frame estimates; inclusive functions overlap. Allocator owners are inferred from sampled caller stacks and cannot fully identify optimized inlined ownership.",
  limitations:
    "Representative deterministic public positions; not a tournament-frequency-weighted average. Concurrent tournament and unavailable priority reduction prevent isolated latency claims. Timed sampling reduces available simulation throughput; no speedup or playing-strength claim.",
  results,
};
const path = join(directories[0], "findings.json");
await writeFile(path, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
