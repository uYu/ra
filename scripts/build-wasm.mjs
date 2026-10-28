import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  cpSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = "native/ra_ai.cpp";
const target = "src/game/ai/ra-ai.wasm";
const compiler = process.env.EMXX || "em++";
const cache =
  process.env.EM_CACHE || join(realpathSync(tmpdir()), "ra-emscripten-cache");
if (!existsSync(cache)) {
  const config = spawnSync("em-config", ["CACHE"], { encoding: "utf8" });
  const original = config.stdout?.trim().replace(/^["']|["']$/g, "");
  if (original && existsSync(original))
    cpSync(original, cache, { recursive: true });
}
const env = { ...process.env, EM_CACHE: cache };
const flags = [
  "-std=c++20",
  "-O3",
  "-Wall",
  "-Wextra",
  "-Wpedantic",
  "-Werror",
  "-fno-exceptions",
  "-fno-threadsafe-statics",
  "--no-entry",
  "-sSTANDALONE_WASM=1",
  "-sFILESYSTEM=0",
  "-sMALLOC=emmalloc",
  "-sINITIAL_MEMORY=33554432",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sSTACK_SIZE=1048576",
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run"]',
];
const result = spawnSync(compiler, [source, ...flags, "-o", target], {
  cwd: root,
  env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const hash = (path) =>
  createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex");
const version = spawnSync(compiler, ["--version"], { encoding: "utf8" });
writeFileSync(
  resolve(root, "native/wasm-build.json"),
  JSON.stringify(
    {
      abi: 6,
      source,
      target,
      sourceSha256: hash(source),
      wasmSha256: hash(target),
      compiler: version.stdout.split("\n")[0],
      flags,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Built ${target} (${readFileSync(resolve(root, target)).length} bytes)`,
);
