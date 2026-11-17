"use client";

import { useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, CheckCircle2, ArchiveRestore } from "lucide-react";
import { studyApi } from "@/lib/study/api";
import type { StudyController } from "@/lib/study/hooks";
import type { StudyView, StudyGoal } from "@/lib/study/types";
import { minutesLabel } from "@/lib/study/utils";
import { StudyPanel, StudyEmpty, StudyDialog, StudyConfirm, StudyField, StudySubmit, StudyMeter } from "./StudyUi";

export function StudyGoals({ view, controller }: { view: StudyView; controller: StudyController }) {
  const [filter, setFilter] = useState<"active" | "completed" | "archived">("active");
  const [editor, setEditor] = useState<StudyGoal | "new" | null>(null);
  const [deleting, setDeleting] = useState<StudyGoal | null>(null);
  const items = view.workspace.goals.filter((goal) => goal.status === filter);
  return <StudyPanel title="Learning goals" subtitle="Connect the time you spend studying to an outcome that matters."
    action={<button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setEditor("new")}><Plus className="h-4 w-4" />New goal</button>}>
    <div className="flex flex-wrap gap-2" aria-label="Goal status">
      {(["active", "completed", "archived"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value}
        className={`rounded-full border px-4 py-2 text-sm capitalize ${filter === value ? "border-brand bg-brand/10 text-brand" : "border-border text-fg-dim"}`}
        onClick={() => setFilter(value)}>{value} ({view.workspace.goals.filter((goal) => goal.status === value).length})</button>)}
    </div>
    {items.length === 0 ? <StudyEmpty title={`No ${filter} goals`}>Create a learning goal, then attach tasks and focus sessions to track real progress.</StudyEmpty>
      : <div className="grid gap-4 md:grid-cols-2">{items.map((goal) => {
        const progress = view.summary.goal_progress.find((row) => row.goal_id === goal.id);
        return <article key={goal.id} className="space-y-4 rounded-xl border border-border p-5">
          <div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{goal.title}</h3>
            <div className="flex shrink-0 gap-1">
              <button type="button" className="rounded p-2 hover:bg-surface-2" aria-label={`Edit ${goal.title}`} onClick={() => setEditor(goal)}><Pencil className="h-4 w-4" /></button>
              <button type="button" className="rounded p-2 text-fg-dim hover:bg-surface-2" aria-label={`Delete ${goal.title}`} onClick={() => setDeleting(goal)}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
          {goal.description && <p className="whitespace-pre-wrap text-sm text-fg-dim">{goal.description}</p>}
          <div className="space-y-2"><p className="text-sm">{minutesLabel(progress?.minutes || 0)} of {minutesLabel(goal.target_minutes)}</p>
            <StudyMeter value={progress?.minutes || 0} maximum={goal.target_minutes} label={goal.title} />
            <p className="text-xs text-fg-dim">{progress?.tasks_done || 0} of {progress?.tasks_total || 0} tasks completed{goal.due_date ? ` · Target date ${goal.due_date}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {goal.status === "active" ? <>
              <button type="button" className="btn-ghost inline-flex items-center gap-2 text-sm" disabled={controller.busy}
                onClick={() => controller.execute(() => studyApi.updateGoal(goal.id, { status: "completed" }))}><CheckCircle2 className="h-4 w-4" />Mark complete</button>
              <button type="button" className="px-3 text-sm text-fg-dim" disabled={controller.busy}
                onClick={() => controller.execute(() => studyApi.updateGoal(goal.id, { status: "archived" }))}>Archive</button>
            </> : <button type="button" className="btn-ghost inline-flex items-center gap-2 text-sm" disabled={controller.busy}
              onClick={() => controller.execute(() => studyApi.updateGoal(goal.id, { status: "active" }))}><ArchiveRestore className="h-4 w-4" />Restore goal</button>}
          </div>
        </article>;
      })}</div>}
    {editor && <StudyDialog open error={controller.mutationError} title={editor === "new" ? "Create a learning goal" : "Edit learning goal"}
      close={() => { if (!controller.busy) setEditor(null); }}>
      <GoalForm key={editor === "new" ? "new" : editor.id} goal={editor === "new" ? undefined : editor} controller={controller} close={() => setEditor(null)} />
    </StudyDialog>}
    {deleting && <StudyConfirm error={controller.mutationError} title="Delete this goal?" message="Your tasks and completed focus sessions will be kept, with their connection to this goal removed."
      busy={controller.busy} onCancel={() => setDeleting(null)} onConfirm={async () => {
        if (await controller.execute(() => studyApi.deleteGoal(deleting.id))) setDeleting(null);
      }} />}
  </StudyPanel>;
}

function GoalForm({ goal, controller, close }: { goal?: StudyGoal; controller: StudyController; close: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      title: String(form.get("title")).trim(), description: String(form.get("description") || ""),
      target_minutes: Number(form.get("target_minutes")), due_date: String(form.get("due_date") || "") || null,
    };
    if (await controller.execute(() => goal ? studyApi.updateGoal(goal.id, input) : studyApi.createGoal(input))) close();
  }
  return <form onSubmit={submit} className="space-y-4">
    <StudyField label="What do you want to learn?"><input autoFocus className="input w-full" name="title" required maxLength={160} defaultValue={goal?.title} placeholder="Understand graph algorithms" /></StudyField>
    <StudyField label="Description"><textarea className="input min-h-24 w-full" name="description" maxLength={4000} defaultValue={goal?.description} placeholder="What would success look like?" /></StudyField>
    <div className="grid gap-4 sm:grid-cols-2">
      <StudyField label="Study time target (minutes)"><input className="input w-full" name="target_minutes" type="number" required min={1} max={100000} defaultValue={goal?.target_minutes || 300} /></StudyField>
      <StudyField label="Target date (optional)"><input className="input w-full" name="due_date" type="date" defaultValue={goal?.due_date || ""} /></StudyField>
    </div>
    <StudySubmit busy={controller.busy}>{goal ? "Save changes" : "Create goal"}</StudySubmit>
  </form>;
}
