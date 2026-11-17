import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyWorkspace, scheduleReview, elapsedSeconds, dueCards, StudyError, LIMITS } from "../user-service/src/study/model";
import { applyCommand, type StudyCommand } from "../user-service/src/study/commands";
import { StudyService } from "../user-service/src/study/service";
import { MemoryStudyRepository, FileStudyRepository, SupabaseStudyRepository } from "../user-service/src/study/persistence";
import { localStudyDate, studySummary } from "../user-service/src/study/analytics";
import * as validation from "../user-service/src/study/validation";
import type { StudyWorkspace, StudyCard, ReviewGrade } from "../shared/types/study";
import type { SupabaseClient } from "@supabase/supabase-js";

const now = new Date("2026-11-17T10:00:00Z");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);
function execute(w: StudyWorkspace, command: StudyCommand, time = now) { return applyCommand(w, command, time); }
function fixture() {
  let w = emptyWorkspace();
  w = execute(w, { type: "goal.create", input: { title: "Learn graphs", target_minutes: 300 } });
  w = execute(w, { type: "deck.create", input: { title: "Graphs" } });
  w = execute(w, { type: "card.create", input: { deck_id: w.decks[0].id, front: "BFS?", back: "Breadth-first search" } });
  return w;
}

describe("study validation", () => {
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "not-a-date"])("rejects invalid date %s", (date) => {
    expect(validation.goalCreate.safeParse({ title: "Goal", target_minutes: 60, due_date: date }).success).toBe(false);
  });
  it("accepts leap dates and trims titles", () => {
    expect(validation.goalCreate.parse({ title: "  Goal  ", target_minutes: 60, due_date: "2028-02-29" }).title).toBe("Goal");
  });
  it("does not allow clients to set schedules, history, or another owner", () => {
    expect(validation.cardCreate.safeParse({ deck_id: randomUUID(), front: "Q", back: "A", due_at: now.toISOString() }).success).toBe(false);
    expect(validation.taskCreate.safeParse({ title: "Task", user_id: randomUUID() }).success).toBe(false);
    expect(validation.focusCreate.safeParse({ label: "Session", planned_minutes: 25, elapsed_seconds: 9999 }).success).toBe(false);
  });
  it("requires a nonempty patch and an IANA time zone", () => {
    expect(validation.taskPatch.safeParse({}).success).toBe(false);
    expect(validation.preferencesPatch.safeParse({ time_zone: "invalid/zone" }).success).toBe(false);
    expect(validation.preferencesPatch.safeParse({ time_zone: "America/New_York" }).success).toBe(true);
  });
  it("bounds bulk imports and text sizes", () => {
    expect(validation.bulkCards.safeParse({ deck_id: randomUUID(), cards: Array.from({ length: 101 }, () => ({ front: "Q", back: "A" })) }).success).toBe(false);
    expect(validation.cardCreate.safeParse({ deck_id: randomUUID(), front: "Q", back: "x".repeat(8001) }).success).toBe(false);
  });
});

describe("study goals and planner", () => {
  it("does not mutate the original snapshot", () => {
    const original = emptyWorkspace();
    const next = execute(original, { type: "goal.create", input: { title: "Goal", target_minutes: 120 } });
    expect(original.goals).toHaveLength(0);
    expect(next.goals[0]).toMatchObject({ title: "Goal", status: "active", due_date: null });
  });
  it("rejects references to goals outside the workspace", () => {
    expect(() => execute(fixture(), { type: "task.create", input: { title: "Task", goal_id: randomUUID() } })).toThrow(StudyError);
  });
  it("does not attach new work to archived goals", () => {
    let w = fixture();
    w = execute(w, { type: "goal.update", id: w.goals[0].id, input: { status: "archived" } });
    expect(() => execute(w, { type: "task.create", input: { title: "Task", goal_id: w.goals[0].id } })).toThrow("active learning goal");
  });
  it("preserves the original completion date and clears it when reopened", () => {
    let w = execute(emptyWorkspace(), { type: "task.create", input: { title: "Task" } });
    const id = w.tasks[0].id;
    w = execute(w, { type: "task.update", id, input: { status: "done" } });
    w = execute(w, { type: "task.update", id, input: { notes: "Finished" } }, later(60));
    expect(w.tasks[0].completed_at).toBe(now.toISOString());
    w = execute(w, { type: "task.update", id, input: { status: "planned" } });
    expect(w.tasks[0].completed_at).toBeNull();
  });
  it("detaches tasks and sessions when deleting a goal", () => {
    let w = fixture();
    const goal_id = w.goals[0].id;
    w = execute(w, { type: "task.create", input: { title: "Task", goal_id } });
    w = execute(w, { type: "focus.create", input: { label: "Session", planned_minutes: 25, goal_id } });
    w = execute(w, { type: "goal.delete", id: goal_id });
    expect(w.goals).toHaveLength(0);
    expect(w.tasks[0].goal_id).toBeNull();
    expect(w.sessions[0].goal_id).toBeNull();
  });
  it("enforces entity limits without partly applying a command", () => {
    const w = fixture();
    w.goals = Array.from({ length: LIMITS.goals }, () => ({ ...w.goals[0], id: randomUUID() }));
    expect(() => execute(w, { type: "goal.create", input: { title: "Extra", target_minutes: 30 } })).toThrow("limit");
    expect(w.goals).toHaveLength(LIMITS.goals);
  });
});

describe("flashcard scheduling", () => {
  it.each([
    ["again", 0, 600], ["hard", 1, 86400], ["good", 1, 86400], ["easy", 4, 345600],
  ] as const)("schedules a new card graded %s", (grade, interval, seconds) => {
    const card = scheduleReview(fixture().cards[0], grade, now);
    expect(card.interval_days).toBe(interval);
    expect(card.due_at).toBe(later(seconds).toISOString());
  });
  it("increases intervals for repeated recall and resets after a lapse", () => {
    let card = fixture().cards[0];
    card = scheduleReview(card, "good", now);
    expect(card.interval_days).toBe(1);
    card = scheduleReview(card, "good", later(86400));
    expect(card.interval_days).toBe(6);
    card = scheduleReview(card, "good", later(7 * 86400));
    expect(card.interval_days).toBe(15);
    card = scheduleReview(card, "again", later(22 * 86400));
    expect(card).toMatchObject({ repetitions: 0, lapses: 1, interval_days: 0 });
  });
  it("bounds ease and intervals across repeated extreme grades", () => {
    let hard = fixture().cards[0];
    let easy = fixture().cards[0];
    for (let i = 0; i < 100; i++) {
      hard = scheduleReview(hard, "again", now);
      easy = scheduleReview(easy, "easy", now);
    }
    expect(hard.ease).toBe(1.3);
    expect(easy.ease).toBe(3.5);
    expect(easy.interval_days).toBe(36500);
  });
  it("handles a network retry without recording another review", () => {
    let w = fixture();
    const command: StudyCommand = { type: "card.review", id: w.cards[0].id, input: { review_id: randomUUID(), grade: "good" } };
    w = execute(w, command);
    const retry = execute(w, command, later(1));
    expect(retry).toBe(w);
    expect(retry.reviews).toHaveLength(1);
  });
  it("rejects reuse of a review id for a different grade", () => {
    let w = fixture();
    const review_id = randomUUID();
    const id = w.cards[0].id;
    w = execute(w, { type: "card.review", id, input: { review_id, grade: "good" } });
    expect(() => execute(w, { type: "card.review", id, input: { review_id, grade: "easy" } })).toThrow("already used");
  });
  it("prevents a second review from a different tab before the card is due", () => {
    let w = fixture();
    const id = w.cards[0].id;
    w = execute(w, { type: "card.review", id, input: { review_id: randomUUID(), grade: "good" } });
    expect(() => execute(w, { type: "card.review", id, input: { review_id: randomUUID(), grade: "good" } }, later(1))).toThrow("scheduled for later");
  });
  it("excludes archived decks and suspended cards", () => {
    let w = fixture();
    expect(dueCards(w, now)).toHaveLength(1);
    w = execute(w, { type: "card.update", id: w.cards[0].id, input: { suspended: true } });
    expect(dueCards(w, now)).toHaveLength(0);
    w = execute(w, { type: "card.update", id: w.cards[0].id, input: { suspended: false } });
    w = execute(w, { type: "deck.update", id: w.decks[0].id, input: { archived: true } });
    expect(dueCards(w, now)).toHaveLength(0);
  });
  it("keeps imports atomic at the workspace card limit", () => {
    const w = fixture();
    w.cards = Array.from({ length: LIMITS.cards - 1 }, () => ({ ...w.cards[0], id: randomUUID() }));
    expect(() => execute(w, { type: "card.import", input: { deck_id: w.decks[0].id, cards: [{ front: "A", back: "B" }, { front: "C", back: "D" }] } })).toThrow("card limit");
    expect(w.cards).toHaveLength(LIMITS.cards - 1);
  });
});

describe("focus sessions", () => {
  it("allows only one running or paused session", () => {
    let w = execute(emptyWorkspace(), { type: "focus.create", input: { label: "Session", planned_minutes: 25 } });
    expect(() => execute(w, { type: "focus.create", input: { label: "Other", planned_minutes: 25 } })).toThrow("current focus session");
    w = execute(w, { type: "focus.action", id: w.sessions[0].id, input: { action: "pause" } }, later(60));
    expect(() => execute(w, { type: "focus.create", input: { label: "Other", planned_minutes: 25 } })).toThrow("current focus session");
  });
  it("does not count paused time and caps at the planned duration", () => {
    let w = execute(emptyWorkspace(), { type: "focus.create", input: { label: "Session", planned_minutes: 2 } });
    const id = w.sessions[0].id;
    w = execute(w, { type: "focus.action", id, input: { action: "pause" } }, later(30));
    expect(elapsedSeconds(w.sessions[0], later(300))).toBe(30);
    w = execute(w, { type: "focus.action", id, input: { action: "resume" } }, later(300));
    w = execute(w, { type: "focus.action", id, input: { action: "complete" } }, later(600));
    expect(w.sessions[0]).toMatchObject({ status: "completed", elapsed_seconds: 120, running_since: null });
  });
  it("supports early completion and idempotent completion retries", () => {
    let w = execute(emptyWorkspace(), { type: "focus.create", input: { label: "Session", planned_minutes: 25 } });
    const command: StudyCommand = { type: "focus.action", id: w.sessions[0].id, input: { action: "complete" } };
    w = execute(w, command, later(90));
    expect(w.sessions[0].elapsed_seconds).toBe(90);
    expect(execute(w, command, later(600))).toBe(w);
  });
  it("cannot revive a cancelled session", () => {
    let w = execute(emptyWorkspace(), { type: "focus.create", input: { label: "Session", planned_minutes: 25 } });
    const id = w.sessions[0].id;
    w = execute(w, { type: "focus.action", id, input: { action: "cancel" } }, later(30));
    expect(() => execute(w, { type: "focus.action", id, input: { action: "resume" } })).toThrow("already ended");
  });
  it("rejects focus on a completed task or mismatched goal", () => {
    let w = fixture();
    w = execute(w, { type: "task.create", input: { title: "Task", goal_id: w.goals[0].id } });
    const task_id = w.tasks[0].id;
    w = execute(w, { type: "goal.create", input: { title: "Other", target_minutes: 60 } });
    expect(() => execute(w, { type: "focus.create", input: { label: "Focus", planned_minutes: 25, task_id, goal_id: w.goals[1].id } })).toThrow("different goal");
    w = execute(w, { type: "task.update", id: task_id, input: { status: "done" } });
    expect(() => execute(w, { type: "focus.create", input: { label: "Focus", planned_minutes: 25, task_id } })).toThrow("already complete");
  });
});

describe("study analytics", () => {
  it("uses local dates rather than UTC at midnight boundaries", () => {
    expect(localStudyDate(new Date("2026-11-17T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11-18");
    expect(localStudyDate(new Date("2026-11-17T02:00:00Z"), "America/New_York")).toBe("2026-11-16");
  });
  it("only credits completed focus sessions and connects them to goals", () => {
    let w = fixture();
    w = execute(w, { type: "focus.create", input: { label: "Focus", planned_minutes: 25, goal_id: w.goals[0].id } });
    expect(studySummary(w, later(120)).weekly_focus_minutes).toBe(0);
    w = execute(w, { type: "focus.action", id: w.sessions[0].id, input: { action: "complete" } }, later(120));
    const summary = studySummary(w, later(120));
    expect(summary.weekly_focus_minutes).toBe(2);
    expect(summary.goal_progress[0].minutes).toBe(2);
    expect(summary.streak_days).toBe(1);
    expect(summary.week[0].date).toBe("2026-11-16");
  });
  it("counts overdue tasks and calculates recall only when reviews exist", () => {
    let w = fixture();
    expect(studySummary(w, now).retention_percent).toBeNull();
    w = execute(w, { type: "task.create", input: { title: "Late", scheduled_date: "2026-11-16" } });
    w = execute(w, { type: "card.review", id: w.cards[0].id, input: { review_id: randomUUID(), grade: "again" } });
    expect(studySummary(w, now)).toMatchObject({ overdue_tasks: 1, retention_percent: 0, streak_days: 1 });
  });
});

describe("study persistence and concurrency", () => {
  it("isolates users and handles simultaneous commands without losing data", async () => {
    const repository = new MemoryStudyRepository();
    const service = new StudyService(repository, () => now);
    await Promise.all(Array.from({ length: 5 }, (_, i) => service.execute("alice", {
      type: "task.create", input: { title: `Task ${i}` },
    })));
    expect((await service.snapshot("alice")).workspace.tasks).toHaveLength(5);
    expect((await service.snapshot("bob")).workspace.tasks).toHaveLength(0);
  });
  it("does not pretend a conflicted write succeeded", async () => {
    const repository = new MemoryStudyRepository();
    repository.save = async () => null;
    await expect(new StudyService(repository).execute("alice", { type: "task.create", input: { title: "Task" } }))
      .rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });
  it("survives repository restarts and rejects stale file writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "learnrift-study-"));
    try {
      const first = new FileStudyRepository(directory);
      const w = fixture();
      expect(await first.save("alice", 0, w)).toBe(1);
      const second = new FileStudyRepository(directory);
      expect((await second.load("alice")).workspace).toEqual(w);
      expect(await second.save("alice", 0, emptyWorkspace())).toBeNull();
      expect((await second.load("bob")).version).toBe(0);
      expect((await readdir(directory)).filter((file) => file.endsWith(".tmp") || file.endsWith(".lock"))).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("refuses corrupt saved data instead of replacing it with an empty workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "learnrift-study-"));
    try {
      const repository = new FileStudyRepository(directory);
      await repository.save("alice", 0, fixture());
      const [file] = await readdir(directory);
      await writeFile(join(directory, file), '{"version":1,"workspace":{}}');
      await expect(repository.load("alice")).rejects.toMatchObject({ code: "STORAGE_INVALID" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("propagates configured database errors without using development data", async () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: { message: "offline" } }) };
    const db = { from: () => query, rpc: async () => ({ data: null, error: { message: "offline" } }) } as unknown as SupabaseClient;
    const repository = new SupabaseStudyRepository(db);
    await expect(repository.load("alice")).rejects.toMatchObject({ status: 503 });
    await expect(repository.save("alice", 0, emptyWorkspace())).rejects.toMatchObject({ status: 503 });
  });
});
