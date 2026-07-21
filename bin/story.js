#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binDir = path.dirname(fileURLToPath(import.meta.url));
const main = path.resolve(binDir, "../src/cli/main.ts");
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", main, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      STORY_ENTRY: path.resolve(binDir, "story.js"),
    },
  },
);
process.exit(result.status ?? 1);
