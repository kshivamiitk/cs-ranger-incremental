/** Local-only smoke test. Requires Chrome and Node 22+
 * and a completed frontend build. No real account, keys or remote DB are used.
 */
import { spawn } from "node:child_process";
import { randomBytes, createHmac } from "node:crypto";
import { mkdtempSync, openSync, closeSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "learnrift-study-browser-"));
const processes = [];
const logFiles = [];
const jwtSecret = randomBytes(32).toString("hex");
const testEnv = {
  ...process.env, NODE_ENV: "development", JWT_SECRET: jwtSecret,
  INTERNAL_API_SECRET: randomBytes(32).toString("hex"), FRONTEND_URL: "http://localhost:3107",
  STUDY_DATA_DIR: join(directory, "study"),
  SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "", REDIS_URL: "",
};
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let socket;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is in use; the smoke test will not stop an existing server.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}
function start(name, executable, args, cwd, env = testEnv) {
  const fd = openSync(join(directory, `${name}.log`), "a", 0o600);
  logFiles.push(fd);
  const child = spawn(executable, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  child.on("error", (error) => console.error(`${name}: ${error.message}`));
  processes.push(child);
  return child;
}
async function waitUntil(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* Service or page still starting. */ }
    await sleep(150);
  }
  throw new Error(`Timed out: ${label}`);
}
function makeToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "u1", role: "learner", roles: ["learner"], exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${body}.${createHmac("sha256", jwtSecret).update(body).digest("base64url")}`;
}
let nextId = 0;
const waiting = new Map();
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    waiting.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
const button = (label) => `Array.from((document.querySelector('dialog[open]') || document).querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`;
async function click(label) {
  await waitUntil(() => evaluate(`!!(${button(label)})`), `button ${label}`);
  await evaluate(`${button(label)}.click()`);
}
async function fill(name, value) {
  await evaluate(`(() => { const el = document.querySelector('dialog[open] [name="${name}"]'); if (!el) throw new Error('Missing form field'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
}
async function noDialog() {
  await waitUntil(() => evaluate("!document.querySelector('dialog[open]')"), "successful form save");
}

try {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Use Node 22 or newer, matching CI and the supported application runtime.");
  for (const port of [4000, 4002, 4009, 3107, 9337]) await freePort(port);
  const tsx = join(root, "backend/node_modules/.bin/tsx");
  const backend = join(root, "backend");
  start("users", process.execPath, [tsx, "user-service/src/index.ts"], backend);
  start("gateway", process.execPath, [tsx, "api-gateway/src/index.ts"], backend);
  start("notifications", process.execPath, [tsx, "notification-service/src/index.ts"], backend);
  start("frontend", process.execPath, [join(root, "frontend/node_modules/.bin/next"), "start", "-p", "3107", "--hostname", "127.0.0.1"], join(root, "frontend"), { ...process.env, NODE_ENV: "production" });
  await waitUntil(async () => (await fetch("http://127.0.0.1:4002/health")).ok, "user service");
  await waitUntil(async () => (await fetch("http://127.0.0.1:3107/study")).ok, "frontend", 60000);
  start("chrome", chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(directory, "chrome")}`, "--remote-debugging-port=9337", "--window-size=1440,1100", "about:blank"], root);
  let target;
  await waitUntil(async () => {
    const response = await fetch("http://127.0.0.1:9337/json/new?about:blank", { method: "PUT" });
    target = await response.json(); return !!target.webSocketDebuggerUrl;
  }, "Chrome debugging endpoint");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(event.data);
    const pending = waiting.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    waiting.delete(response.id);
    if (response.error) pending.reject(new Error(response.error.message)); else pending.resolve(response.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    if (location.origin === 'http://127.0.0.1:3107') {
      localStorage.setItem('access_token', ${JSON.stringify(makeToken())});
      localStorage.setItem('learnrift:roleView', 'learner');
      localStorage.setItem('theme', 'dark');
    }
  ` });
  await cdp("Page.navigate", { url: "http://127.0.0.1:3107/study" });
  await click("Goals");
  await click("New goal");
  await fill("title", "Browser smoke: learn graphs");
  await click("Create goal");
  await noDialog();
  await waitUntil(() => evaluate("document.body.textContent.includes('Browser smoke: learn graphs')"), "saved goal");
  await click("Planner");
  await click("Add task");
  await fill("title", "Browser smoke: practice BFS");
  await click("Add task");
  await noDialog();
  await waitUntil(() => evaluate("!!document.querySelector('[aria-label=\"Focus on Browser smoke: practice BFS\"]')"), "saved task");
  await evaluate("document.querySelector('[aria-label=\"Focus on Browser smoke: practice BFS\"]').click()");
  await click("Start focus session");
  await click("Pause");
  await click("Resume");
  await sleep(1200);
  await click("Complete session");
  await click("Flashcards");
  await click("New deck");
  await fill("title", "Browser smoke: algorithms");
  await click("Create deck");
  await noDialog();
  await click("Browser smoke: algorithms");
  await click("Add card");
  await fill("front", "What does BFS stand for?");
  await fill("back", "Breadth-first search.");
  await click("Add card");
  await noDialog();
  await click("Review (1)");
  await click("Show answer");
  await waitUntil(() => evaluate("document.body.textContent.includes('Breadth-first search.')"), "revealed answer");
  await click("Good Normal interval");
  await waitUntil(() => evaluate("document.body.textContent.includes('Review session complete')"), "saved review");
  await click("Return to flashcards");
  await click("Overview");
  await cdp("Page.reload", { ignoreCache: true });
  await click("Goals");
  await waitUntil(() => evaluate("document.body.textContent.includes('Browser smoke: learn graphs')"), "persisted goal after reload");
  const response = await fetch("http://127.0.0.1:4000/api/users/me/study", { headers: { authorization: `Bearer ${makeToken()}` } });
  const { data } = await response.json();
  if (!data || data.workspace.goals.length !== 1 || data.workspace.tasks.length !== 1 || data.workspace.reviews.length !== 1
    || data.workspace.sessions[0]?.status !== "completed" || data.workspace.sessions[0]?.elapsed_seconds < 1) {
    throw new Error("The persisted workspace did not match the browser workflow");
  }
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  const imagePath = process.env.STUDY_SCREENSHOT || join(tmpdir(), "learnrift-study-preview.png");
  writeFileSync(imagePath, Buffer.from(screenshot.data, "base64"));
  console.log("Browser smoke passed: sign-in context, goal, task, focus pause/resume/completion, flashcard creation/review, reload, and persisted API state.");
  console.log(`Preview: ${imagePath}`);
} catch (error) {
  console.error(error.message);
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      writeFileSync(join(directory, "page.txt"), await evaluate("document.body.innerText"));
      const shot = await cdp("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(directory, "failure.png"), Buffer.from(shot.data, "base64"));
    } catch { /* Keep the original failure. */ }
  }
  console.error(`Smoke logs: ${directory}`);
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const child of processes.reverse()) {
    try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
  }
  for (const fd of logFiles) closeSync(fd);
  await sleep(500);
  if (!process.exitCode) rmSync(directory, { recursive: true, force: true });
}
