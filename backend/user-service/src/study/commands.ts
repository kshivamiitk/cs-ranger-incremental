import type { z } from "zod";
import type { StudyWorkspace, StudyCard } from "../../../shared/types/study.js";
import * as schemas from "./validation.js";
import {
  StudyError, LIMITS, findEntity, makeId, assertCapacity, assertGoal, elapsedSeconds, scheduleReview,
} from "./model.js";

type Input<T extends z.ZodTypeAny> = z.infer<T>;
export type StudyCommand =
  | { type: "goal.create"; input: Input<typeof schemas.goalCreate> }
  | { type: "goal.update"; id: string; input: Input<typeof schemas.goalPatch> }
  | { type: "goal.delete"; id: string }
  | { type: "task.create"; input: Input<typeof schemas.taskCreate> }
  | { type: "task.update"; id: string; input: Input<typeof schemas.taskPatch> }
  | { type: "task.delete"; id: string }
  | { type: "deck.create"; input: Input<typeof schemas.deckCreate> }
  | { type: "deck.update"; id: string; input: Input<typeof schemas.deckPatch> }
  | { type: "deck.delete"; id: string }
  | { type: "card.create"; input: Input<typeof schemas.cardCreate> }
  | { type: "card.update"; id: string; input: Input<typeof schemas.cardPatch> }
  | { type: "card.delete"; id: string }
  | { type: "card.import"; input: Input<typeof schemas.bulkCards> }
  | { type: "card.review"; id: string; input: Input<typeof schemas.reviewInput> }
  | { type: "focus.create"; input: Input<typeof schemas.focusCreate> }
  | { type: "focus.action"; id: string; input: Input<typeof schemas.focusAction> }
  | { type: "preferences.update"; input: Input<typeof schemas.preferencesPatch> };

function newCard(input: Input<typeof schemas.cardCreate>, at: string): StudyCard {
  return {
    id: makeId(),
    deck_id: input.deck_id,
    front: input.front,
    back: input.back,
    tags: [...new Set(input.tags || [])],
    suspended: false,
    repetitions: 0,
    lapses: 0,
    interval_days: 0,
    ease: 2.5,
    due_at: at,
    last_reviewed_at: null,
    created_at: at,
    updated_at: at,
  };
}

/** Apply to a private copy: validation failures never mutate stored state. */
export function applyCommand(original: StudyWorkspace, command: StudyCommand, now: Date): StudyWorkspace {
  const w = structuredClone(original);
  const at = now.toISOString();
  switch (command.type) {
    case "goal.create": {
      assertCapacity(w.goals.length, LIMITS.goals, "goals");
      w.goals.push({
        id: makeId(), title: command.input.title, description: command.input.description || "",
        target_minutes: command.input.target_minutes, due_date: command.input.due_date || null,
        status: "active", created_at: at, updated_at: at,
      });
      break;
    }
    case "goal.update": {
      Object.assign(findEntity(w.goals, command.id), command.input, { updated_at: at });
      break;
    }
    case "goal.delete": {
      findEntity(w.goals, command.id);
      w.goals = w.goals.filter((goal) => goal.id !== command.id);
      for (const task of w.tasks) if (task.goal_id === command.id) task.goal_id = null;
      for (const session of w.sessions) if (session.goal_id === command.id) session.goal_id = null;
      break;
    }
    case "task.create": {
      assertCapacity(w.tasks.length, LIMITS.tasks, "tasks");
      assertGoal(w, command.input.goal_id);
      w.tasks.push({
        id: makeId(), title: command.input.title, notes: command.input.notes || "",
        goal_id: command.input.goal_id || null, scheduled_date: command.input.scheduled_date || null,
        estimated_minutes: command.input.estimated_minutes || 25, priority: command.input.priority || "normal",
        status: "planned", completed_at: null, created_at: at, updated_at: at,
      });
      break;
    }
    case "task.update": {
      if (command.input.goal_id) assertGoal(w, command.input.goal_id);
      const task = findEntity(w.tasks, command.id);
      const status = command.input.status || task.status;
      const completedAt = status === "done" ? task.completed_at || at : null;
      Object.assign(task, command.input, { completed_at: completedAt, updated_at: at });
      break;
    }
    case "task.delete": {
      findEntity(w.tasks, command.id);
      w.tasks = w.tasks.filter((task) => task.id !== command.id);
      for (const session of w.sessions) if (session.task_id === command.id) session.task_id = null;
      break;
    }
    case "deck.create": {
      assertCapacity(w.decks.length, LIMITS.decks, "decks");
      w.decks.push({
        id: makeId(), title: command.input.title, description: command.input.description || "",
        color: command.input.color || "indigo", archived: false, created_at: at, updated_at: at,
      });
      break;
    }
    case "deck.update": {
      Object.assign(findEntity(w.decks, command.id), command.input, { updated_at: at });
      break;
    }
    case "deck.delete": {
      findEntity(w.decks, command.id);
      w.decks = w.decks.filter((deck) => deck.id !== command.id);
      w.cards = w.cards.filter((card) => card.deck_id !== command.id);
      // Keep review events for historical activity statistics.
      break;
    }
    case "card.create": {
      assertCapacity(w.cards.length, LIMITS.cards, "cards");
      if (findEntity(w.decks, command.input.deck_id).archived) {
        throw new StudyError("Restore this deck before adding cards", 409, "DECK_ARCHIVED");
      }
      w.cards.push(newCard(command.input, at));
      break;
    }
    case "card.update": {
      const card = findEntity(w.cards, command.id);
      Object.assign(card, command.input, { updated_at: at });
      if (command.input.tags) card.tags = [...new Set(command.input.tags)];
      break;
    }
    case "card.delete": {
      findEntity(w.cards, command.id);
      w.cards = w.cards.filter((card) => card.id !== command.id);
      break;
    }
    case "card.import": {
      const deck = findEntity(w.decks, command.input.deck_id);
      if (deck.archived) throw new StudyError("Restore this deck first", 409, "DECK_ARCHIVED");
      if (w.cards.length + command.input.cards.length > LIMITS.cards) {
        throw new StudyError("This import would exceed the card limit", 409, "LIMIT_REACHED");
      }
      w.cards.push(...command.input.cards.map((card) => newCard({ ...card, deck_id: deck.id }, at)));
      break;
    }
    case "card.review": {
      const previous = w.reviews.find((review) => review.id === command.input.review_id);
      if (previous) {
        if (previous.card_id !== command.id || previous.grade !== command.input.grade) {
          throw new StudyError("This review ID was already used", 409, "REVIEW_CONFLICT");
        }
        return original;
      }
      const card = findEntity(w.cards, command.id);
      if (card.suspended || findEntity(w.decks, card.deck_id).archived) {
        throw new StudyError("This card is not available for review", 409, "CARD_INACTIVE");
      }
      if (Date.parse(card.due_at) > now.getTime()) {
        throw new StudyError("This card has already been scheduled for later", 409, "CARD_NOT_DUE");
      }
      const next = scheduleReview(card, command.input.grade, now);
      w.cards[w.cards.findIndex((item) => item.id === card.id)] = next;
      w.reviews.push({
        id: command.input.review_id, card_id: card.id, deck_id: card.deck_id,
        grade: command.input.grade, reviewed_at: at, next_due_at: next.due_at, interval_days: next.interval_days,
      });
      w.reviews = w.reviews.slice(-LIMITS.reviews);
      break;
    }
    case "focus.create": {
      if (w.sessions.some((session) => session.status === "running" || session.status === "paused")) {
        throw new StudyError("Finish or cancel your current focus session first", 409, "SESSION_ACTIVE");
      }
      assertGoal(w, command.input.goal_id);
      const task = command.input.task_id ? findEntity(w.tasks, command.input.task_id) : null;
      assertGoal(w, task?.goal_id);
      if (task?.status === "done") throw new StudyError("This task is already complete", 409, "TASK_DONE");
      if (task?.goal_id && command.input.goal_id && task.goal_id !== command.input.goal_id) {
        throw new StudyError("The task belongs to a different goal", 409, "GOAL_MISMATCH");
      }
      w.sessions.push({
        id: makeId(), goal_id: command.input.goal_id || task?.goal_id || null,
        task_id: command.input.task_id || null, label: command.input.label,
        planned_minutes: command.input.planned_minutes, status: "running", elapsed_seconds: 0,
        running_since: at, started_at: at, ended_at: null,
      });
      w.sessions = w.sessions.slice(-LIMITS.sessions);
      break;
    }
    case "focus.action": {
      const session = findEntity(w.sessions, command.id);
      const action = command.input.action;
      if (session.status === "completed" || session.status === "cancelled") {
        if ((action === "complete" && session.status === "completed")
          || (action === "cancel" && session.status === "cancelled")) return original;
        throw new StudyError("This session has already ended", 409, "SESSION_ENDED");
      }
      if (action === "pause" && session.status !== "running") return original;
      if (action === "resume" && session.status !== "paused") return original;
      session.elapsed_seconds = elapsedSeconds(session, now);
      session.running_since = null;
      if (action === "pause") session.status = "paused";
      if (action === "resume") {
        if (session.elapsed_seconds >= session.planned_minutes * 60) {
          throw new StudyError("The timer has finished; complete the session", 409, "TIMER_FINISHED");
        }
        session.status = "running";
        session.running_since = at;
      }
      if (action === "complete" || action === "cancel") {
        session.status = action === "complete" ? "completed" : "cancelled";
        session.ended_at = at;
      }
      break;
    }
    case "preferences.update": {
      Object.assign(w.preferences, command.input);
      break;
    }
  }
  if (Buffer.byteLength(JSON.stringify(w), "utf8") > LIMITS.document_bytes) {
    throw new StudyError("Your workspace is full. Remove unused cards or tasks before saving.", 409, "WORKSPACE_FULL");
  }
  return w;
}
