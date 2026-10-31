import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, cp, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
const output = resolve(
  process.argv[2] ?? "artifacts/ai-auction-sampling-20261029",
);
assert.ok(!existsSync(join(output, "build.json")), "Choose new directory");
await mkdir(output, { recursive: true });
const hash = (x: Uint8Array | string) =>
  createHash("sha256").update(x).digest("hex");
const source = await readFile("native/ra_ai.cpp", "utf8"),
  extension = await readFile("scripts/auction-sampling/probe.inc", "utf8"),
  manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
assert.equal(hash(source), manifest.sourceSha256);
let probe = source;
function replace(a: string, b: string) {
  assert.equal(probe.split(a).length - 1, 1, a);
  probe = probe.replace(a, b);
}
replace(
  "// Versioned numeric ABI, bounded and checked before native indexing.",
  extension +
    "\n// Versioned numeric ABI, bounded and checked before native indexing.",
);
replace(
  "      auto r=searchAction(s,samples,horizon,variant,timeMs,hasModel?&model:nullptr,hasRollout?&rolloutModel:nullptr,reward,op==9);",
  "      std::fill(std::begin(auctionStudyMetrics),std::end(auctionStudyMetrics),0);\n      if(auctionStudyMode&&(hasModel||hasRollout||reward||op!=0||variant))return -6;\n      auto r=auctionStudyMode&&s.phase==Auction&&legal(s).size()>1?auctionSampleSearch(s,samples,horizon,timeMs):searchAction(s,samples,horizon,variant,timeMs,hasModel?&model:nullptr,hasRollout?&rolloutModel:nullptr,reward,op==9);",
);
await writeFile(join(output, "probe.cpp"), probe);
await cp("src/game/ai/ra-ai.wasm", join(output, "baseline.wasm"));
const cache = join(await realpath(tmpdir()), "ra-search-probe-cache");
if (!existsSync(cache)) {
  const r = spawnSync("em-config", ["CACHE"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  await cp(r.stdout.trim().replace(/^["']|["']$/g, ""), cache, {
    recursive: true,
  });
}
const flags = manifest.flags.filter(
  (x: string) => !x.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run","_configure_auction_study","_auction_study_metrics","_auction_study_leaves"]',
);
const c = spawnSync(
  process.env.EMXX ?? "em++",
  [join(output, "probe.cpp"), ...flags, "-o", join(output, "probe.wasm")],
  { stdio: "inherit", env: { ...process.env, EM_CACHE: cache } },
);
assert.equal(c.status, 0);
await writeFile(
  join(output, "build.json"),
  JSON.stringify(
    {
      sourceSha256: hash(source),
      extensionSha256: hash(extension),
      probeSha256: hash(probe),
      wasmSha256: hash(await readFile(join(output, "probe.wasm"))),
      baselineSha256: manifest.wasmSha256,
      flags,
      scope:
        "Experimental current-auction exhaustive tree, shared-scenario rollout leaf values, backward induction on each bidder own mean tanh utility. Other phases preserve original UCT. Not a full MCMS reproduction. No production changes.",
    },
    null,
    2,
  ) + "\n",
);
console.log(output);
