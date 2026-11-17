"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Play, Pause, Square, XCircle, Timer } from "lucide-react";
import { studyApi } from "@/lib/study/api";
import type { StudyController } from "@/lib/study/hooks";
import type { StudyView } from "@/lib/study/types";
import { clockLabel, minutesLabel, sessionElapsed } from "@/lib/study/utils";
import { StudyPanel, StudyEmpty, StudyField, StudySubmit } from "./StudyUi";

export function StudyFocus({ view, controller, selectedTask }: {
  view: StudyView; controller: StudyController; selectedTask: string | null;
}) {
  const [tick, setTick] = useState(Date.now());
  // Recalibrate when a server snapshot arrives; device clocks may be wrong.
  const [offset, setOffset] = useState(() => Date.parse(view.server_time) - Date.now());
  useEffect(() => {
    const client = Date.now();
    setTick(client);
    setOffset(Date.parse(view.server_time) - client);
  }, [view.server_time]);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const active = view.workspace.sessions.find((session) => session.status === "running" || session.status === "paused");
  const history = [...view.workspace.sessions].filter((session) => session.status === "completed" || session.status === "cancelled").reverse().slice(0, 20);
  const elapsed = active ? sessionElapsed(active, tick + offset) : 0;
  const remaining = active ? Math.max(0, active.planned_minutes * 60 - elapsed) : 0;
  const task = active?.task_id ? view.workspace.tasks.find((entry) => entry.id === active.task_id) : null;
  return <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
    <StudyPanel title="Focus session" subtitle="One task. A little uninterrupted time. A clear place to stop.">
      {active ? <div className="space-y-7 py-5 text-center">
        <p className="text-lg font-medium">{active.label}</p>
        <div role="timer" aria-label="Focus time remaining" className="font-mono text-7xl font-semibold tracking-tight tabular-nums sm:text-8xl">{clockLabel(remaining)}</div>
        <p className="text-sm text-fg-dim">{remaining === 0 ? "Timer finished. Complete the session to save your study time."
          : active.status === "paused" ? "Paused. Your study time is not increasing." : "Your session continues if you close this tab."}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {remaining > 0 && <button type="button" className="btn-ghost inline-flex items-center gap-2" disabled={controller.busy}
            onClick={() => controller.execute(() => studyApi.focusAction(active.id, active.status === "running" ? "pause" : "resume"))}>
            {active.status === "running" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{active.status === "running" ? "Pause" : "Resume"}
          </button>}
          <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={controller.busy}
            onClick={() => controller.execute(() => studyApi.focusAction(active.id, "complete"))}><Square className="h-4 w-4" />Complete session</button>
          <button type="button" className="inline-flex items-center gap-2 rounded-lg px-3 text-sm text-fg-dim" disabled={controller.busy}
            onClick={() => controller.execute(() => studyApi.focusAction(active.id, "cancel"))}><XCircle className="h-4 w-4" />Cancel</button>
        </div>
        <p className="text-xs text-fg-dim">Completing early saves only the time actually spent. Cancelling does not count toward your goals.</p>
        {task && <div className="rounded-xl bg-surface-2 p-4 text-left"><p className="text-xs text-fg-dim">Linked task</p><p className="mt-1 text-sm">{task.title}</p>
          {task.status !== "done" && <p className="mt-2 text-xs text-fg-dim">Complete the task separately in your planner when the work is done.</p>}
        </div>}
      </div> : <StartFocus key={selectedTask || "custom"} view={view} controller={controller} selectedTask={selectedTask} />}
    </StudyPanel>
    <StudyPanel title="Recent sessions" subtitle="Your last 20 completed or cancelled sessions.">
      {history.length === 0 ? <StudyEmpty title="Make time for your next step">Completed sessions contribute to your weekly target and linked learning goal.</StudyEmpty>
        : <ul className="divide-y divide-border">{history.map((session) => <li key={session.id} className="flex items-start gap-3 py-3">
          <Timer className="mt-1 h-4 w-4 shrink-0 text-fg-dim" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{session.label}</p>
            <p className="mt-1 text-xs text-fg-dim">{new Date(session.ended_at || session.started_at).toLocaleString(undefined, { timeZone: view.workspace.preferences.time_zone, dateStyle: "medium", timeStyle: "short" })}</p>
          </div>
          <div className="shrink-0 text-right"><p className="text-sm tabular-nums">{minutesLabel(session.elapsed_seconds / 60)}</p>
            <p className="mt-1 text-xs text-fg-dim">{session.status}</p></div>
        </li>)}</ul>}
    </StudyPanel>
  </div>;
}

function StartFocus({ view, controller, selectedTask }: {
  view: StudyView; controller: StudyController; selectedTask: string | null;
}) {
  const tasks = view.workspace.tasks.filter((task) => task.status !== "done");
  const [taskId, setTaskId] = useState(tasks.some((task) => task.id === selectedTask) ? selectedTask || "" : "");
  const linked = tasks.find((task) => task.id === taskId);
  const [label, setLabel] = useState(linked?.title || "");
  const [goalId, setGoalId] = useState("");
  const [minutes, setMinutes] = useState(Math.min(180, linked?.estimated_minutes || view.workspace.preferences.focus_minutes));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await controller.execute(() => studyApi.startFocus({
      label, planned_minutes: minutes, task_id: taskId || null,
      goal_id: linked?.goal_id || goalId || null,
    }));
  }
  return <form className="space-y-5" onSubmit={submit}>
    <StudyField label="Work on a planned task"><select className="input w-full" value={taskId} onChange={(event) => {
      const id = event.target.value;
      const task = tasks.find((item) => item.id === id);
      setTaskId(id);
      if (task) { setLabel(task.title); setMinutes(Math.min(180, task.estimated_minutes)); }
    }}><option value="">Choose a task or start something new</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></StudyField>
    <StudyField label="What will you focus on?"><input className="input w-full" value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={160} placeholder="Work through one lesson" /></StudyField>
    <StudyField label="Learning goal"><select name="goal_id" className="input w-full" disabled={!!linked?.goal_id} value={linked?.goal_id || goalId} onChange={(event) => setGoalId(event.target.value)}>
      <option value="">No goal</option>{view.workspace.goals.filter((goal) => goal.status === "active" || goal.id === linked?.goal_id)
        .map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
    </select></StudyField>
    <StudyField label="Session length (minutes)"><input className="input w-full" type="number" required min={1} max={180} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></StudyField>
    <div className="flex gap-2">{[15, 25, 45, 60].map((value) => <button type="button" key={value} onClick={() => setMinutes(value)} aria-pressed={minutes === value}
      className={`rounded-full border px-3 py-1.5 text-sm ${minutes === value ? "border-brand text-brand" : "border-border text-fg-dim"}`}>{value}m</button>)}</div>
    <StudySubmit busy={controller.busy}>Start focus session</StudySubmit>
  </form>;
}
