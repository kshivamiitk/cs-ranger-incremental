import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { attachUser } from "../shared/middleware/auth";
import { registerReviewRoutes } from "../course-service/src/reviews";
import { registerBookmarkRoutes } from "../course-service/src/bookmarks";
import { registerCollaborationRoutes } from "../course-service/src/collaboration";
import { registerCourseLockRoutes } from "../course-service/src/locks";

// Use real response and identity middleware. Stub only external integrations;
// these HTTP checks exercise the existing no-database development contracts.
vi.mock("@cs-ranger/shared", async () => ({
  ...await import("../shared/middleware/auth"),
  ...await import("../shared/utils/response"),
  mock: { reviews: [{ id: "review", courseId: "course", rating: 5 }] },
  withDb: async (_query: unknown, fallback: unknown) =>
    typeof fallback === "function" ? fallback() : fallback,
  sendRealtimeNotification: vi.fn(),
  writeAuditLog: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use(attachUser);
registerReviewRoutes(app);
registerBookmarkRoutes(app);
registerCollaborationRoutes(app);
registerCourseLockRoutes(app);
// Match the entry point's requirement: literal routes precede this catch-all.
app.get("/:id", (_req, res) => res.status(418).json({ catchAll: true }));
const server = createServer(app);
let base: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path: string, method = "GET", role?: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role) Object.assign(headers, { "x-user-id": "user", "x-user-role": role });
  return fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("extracted course routes", () => {
  it.each([
    ["POST", "/course/reviews"], ["GET", "/course/reviews/mine"],
    ["GET", "/bookmarks"], ["POST", "/bookmarks"], ["DELETE", "/bookmarks/course"],
    ["GET", "/lesson-bookmarks"], ["POST", "/nodes/node/bookmark"], ["DELETE", "/nodes/node/bookmark"],
    ["GET", "/course/collaborators"], ["POST", "/course/collaborators"],
    ["DELETE", "/course/collaborators/user"], ["POST", "/collaborations/course/respond"],
    ["GET", "/collaborations/mine"], ["GET", "/course/lock"], ["POST", "/course/lock"],
    ["POST", "/course/lock/heartbeat"], ["DELETE", "/course/lock"],
  ])("retains authentication on %s %s", async (method, path) => {
    const response = await request(path, method);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "UNAUTHORIZED" } });
  });

  it("keeps course reviews publicly readable", async () => {
    const response = await request("/course/reviews");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: [{ id: "review" }] });
  });

  it.each(["/bookmarks", "/lesson-bookmarks", "/collaborations/mine"])
    ("matches %s before the course catch-all", async (path) => {
      const response = await request(path, "GET", "learner");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, data: [] });
    });

  it("keeps creator-only invitations restricted", async () => {
    expect((await request("/course/collaborators", "POST", "learner", {})).status).toBe(403);
  });

  it.each([
    ["/course/reviews", "learner", { rating: 6 }],
    ["/bookmarks", "learner", {}],
    ["/course/collaborators", "creator", { userId: "invalid" }],
    ["/collaborations/course/respond", "creator", { accept: "yes" }],
  ])("retains request validation on %s", async (path, role, body) => {
    const response = await request(path, "POST", role, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "VALIDATION" } });
  });

  it("retains the development lock response", async () => {
    const response = await request("/course/lock", "GET", "creator");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { lock: null, role: "owner" } });
  });
});
