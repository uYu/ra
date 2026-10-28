import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { availableParallelism, cpus, platform, release } from "node:os";
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i], process.argv[i + 1]);
const workers = Number(args.get("--jobs") ?? 8);
if (!Number.isInteger(workers) || workers < 1 || workers > 8)
  throw new Error("Invalid workers");
const groups = [
  {
    id: "sh200",
    engine: "frozen5",
    time: 200,
    start: 810001,
    opponent: "uct",
    reward: "relative",
  },
  {
    id: "rank200",
    engine: "current",
    time: 200,
    start: 840001,
    opponent: "sh",
    reward: "future-rank",
  },
];
const files = [
  "artifacts/ai-sh-confirmation-methods.md",
  "scripts/benchmark-tree.ts",
  "scripts/run-sh-study.ts",
  "scripts/summarize-sh-study.ts",
  "scripts/lib/decision-trace.ts",
  "src/game/ai/wasm.ts",
  "src/game/ai/wasm-frozen-uct5.ts",
  "src/game/ai/search.ts",
  "src/game/engine.ts",
  "src/game/data.ts",
  "src/game/ai.ts",
  "native/ra_ai.cpp",
  "src/game/ai/ra-ai.wasm",
  "artifacts/frozen-uct5/ra_ai.cpp",
  "artifacts/frozen-uct5/ra-ai.wasm",
];
const hashes = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [
      p,
      createHash("sha256")
        .update(await readFile(p))
        .digest("hex"),
    ]),
  ),
);
const identity = {
  groups,
  seeds: 20,
  counts: [2, 3, 4, 5],
  samples: 32,
  hashes,
};
const path = "artifacts/ai-sh-study-manifest.json";
if (existsSync(path)) {
  const old = JSON.parse(await readFile(path, "utf8"));
  if (JSON.stringify(old.identity) !== JSON.stringify(identity))
    throw new Error(
      "Study identity changed; preserve old results and explicitly design a new study",
    );
} else
  await writeFile(
    path,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        supersedes:
          "artifacts/ai-sh-study-initial-plan/ai-sh-study-manifest.json",
        amendment:
          "User cancelled the not-yet-started 500ms group while sh200 had 40 completed games; retain both 200ms groups with unchanged parameters and completed checkpoints.",
        identity,
        environment: {
          node: process.version,
          platform: platform(),
          release: release(),
          cpu: cpus()[0]?.model,
          availableParallelism: availableParallelism(),
          workers,
        },
      },
      null,
      2,
    ) + "\n",
  );
for (const group of groups) {
  const out = `artifacts/ai-sh-${group.id}.json`;
  const command = [
    "--experimental-strip-types",
    "scripts/benchmark-tree.ts",
    "--engine",
    group.engine,
    "--variants",
    "sh",
    "--modes",
    "time",
    "--reward",
    group.reward,
    "--opponent-variant",
    group.opponent,
    "--time-ms",
    String(group.time),
    "--seeds",
    "20",
    "--start",
    String(group.start),
    "--jobs",
    String(workers),
    "--costs",
    "off",
    "--out",
    out,
  ];
  if (existsSync(out)) command.push("--resume", "yes");
  console.log(
    JSON.stringify({
      event: "start",
      group: group.id,
      time: new Date().toISOString(),
    }),
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, command, {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let pending = "",
      logging = Promise.resolve();
    const stop = () => child.kill("SIGTERM");
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      logging = logging.then(() =>
        appendFile(`artifacts/ai-sh-${group.id}.log`, text),
      );
      pending += text;
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        try {
          const row = JSON.parse(line);
          if (row.finished && row.finished % 14 === 0)
            console.log(JSON.stringify({ group: group.id, ...row }));
        } catch {
          /* Pretty printed final summaries are retained in the full log. */
        }
      }
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
      logging.then(
        () =>
          code === 0
            ? resolve()
            : reject(new Error(`Group ${group.id} failed ${code}/${signal}`)),
        reject,
      );
    });
  });
  console.log(
    JSON.stringify({
      event: "complete",
      group: group.id,
      time: new Date().toISOString(),
    }),
  );
}
await new Promise<void>((resolve, reject) => {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "scripts/summarize-sh-study.ts"],
    { stdio: "inherit" },
  );
  child.once("error", reject);
  child.once("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`Report failed: ${code}`)),
  );
});
