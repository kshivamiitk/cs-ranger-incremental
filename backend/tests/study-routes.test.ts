import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { attachUser } from "../shared/middleware/auth";
import { registerStudyRoutes } from "../user-service/src/study/routes";
import { StudyService } from "../user-service/src/study/service";
import { MemoryStudyRepository } from "../user-service/src/study/persistence";
import type { StudySnapshot, StudySummary } from "../shared/types/study";

vi.mock("@cs-ranger/shared", async () => ({
  ...await import("../shared/middleware/auth"),
  ...await import("../shared/utils/response"),
}));

let instant = new Date("2026-11-17T10:00:00Z");
const service = new StudyService(new MemoryStudyRepository(), () => instant);
const app = express();
app.use(express.json());
app.use(attachUser);
registerStudyRoutes(app, () => service);
const server = createServer(app);
let base: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/me/study`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
async function request(path = "", method = "GET", body?: unknown, user?: string) {
  return fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", ...(user ? { "x-user-id": user, "x-user-role": "learner" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function data(response: Response): Promise<StudySnapshot & { summary: StudySummary }> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.data;
}

describe("study HTTP authentication", () => {
  it.each([
    ["GET", ""], ["POST", "/goals"], ["PATCH", "/goals/id"], ["DELETE", "/goals/id"],
    ["POST", "/tasks"], ["PATCH", "/tasks/id"], ["DELETE", "/tasks/id"],
    ["POST", "/decks"], ["PATCH", "/decks/id"], ["DELETE", "/decks/id"],
    ["POST", "/cards"], ["POST", "/cards/import"], ["PATCH", "/cards/id"], ["DELETE", "/cards/id"],
    ["POST", "/cards/id/review"], ["POST", "/focus"], ["POST", "/focus/id"], ["PATCH", "/preferences"],
  ])("requires authentication on %s %s", async (method, path) => {
    const response = await request(path, method, method === "GET" ? undefined : {});
    expect(response.status).toBe(401);
  });
});

describe("study HTTP workflows", () => {
  it("persists a goal, linked task, timed focus session and task completion", async () => {
    let snapshot = await data(await request("/goals", "POST", { title: "Learn TypeScript", target_minutes: 120 }, "workflow"));
    const goalId = snapshot.workspace.goals[0].id;
    snapshot = await data(await request("/tasks", "POST", { title: "Read narrowing chapter", goal_id: goalId, estimated_minutes: 25 }, "workflow"));
    const taskId = snapshot.workspace.tasks[0].id;
    snapshot = await data(await request("/focus", "POST", { label: "Read narrowing", task_id: taskId, planned_minutes: 25 }, "workflow"));
    const sessionId = snapshot.workspace.sessions[0].id;
    instant = new Date(instant.getTime() + 10 * 60_000);
    snapshot = await data(await request(`/focus/${sessionId}`, "POST", { action: "complete" }, "workflow"));
    expect(snapshot.summary.weekly_focus_minutes).toBe(10);
    expect(snapshot.summary.goal_progress[0].minutes).toBe(10);
    snapshot = await data(await request(`/tasks/${taskId}`, "PATCH", { status: "done" }, "workflow"));
    expect(snapshot.summary.today.completed_tasks).toBe(1);
    const reloaded = await data(await request("", "GET", undefined, "workflow"));
    expect(reloaded.workspace).toEqual(snapshot.workspace);
  });
  it("isolates each learner's data and rejects another learner's goal", async () => {
    const alice = await data(await request("/goals", "POST", { title: "Private goal", target_minutes: 60 }, "alice"));
    const bob = await data(await request("", "GET", undefined, "bob"));
    expect(bob.workspace.goals).toHaveLength(0);
    const response = await request("/tasks", "POST", { title: "Other goal", goal_id: alice.workspace.goals[0].id }, "bob");
    expect(response.status).toBe(404);
    const update = await request(`/goals/${alice.workspace.goals[0].id}`, "PATCH", { title: "Stolen" }, "bob");
    expect(update.status).toBe(404);
  });
  it("imports cards, schedules recall, and handles a duplicate review safely", async () => {
    let snapshot = await data(await request("/decks", "POST", { title: "TypeScript" }, "cards"));
    const deck = snapshot.workspace.decks[0].id;
    snapshot = await data(await request("/cards/import", "POST", { deck_id: deck, cards: [{ front: "What is never?", back: "An uninhabited type." }, { front: "What is unknown?", back: "The type-safe top type." }] }, "cards"));
    expect(snapshot.summary.due_cards).toBe(2);
    const card = snapshot.workspace.cards[0].id;
    const review = { review_id: crypto.randomUUID(), grade: "good" };
    snapshot = await data(await request(`/cards/${card}/review`, "POST", review, "cards"));
    const version = snapshot.version;
    expect(snapshot.summary.due_cards).toBe(1);
    snapshot = await data(await request(`/cards/${card}/review`, "POST", review, "cards"));
    expect(snapshot.version).toBe(version);
    expect(snapshot.workspace.reviews).toHaveLength(1);
  });
  it("rejects an entire invalid card import without storing a partial batch", async () => {
    let snapshot = await data(await request("/decks", "POST", { title: "Atomic imports" }, "imports"));
    const deck_id = snapshot.workspace.decks[0].id;
    const response = await request("/cards/import", "POST", { deck_id, cards: [{ front: "Valid", back: "Yes" }, { front: "", back: "Invalid" }] }, "imports");
    expect(response.status).toBe(400);
    snapshot = await data(await request("", "GET", undefined, "imports"));
    expect(snapshot.workspace.cards).toHaveLength(0);
  });
  it("validates IDs and rejects attempts to set another user's identity", async () => {
    expect((await request("/goals/not-an-id", "DELETE", undefined, "validation")).status).toBe(400);
    const response = await request("/goals", "POST", { title: "Goal", target_minutes: 60, user_id: "alice" }, "validation");
    expect(response.status).toBe(400);
  });
  it("saves preferences and calculates week boundaries in that timezone", async () => {
    const snapshot = await data(await request("/preferences", "PATCH", { time_zone: "America/New_York", week_starts_on: "sunday", review_session_limit: 10 }, "preferences"));
    expect(snapshot.workspace.preferences.time_zone).toBe("America/New_York");
    expect(new Date(`${snapshot.summary.week[0].date}T12:00:00Z`).getUTCDay()).toBe(0);
  });
});
