import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { newGame, legalActions } from "../src/game/engine.ts";
import { chooseAction } from "../src/game/ai.ts";

const directory = await mkdtemp(join(tmpdir(), "ra-wasm-worker-"));
await build({
  logLevel: "silent",
  build: { outDir: directory, emptyOutDir: true },
});
const assetDirectory = join(directory, "assets"),
  files = await readdir(assetDirectory);
const workerFile = files.find(
  (f) => f.startsWith("ai.worker-") && f.endsWith(".js"),
)!;
const wasmFile = files.find((f) => f.endsWith(".wasm"))!;
assert.ok(
  workerFile && wasmFile,
  "production build must emit the Worker and Wasm assets",
);
const wasm = await readFile(join(assetDirectory, wasmFile));
let wasmRequests = 0;
const server = createServer((request, response) => {
  if (request.url === `/assets/${wasmFile}`) {
    wasmRequests++;
    response.writeHead(200, { "Content-Type": "application/wasm" });
    response.end(wasm);
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const location = `http://127.0.0.1:${address.port}/assets/${workerFile}`;
const live = new Set<Worker>();
after(async () => {
  await Promise.all([...live].map((w) => w.terminate()));
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
async function run(
  difficulty: "hard" | "normal" | "easy",
  failWasm: boolean | "hang" = false,
) {
  // Run the actual built browser Worker in a worker thread, supplying only its
  // browser messaging/location globals. Fetch, compilation and search are real.
  const worker = new Worker(
    `
    const {parentPort,workerData}=require('node:worker_threads');
    global.self={location:{href:workerData.location},postMessage:value=>parentPort.postMessage(value)};
    if(workerData.failWasm === 'hang')global.fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
    });
    else if(workerData.failWasm)global.fetch=async()=>new Response('unavailable',{status:503});
    import(workerData.path).then(()=>{
      parentPort.on('message',data=>self.onmessage({data}));
      parentPort.postMessage({ready:true});
    }).catch(error=>{throw error});
  `,
    {
      eval: true,
      workerData: {
        location,
        path: pathToFileURL(join(assetDirectory, workerFile)).href,
        failWasm,
      },
    },
  );
  live.add(worker);
  const state = newGame({ count: 3, humans: 0, difficulty, seed: 155 });
  try {
    return await new Promise<{
      action: unknown;
      backend: string;
      elapsed: number;
      searchElapsed?: number;
      samples?: number;
      horizon?: string;
      epochAdvances?: number;
      completed?: number;
      truncated?: number;
      fallback?: string;
    }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("production Worker timed out")),
        15000,
      );
      worker.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.on("message", (message) => {
        if (message.ready) {
          worker.postMessage({ state, difficulty });
          return;
        }
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error));
        else resolve(message);
      });
    });
  } finally {
    await worker.terminate();
    live.delete(worker);
  }
}

test("production hard Worker fetches its hashed Wasm asset and returns a legal native action", async () => {
  const before = wasmRequests,
    result = await run("hard");
  assert.equal(result.backend, "wasm");
  assert.equal(result.fallback, undefined);
  assert.ok(wasmRequests > before);
  assert.ok(result.elapsed > 0);
  assert.ok(
    result.searchElapsed! >= 1900,
    "hard AI must spend its two-second search budget",
  );
  assert.ok(result.samples! > 0);
  assert.equal(result.horizon, "next-epoch");
  assert.equal(result.epochAdvances, result.samples);
  assert.equal(result.completed, 0, "epoch-one search stops after epoch two");
  assert.equal(result.truncated, 0);
  const s = newGame({ count: 3, humans: 0, difficulty: "hard", seed: 155 });
  assert.ok(
    legalActions(s).some(
      (a) => JSON.stringify(a) === JSON.stringify(result.action),
    ),
  );
});
test("unavailable Wasm falls back to the existing TS search and reports its backend", async () => {
  const result = await run("hard", true);
  assert.equal(result.backend, "typescript");
  assert.match(result.fallback!, /503/);
  assert.equal(result.horizon, "next-epoch");
  const s = newGame({ count: 3, humans: 0, difficulty: "hard", seed: 155 });
  assert.deepEqual(result.action, chooseAction(s, "hard"));
});
test("normal and easy production Workers do not fetch Wasm", async () => {
  const before = wasmRequests;
  for (const difficulty of ["normal", "easy"] as const) {
    const result = await run(difficulty);
    assert.equal(result.backend, "typescript");
    const s = newGame({ count: 3, humans: 0, difficulty, seed: 155 });
    assert.deepEqual(result.action, chooseAction(s, difficulty));
  }
  assert.equal(wasmRequests, before);
});

test("a stalled Wasm download times out and falls back instead of hanging the turn", async () => {
  const result = await run("hard", "hang");
  assert.equal(result.backend, "typescript");
  assert.match(result.fallback!, /aborted/);
});
