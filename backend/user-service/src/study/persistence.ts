import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyWorkspace } from "../../../shared/types/study.js";
import { emptyWorkspace, StudyError } from "./model.js";
import { goalCreate, taskCreate, deckCreate, cardCreate } from "./validation.js";

const timestamp = z.string().datetime();
const id = z.string().uuid();
const storedWorkspace = z.object({
  schema_version: z.literal(1),
  preferences: z.object({
    time_zone: z.string().refine((zone) => {
      try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
    }),
    weekly_target_minutes: z.number().int().positive(),
    focus_minutes: z.number().int().positive(),
    review_session_limit: z.number().int().positive(),
    week_starts_on: z.enum(["monday", "sunday"]),
  }),
  goals: z.array(goalCreate.extend({
    id, description: z.string(), due_date: z.string().nullable(),
    status: z.enum(["active", "completed", "archived"]), created_at: timestamp, updated_at: timestamp,
  })),
  tasks: z.array(taskCreate.extend({
    id, notes: z.string(), goal_id: id.nullable(), scheduled_date: z.string().nullable(),
    estimated_minutes: z.number().int().positive(), priority: z.enum(["low", "normal", "high"]),
    status: z.enum(["planned", "in_progress", "done"]), completed_at: timestamp.nullable(),
    created_at: timestamp, updated_at: timestamp,
  })),
  decks: z.array(deckCreate.extend({
    id, description: z.string(), color: z.enum(["indigo", "emerald", "amber", "rose", "sky"]),
    archived: z.boolean(), created_at: timestamp, updated_at: timestamp,
  })),
  cards: z.array(cardCreate.extend({
    id, tags: z.array(z.string()), suspended: z.boolean(), repetitions: z.number().int().nonnegative(),
    lapses: z.number().int().nonnegative(), interval_days: z.number().int().nonnegative(),
    ease: z.number().min(1.3).max(3.5), due_at: timestamp, last_reviewed_at: timestamp.nullable(),
    created_at: timestamp, updated_at: timestamp,
  })),
  reviews: z.array(z.object({
    id, card_id: id, deck_id: id, grade: z.enum(["again", "hard", "good", "easy"]),
    reviewed_at: timestamp, next_due_at: timestamp, interval_days: z.number().int().nonnegative(),
  })),
  sessions: z.array(z.object({
    id, goal_id: id.nullable(), task_id: id.nullable(), label: z.string(),
    planned_minutes: z.number().int().positive(), status: z.enum(["running", "paused", "completed", "cancelled"]),
    elapsed_seconds: z.number().int().nonnegative(), running_since: timestamp.nullable(),
    started_at: timestamp, ended_at: timestamp.nullable(),
  })),
});

export interface StoredStudy {
  version: number;
  workspace: StudyWorkspace;
}
export interface StudyRepository {
  readonly mode: "database" | "local";
  load(userId: string): Promise<StoredStudy>;
  save(userId: string, expectedVersion: number, workspace: StudyWorkspace): Promise<number | null>;
}

function decode(value: unknown): StoredStudy {
  const parsed = z.object({ version: z.number().int().positive(), workspace: storedWorkspace }).safeParse(value);
  if (!parsed.success) throw new StudyError("Stored study data could not be read", 500, "STORAGE_INVALID");
  return parsed.data;
}

export class SupabaseStudyRepository implements StudyRepository {
  readonly mode = "database" as const;
  constructor(private readonly db: SupabaseClient) {}
  async load(userId: string): Promise<StoredStudy> {
    const { data, error } = await this.db.from("study_workspaces")
      .select("version, data").eq("user_id", userId).maybeSingle();
    if (error) throw new StudyError("Study storage is unavailable. Please retry later.", 503, "STORAGE_UNAVAILABLE");
    return data ? decode({ version: data.version, workspace: data.data }) : { version: 0, workspace: emptyWorkspace() };
  }
  async save(userId: string, expectedVersion: number, workspace: StudyWorkspace) {
    const { data, error } = await this.db.rpc("save_study_workspace", {
      p_user_id: userId, p_expected_version: expectedVersion, p_data: workspace,
    });
    if (error) throw new StudyError("Your changes were not saved. Please retry.", 503, "STORAGE_UNAVAILABLE");
    return typeof data === "number" ? data : null;
  }
}

/** Persistent single-host development store. Production uses PostgreSQL. */
export class FileStudyRepository implements StudyRepository {
  readonly mode = "local" as const;
  constructor(private readonly directory: string) {}
  private file(userId: string) {
    const key = createHash("sha256").update(userId).digest("hex");
    return join(resolve(this.directory), `${key}.json`);
  }
  async load(userId: string): Promise<StoredStudy> {
    try {
      return decode(JSON.parse(await readFile(this.file(userId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 0, workspace: emptyWorkspace() };
      if (error instanceof StudyError) throw error;
      throw new StudyError("Local study data could not be read", 503, "STORAGE_UNAVAILABLE");
    }
  }
  async save(userId: string, expectedVersion: number, workspace: StudyWorkspace) {
    await mkdir(resolve(this.directory), { recursive: true, mode: 0o700 });
    const file = this.file(userId);
    let lock;
    try {
      lock = await open(`${file}.lock`, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw new StudyError("Local study data could not be saved", 503, "STORAGE_UNAVAILABLE");
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const current = await this.load(userId);
      if (current.version !== expectedVersion) return null;
      const version = expectedVersion + 1;
      await writeFile(temporary, JSON.stringify({ version, workspace }), { mode: 0o600 });
      await rename(temporary, file);
      return version;
    } finally {
      await lock.close();
      await unlink(`${file}.lock`);
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

/** Test-only adapter; callers get copies, just as they do from the database. */
export class MemoryStudyRepository implements StudyRepository {
  readonly mode = "local" as const;
  private readonly values = new Map<string, StoredStudy>();
  async load(userId: string) {
    return structuredClone(this.values.get(userId) || { version: 0, workspace: emptyWorkspace() });
  }
  async save(userId: string, expectedVersion: number, workspace: StudyWorkspace) {
    const current = this.values.get(userId);
    if ((current?.version || 0) !== expectedVersion) return null;
    const version = expectedVersion + 1;
    this.values.set(userId, structuredClone({ version, workspace }));
    return version;
  }
}
