import { Router, type Express, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth, ok, fail } from "@cs-ranger/shared";
import { isSupabaseConfigured, supabaseAdmin } from "@cs-ranger/shared/supabase";
import { FileStudyRepository, SupabaseStudyRepository } from "./persistence.js";
import { StudyService } from "./service.js";
import { StudyError } from "./model.js";
import { studySummary } from "./analytics.js";
import type { StudyCommand } from "./commands.js";
import * as schema from "./validation.js";

let defaultService: StudyService | undefined;
function service() {
  if (!defaultService) {
    if (!isSupabaseConfigured() && process.env.NODE_ENV === "production") {
      throw new StudyError("Study storage is not configured", 503, "STORAGE_UNAVAILABLE");
    }
    const repository = isSupabaseConfigured()
      ? new SupabaseStudyRepository(supabaseAdmin())
      : new FileStudyRepository(process.env.STUDY_DATA_DIR || ".local/study");
    defaultService = new StudyService(repository);
  }
  return defaultService;
}

export function registerStudyRoutes(app: Express, getService: () => StudyService = service) {
  const router = Router();
  router.use(requireAuth);
  const run = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof z.ZodError) return fail(res, 400, error.issues[0]?.message || "Invalid request", "VALIDATION");
      if (error instanceof StudyError) return fail(res, error.status, error.message, error.code);
      // Do not expose file paths, credentials or raw database errors to clients.
      return fail(res, 503, "Study storage is unavailable. Your changes were not saved.", "STORAGE_UNAVAILABLE");
    }
  };
  router.get("/", run(async (req, res) => {
    const snapshot = await getService().snapshot(req.user!.id);
    ok(res, { ...snapshot, summary: studySummary(snapshot.workspace, new Date(snapshot.server_time)) });
  }));
  const mutate = (build: (req: Parameters<RequestHandler>[0]) => StudyCommand) => run(async (req, res) => {
    const command = build(req);
    const snapshot = await getService().execute(req.user!.id, command);
    ok(res, { ...snapshot, summary: studySummary(snapshot.workspace, new Date(snapshot.server_time)) });
  });
  const id = (value: unknown) => schema.entityId.parse(value);
  router.post("/goals", mutate((req) => ({ type: "goal.create", input: schema.goalCreate.parse(req.body) })));
  router.patch("/goals/:id", mutate((req) => ({ type: "goal.update", id: id(req.params.id), input: schema.goalPatch.parse(req.body) })));
  router.delete("/goals/:id", mutate((req) => ({ type: "goal.delete", id: id(req.params.id) })));
  router.post("/tasks", mutate((req) => ({ type: "task.create", input: schema.taskCreate.parse(req.body) })));
  router.patch("/tasks/:id", mutate((req) => ({ type: "task.update", id: id(req.params.id), input: schema.taskPatch.parse(req.body) })));
  router.delete("/tasks/:id", mutate((req) => ({ type: "task.delete", id: id(req.params.id) })));
  router.post("/decks", mutate((req) => ({ type: "deck.create", input: schema.deckCreate.parse(req.body) })));
  router.patch("/decks/:id", mutate((req) => ({ type: "deck.update", id: id(req.params.id), input: schema.deckPatch.parse(req.body) })));
  router.delete("/decks/:id", mutate((req) => ({ type: "deck.delete", id: id(req.params.id) })));
  router.post("/cards", mutate((req) => ({ type: "card.create", input: schema.cardCreate.parse(req.body) })));
  router.post("/cards/import", mutate((req) => ({ type: "card.import", input: schema.bulkCards.parse(req.body) })));
  router.patch("/cards/:id", mutate((req) => ({ type: "card.update", id: id(req.params.id), input: schema.cardPatch.parse(req.body) })));
  router.delete("/cards/:id", mutate((req) => ({ type: "card.delete", id: id(req.params.id) })));
  router.post("/cards/:id/review", mutate((req) => ({ type: "card.review", id: id(req.params.id), input: schema.reviewInput.parse(req.body) })));
  router.post("/focus", mutate((req) => ({ type: "focus.create", input: schema.focusCreate.parse(req.body) })));
  router.post("/focus/:id", mutate((req) => ({ type: "focus.action", id: id(req.params.id), input: schema.focusAction.parse(req.body) })));
  router.patch("/preferences", mutate((req) => ({ type: "preferences.update", input: schema.preferencesPatch.parse(req.body) })));
  app.use("/me/study", router);
}
