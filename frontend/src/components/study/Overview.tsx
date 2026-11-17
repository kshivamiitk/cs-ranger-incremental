"use client";

import { Clock3, Flame, Layers3, CheckCircle2, ArrowRight } from "lucide-react";
import type { StudyView } from "@/lib/study/types";
import { minutesLabel } from "@/lib/study/utils";
import { StudyPanel, StudyEmpty, StudyMeter } from "./StudyUi";

export function StudyOverview({ view, navigate }: { view: StudyView; navigate: (tab: string) => void }) {
  const { summary, workspace } = view;
  const cards = [
    { label: "Focus this week", value: minutesLabel(summary.weekly_focus_minutes), icon: Clock3 },
    { label: "Study streak", value: `${summary.streak_days} ${summary.streak_days === 1 ? "day" : "days"}`, icon: Flame },
    { label: "Cards due", value: String(summary.due_cards), icon: Layers3 },
    { label: "Tasks done today", value: String(summary.today.completed_tasks), icon: CheckCircle2 },
  ];
  const peak = Math.max(1, ...summary.week.map((day) => day.focus_minutes));
  const nextTasks = workspace.tasks.filter((task) => task.status !== "done")
    .sort((a, b) => (a.scheduled_date || "9999").localeCompare(b.scheduled_date || "9999"))
    .slice(0, 5);
  const current = workspace.sessions.find((session) => session.status === "running" || session.status === "paused");
  return <div className="space-y-6">
    {current && <button type="button" onClick={() => navigate("focus")}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/10 p-4 text-left">
      <span><strong>{current.status === "paused" ? "Paused" : "Active"} focus session</strong><span className="mt-1 block text-sm">{current.label}</span></span>
      <span className="inline-flex items-center gap-2 text-sm">Open timer <ArrowRight className="h-4 w-4" /></span>
    </button>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ label, value, icon: Icon }) => <div key={label} className="card">
        <Icon className="mb-3 h-5 w-5 text-brand" aria-hidden="true" />
        <p className="text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-sm text-fg-dim">{label}</p>
      </div>)}
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <StudyPanel title="Your week" subtitle={`Times shown in ${workspace.preferences.time_zone}. Only completed focus sessions count.`}>
        <div className="flex h-40 items-end gap-3" role="img" aria-label={summary.week.map((day) => `${day.date}: ${day.focus_minutes} minutes`).join("; ")}>
          {summary.week.map((day) => <div key={day.date} className="flex h-full flex-1 flex-col justify-end gap-2 text-center">
            <span className="text-xs tabular-nums text-fg-dim">{Math.round(day.focus_minutes)}m</span>
            <div className="min-h-1 rounded-t-md bg-brand/70" style={{ height: `${Math.max(2, day.focus_minutes / peak * 100)}%` }} />
            <span className="text-xs text-fg-dim">{new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}</span>
          </div>)}
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm">{minutesLabel(summary.weekly_focus_minutes)} of {minutesLabel(summary.weekly_target_minutes)} weekly target</p>
          <StudyMeter value={summary.weekly_focus_minutes} maximum={summary.weekly_target_minutes} label="Weekly study target" />
        </div>
      </StudyPanel>
      <StudyPanel title="Next on your plan" subtitle={`${summary.overdue_tasks} overdue ${summary.overdue_tasks === 1 ? "task" : "tasks"}`}
        action={<button type="button" className="text-sm text-brand" onClick={() => navigate("planner")}>Open planner</button>}>
        {nextTasks.length === 0 ? <StudyEmpty title="Your plan is clear">Add a small, specific task for your next study session.</StudyEmpty>
          : <ul className="divide-y divide-border">{nextTasks.map((task) => <li key={task.id} className="flex items-center justify-between gap-4 py-3">
            <div><p className="text-sm font-medium">{task.title}</p><p className="mt-1 text-xs text-fg-dim">{task.scheduled_date || "Unscheduled"} · {minutesLabel(task.estimated_minutes)}</p></div>
            <span className="rounded-full bg-surface-2 px-2 py-1 text-xs">{task.priority}</span>
          </li>)}</ul>}
      </StudyPanel>
      <StudyPanel title="Learning goals" action={<button type="button" className="text-sm text-brand" onClick={() => navigate("goals")}>Manage goals</button>}>
        {workspace.goals.filter((goal) => goal.status === "active").length === 0
          ? <StudyEmpty title="Choose something to learn">Set a goal and connect your planner tasks and focus sessions to it.</StudyEmpty>
          : <div className="space-y-5">{workspace.goals.filter((goal) => goal.status === "active").slice(0, 4).map((goal) => {
            const progress = summary.goal_progress.find((row) => row.goal_id === goal.id);
            return <div key={goal.id} className="space-y-2">
              <div className="flex justify-between gap-3 text-sm"><span>{goal.title}</span><span className="shrink-0 text-fg-dim">{minutesLabel(progress?.minutes || 0)} / {minutesLabel(goal.target_minutes)}</span></div>
              <StudyMeter value={progress?.minutes || 0} maximum={goal.target_minutes} label={goal.title} />
            </div>;
          })}</div>}
      </StudyPanel>
      <StudyPanel title="Review a little, remember more" subtitle="Cards you recall comfortably move further into the future.">
        <p className="text-3xl font-semibold">{summary.due_cards} <span className="text-base font-normal text-fg-dim">cards ready</span></p>
        <p className="text-sm text-fg-dim">{summary.retention_percent === null ? "Your recall statistics will appear after your first review."
          : `${summary.retention_percent}% successful recall across reviews in the last 30 days.`}</p>
        <button type="button" className="btn-primary" onClick={() => navigate("flashcards")}>Open flashcards</button>
      </StudyPanel>
    </div>
  </div>;
}
