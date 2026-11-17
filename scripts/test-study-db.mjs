import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// A separate local cluster and Unix socket ensure this never touches an
// existing development or production database, even if DATABASE_URL is set.
const directory = mkdtempSync(join(tmpdir(), "learnrift-study-pg-"));
const cluster = join(directory, "data");
let running = false;
let bindir;
try {
  bindir = process.env.PG_BINDIR || execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  const run = (name, args, options = {}) => execFileSync(join(bindir, name), args, {
    stdio: "pipe", ...options,
  });
  run("initdb", ["-D", cluster, "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  run("pg_ctl", ["-D", cluster, "-l", join(directory, "postgres.log"), "-o", `-F -k ${directory} -c listen_addresses='' -p 55443`, "-w", "start"]);
  running = true;
  const args = ["-X", "-h", directory, "-p", "55443", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
  run("psql", [...args, "-c", `
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.users(id uuid primary key);
  `]);
  const migration = join(root, "database/migrations/0043_study_workspaces.sql");
  run("psql", [...args, "-f", migration]);
  run("psql", [...args, "-f", migration]); // Idempotent schema installation.
  run("psql", [...args, "-f", join(root, "database/tests/study-workspaces.sql")]);
  console.log("Study migration passed: install, reapply, permissions, RLS, version conflicts, size constraints, and deletion cascade.");
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  let stopped = !running;
  if (running) {
    try { execFileSync(join(bindir, "pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"], { stdio: "pipe" }); stopped = true; }
    catch { console.error(`Stop the isolated test cluster manually: ${cluster}`); process.exitCode = 1; }
  }
  // Never remove files beneath a server that failed to stop.
  if (stopped) rmSync(directory, { recursive: true, force: true });
}
