import type { Express } from "express";
import { ok, fail, requireAuth, withDb } from "@cs-ranger/shared";
import { courseEditorRole, getCourseLock } from "./access.js";

export function registerCourseLockRoutes(app: Express) {
  // ─── Lock endpoints ───────────────────────────────────────────────

  app.get("/:id/lock", requireAuth, async (req, res) => {
    type LockState = Awaited<ReturnType<typeof getCourseLock>>;
    const result = await withDb<{ forbidden: true } | { lock: LockState; role: "owner" | "collaborator" | "admin" }>(async (db) => {
      const role = await courseEditorRole(db, req.params.id, req.user!.id, req.user!.role === "admin");
      if (!role) return { forbidden: true } as const;
      const lock = await getCourseLock(db, req.params.id);
      return { lock, role } as const;
    }, () => ({ lock: null, role: "owner" as const }));
    if ("forbidden" in result) return fail(res, 403, "Not an editor of this course", "FORBIDDEN");
    ok(res, { lock: result.lock, role: result.role });
  });

  app.post("/:id/lock", requireAuth, async (req, res) => {
    const result = await withDb(async (db) => {
      const role = await courseEditorRole(db, req.params.id, req.user!.id, req.user!.role === "admin");
      if (!role) return { forbidden: true } as const;
      const { data, error } = await db.rpc("acquire_course_lock", {
        p_course_id: req.params.id, p_user_id: req.user!.id,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return { ...row, role } as const;
    }, () => ({ outcome: "acquired", held_by: req.user!.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), holder_name: "you", role: "owner" }));
    if (result && "forbidden" in result) return fail(res, 403, "Not an editor of this course", "FORBIDDEN");
    ok(res, result);
  });

  app.post("/:id/lock/heartbeat", requireAuth, async (req, res) => {
    const result = await withDb(async (db) => {
      const now = new Date();
      const newExpires = new Date(now.getTime() + 10 * 60_000);
      const { data } = await db.from("course_edit_locks")
        .update({ last_heartbeat_at: now.toISOString(), expires_at: newExpires.toISOString() })
        .eq("course_id", req.params.id)
        .eq("held_by", req.user!.id)
        .select("expires_at")
        .maybeSingle();
      return { held: !!data, expires_at: data?.expires_at || null };
    }, () => ({ held: true, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }));
    ok(res, result);
  });

  app.delete("/:id/lock", requireAuth, async (req, res) => {
    await withDb(async (db) => {
      await db.from("course_edit_locks")
        .delete()
        .eq("course_id", req.params.id)
        .eq("held_by", req.user!.id);
      return null;
    }, null);
    ok(res, { released: true });
  });
}
