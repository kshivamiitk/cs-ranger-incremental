"use client";

import { useState, useMemo, type FormEvent } from "react";
import { Plus, Play, Pencil, Trash2, Search } from "lucide-react";
import { studyApi } from "@/lib/study/api";
import type { StudyController } from "@/lib/study/hooks";
import type { StudyView, StudyTask } from "@/lib/study/types";
import { minutesLabel, studyDate } from "@/lib/study/utils";
import { StudyPanel, StudyEmpty, StudyDialog, StudyConfirm, StudyField, StudySubmit } from "./StudyUi";

type TaskFilter = "today" | "week" | "overdue" | "all" | "done";
export function StudyPlanner({ view, controller, focusTask }: {
  view: StudyView; controller: StudyController; focusTask: (id: string) => void;
}) {
  const [filter, setFilter] = useState<TaskFilter>("today");
  const [search, setSearch] = useState("");
  const [goalFilter, setGoalFilter] = useState("");
  const [editor, setEditor] = useState<StudyTask | "new" | null>(null);
  const [deleting, setDeleting] = useState<StudyTask | null>(null);
  const today = studyDate(view.workspace.preferences.time_zone, new Date(view.server_time));
  const last = new Date(`${today}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 6);
  const lastDate = last.toISOString().slice(0, 10);
  const items = useMemo(() => view.workspace.tasks.filter((task) => {
    if (goalFilter && task.goal_id !== goalFilter) return false;
    if (search && !`${task.title} ${task.notes}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "done") return task.status === "done";
    if (task.status === "done") return false;
    if (filter === "today") return task.scheduled_date === today;
    if (filter === "week") return !!task.scheduled_date && task.scheduled_date >= today && task.scheduled_date <= lastDate;
    if (filter === "overdue") return !!task.scheduled_date && task.scheduled_date < today;
    return true;
  }).sort((a, b) => (a.scheduled_date || "9999").localeCompare(b.scheduled_date || "9999")
    || ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority])
    || a.created_at.localeCompare(b.created_at)), [view.workspace.tasks, goalFilter, search, filter, today, lastDate]);
  return <StudyPanel title="Study planner" subtitle="Turn a learning goal into manageable sessions. Dates follow your study time zone."
    action={<button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setEditor("new")}><Plus className="h-4 w-4" />Add task</button>}>
    <div className="flex flex-wrap gap-2" aria-label="Filter tasks">
      {([["today", "Today"], ["week", "Next 7 days"], ["overdue", "Overdue"], ["all", "All open"], ["done", "Completed"]] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
          className={`rounded-full border px-3 py-2 text-sm ${filter === value ? "border-brand bg-brand/10 text-brand" : "border-border text-fg-dim"}`}>{label}</button>)}
    </div>
    <div className="flex flex-wrap gap-3">
      <label className="relative min-w-48 flex-1"><span className="sr-only">Search tasks</span><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-fg-dim" />
        <input className="input w-full pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" /></label>
      <label><span className="sr-only">Filter by goal</span><select className="input" value={goalFilter} onChange={(event) => setGoalFilter(event.target.value)}>
        <option value="">All goals</option>{view.workspace.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
      </select></label>
    </div>
    <p className="text-xs text-fg-dim">{items.length} {items.length === 1 ? "task" : "tasks"} · {minutesLabel(items.reduce((sum, task) => sum + task.estimated_minutes, 0))} planned</p>
    {items.length === 0 ? <StudyEmpty title="No tasks in this view">Add a task or change the filters. Unscheduled tasks appear under All open.</StudyEmpty>
      : <ul className="divide-y divide-border">{items.map((task) => {
        const overdue = task.status !== "done" && !!task.scheduled_date && task.scheduled_date < today;
        const goal = view.workspace.goals.find((item) => item.id === task.goal_id);
        return <li key={task.id} className="flex items-start gap-3 py-4">
          <input className="mt-1 h-5 w-5 shrink-0 accent-indigo-500" type="checkbox" checked={task.status === "done"} disabled={controller.busy}
            aria-label={`Mark ${task.title} ${task.status === "done" ? "incomplete" : "complete"}`}
            onChange={() => controller.execute(() => studyApi.updateTask(task.id, { status: task.status === "done" ? "planned" : "done" }))} />
          <div className="min-w-0 flex-1"><p className={`break-words font-medium ${task.status === "done" ? "text-fg-dim line-through" : ""}`}>{task.title}</p>
            {task.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-fg-dim">{task.notes}</p>}
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-dim">
              <span className={overdue ? "text-amber-500" : ""}>{overdue ? "Overdue: " : ""}{task.scheduled_date || "Unscheduled"}</span>
              <span>· {minutesLabel(task.estimated_minutes)}</span><span>· {task.priority} priority</span>
              {goal && <span className="rounded bg-surface-2 px-2">{goal.title}</span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {task.status !== "done" && <button type="button" className="rounded-lg p-2 text-brand hover:bg-surface-2" aria-label={`Focus on ${task.title}`} onClick={() => focusTask(task.id)}><Play className="h-4 w-4" /></button>}
            <button type="button" className="rounded-lg p-2 hover:bg-surface-2" aria-label={`Edit ${task.title}`} onClick={() => setEditor(task)}><Pencil className="h-4 w-4" /></button>
            <button type="button" className="rounded-lg p-2 text-fg-dim hover:bg-surface-2" aria-label={`Delete ${task.title}`} onClick={() => setDeleting(task)}><Trash2 className="h-4 w-4" /></button>
          </div>
        </li>;
      })}</ul>}
    {editor && <StudyDialog open error={controller.mutationError} title={editor === "new" ? "Plan a study task" : "Edit task"} close={() => { if (!controller.busy) setEditor(null); }}>
      <TaskForm key={editor === "new" ? "new" : editor.id} task={editor === "new" ? undefined : editor} view={view} controller={controller} close={() => setEditor(null)} />
    </StudyDialog>}
    {deleting && <StudyConfirm error={controller.mutationError} title="Delete this task?" message="Completed focus sessions will remain in your activity history."
      busy={controller.busy} onCancel={() => setDeleting(null)} onConfirm={async () => {
        if (await controller.execute(() => studyApi.deleteTask(deleting.id))) setDeleting(null);
      }} />}
  </StudyPanel>;
}

function TaskForm({ task, view, controller, close }: { task?: StudyTask; view: StudyView; controller: StudyController; close: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      title: String(form.get("title")), notes: String(form.get("notes") || ""),
      scheduled_date: String(form.get("scheduled_date") || "") || null,
      goal_id: String(form.get("goal_id") || "") || null,
      estimated_minutes: Number(form.get("estimated_minutes")), priority: String(form.get("priority")) as StudyTask["priority"],
    };
    // Existing tasks may remain attached to archived goals, but changing their
    // other fields must not attempt to reattach the inactive goal.
    const update = task && task.goal_id === input.goal_id ? (({ goal_id: _goal, ...rest }) => rest)(input) : input;
    if (await controller.execute(() => task ? studyApi.updateTask(task.id, update) : studyApi.createTask(input))) close();
  }
  return <form className="space-y-4" onSubmit={submit}>
    <StudyField label="Task"><input autoFocus className="input w-full" name="title" required maxLength={160} defaultValue={task?.title} placeholder="Practice breadth-first search" /></StudyField>
    <StudyField label="Notes"><textarea className="input min-h-20 w-full" name="notes" maxLength={4000} defaultValue={task?.notes} /></StudyField>
    <StudyField label="Learning goal"><select name="goal_id" className="input w-full" defaultValue={task?.goal_id || ""}>
      <option value="">No goal</option>{view.workspace.goals.filter((goal) => goal.status === "active" || goal.id === task?.goal_id)
        .map((goal) => <option key={goal.id} value={goal.id}>{goal.title}{goal.status !== "active" ? ` (${goal.status})` : ""}</option>)}
    </select></StudyField>
    <div className="grid gap-4 sm:grid-cols-3">
      <StudyField label="Date"><input className="input w-full" name="scheduled_date" type="date" defaultValue={task?.scheduled_date || studyDate(view.workspace.preferences.time_zone, new Date(view.server_time))} /></StudyField>
      <StudyField label="Minutes"><input className="input w-full" name="estimated_minutes" required type="number" min={1} max={1440} defaultValue={task?.estimated_minutes || 25} /></StudyField>
      <StudyField label="Priority"><select className="input w-full" name="priority" defaultValue={task?.priority || "normal"}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></StudyField>
    </div>
    <StudySubmit busy={controller.busy}>{task ? "Save changes" : "Add task"}</StudySubmit>
  </form>;
}
