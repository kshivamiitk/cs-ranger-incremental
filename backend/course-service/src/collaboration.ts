import type { Express } from "express";
import { z } from "zod";
import { ok, fail, requireAuth, requireRole, withDb, sendRealtimeNotification, writeAuditLog } from "@cs-ranger/shared";
import { courseEditorRole } from "./access.js";

export function registerCollaborationRoutes(app: Express) {
  // ─── Collaboration endpoints ──────────────────────────────────────
  // Invitations + active collaborations. See Docs/collaboration.md for the
  // full design.

  // List "people on this course" — owner and all collaborator rows (any status).
  // Available to the owner and any collaborator (pending or otherwise).
  // PostgREST can't embed profiles directly off course_collaborators.user_id
  // (that FK points at users, not profiles), so we go through users → profiles
  // and flatten back to `row.profiles` so the frontend shape stays unchanged.
  type CollabRowRaw = {
    course_id: string; user_id: string; status: string; role: string;
    invited_by: string; invited_at: string; responded_at: string | null;
    users?: { profiles?: { display_name?: string; username?: string; avatar_url?: string } | null } | null;
    profiles?: { display_name?: string; username?: string; avatar_url?: string } | null;
  };
  function flattenCollabProfiles(rows: CollabRowRaw[] | null | undefined): CollabRowRaw[] {
    return (rows || []).map((r) => {
      const p = r.users?.profiles || null;
      const out = { ...r, profiles: p } as CollabRowRaw;
      delete out.users;
      return out;
    });
  }

  app.get("/:id/collaborators", requireAuth, async (req, res) => {
    const result = await withDb<{ forbidden: true } | { items: unknown[] }>(async (db) => {
      const role = await courseEditorRole(db, req.params.id, req.user!.id, req.user!.role === "admin");
      if (!role) {
        const { data: own } = await db.from("course_collaborators")
          .select("course_id, user_id, status, role, invited_by, invited_at, responded_at")
          .eq("course_id", req.params.id).eq("user_id", req.user!.id).maybeSingle();
        if (!own) return { forbidden: true } as const;
        return { items: [own] } as const;
      }
      const { data } = await db.from("course_collaborators")
        .select("course_id, user_id, status, role, invited_by, invited_at, responded_at, users:user_id(profiles(display_name, username, avatar_url))")
        .eq("course_id", req.params.id);
      return { items: flattenCollabProfiles(data as CollabRowRaw[] | null) } as const;
    }, () => ({ items: [] as Array<Record<string, unknown>> }));
    if ("forbidden" in result) return fail(res, 403, "Not your course", "FORBIDDEN");
    ok(res, result.items);
  });

  // Invite a creator. Owner-only. Idempotent: re-inviting a pending row is a
  // no-op; re-inviting a declined/removed row resets it to pending.
  const InviteBody = z.object({ userId: z.string().uuid() });
  app.post("/:id/collaborators", requireRole("creator", "admin"), async (req, res) => {
    const parsed = InviteBody.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    const inviteeId = parsed.data.userId;
    if (inviteeId === req.user!.id) return fail(res, 400, "You can't invite yourself", "VALIDATION");

    const result = await withDb(async (db) => {
      const { data: course } = await db.from("courses").select("creator_id, title").eq("id", req.params.id).maybeSingle();
      if (!course) return { notFound: true } as const;
      if ((course as { creator_id: string }).creator_id !== req.user!.id && req.user!.role !== "admin") {
        return { forbidden: true } as const;
      }
      // Invitee must already be a creator.
      const { data: roleRow } = await db.from("user_roles")
        .select("role").eq("user_id", inviteeId).eq("role", "creator").maybeSingle();
      if (!roleRow) return { notCreator: true } as const;
      // Upsert — re-inviting after decline/remove resets the row.
      const { data: row, error } = await db.from("course_collaborators").upsert({
        course_id: req.params.id, user_id: inviteeId,
        status: "pending", role: "editor",
        invited_by: req.user!.id, invited_at: new Date().toISOString(), responded_at: null,
      }, { onConflict: "course_id,user_id" }).select("*").single();
      if (error) throw error;
      // Notify the invitee — synchronous insert (Redis-independent).
      await db.from("notifications").insert({
        user_id: inviteeId,
        type: "collab_invite",
        title: "You've been invited to collaborate",
        body: `On the course "${(course as { title: string }).title}"`,
        href: `/creator/collaborations?focus=${req.params.id}`,
      });
      await sendRealtimeNotification(inviteeId, { type: "collab_invite", courseId: req.params.id });
      return { row } as const;
    }, null);

    if (!result) return fail(res, 500, "Failed", "INTERNAL");
    if ("notFound" in result) return fail(res, 404, "Course not found", "NOT_FOUND");
    if ("forbidden" in result) return fail(res, 403, "Not your course", "FORBIDDEN");
    if ("notCreator" in result) return fail(res, 400, "That user isn't a creator", "VALIDATION");
    // Creator-initiated invites are visible in the collaborator list itself; only
    // admin interventions belong in the admin audit log.
    if (req.user!.role === "admin") {
      await writeAuditLog({ adminId: req.user!.id, action: "collaborator.invited", targetType: "course", targetId: String(req.params.id), metadata: { userId: inviteeId } });
    }
    ok(res, result.row);
  });

  // Remove a collaborator (owner) or leave a course (self).
  app.delete("/:id/collaborators/:userId", requireAuth, async (req, res) => {
    const result = await withDb(async (db) => {
      const { data: course } = await db.from("courses").select("creator_id, title").eq("id", req.params.id).maybeSingle();
      if (!course) return { notFound: true } as const;
      const isOwner = (course as { creator_id: string }).creator_id === req.user!.id;
      const isSelf  = req.params.userId === req.user!.id;
      if (!isOwner && !isSelf && req.user!.role !== "admin") return { forbidden: true } as const;
      if (isOwner && isSelf) return { invalid: "Owners can't leave their own course" } as const;
      const { error } = await db.from("course_collaborators")
        .update({ status: "removed", responded_at: new Date().toISOString() })
        .eq("course_id", req.params.id).eq("user_id", req.params.userId);
      if (error) throw error;
      // Tell the removed user (only when the owner removes them — leaving is
      // self-initiated and doesn't need a notification).
      if (!isSelf) {
        await db.from("notifications").insert({
          user_id: req.params.userId,
          type: "collab_removed",
          title: "Removed from a collaboration",
          body: `${(course as { title: string }).title}`,
          href: `/creator/collaborations`,
        });
        await sendRealtimeNotification(String(req.params.userId), { type: "collab_removed", courseId: req.params.id });
      } else {
        // A collaborator left on their own — the owner should hear about it.
        const ownerId = (course as { creator_id: string }).creator_id;
        await db.from("notifications").insert({
          user_id: ownerId,
          type: "collab_left",
          title: "A collaborator left your course",
          body: `${(course as { title: string }).title}`,
          href: `/creator/courses/${req.params.id}/edit`,
        });
        await sendRealtimeNotification(ownerId, { type: "collab_left", courseId: req.params.id });
      }
      return { ok: true } as const;
    }, null);
    if (!result) return fail(res, 500, "Failed", "INTERNAL");
    if ("notFound" in result) return fail(res, 404, "Course not found", "NOT_FOUND");
    if ("forbidden" in result) return fail(res, 403, "Not allowed", "FORBIDDEN");
    if ("invalid" in result) return fail(res, 400, result.invalid ?? "Invalid request", "VALIDATION");
    if (req.user!.role === "admin" && req.params.userId !== req.user!.id) {
      await writeAuditLog({ adminId: req.user!.id, action: "collaborator.removed", targetType: "course", targetId: String(req.params.id), metadata: { userId: req.params.userId } });
    }
    ok(res, { removed: true });
  });

  // Invitee Accept / Decline.
  const RespondBody = z.object({ accept: z.boolean() });
  app.post("/collaborations/:courseId/respond", requireAuth, async (req, res) => {
    const parsed = RespondBody.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    const newStatus = parsed.data.accept ? "accepted" : "declined";

    const result = await withDb(async (db) => {
      const { data: row } = await db.from("course_collaborators")
        .select("course_id, user_id, status, invited_by, courses:course_id(title)")
        .eq("course_id", req.params.courseId).eq("user_id", req.user!.id).maybeSingle();
      if (!row) return { notFound: true } as const;
      if ((row as { status: string }).status !== "pending") {
        return { invalid: "This invitation isn't pending" } as const;
      }
      const { error } = await db.from("course_collaborators")
        .update({ status: newStatus, responded_at: new Date().toISOString() })
        .eq("course_id", req.params.courseId).eq("user_id", req.user!.id);
      if (error) throw error;
      // Tell the inviter — both accept and decline get a notification.
      type Joined = { invited_by: string; courses?: { title?: string } | { title?: string }[] | null };
      const r = row as Joined;
      const courseObj = Array.isArray(r.courses) ? r.courses[0] : r.courses;
      await db.from("notifications").insert({
        user_id: r.invited_by,
        type: parsed.data.accept ? "collab_accepted" : "collab_declined",
        title: parsed.data.accept ? "Collaboration accepted" : "Collaboration declined",
        body: courseObj?.title || "",
        href: `/creator/courses/${req.params.courseId}/edit`,
      });
      await sendRealtimeNotification(r.invited_by, { type: parsed.data.accept ? "collab_accepted" : "collab_declined", courseId: req.params.courseId });
      return { ok: true } as const;
    }, null);

    if (!result) return fail(res, 500, "Failed", "INTERNAL");
    if ("notFound" in result) return fail(res, 404, "Invitation not found", "NOT_FOUND");
    if ("invalid" in result) return fail(res, 400, result.invalid ?? "Invalid request", "VALIDATION");
    ok(res, { status: newStatus });
  });

  // My pending invites + accepted collaborations. Same flattening trick as
  // /:id/collaborators — go users → profiles, then bring `display_name` up
  // onto the row as `inviter` for the frontend.
  type MyCollabRowRaw = {
    course_id: string; user_id: string; status: string; role: string;
    invited_by: string; invited_at: string; responded_at: string | null;
    courses?: { id: string; title: string; thumbnail_url?: string | null; creator_id: string } | { id: string; title: string; thumbnail_url?: string | null; creator_id: string }[] | null;
    inviter_user?: { profiles?: { display_name?: string } | null } | null;
    inviter?: { display_name?: string } | null;
  };
  app.get("/collaborations/mine", requireAuth, async (req, res) => {
    const status = String(req.query.status || "");
    const list = await withDb(async (db) => {
      let q = db.from("course_collaborators")
        .select("course_id, user_id, status, role, invited_by, invited_at, responded_at, courses:course_id(id, title, thumbnail_url, creator_id), inviter_user:invited_by(profiles(display_name))")
        .eq("user_id", req.user!.id);
      if (status === "pending" || status === "accepted" || status === "declined") q = q.eq("status", status);
      else q = q.in("status", ["pending", "accepted"]); // never show declined/removed by default
      const { data } = await q.order("invited_at", { ascending: false });
      return (data as MyCollabRowRaw[] | null || []).map((r) => {
        const out = { ...r, inviter: r.inviter_user?.profiles || null } as MyCollabRowRaw;
        delete out.inviter_user;
        return out;
      });
    }, () => []);
    ok(res, list);
  });
}
