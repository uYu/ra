import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = process.argv[2] ?? "artifacts/ai-perf-detail-20261028";
const profile = JSON.parse(
  await readFile(join(directory, "summary.json"), "utf8"),
);
const counts = JSON.parse(
  await readFile(join(directory, "work-counts.json"), "utf8"),
);
assert.equal(counts.productionWasmSha256, profile.productionWasmSha256);
assert.equal(counts.sourceSha256, profile.productionSourceSha256);
assert.equal(profile.identicalExecutableSections, true);
assert.equal(profile.identicalFixedBudgetReports, true);
assert.equal(profile.protectedSourcesUnchanged, true);
assert.equal(counts.rows.length, 24);
type Frame = { functionName: string; url: string };
const mechanism = (frames: Frame[]) => {
  if (!frames[0].url.startsWith("wasm:")) return "js-runtime";
  for (const f of frames) {
    const name = f.functionName;
    if (
      /^(attempt_allocate|emmalloc|_?malloc|_?free|_?calloc|_?realloc)|operator (new|delete)/.test(
        name,
      )
    )
      return "allocator";
    if (/^(memcpy|memmove|memset)$/.test(name)) return "bulk-memory";
    if (/^(exp|log|sqrt|tanh|pow)$/.test(name)) return `math-${name}`;
    if (/inventory\(/.test(name)) return "inventory-scan";
    if (
      /State::State|State::operator=|Player::Player|Player::operator=/.test(
        name,
      )
    )
      return "state-player-copy";
    if (/futureValues\(/.test(name)) return "future-value";
    if (/reserveCost\(/.test(name)) return "disk-reserve";
    if (/drawsLeft\(/.test(name)) return "draw-deadline";
    if (/softRace\(/.test(name)) return "pharaoh-race";
    if (/positionCache\(/.test(name)) return "position-cache-other";
    if (/positionValues\(/.test(name)) return "score-assembly";
    if (/^(listKey|observation|appendInt|writeInt)\(/.test(name))
      return "public-key";
    if (/actionKey\(/.test(name)) return "action-key";
    if (
      /unordered_map|__hash_table|__murmur2_or_cityhash|hash_bytes/.test(name)
    )
      return "hash-containers";
    if (name.startsWith("_ZZ11auctionPlan"))
      return "auction-backward-induction";
    if (name.startsWith("auctionPlan(")) return "auction-outcome-setup";
    if (/collectInto|collectionAfter|bestDiscard/.test(name))
      return "collection-disaster";
    if (/godChoices/.test(name)) return "god-choice-other";
    if (/candidates\(/.test(name)) return "candidate-generation";
    if (/policyAction/.test(name)) return "policy-other";
    if (
      /^apply\(|resolveAuction|startAuction|endEpoch|finishTurn|settle\(|acquire\(|epochScores/.test(
        name,
      )
    )
      return "rules";
    if (/shuffle|Random::/.test(name)) return "sampling";
  }
  return "search-or-inlined-other";
};
const purpose = (frames: Frame[]) => {
  const auction = frames.findIndex((f) =>
    f.functionName.startsWith("auctionPlan("),
  );
  if (auction >= 0)
    return frames
      .slice(auction + 1)
      .some((f) => f.functionName.startsWith("policyAction("))
      ? "policy-auction-solving"
      : "simulation-auction-solving";
  if (frames.some((f) => f.functionName.startsWith("godChoices(")))
    return "god-choice-check";
  if (
    frames.some((f) =>
      /bestDiscard|collectInto|collectionAfter/.test(f.functionName),
    )
  )
    return "other-collection-disaster";
  if (frames.some((f) => f.functionName.startsWith("policyAction(")))
    return "policy-other";
  if (frames.some((f) => /listKey\(|observation\(/.test(f.functionName)))
    return "public-key";
  return "tree-rules-sampling-other";
};
const byCount = [];
for (const count of [2, 3, 4, 5]) {
  const mechanisms = new Map<string, number>(),
    purposes = new Map<string, number>();
  const functions = new Map<string, { self: number; inclusive: number }>();
  let total = 0;
  for (const group of profile.groups.filter((g: any) => g.count === count)) {
    const raw = JSON.parse(await readFile(group.path, "utf8"));
    const nodes = new Map<number, any>(raw.nodes.map((n: any) => [n.id, n]));
    const parents = new Map<number, number>();
    for (const n of raw.nodes)
      for (const id of n.children ?? []) parents.set(id, n.id);
    for (const id of raw.samples) {
      const frames: Frame[] = [];
      let current: number | undefined = id;
      while (current !== undefined) {
        frames.push(nodes.get(current).callFrame);
        current = parents.get(current);
      }
      total++;
      const m = mechanism(frames),
        p = purpose(frames);
      mechanisms.set(m, (mechanisms.get(m) ?? 0) + 1);
      purposes.set(p, (purposes.get(p) ?? 0) + 1);
      const seen = new Set<string>();
      frames.forEach((f, index) => {
        const row = functions.get(f.functionName) ?? { self: 0, inclusive: 0 };
        if (index === 0) row.self++;
        if (!seen.has(f.functionName)) row.inclusive++;
        seen.add(f.functionName);
        functions.set(f.functionName, row);
      });
    }
  }
  const percent = (map: Map<string, number>) =>
    [...map]
      .map(([name, hits]) => ({ name, hits, percent: (100 * hits) / total }))
      .sort((a, b) => b.hits - a.hits);
  const rows = counts.rows.filter((r: any) => r.count === count);
  assert.equal(rows.length, 6);
  const sum = (get: (r: any) => number) =>
    rows.reduce((n: number, r: any) => n + get(r), 0);
  const simulations = sum((r) => r.samples);
  const contexts = counts.contexts.map((name: string) => ({
    name,
    calls: sum((r) => r.calls[name].calls),
    allocations: sum((r) => r.calls[name].allocations),
    requestedBytes: sum((r) => r.calls[name].requestedBytes),
    frees: sum((r) => r.calls[name].frees),
  }));
  const work: Record<string, number> = Object.fromEntries(
    counts.work.map((name: string) => [name, sum((r) => r.counts[name])]),
  );
  const copies = counts.copies.map((name: string) => ({
    name,
    copies: sum((r) => r.copies[name].copies),
    vectorItems: sum((r) => r.copies[name].vectorItems),
  }));
  const allocations = contexts.reduce(
    (n: number, r: any) => n + r.allocations,
    0,
  );
  const requestedBytes = contexts.reduce(
    (n: number, r: any) => n + r.requestedBytes,
    0,
  );
  const auctionCalls = contexts.find((r: any) => r.name === "auction").calls;
  const godCalls = contexts.find((r: any) => r.name === "god").calls;
  byCount.push({
    count,
    cpuSamples: total,
    mechanisms: percent(mechanisms),
    purposes: percent(purposes),
    topFunctions: [...functions]
      .map(([name, r]) => ({
        name,
        selfPercent: (100 * r.self) / total,
        inclusivePercent: (100 * r.inclusive) / total,
      }))
      .sort((a, b) => b.selfPercent - a.selfPercent)
      .slice(0, 25),
    replayedProfileDecisions: rows.length,
    simulations,
    transitions: sum((r) => r.transitions),
    perDecision: {
      simulations: simulations / rows.length,
      transitions: sum((r) => r.transitions) / rows.length,
      allocations: allocations / rows.length,
      requestedMiB: requestedBytes / rows.length / 1048576,
    },
    perSimulation: {
      transitions: sum((r) => r.transitions) / simulations,
      auctions: auctionCalls / simulations,
      allocations: allocations / simulations,
      requestedBytes: requestedBytes / simulations,
      inventoryTiles: work.inventoryTiles / simulations,
      bagItems: (work.bagRaItems + work.bagFloodItems) / simulations,
      stateCopies:
        copies.reduce((n: number, c: any) => n + c.copies, 0) / simulations,
    },
    fractions: {
      turnProbesOfAuctionCalls: work.turnProbes / auctionCalls,
      unusedAuctionBase: work.unusedAuctionBase / auctionCalls,
      emptyGodChecks: work.godEmpty / godCalls,
      unusedRiverExp: work.riverUnused / work.riverExp,
    },
    contexts: contexts.sort((a: any, b: any) => b.allocations - a.allocations),
    work,
    copies,
  });
}
const result = {
  createdAt: new Date().toISOString(),
  sourceSha256: profile.productionSourceSha256,
  wasmSha256: profile.productionWasmSha256,
  method:
    "CPU occupancy sampled from unchanged O3 executable sections, 24 public positions, two 2s repetitions. Separate diagnostic counters replay exactly the first CPU-profile repetition simulation counts and match transitions; full fixed-128 reports match production. CPU mechanisms and purposes are separate non-overlapping partitions; function inclusive percentages overlap.",
  caveats: [
    "Inlined work belongs to the surviving caller; position-cache-other and search-or-inlined-other cannot be precisely subdivided from this sample.",
    "Logical work and requested C++ new bytes are not timing measurements or peak memory. The counted build performance is not used as production throughput.",
    "Representative positions are not tournament-frequency weighted. Runtime phase is not always recoverable from stack names: policy-auction-solving includes turn probes and auction priors.",
  ],
  byCount,
};
await writeFile(
  join(directory, "details.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    output: join(directory, "details.json"),
    counts: byCount.map((r) => r.count),
  }),
);
