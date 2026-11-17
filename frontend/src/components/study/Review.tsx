"use client";

import { useState } from "react";
import { RotateCcw, CheckCircle2, ArrowLeft } from "lucide-react";
import { studyApi } from "@/lib/study/api";
import type { StudyController } from "@/lib/study/hooks";
import type { StudyView, ReviewGrade } from "@/lib/study/types";
import { reviewQueue } from "@/lib/study/utils";
import { StudyPanel, StudyMeter } from "./StudyUi";

export function StudyReview({ view, deckId, controller, close }: {
  view: StudyView; deckId?: string; controller: StudyController; close: () => void;
}) {
  // Capture the initial queue: polling and newly due cards do not interrupt a
  // review session. Server state still decides whether each card is reviewable.
  const [ids] = useState(() => reviewQueue(view.workspace, Date.parse(view.server_time), deckId)
    .slice(0, view.workspace.preferences.review_session_limit).map((card) => card.id));
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewId, setReviewId] = useState(() => crypto.randomUUID());
  const card = view.workspace.cards.find((item) => item.id === ids[index]);
  const completed = index >= ids.length;
  async function grade(value: ReviewGrade) {
    if (!card) return;
    if (await controller.execute(() => studyApi.reviewCard(card.id, value, reviewId))) {
      setIndex((current) => current + 1);
      setRevealed(false);
      setReviewId(crypto.randomUUID());
    }
  }
  return <StudyPanel title={completed ? "Review session complete" : "Time to recall"}
    subtitle={deckId ? view.workspace.decks.find((deck) => deck.id === deckId)?.title : "All active decks"}
    action={<button type="button" className="inline-flex items-center gap-2 text-sm text-fg-dim" disabled={controller.busy} onClick={close}><ArrowLeft className="h-4 w-4" />Back to decks</button>}>
    <div className="space-y-2"><p className="text-sm text-fg-dim">{Math.min(index, ids.length)} of {ids.length} cards finished</p>
      <StudyMeter value={Math.min(index, ids.length)} maximum={Math.max(1, ids.length)} label="Review session progress" /></div>
    {completed ? <div className="space-y-4 py-12 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
      <h3 className="text-xl font-semibold">A little practice adds up.</h3><p className="text-sm text-fg-dim">{ids.length ? "Your next review dates have been saved. Come back when more cards are due." : "There are no due cards in this deck right now."}</p>
      <button type="button" className="btn-primary" onClick={close}>Return to flashcards</button>
    </div> : !card || card.suspended || Date.parse(card.due_at) > Date.parse(view.server_time) || view.workspace.decks.find((deck) => deck.id === card.deck_id)?.archived ? <div className="space-y-4 py-8 text-center">
      <p>This card is no longer due or available. It may have changed in another tab.</p><button type="button" className="btn-ghost" onClick={() => { setIndex((current) => current + 1); setRevealed(false); setReviewId(crypto.randomUUID()); }}>Skip card</button>
    </div> : <div className="space-y-6">
      <div className="flex flex-wrap gap-2">{card.tags.map((tag) => <span key={tag} className="rounded-full bg-surface-2 px-2 py-1 text-xs text-fg-dim">{tag}</span>)}</div>
      <div className="flex min-h-52 items-center justify-center rounded-2xl border border-border bg-surface-2/40 p-8">
        <p className="whitespace-pre-wrap break-words text-center text-xl leading-relaxed">{card.front}</p>
      </div>
      {revealed ? <>
        <div className="rounded-2xl border border-brand/30 bg-brand/5 p-8" aria-live="polite"><p className="mb-3 text-xs font-medium uppercase tracking-widest text-brand">Answer</p><p className="whitespace-pre-wrap break-words leading-relaxed">{card.back}</p></div>
        <div><p className="mb-3 text-center text-sm text-fg-dim">How well did you remember it?</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            ["again", "Again", "About 10 minutes", "border-rose-500/40 text-rose-500"],
            ["hard", "Hard", "Shorter interval", "border-amber-500/40 text-amber-500"],
            ["good", "Good", "Normal interval", "border-emerald-500/40 text-emerald-500"],
            ["easy", "Easy", "Longer interval", "border-sky-500/40 text-sky-500"],
          ] as const).map(([value, label, hint, color]) => <button type="button" key={value} disabled={controller.busy} onClick={() => grade(value as ReviewGrade)}
            className={`rounded-xl border p-4 text-center transition hover:bg-surface-2 disabled:opacity-50 ${color}`}><span className="block font-semibold">{label}</span>{" "}<span className="mt-1 block text-xs text-fg-dim">{hint}</span></button>)}
        </div></div>
      </> : <div className="text-center"><button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setRevealed(true)}><RotateCcw className="h-4 w-4" />Show answer</button>
        <p className="mt-3 text-xs text-fg-dim">Try to recall the answer before revealing it.</p></div>}
    </div>}
  </StudyPanel>;
}
