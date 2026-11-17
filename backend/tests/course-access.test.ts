import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertCanWriteCourse, courseEditorRole, getCourseLock, moduleCourseId, nodeCourseId,
} from "../course-service/src/access";

// Exercise authorization without service startup, secrets, or a live database.
function database(...rows: unknown[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  for (const data of rows) query.maybeSingle.mockResolvedValueOnce({ data });
  const from = vi.fn().mockReturnValue(query);
  const rpc = vi.fn();
  return { db: { from, rpc } as unknown as SupabaseClient, from, rpc, query };
}

beforeEach(() => vi.restoreAllMocks());

describe("course editor access", () => {
  it("lets administrators bypass database queries", async () => {
    const { db, from, rpc } = database();
    expect(await courseEditorRole(db, "course", "admin", true)).toBe("admin");
    expect(await assertCanWriteCourse(db, "course", "admin", true))
      .toEqual({ ok: true, role: "admin" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recognizes owners without looking up collaborators", async () => {
    const { db, from } = database({ creator_id: "owner" });
    expect(await courseEditorRole(db, "course", "owner", false)).toBe("owner");
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing course before checking collaboration", async () => {
    const { db, from } = database(null);
    expect(await courseEditorRole(db, "missing", "user", false)).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("requires an accepted collaboration", async () => {
    const { db, query } = database({ creator_id: "owner" }, { user_id: "editor" });
    expect(await courseEditorRole(db, "course", "editor", false)).toBe("collaborator");
    expect(query.eq).toHaveBeenCalledWith("status", "accepted");
  });

  it("rejects users without an accepted collaboration", async () => {
    const { db } = database({ creator_id: "owner" }, null);
    expect(await courseEditorRole(db, "course", "stranger", false)).toBeNull();
  });
});

describe("course write locks", () => {
  const lock = {
    role: "owner", lock_held_by: "writer", lock_expired: false,
    lock_holder_name: "Writer", lock_expires_at: "2099-01-01T00:00:00Z",
  };

  it.each([null, [], { ...lock, role: null }])("denies non-editors (%j)", async (data) => {
    const { db, rpc } = database();
    rpc.mockResolvedValue({ data });
    expect(await assertCanWriteCourse(db, "course", "writer", false))
      .toMatchObject({ ok: false, status: 403, code: "NOT_EDITOR" });
  });

  it.each([
    { lock_held_by: null }, { lock_expired: true }, { lock_expired: null },
  ])("requires a current lock (%j)", async (changes) => {
    const { db, rpc } = database();
    rpc.mockResolvedValue({ data: [{ ...lock, ...changes }] });
    expect(await assertCanWriteCourse(db, "course", "writer", false))
      .toMatchObject({ ok: false, status: 423, code: "LOCK_REQUIRED" });
  });

  it("reports the holder when another editor owns the lock", async () => {
    const { db, rpc } = database();
    rpc.mockResolvedValue({ data: lock });
    expect(await assertCanWriteCourse(db, "course", "other", false)).toEqual({
      ok: false, status: 423, code: "LOCK_HELD_BY_OTHER", message: "Locked by Writer",
      meta: {
        heldBy: "writer", holderId: "writer", holderName: "Writer",
        expiresAt: lock.lock_expires_at,
      },
    });
  });

  it.each(["owner", "collaborator"])("allows a %s holding the lock with one RPC", async (role) => {
    const { db, rpc, from } = database();
    rpc.mockResolvedValue({ data: [{ ...lock, role }] });
    expect(await assertCanWriteCourse(db, "course", "writer", false)).toEqual({ ok: true, role });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("course_write_check", {
      p_course_id: "course", p_user_id: "writer",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([false, true])("reads the lock holder through object or array joins (%s)", async (array) => {
    const joined = { profiles: { display_name: "Editor" } };
    const { db } = database({
      held_by: "editor", expires_at: "2099-01-01T00:00:00Z",
      users: array ? [joined] : joined,
    });
    expect(await getCourseLock(db, "course")).toEqual({
      heldBy: "editor", expiresAt: "2099-01-01T00:00:00Z", holderName: "Editor", expired: false,
    });
  });

  it("returns null when no lock exists", async () => {
    expect(await getCourseLock(database(null).db, "course")).toBeNull();
  });

  it("marks a past lock as expired and provides a missing holder name", async () => {
    const { db } = database({ held_by: "editor", expires_at: "2000-01-01T00:00:00Z" });
    expect(await getCourseLock(db, "course")).toMatchObject({ expired: true, holderName: "Someone" });
  });
});

describe("parent course lookup", () => {
  it("resolves a module and returns null for a missing module", async () => {
    expect(await moduleCourseId(database({ course_id: "course" }).db, "module")).toBe("course");
    expect(await moduleCourseId(database(null).db, "module")).toBeNull();
  });

  it.each([{ course_id: "course" }, [{ course_id: "course" }]])("resolves a lesson join (%j)", async (modules) => {
    expect(await nodeCourseId(database({ modules }).db, "node")).toBe("course");
  });

  it.each([null, { modules: [] }, { modules: null }])("handles missing lesson parents (%j)", async (row) => {
    expect(await nodeCourseId(database(row).db, "node")).toBeNull();
  });
});
