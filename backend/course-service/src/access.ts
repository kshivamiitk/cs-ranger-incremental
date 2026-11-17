import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Collaboration helpers ────────────────────────────────────────
// Single source of truth for "can this user write to this course": the course
// owner OR an accepted collaborator OR an admin. Both invoked from every
// write-path handler so a future role tweak is one place to change.
export async function courseEditorRole(
  db: SupabaseClient,
  // Express 5 types route params as string | string[]; normalise once here so
  // every call site can pass req.params.* directly.
  courseIdParam: string | string[],
  userId: string,
  isAdmin: boolean,
): Promise<"owner" | "collaborator" | "admin" | null> {
  const courseId = String(courseIdParam);
  if (isAdmin) return "admin";
  const { data: course } = await db.from("courses").select("creator_id").eq("id", courseId).maybeSingle();
  if (!course) return null;
  if ((course as { creator_id: string }).creator_id === userId) return "owner";
  const { data: collab } = await db.from("course_collaborators")
    .select("user_id").eq("course_id", courseId).eq("user_id", userId).eq("status", "accepted").maybeSingle();
  return collab ? "collaborator" : null;
}

// Resolve a module / lesson back to its parent course so we can authz the
// write path. One-shot small queries, indexed lookups.
export async function moduleCourseId(db: SupabaseClient, moduleId: string | string[]): Promise<string | null> {
  const { data } = await db.from("modules").select("course_id").eq("id", String(moduleId)).maybeSingle();
  return (data as { course_id?: string } | null)?.course_id || null;
}
export async function nodeCourseId(db: SupabaseClient, nodeId: string | string[]): Promise<string | null> {
  const { data } = await db.from("nodes")
    .select("modules!inner(course_id)").eq("id", String(nodeId)).maybeSingle();
  if (!data) return null;
  const m = (data as { modules?: { course_id?: string } | { course_id?: string }[] }).modules;
  const one = Array.isArray(m) ? m[0] : m;
  return one?.course_id || null;
}

// Inspect the lock row directly (bypasses the SQL function — that one mutates).
// PostgREST can't embed profiles off course_edit_locks.held_by because that
// column FKs users(id), not profiles. Same trap as comments/collaborators —
// we traverse users → profiles and flatten. If we don't do this the join
// errors out, the function returns null, and EVERY lock check downstream
// reads as "no lock → require one" — which is the exact bug that caused
// "Acquire the edit lock before saving" to fire even when the lock was held.
export async function getCourseLock(db: SupabaseClient, courseId: string | string[]): Promise<
  { heldBy: string; expiresAt: string; holderName: string; expired: boolean } | null
> {
  const { data } = await db.from("course_edit_locks")
    .select("held_by, expires_at, users:held_by(profiles(display_name))")
    .eq("course_id", String(courseId))
    .maybeSingle();
  if (!data) return null;
  type Row = {
    held_by: string;
    expires_at: string;
    users?: { profiles?: { display_name?: string } | null } | { profiles?: { display_name?: string } | null }[] | null;
  };
  const r = data as Row;
  const u = Array.isArray(r.users) ? r.users[0] : r.users;
  const p = u?.profiles;
  return {
    heldBy: r.held_by,
    expiresAt: r.expires_at,
    holderName: p?.display_name || "Someone",
    expired: new Date(r.expires_at).getTime() < Date.now(),
  };
}

// One-stop write-path check: caller must be an editor (owner / accepted
// collaborator / admin) AND currently hold the lock. Admin bypasses the lock
// so they can always step in.
export type WriteCheck =
  | { ok: true; role: "owner" | "collaborator" | "admin" }
  | { ok: false; status: number; code: string; message: string; meta?: Record<string, unknown> };

export async function assertCanWriteCourse(
  db: SupabaseClient, courseId: string | string[], userId: string, isAdmin: boolean,
): Promise<WriteCheck> {
  // Admin bypasses editor + lock checks — keep the zero-query fast path.
  if (isAdmin) return { ok: true, role: "admin" };
  // Single round-trip: editor role + edit-lock state in one read, replacing the
  // previous 2-3 sequential selects (courses → maybe collaborators → lock). That
  // authz was the dominant latency on the write path; course_write_check
  // (migration 0036) returns the same role values courseEditorRole produced.
  const { data } = await db.rpc("course_write_check", { p_course_id: String(courseId), p_user_id: userId });
  const row = (Array.isArray(data) ? data[0] : data) as {
    role: "owner" | "collaborator" | null;
    lock_held_by: string | null;
    lock_expires_at: string | null;
    lock_holder_name: string | null;
    lock_expired: boolean | null;
  } | null;
  const role = row?.role ?? null;
  if (!role) return { ok: false, status: 403, code: "NOT_EDITOR", message: "Not an editor of this course" };
  const heldBy = row!.lock_held_by;
  if (!heldBy || (row!.lock_expired ?? true)) {
    return { ok: false, status: 423, code: "LOCK_REQUIRED", message: "Acquire the edit lock before saving" };
  }
  if (heldBy !== userId) {
    const holderName = row!.lock_holder_name || "Someone";
    return {
      ok: false, status: 423, code: "LOCK_HELD_BY_OTHER",
      message: `Locked by ${holderName}`,
      // holderId duplicates heldBy so clients can rely on the documented
      // LOCKED-error shape (holderId / holderName / expiresAt).
      meta: { heldBy, holderId: heldBy, holderName, expiresAt: row!.lock_expires_at },
    };
  }
  return { ok: true, role };
}
