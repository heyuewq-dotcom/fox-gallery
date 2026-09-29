import { cp, mkdir, readFile, readdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const files = await readdir(resolve(root, "src"));
// Native modules need no bundler. Validate syntax and local imports before copying.
for (const file of files.filter((file) => file.endsWith(".js"))) {
  const source = resolve(root, "src", file);
  const result = spawnSync(process.execPath, ["--check", source], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
  const content = await readFile(source, "utf8");
  for (const match of content.matchAll(
    /(?:from\s*|import\s*)["'](\.\.?\/[^"']+)["']/g,
  )) {
    await access(resolve(dirname(source), match[1]));
  }
}
await mkdir(output, { recursive: true });
await cp(resolve(root, "index.html"), resolve(output, "index.html"));
await cp(resolve(root, "src"), resolve(output, "src"), { recursive: true });
await cp(resolve(root, "schema"), resolve(output, "schema"), {
  recursive: true,
});
console.log(
  "Build OK: dist/ (static application only; local image data is not copied)",
);
