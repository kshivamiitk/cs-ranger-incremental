"use client";

import { useState, type FormEvent } from "react";
import { Download, CheckCircle2 } from "lucide-react";
import { studyApi } from "@/lib/study/api";
import type { StudyController } from "@/lib/study/hooks";
import type { StudyView } from "@/lib/study/types";
import { downloadStudyJson } from "@/lib/study/utils";
import { StudyPanel, StudyField, StudySubmit } from "./StudyUi";

export function StudySettings({ view, controller }: { view: StudyView; controller: StudyController }) {
  const preferences = view.workspace.preferences;
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const success = await controller.execute(() => studyApi.preferences({
      time_zone: String(form.get("time_zone")),
      weekly_target_minutes: Number(form.get("weekly_target_minutes")),
      focus_minutes: Number(form.get("focus_minutes")),
      review_session_limit: Number(form.get("review_session_limit")),
      week_starts_on: String(form.get("week_starts_on")) as "monday" | "sunday",
    }));
    if (success) setSaved(true);
  }
  const zones = ["Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Asia/Dubai", "Europe/London", "Europe/Paris", "UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney"];
  return <div className="grid gap-6 lg:grid-cols-2">
    <StudyPanel title="Study preferences" subtitle="Choose a rhythm that works for you.">
      <form key={JSON.stringify(preferences)} onSubmit={submit} className="space-y-4" onChange={() => setSaved(false)}>
        <StudyField label="Time zone" hint="Your planner dates, daily activity, and weekly targets use this time zone.">
          <input className="input w-full" name="time_zone" list="study-time-zones" required maxLength={100} defaultValue={preferences.time_zone} />
          <datalist id="study-time-zones">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
        </StudyField>
        <StudyField label="Weekly study target (minutes)"><input className="input w-full" name="weekly_target_minutes" type="number" required min={15} max={10080} defaultValue={preferences.weekly_target_minutes} /></StudyField>
        <StudyField label="Default focus session (minutes)"><input className="input w-full" name="focus_minutes" type="number" required min={1} max={180} defaultValue={preferences.focus_minutes} /></StudyField>
        <StudyField label="Cards per review session"><input className="input w-full" name="review_session_limit" type="number" required min={1} max={200} defaultValue={preferences.review_session_limit} /></StudyField>
        <StudyField label="First day of the week"><select className="input w-full" name="week_starts_on" defaultValue={preferences.week_starts_on}><option value="monday">Monday</option><option value="sunday">Sunday</option></select></StudyField>
        <div className="flex flex-wrap items-center gap-3"><StudySubmit busy={controller.busy}>Save preferences</StudySubmit>
          {saved && <span role="status" className="inline-flex items-center gap-1 text-sm text-emerald-500"><CheckCircle2 className="h-4 w-4" />Saved</span>}
        </div>
      </form>
    </StudyPanel>
    <StudyPanel title="Your study data" subtitle="Download a copy of your goals, tasks, cards, review history, and focus sessions.">
      <p className="text-sm text-fg-dim">Exports include your private study notes. Keep the downloaded file somewhere you trust. Deck exports on the Flashcards screen can be imported into another deck.</p>
      <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => downloadStudyJson({
        exported_at: new Date().toISOString(), schema_version: 1, workspace: view.workspace,
      }, `learnrift-study-${new Date().toISOString().slice(0, 10)}.json`)}><Download className="h-4 w-4" />Download workspace</button>
      <dl className="space-y-3 border-t border-border pt-4 text-sm">
        <div className="flex justify-between"><dt className="text-fg-dim">Learning goals</dt><dd>{view.workspace.goals.length} / 100</dd></div>
        <div className="flex justify-between"><dt className="text-fg-dim">Planner tasks</dt><dd>{view.workspace.tasks.length} / 2,000</dd></div>
        <div className="flex justify-between"><dt className="text-fg-dim">Flashcard decks</dt><dd>{view.workspace.decks.length} / 100</dd></div>
        <div className="flex justify-between"><dt className="text-fg-dim">Flashcards</dt><dd>{view.workspace.cards.length} / 5,000</dd></div>
      </dl>
      <p className="text-xs text-fg-dim">The workspace keeps the latest 2,000 review events and 1,000 focus sessions. Older activity falls outside these historical statistics. Workspace downloads are for backup and inspection; full-workspace restore is not supported.</p>
    </StudyPanel>
  </div>;
}
