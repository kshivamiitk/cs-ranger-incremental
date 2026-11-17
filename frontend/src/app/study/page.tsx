"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpenCheck, Loader2, RefreshCw, X } from "lucide-react";
import { useApp } from "@/app/providers";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { useStudy } from "@/lib/study/hooks";
import { StudyOverview } from "@/components/study/Overview";
import { StudyGoals } from "@/components/study/Goals";
import { StudyPlanner } from "@/components/study/Planner";
import { StudyFocus } from "@/components/study/Focus";
import { StudyFlashcards } from "@/components/study/Flashcards";
import { StudySettings } from "@/components/study/Settings";

const tabs = [
  ["overview", "Overview"], ["goals", "Goals"], ["planner", "Planner"],
  ["focus", "Focus timer"], ["flashcards", "Flashcards"], ["settings", "Preferences"],
] as const;

export default function StudyPage() {
  const { user, loadingUser } = useApp();
  const userId = user?.user_id || user?.id;
  const controller = useStudy(userId);
  const [tab, setTab] = useState("overview");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const view = controller.data;
  function navigate(next: string) { controller.clearError(); setTab(next); }
  const active = view?.workspace.sessions.some((session) => session.status === "running" || session.status === "paused");
  return <>
    <Navbar />
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4"><span className="rounded-2xl bg-brand/10 p-3 text-brand"><BookOpenCheck className="h-7 w-7" aria-hidden="true" /></span>
          <div><p className="text-xs font-medium uppercase tracking-[0.2em] text-brand">Make learning a habit</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Your study workspace</h1>
            <p className="mt-2 text-sm text-fg-dim">Plan a little. Focus on one thing. Remember what you learn.</p></div>
        </div>
        {view && <button type="button" disabled={controller.isFetching || controller.busy} onClick={() => controller.refetch()} className="btn-ghost inline-flex items-center gap-2 text-sm"><RefreshCw className={`h-4 w-4 ${controller.isFetching ? "animate-spin" : ""}`} />Refresh</button>}
      </header>
      {loadingUser || (!!user && controller.isLoading) ? <div className="card flex items-center justify-center gap-3 py-16" role="status"><Loader2 className="h-6 w-6 animate-spin" />Loading your workspace</div>
        : !user ? <div className="card space-y-4 py-12 text-center"><h2 className="text-xl font-semibold">Your next learning step starts here.</h2><p className="text-fg-dim">Sign in to save goals, plan study time, and build your flashcards.</p><Link href="/login" className="btn-primary inline-block">Sign in</Link></div>
        : controller.isError && !view ? <div className="card space-y-4" role="alert"><h2 className="text-lg font-semibold">We could not load your workspace</h2><p className="text-sm text-fg-dim">{controller.error instanceof Error ? controller.error.message : "Please try again."}</p><button type="button" className="btn-primary" onClick={() => controller.refetch()}>Try again</button></div>
        : view ? <div className="space-y-6">
          {view.storage === "local" && <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-fg-dim">Development storage is active. Your data is saved on this server; it will not sync to another server.</p>}
          {controller.isError && <p role="alert" className="rounded-xl border border-amber-500/30 p-4 text-sm">The latest refresh failed. You are viewing the last saved snapshot. Retry before making further changes.</p>}
          {controller.mutationError && <div role="alert" className="flex items-start justify-between gap-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm"><p>{controller.mutationError}</p><button type="button" aria-label="Dismiss error" onClick={controller.clearError}><X className="h-4 w-4" /></button></div>}
          <nav aria-label="Study workspace sections" className="flex flex-wrap gap-2 border-b border-border pb-4">
            {tabs.map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => navigate(value)}
              className={`rounded-lg px-4 py-2 text-sm transition ${tab === value ? "bg-brand text-white" : "text-fg-dim hover:bg-surface-2 hover:text-fg"}`}>{label}{value === "focus" && active && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-emerald-400" aria-label="Active session" />}</button>)}
          </nav>
          {tab === "overview" && <StudyOverview view={view} navigate={navigate} />}
          {tab === "goals" && <StudyGoals view={view} controller={controller} />}
          {tab === "planner" && <StudyPlanner view={view} controller={controller} focusTask={(id) => { setSelectedTask(id); navigate("focus"); }} />}
          {tab === "focus" && <StudyFocus view={view} controller={controller} selectedTask={selectedTask} />}
          {tab === "flashcards" && <StudyFlashcards view={view} controller={controller} />}
          {tab === "settings" && <StudySettings view={view} controller={controller} />}
        </div> : null}
    </main>
    <Footer />
  </>;
}
