import { z } from "zod";

export const entityId = z.string().uuid();
const title = z.string().trim().min(1).max(160);
const description = z.string().trim().max(4000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Use a valid calendar date");
const optionalId = entityId.nullable().optional();
const optionalDate = date.nullable().optional();
const nonemptyPatch = (value: Record<string, unknown>) => Object.keys(value).length > 0;

export const goalCreate = z.object({
  title,
  description: description.optional(),
  target_minutes: z.number().int().min(1).max(100_000),
  due_date: optionalDate,
}).strict();
export const goalPatch = goalCreate.partial().extend({
  status: z.enum(["active", "completed", "archived"]).optional(),
}).strict().refine(nonemptyPatch, "Provide at least one change");

export const taskCreate = z.object({
  title,
  notes: description.optional(),
  goal_id: optionalId,
  scheduled_date: optionalDate,
  estimated_minutes: z.number().int().min(1).max(1440).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
}).strict();
export const taskPatch = taskCreate.partial().extend({
  status: z.enum(["planned", "in_progress", "done"]).optional(),
}).strict().refine(nonemptyPatch, "Provide at least one change");

export const deckCreate = z.object({
  title,
  description: description.optional(),
  color: z.enum(["indigo", "emerald", "amber", "rose", "sky"]).optional(),
}).strict();
export const deckPatch = deckCreate.partial().extend({
  archived: z.boolean().optional(),
}).strict().refine(nonemptyPatch, "Provide at least one change");

export const cardCreate = z.object({
  deck_id: entityId,
  front: z.string().trim().min(1).max(4000),
  back: z.string().trim().min(1).max(8000),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
}).strict();
export const cardPatch = cardCreate.omit({ deck_id: true }).partial().extend({
  suspended: z.boolean().optional(),
}).strict().refine(nonemptyPatch, "Provide at least one change");
export const reviewInput = z.object({
  // A client-generated operation ID makes network retries idempotent.
  review_id: entityId,
  grade: z.enum(["again", "hard", "good", "easy"]),
}).strict();
export const bulkCards = z.object({
  deck_id: entityId,
  cards: z.array(cardCreate.omit({ deck_id: true })).min(1).max(100),
}).strict();

export const focusCreate = z.object({
  label: title,
  planned_minutes: z.number().int().min(1).max(180),
  goal_id: optionalId,
  task_id: optionalId,
}).strict();
export const focusAction = z.object({
  action: z.enum(["pause", "resume", "complete", "cancel"]),
}).strict();

export const preferencesPatch = z.object({
  time_zone: z.string().max(100).refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
    catch { return false; }
  }, "Choose a valid time zone"),
  weekly_target_minutes: z.number().int().min(15).max(10_080),
  focus_minutes: z.number().int().min(1).max(180),
  review_session_limit: z.number().int().min(1).max(200),
  week_starts_on: z.enum(["monday", "sunday"]),
}).partial().strict().refine(nonemptyPatch, "Provide at least one change");
