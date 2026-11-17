import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudyGoals } from "./Goals";
import { StudyPlanner } from "./Planner";
import { StudyFocus } from "./Focus";
import { StudyReview } from "./Review";
import { StudySettings } from "./Settings";
import { studyApi } from "@/lib/study/api";
import type { StudyController } from "@/lib/study/hooks";
import type { StudyView } from "@/lib/study/types";

const instant = "2026-11-17T10:00:00.000Z";
function view(): StudyView {
  return {
    version: 1, storage: "database", server_time: instant,
    workspace: {
      schema_version: 1,
      preferences: { time_zone: "Asia/Kolkata", weekly_target_minutes: 300, focus_minutes: 25, review_session_limit: 30, week_starts_on: "monday" },
      goals: [], tasks: [], cards: [], decks: [], reviews: [], sessions: [],
    },
    summary: {
      today: { date: "2026-11-17", focus_minutes: 0, reviews: 0, completed_tasks: 0 }, week: [],
      weekly_focus_minutes: 0, weekly_target_minutes: 300, due_cards: 0, overdue_tasks: 0,
      active_goals: 0, completed_goals: 0, streak_days: 0, retention_percent: null, goal_progress: [],
    },
  };
}
function controller() {
  return {
    busy: false, mutationError: null,
    execute: vi.fn(async (operation: () => Promise<StudyView>) => { await operation(); return true; }),
  } as unknown as StudyController;
}

beforeEach(() => {
  // Native dialog provides focus trapping in browsers; jsdom needs these two
  // methods to exercise form behavior without implementing a different modal.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => vi.restoreAllMocks());

describe("study goal and planner forms", () => {
  it("creates a goal through its visible form", async () => {
    const snapshot = view();
    const create = vi.spyOn(studyApi, "createGoal").mockResolvedValue(snapshot);
    const user = userEvent.setup();
    render(<StudyGoals view={snapshot} controller={controller()} />);
    await user.click(screen.getByRole("button", { name: "New goal" }));
    await user.type(screen.getByLabelText("What do you want to learn?"), "Learn heaps");
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ title: "Learn heaps", description: "", target_minutes: 300, due_date: null }));
  });
  it("keeps save errors visible inside the open modal", async () => {
    const state = controller();
    state.mutationError = "Your changes were not saved";
    const user = userEvent.setup();
    render(<StudyGoals view={view()} controller={state} />);
    await user.click(screen.getByRole("button", { name: "New goal" }));
    expect(screen.getByRole("dialog")).toContainElement(screen.getByRole("alert"));
    expect(screen.getByRole("alert")).toHaveTextContent("Your changes were not saved");
  });
  it("marks a task complete and opens its focus action", async () => {
    const snapshot = view();
    snapshot.workspace.tasks.push({
      id: "task", title: "Practice trees", notes: "", goal_id: null, scheduled_date: "2026-11-17",
      estimated_minutes: 25, priority: "high", status: "planned", completed_at: null, created_at: instant, updated_at: instant,
    });
    const update = vi.spyOn(studyApi, "updateTask").mockResolvedValue(snapshot);
    const focus = vi.fn();
    const user = userEvent.setup();
    render(<StudyPlanner view={snapshot} controller={controller()} focusTask={focus} />);
    await user.click(screen.getByRole("checkbox", { name: "Mark Practice trees complete" }));
    expect(update).toHaveBeenCalledWith("task", { status: "done" });
    await user.click(screen.getByRole("button", { name: "Focus on Practice trees" }));
    expect(focus).toHaveBeenCalledWith("task");
  });
  it("filters tasks without treating completed work as overdue", async () => {
    const snapshot = view();
    snapshot.workspace.tasks = [
      { id: "late", title: "Late task", notes: "", goal_id: null, scheduled_date: "2026-11-16", estimated_minutes: 25, priority: "normal", status: "planned", completed_at: null, created_at: instant, updated_at: instant },
      { id: "done", title: "Done task", notes: "", goal_id: null, scheduled_date: "2026-11-16", estimated_minutes: 25, priority: "normal", status: "done", completed_at: instant, created_at: instant, updated_at: instant },
    ];
    const user = userEvent.setup();
    render(<StudyPlanner view={snapshot} controller={controller()} focusTask={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Overdue" }));
    expect(screen.getByText("Late task")).toBeVisible();
    expect(screen.queryByText("Done task")).not.toBeInTheDocument();
  });
});

describe("focus timer and review interactions", () => {
  it("restores a running session and sends a server-side pause command", async () => {
    const snapshot = view();
    snapshot.workspace.sessions.push({
      id: "session", label: "Read chapter", planned_minutes: 25, goal_id: null, task_id: null,
      elapsed_seconds: 0, running_since: "2026-11-17T09:59:00.000Z", started_at: "2026-11-17T09:59:00.000Z",
      status: "running", ended_at: null,
    });
    const pause = vi.spyOn(studyApi, "focusAction").mockResolvedValue(snapshot);
    const user = userEvent.setup();
    render(<StudyFocus view={snapshot} controller={controller()} selectedTask={null} />);
    expect(screen.getByRole("timer")).toHaveTextContent("24:00");
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(pause).toHaveBeenCalledWith("session", "pause");
  });
  it("requires answer reveal before a grade can be submitted", async () => {
    const snapshot = view();
    snapshot.workspace.decks.push({ id: "deck", title: "Graphs", description: "", color: "indigo", archived: false, created_at: instant, updated_at: instant });
    snapshot.workspace.cards.push({
      id: "card", deck_id: "deck", front: "BFS?", back: "Breadth-first search", tags: [], suspended: false,
      repetitions: 0, lapses: 0, interval_days: 0, ease: 2.5, due_at: instant, last_reviewed_at: null, created_at: instant, updated_at: instant,
    });
    const review = vi.spyOn(studyApi, "reviewCard").mockResolvedValue(snapshot);
    const user = userEvent.setup();
    render(<StudyReview view={snapshot} controller={controller()} close={vi.fn()} />);
    expect(screen.queryByText("Breadth-first search")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Good/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText("Breadth-first search")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Good Normal interval/ }));
    expect(review).toHaveBeenCalledWith("card", "good", expect.any(String));
    await waitFor(() => expect(screen.getByText("Review session complete")).toBeVisible());
  });
  it("saves timezone and timing preferences through the form", async () => {
    const snapshot = view();
    const save = vi.spyOn(studyApi, "preferences").mockResolvedValue(snapshot);
    const user = userEvent.setup();
    render(<StudySettings view={snapshot} controller={controller()} />);
    const zone = screen.getByLabelText(/Time zone/);
    await user.clear(zone);
    await user.type(zone, "Europe/London");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ time_zone: "Europe/London", weekly_target_minutes: 300, review_session_limit: 30 }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  });
});
