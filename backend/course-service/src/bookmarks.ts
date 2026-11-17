import type { Express } from "express";
import { ok, fail, requireAuth, withDb } from "@cs-ranger/shared";

export function registerBookmarkRoutes(app: Express) {
  // ─── Bookmarks (node-level) ──────────────────────────────────────
  app.get("/bookmarks", requireAuth, async (req, res) => {
    const list = await withDb(async (db) => {
      const { data } = await db.from("bookmarks").select("course_id, created_at, courses(*)").eq("learner_id", req.user!.id);
      return data || [];
    }, () => []);
    ok(res, list);
  });

  app.post("/bookmarks", requireAuth, async (req, res) => {
    const courseId = String(req.body.courseId || "");
    if (!courseId) return fail(res, 400, "courseId required", "VALIDATION");
    await withDb(async (db) => { await db.from("bookmarks").insert({ learner_id: req.user!.id, course_id: courseId }); return null; }, null);
    ok(res, { bookmarked: true });
  });

  app.delete("/bookmarks/:courseId", requireAuth, async (req, res) => {
    await withDb(async (db) => {
      await db.from("bookmarks").delete().eq("learner_id", req.user!.id).eq("course_id", req.params.courseId);
      return null;
    }, null);
    ok(res, { bookmarked: false });
  });

  // ─── Lesson (node-level) bookmarks ───────────────────────────────
  // Distinct from /bookmarks above: this saves a specific lesson position so the
  // learner can jump straight back to /course/<id>/learn/<nodeId>, not the
  // course landing.
  app.get("/lesson-bookmarks", requireAuth, async (req, res) => {
    const list = await withDb(async (db) => {
      const { data } = await db.from("lesson_bookmarks")
        .select("node_id, course_id, created_at, nodes(id, title, type), courses(id, title, thumbnail_url)")
        .eq("learner_id", req.user!.id)
        .order("created_at", { ascending: false });
      return data || [];
    }, () => []);
    ok(res, list);
  });

  app.post("/nodes/:nodeId/bookmark", requireAuth, async (req, res) => {
    const result = await withDb(async (db) => {
      // course_id is required on the row; resolve it from the node → module.
      const { data: node } = await db.from("nodes")
        .select("modules!inner(course_id)")
        .eq("id", req.params.nodeId)
        .maybeSingle();
      if (!node) return { notFound: true } as const;
      type Rel = { modules?: { course_id: string } | { course_id: string }[] };
      const m = (node as Rel).modules;
      const courseId = Array.isArray(m) ? m[0]?.course_id : m?.course_id;
      if (!courseId) return { notFound: true } as const;
      // Upsert keyed by (learner_id, node_id) — bookmarking the same lesson
      // twice just touches the row.
      await db.from("lesson_bookmarks").upsert(
        { learner_id: req.user!.id, node_id: req.params.nodeId, course_id: courseId },
        { onConflict: "learner_id,node_id" },
      );
      return { bookmarked: true } as const;
    }, null);
    if (!result) return fail(res, 500, "Failed", "INTERNAL");
    if ("notFound" in result) return fail(res, 404, "Lesson not found", "NOT_FOUND");
    ok(res, result);
  });

  app.delete("/nodes/:nodeId/bookmark", requireAuth, async (req, res) => {
    await withDb(async (db) => {
      await db.from("lesson_bookmarks")
        .delete()
        .eq("learner_id", req.user!.id)
        .eq("node_id", req.params.nodeId);
      return null;
    }, null);
    ok(res, { bookmarked: false });
  });
}
