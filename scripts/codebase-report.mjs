import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".sql", ".sh"]);
const excluded = new Set(["node_modules", ".next", "dist", "build", "out", "coverage"]);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root, encoding: "utf8",
}).split("\0").filter(Boolean);

const rows = [];
for (const path of new Set(files)) {
  if (!extensions.has(extname(path)) || path.split("/").some((part) => excluded.has(part))) continue;
  // Skip Next's generated declarations; count human-maintained source and tests.
  if (path === "frontend/next-env.d.ts") continue;
  let source;
  try {
    source = readFileSync(resolve(root, path), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") continue; // A tracked file deleted in the working tree.
    throw error;
  }
  const lines = source.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  rows.push({ path, lines: lines.length, nonblank: lines.filter((line) => line.trim()).length });
}

const groups = new Map();
for (const row of rows) {
  const group = row.path.includes("/") ? row.path.split("/")[0] : "root scripts";
  const total = groups.get(group) || { files: 0, lines: 0, nonblank: 0 };
  total.files++;
  total.lines += row.lines;
  total.nonblank += row.nonblank;
  groups.set(group, total);
}
console.log("Source size: working-tree source and tests, including untracked, non-ignored files.");
console.log("Physical and nonblank lines; comments included. Excludes docs, locks, dependencies and build output.\n");
console.table(Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b))));
console.log(`Total: ${rows.length} files, ${rows.reduce((n, row) => n + row.lines, 0)} physical lines, ${rows.reduce((n, row) => n + row.nonblank, 0)} nonblank lines.\n`);
const application = rows.filter(({ path }) =>
  /^(frontend\/src\/|backend\/[^/]+\/src\/|backend\/shared\/|database\/)/.test(path)
  && !/\.(test|spec)\.[^/]+$/.test(path));
console.log(`Application and database only: ${application.length} files, ${application.reduce((n, row) => n + row.lines, 0)} physical lines (excludes tests, utility scripts, and build/test configuration).\n`);
console.log("Largest source files (starting points for focused refactoring):");
console.table(rows.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path)).slice(0, 15));
