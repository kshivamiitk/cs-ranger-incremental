import type { Express } from "express";
import { z } from "zod";
import { ok, fail, requireAuth, withDb, mock } from "@cs-ranger/shared";

export function registerReviewRoutes(app: Express) {
  // ─── Reviews ──────────────────────────────────────────────────────
  app.get("/:id/reviews", async (req, res) => {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 10);
    const result = await withDb(async (db) => {
      const { data, count } = await db.from("reviews").select("*", { count: "exact" }).eq("course_id", req.params.id).order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
      return { items: data || [], total: count || 0 };
    }, () => {
      const all = mock.reviews.filter((r) => r.courseId === req.params.id);
      return { items: all, total: all.length };
    });
    ok(res, result.items, { page, pageSize, total: result.total });
  });

  const ReviewCreate = z.object({ rating: z.number().int().min(1).max(5), body: z.string().max(2000).optional() });
  app.post("/:id/reviews", requireAuth, async (req, res) => {
    const parsed = ReviewCreate.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    const result = await withDb(async (db) => {
      // Must be enrolled to rate. Service-role bypasses RLS, so enforce here.
      const { data: enr } = await db.from("enrollments")
        .select("id").eq("course_id", req.params.id).eq("learner_id", req.user!.id).maybeSingle();
      if (!enr) return { forbidden: "Enroll in the course before rating it." } as const;
      // One review per (course, learner). Upsert so resubmitting just updates the
      // existing row (the table has unique (course_id, learner_id)). The
      // refresh_course_rating trigger keeps courses.rating_avg / rating_count in sync.
      const { data, error } = await db.from("reviews").upsert({
        course_id: req.params.id, learner_id: req.user!.id,
        rating: parsed.data.rating, body: parsed.data.body ?? null,
      }, { onConflict: "course_id,learner_id" }).select("*").single();
      if (error) throw error;
      return data;
    }, null);
    if (!result) return fail(res, 500, "Failed", "INTERNAL");
    if ("forbidden" in result) return fail(res, 403, result.forbidden, "FORBIDDEN");
    ok(res, result);
  });

  // The current learner's own review for a course (if any), so the rate card on
  // the course page can prefill instead of stacking duplicate submissions.
  app.get("/:id/reviews/mine", requireAuth, async (req, res) => {
    const review = await withDb(async (db) => {
      const { data } = await db.from("reviews")
        .select("*").eq("course_id", req.params.id).eq("learner_id", req.user!.id).maybeSingle();
      return data;
    }, () => null);
    ok(res, review);
  });
}
