import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const sourceRoot = path.resolve(root.pathname, "src");

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(fullPath)));
    else if (entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

const files = await collect(sourceRoot);
for (const file of files) {
  await import(pathToFileURL(file).href);
}
console.log(`Checked ${files.length} TypeScript source files.`);
