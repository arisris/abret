import { spawn } from "bun";

console.log("🧹  Cleaning dist...");
await spawn(["rm", "-rf", "dist"]).exited;

console.log("📦  Bundling with Bun...");
const buildResult = await Bun.build({
  entrypoints: [
    "./src/index.ts",
    "./src/store.ts",
    "./src/html.ts",
    "./src/jsx/jsx-runtime.ts",
    "./src/jsx/jsx-dev-runtime.ts",
  ],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  sourcemap: "none",

  minify: false, // Libraries usually don't minify to keep readable stacktraces, user can minify
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
