import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, cp, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { observe } from "../src/game/ai.ts";

// Isolated source instrumentation: never rebuilds or changes production Wasm.
const output = resolve(
  process.argv[2] ?? "artifacts/ai-search-exploration-20261028",
);
await mkdir(output, { recursive: true });
const source = await readFile("native/ra_ai.cpp", "utf8");
const manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
assert.equal(hash(source), manifest.sourceSha256);
let cpp = source;
function replace(a: string, b: string) {
  assert.equal(cpp.split(a).length - 1, 1, a);
  cpp = cpp.replace(a, b);
}
replace(
  "Report searchAction(",
  `
int probeIterations=0,probeLinear=0,probeDepth=64;
double probeInnerC=1.4,probeRootC=1.4;
double probeRoots[4096]{};
extern "C" double* probe_roots(){return probeRoots;}
extern "C" void configure_probe(int iterations,int linear,double innerC,double rootC,int depth){
  probeIterations=iterations;probeLinear=linear;probeInnerC=innerC;probeRootC=rootC;probeDepth=depth;
}
Report searchAction(`,
);
replace(
  "  Report report;",
  "  Report report;\n  std::fill(std::begin(probeRoots),std::end(probeRoots),0);\n  int checkpoint=0;",
);
replace(
  "  RootHalving halving(rootActions.size(),iterations,timed);",
  "  if(probeIterations>0)iterations=probeIterations;\n  RootHalving halving(rootActions.size(),iterations,timed);",
);
replace(
  "    while(!finished(next)&&steps<64) {",
  "    while(!finished(next)&&steps<64&&(int)path.size()<probeDepth) {",
);
replace(
  "+1.4*std::sqrt(std::log(branch->visits+1.0)/e->visits)",
  "+(branch==&root?probeRootC:probeInnerC)*std::sqrt(std::log(branch->visits+1.0)/e->visits)",
);
replace(
  "e->utilities[i]+=reward==1?2*v-1:std::tanh(v/20);",
  "e->utilities[i]+=reward==1?2*v-1:(probeLinear?v/20:std::tanh(v/20));",
);
replace(
  "    report.samples++;",
  `    report.samples++;
    if((k+1)%1024==0&&checkpoint<128){
      int base=1+checkpoint*25;probeRoots[0]=++checkpoint;probeRoots[base++]=k+1;
      for(auto&a:rootActions){auto*e=root.get(actionKey(a));
        probeRoots[base++]=a.arg;probeRoots[base++]=e->visits;
        probeRoots[base++]=e->sums[s.current]/e->visits;
        probeRoots[base++]=e->utilities[s.current]/e->visits;
      }
    }`,
);
const cache = join(await realpath(tmpdir()), "ra-search-probe-cache");
if (!existsSync(cache)) {
  const r = spawnSync("em-config", ["CACHE"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  await cp(r.stdout.trim().replace(/^["']|["']$/g, ""), cache, {
    recursive: true,
  });
}
const flags = manifest.flags.filter(
  (f: string) => !f.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run","_probe_roots","_configure_probe"]',
);
await writeFile(join(output, "probe.cpp"), cpp);
const result = spawnSync(
  process.env.EMXX ?? "em++",
  [join(output, "probe.cpp"), ...flags, "-o", join(output, "probe.wasm")],
  { stdio: "inherit", env: { ...process.env, EM_CACHE: cache } },
);
assert.equal(result.status, 0);
const ai = await createWasmAi(await readFile(join(output, "probe.wasm")));
const native = (ai as any).native;
const prod = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
const fixture = observe(
  JSON.parse(
    await readFile("tests/fixtures/last-bid-final-epoch.json", "utf8"),
  ),
);
native.configure_probe(0, 0, 1.4, 1.4, 64);
assert.deepEqual(
  ai.search(fixture, { samples: 128, horizon: "next-epoch" }),
  prod.search(fixture, { samples: 128, horizon: "next-epoch" }),
);
const configurations = [
  { name: "baseline", linear: 0, innerC: 1.4, rootC: 1.4, depth: 64 },
  { name: "inner-0", linear: 0, innerC: 0, rootC: 1.4, depth: 64 },
  { name: "inner-0.1", linear: 0, innerC: 0.1, rootC: 1.4, depth: 64 },
  { name: "inner-0.35", linear: 0, innerC: 0.35, rootC: 1.4, depth: 64 },
  { name: "inner-0.7", linear: 0, innerC: 0.7, rootC: 1.4, depth: 64 },
  { name: "root-only", linear: 0, innerC: 1.4, rootC: 1.4, depth: 1 },
  { name: "linear", linear: 1, innerC: 1.4, rootC: 1.4, depth: 64 },
];
const iterations = Number(process.argv[3] ?? 32768);
assert.ok(
  Number.isInteger(iterations) && iterations >= 1024 && iterations <= 131072,
);
const rows: any[] = [];
for (const config of configurations.filter(
  (c) => !process.argv[4] || process.argv[4].split(",").includes(c.name),
)) {
  native.configure_probe(
    iterations,
    config.linear,
    config.innerC,
    config.rootC,
    config.depth,
  );
  const start = performance.now();
  const report = ai.search(fixture, { samples: 128, horizon: "next-epoch" });
  const raw = new Float64Array(
    native.memory.buffer,
    native.probe_roots(),
    4096,
  );
  const checkpoints = Array.from({ length: raw[0] }, (_, i) => ({
    samples: raw[1 + i * 25],
    roots: Array.from({ length: report.candidates.length }, (_, j) => {
      const b = 2 + i * 25 + j * 4;
      return {
        sun: raw[b],
        visits: raw[b + 1],
        mean: raw[b + 2],
        utility: raw[b + 3],
      };
    }),
  }));
  const row = {
    config,
    elapsedMs: performance.now() - start,
    report,
    checkpoints,
  };
  rows.push(row);
  console.log(
    JSON.stringify({
      name: config.name,
      elapsedMs: row.elapsedMs,
      action: report.action,
      roots: checkpoints.at(-1)?.roots,
    }),
  );
  await writeFile(
    join(output, "summary.json"),
    JSON.stringify(
      {
        sourceSha256: hash(source),
        productionWasmSha256: manifest.wasmSha256,
        baselineFixedReportEqual: true,
        iterations,
        rows,
      },
      null,
      2,
    ) + "\n",
  );
}
assert.equal(hash(await readFile("native/ra_ai.cpp")), manifest.sourceSha256);
assert.equal(
  hash(await readFile("src/game/ai/ra-ai.wasm")),
  manifest.wasmSha256,
);
