#!/usr/bin/env node
// Launches the Electron desktop app. Kept as a bin entry so `npx hermes`
// (and a global install, if any) still starts the app.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let electronBinary;
try {
  const require = createRequire(import.meta.url);
  electronBinary = require("electron");
} catch {
  electronBinary = null;
}

if (!electronBinary) {
  console.error(
    "[hermes] Electron is not installed. Run `npm install` in the project root first:\n" +
      `  cd ${root} && npm install`,
  );
  process.exit(1);
}

// `require("electron")` resolves to the path of the Electron binary string
// when run outside of Electron itself.
if (typeof electronBinary !== "string") {
  console.error("[hermes] Unexpected resolution for the electron package; aborting.");
  process.exit(1);
}

if (!existsSync(electronBinary)) {
  console.error(
    `[hermes] Electron binary not found at ${electronBinary}. Run \`npm install\` in the project root.`,
  );
  process.exit(1);
}

if (!existsSync(path.join(root, "out", "main", "index.js"))) {
  console.error(
    "[hermes] The app is not built yet. Run `npm run build` in the project root first:\n" +
      `  cd ${root} && npm run build`,
  );
  process.exit(1);
}

const r = spawnSync(electronBinary, ["."], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);