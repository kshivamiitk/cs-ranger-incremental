import { randomUUID } from "node:crypto";
import type {
  StudyWorkspace, StudyCard, StudyFocusSession, ReviewGrade,
} from "../../../shared/types/study.js";

export class StudyError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "VALIDATION") {
    super(message);
  }
}

export const LIMITS = {
  goals: 100,
  tasks: 2000,
  decks: 100,
  cards: 5000,
  reviews: 2000,
  sessions: 1000,
  document_bytes: 2_000_000,
} as const;

export function emptyWorkspace(): StudyWorkspace {
  return {
    schema_version: 1,
    preferences: {
      time_zone: "Asia/Kolkata",
      weekly_target_minutes: 300,
      focus_minutes: 25,
      review_session_limit: 30,
      week_starts_on: "monday",
    },
    goals: [],
    tasks: [],
    decks: [],
    cards: [],
    reviews: [],
    sessions: [],
  };
}

export function findEntity<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new StudyError("This item no longer exists", 404, "NOT_FOUND");
  return item;
}

export function assertCapacity(count: number, limit: number, label: string) {
  if (count >= limit) {
    throw new StudyError(`The workspace limit of ${limit} ${label} has been reached`, 409, "LIMIT_REACHED");
  }
}

export function assertGoal(workspace: StudyWorkspace, goalId?: string | null) {
  if (!goalId) return;
  const goal = findEntity(workspace.goals, goalId);
  if (goal.status !== "active") {
    throw new StudyError("Choose an active learning goal", 409, "GOAL_INACTIVE");
  }
}

export function makeId() { return randomUUID(); }

/** Seconds are measured on the server, capped at the intended session length. */
export function elapsedSeconds(session: StudyFocusSession, now: Date): number {
  const additional = session.status === "running" && session.running_since
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(session.running_since)) / 1000))
    : 0;
  return Math.min(session.planned_minutes * 60, session.elapsed_seconds + additional);
}

/** A deterministic SM-2-inspired schedule. All dates use instants, not local days. */
export function scheduleReview(card: StudyCard, grade: ReviewGrade, now: Date): StudyCard {
  let ease = card.ease;
  let interval = card.interval_days;
  let repetitions = card.repetitions;
  let lapses = card.lapses;
  if (grade === "again") {
    ease = Math.max(1.3, ease - 0.2);
    interval = 0;
    repetitions = 0;
    lapses++;
  } else if (grade === "hard") {
    ease = Math.max(1.3, ease - 0.15);
    interval = Math.max(1, Math.ceil(interval * 1.2));
    repetitions++;
  } else if (grade === "good") {
    interval = repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.round(Math.max(1, interval) * ease);
    repetitions++;
  } else {
    interval = repetitions === 0 ? 4 : Math.ceil(Math.max(1, interval) * ease * 1.3);
    ease += 0.15;
    repetitions++;
  }
  interval = Math.min(36500, interval);
  ease = Math.min(3.5, Math.round(ease * 100) / 100);
  const delay = grade === "again" ? 10 * 60_000 : interval * 86_400_000;
  return {
    ...card,
    repetitions,
    lapses,
    ease,
    interval_days: interval,
    due_at: new Date(now.getTime() + delay).toISOString(),
    last_reviewed_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

export function dueCards(workspace: StudyWorkspace, now: Date, deckId?: string) {
  const active = new Set(workspace.decks.filter((deck) => !deck.archived).map((deck) => deck.id));
  return workspace.cards
    .filter((card) => !card.suspended && active.has(card.deck_id)
      && (!deckId || card.deck_id === deckId) && Date.parse(card.due_at) <= now.getTime())
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at) || a.id.localeCompare(b.id));
}
