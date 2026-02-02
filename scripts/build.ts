import { $, spawn } from "bun";

console.log("🧹  Cleaning dist...");
await $`rm -rf dist`;

console.log("📦  Bundling with Bun...");
const buildResult = await Bun.build({
  entrypoints: [
    "./src/index.ts",
    "./src/store.ts",
    "./src/html.ts",
    "./src/jsx/jsx-runtime.ts",
    "./src/jsx/jsx-dev-runtime.ts",
    "./src/middleware/static/index.ts",
    "./src/middleware/transpiler/index.ts",
  ],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  splitting: true,
  sourcemap: "none",
  minify: false,
});

if (!buildResult.success) {
  console.error("Build failed");
  for (const message of buildResult.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log("📝  Generating Types...");
// We override noEmit from tsconfig
const tsc = spawn(
  [
    "tsc",
    "--emitDeclarationOnly",
    "--noEmit",
    "false",
    "--outDir",
    "./dist",
    "--declaration",
    "--project",
    "tsconfig.build.json",
  ],
  {
    stdout: "inherit",
    stderr: "inherit",
  },
);

const tscExitCode = await tsc.exited;

if (tscExitCode !== 0) {
  console.error("Type generation failed");
  process.exit(tscExitCode);
}

console.log("✅  Build successful!");
