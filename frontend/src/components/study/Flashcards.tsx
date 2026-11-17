"use client";

import { useState, type FormEvent } from "react";
import { Plus, Layers3, Pencil, Trash2, Download, Upload, ArrowLeft, Play, Search } from "lucide-react";
import { studyApi } from "@/lib/study/api";
import type { StudyController } from "@/lib/study/hooks";
import type { StudyView, StudyDeck, StudyCard } from "@/lib/study/types";
import { downloadStudyJson, parseCardImport, reviewQueue } from "@/lib/study/utils";
import { StudyPanel, StudyEmpty, StudyField, StudySubmit, StudyDialog, StudyConfirm } from "./StudyUi";
import { StudyReview } from "./Review";

const colors: Record<StudyDeck["color"], string> = {
  indigo: "bg-indigo-500/10 text-indigo-500", emerald: "bg-emerald-500/10 text-emerald-500",
  amber: "bg-amber-500/10 text-amber-500", rose: "bg-rose-500/10 text-rose-500", sky: "bg-sky-500/10 text-sky-500",
};
export function StudyFlashcards({ view, controller }: { view: StudyView; controller: StudyController }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<string | "all" | null>(null);
  const [deckEditor, setDeckEditor] = useState<StudyDeck | "new" | null>(null);
  const [deletingDeck, setDeletingDeck] = useState<StudyDeck | null>(null);
  const [cardEditor, setCardEditor] = useState<StudyCard | "new" | null>(null);
  const [deletingCard, setDeletingCard] = useState<StudyCard | null>(null);
  const [importing, setImporting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const now = Date.parse(view.server_time);
  const due = reviewQueue(view.workspace, now);
  const deck = view.workspace.decks.find((item) => item.id === selected);
  const cards = deck ? view.workspace.cards.filter((card) => card.deck_id === deck.id) : [];
  const filtered = cards.filter((card) => `${card.front} ${card.back} ${card.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const visible = filtered.slice((page - 1) * 25, page * 25);
  if (review) return <StudyReview key={review} view={view} deckId={review === "all" ? undefined : review} controller={controller} close={() => setReview(null)} />;
  return <div className="space-y-6">
    {deck ? <StudyPanel title={deck.title} subtitle={deck.description || "Short prompts. Clear answers. Regular practice."}
      action={<button type="button" className="inline-flex items-center gap-2 text-sm text-fg-dim" onClick={() => { setSelected(null); setSearch(""); setPage(1); }}><ArrowLeft className="h-4 w-4" />All decks</button>}>
      {deck.archived && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-500">This deck is archived. Restore it to add cards or review.</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={deck.archived || !due.some((card) => card.deck_id === deck.id)} onClick={() => setReview(deck.id)}><Play className="h-4 w-4" />Review ({due.filter((card) => card.deck_id === deck.id).length})</button>
        <button type="button" className="btn-ghost inline-flex items-center gap-2" disabled={deck.archived} onClick={() => setCardEditor("new")}><Plus className="h-4 w-4" />Add card</button>
        <button type="button" className="btn-ghost inline-flex items-center gap-2" disabled={deck.archived} onClick={() => setImporting(true)}><Upload className="h-4 w-4" />Import JSON</button>
        <button type="button" className="btn-ghost inline-flex items-center gap-2" disabled={!cards.length} onClick={() => downloadStudyJson(cards.map(({ front, back, tags }) => ({ front, back, tags })), `study-deck-${deck.id}.json`)}><Download className="h-4 w-4" />Export cards</button>
        <button type="button" className="btn-ghost" onClick={() => setDeckEditor(deck)}>Edit deck</button>
      </div>
      <label className="relative block"><span className="sr-only">Search flashcards</span><Search className="absolute left-3 top-3 h-4 w-4 text-fg-dim" aria-hidden="true" />
        <input className="input w-full pl-10" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search prompts, answers, or tags" /></label>
      <p className="text-xs text-fg-dim">{filtered.length} cards · {cards.filter((card) => card.suspended).length} suspended</p>
      {visible.length === 0 ? <StudyEmpty title={search ? "No matching cards" : "Build your first card"}>Write a question on the front and a clear answer on the back.</StudyEmpty>
        : <ul className="divide-y divide-border">{visible.map((card) => <li key={card.id} className="flex items-start gap-4 py-4">
          <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words text-sm font-medium">{card.front}</p>
            <details className="mt-2 text-sm text-fg-dim"><summary className="cursor-pointer">Show answer</summary><p className="mt-2 whitespace-pre-wrap break-words">{card.back}</p></details>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-dim">
              <span>{card.suspended ? "Suspended" : Date.parse(card.due_at) <= now ? "Due now" : `Due ${new Date(card.due_at).toLocaleDateString(undefined, { timeZone: view.workspace.preferences.time_zone })}`}</span>
              {card.tags.map((tag) => <span className="rounded bg-surface-2 px-2" key={tag}>{tag}</span>)}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <button type="button" className="rounded-lg p-2 hover:bg-surface-2" aria-label={`Edit card: ${card.front.slice(0, 60)}`} onClick={() => setCardEditor(card)}><Pencil className="h-4 w-4" /></button>
            <button type="button" className="rounded-lg p-2 text-fg-dim hover:bg-surface-2" aria-label={`Delete card: ${card.front.slice(0, 60)}`} onClick={() => setDeletingCard(card)}><Trash2 className="h-4 w-4" /></button>
          </div>
        </li>)}</ul>}
      {filtered.length > 25 && <div className="flex items-center justify-between gap-3 text-sm">
        <button type="button" className="btn-ghost" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
        <span>Page {page} of {Math.ceil(filtered.length / 25)}</span>
        <button type="button" className="btn-ghost" disabled={page * 25 >= filtered.length} onClick={() => setPage((value) => value + 1)}>Next</button>
      </div>}
    </StudyPanel> : <StudyPanel title="Your flashcards" subtitle="Practice active recall with a review schedule that adapts to your answers."
      action={<button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDeckEditor("new")}><Plus className="h-4 w-4" />New deck</button>}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button type="button" className="btn-ghost inline-flex items-center gap-2" disabled={!due.length} onClick={() => setReview("all")}><Play className="h-4 w-4" />Review all due ({due.length})</button>
        <label className="flex items-center gap-2 text-sm text-fg-dim"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Show archived decks</label>
      </div>
      {view.workspace.decks.filter((item) => showArchived || !item.archived).length === 0
        ? <StudyEmpty title="Remember what you learn">Create a deck for a subject, then add your own prompts and answers.</StudyEmpty>
        : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{view.workspace.decks.filter((item) => showArchived || !item.archived).map((item) => {
          const count = view.workspace.cards.filter((card) => card.deck_id === item.id).length;
          const dueCount = due.filter((card) => card.deck_id === item.id).length;
          return <article className="rounded-xl border border-border p-5" key={item.id}>
            <div className="flex justify-between gap-3"><span className={`rounded-lg p-3 ${colors[item.color]}`}><Layers3 className="h-5 w-5" /></span>
              <div className="flex items-start gap-1"><button type="button" className="rounded p-2 hover:bg-surface-2" aria-label={`Edit deck ${item.title}`} onClick={() => setDeckEditor(item)}><Pencil className="h-4 w-4" /></button>
                <button type="button" className="rounded p-2 text-fg-dim hover:bg-surface-2" aria-label={`Delete deck ${item.title}`} onClick={() => setDeletingDeck(item)}><Trash2 className="h-4 w-4" /></button></div>
            </div>
            <button type="button" className="mt-4 block text-left text-lg font-semibold hover:text-brand" onClick={() => { setSelected(item.id); setSearch(""); setPage(1); }}>{item.title}</button>
            <p className="mt-1 line-clamp-2 text-sm text-fg-dim">{item.description || "A little daily practice."}</p>
            <div className="mt-4 flex items-center justify-between gap-2 text-xs text-fg-dim"><span>{count} cards</span><span>{item.archived ? "Archived" : `${dueCount} due`}</span></div>
          </article>;
        })}</div>}
    </StudyPanel>}
    {deckEditor && <StudyDialog open error={controller.mutationError} title={deckEditor === "new" ? "Create a flashcard deck" : "Edit deck"} close={() => { if (!controller.busy) setDeckEditor(null); }}>
      <DeckForm key={deckEditor === "new" ? "new" : deckEditor.id} deck={deckEditor === "new" ? undefined : deckEditor} controller={controller} close={() => setDeckEditor(null)} />
    </StudyDialog>}
    {cardEditor && deck && <StudyDialog open error={controller.mutationError} title={cardEditor === "new" ? "Add a flashcard" : "Edit flashcard"} close={() => { if (!controller.busy) setCardEditor(null); }}>
      <CardForm key={cardEditor === "new" ? "new" : cardEditor.id} deck={deck} card={cardEditor === "new" ? undefined : cardEditor} controller={controller} close={() => setCardEditor(null)} />
    </StudyDialog>}
    {importing && deck && <StudyDialog open error={controller.mutationError} title="Import flashcards" close={() => { if (!controller.busy) setImporting(false); }}>
      <CardImport deck={deck} controller={controller} close={() => setImporting(false)} />
    </StudyDialog>}
    {deletingDeck && <StudyConfirm error={controller.mutationError} title={`Delete ${deletingDeck.title}?`} message="This permanently deletes the deck and all its cards. Historical review activity is kept. Export the deck first if you want a backup."
      busy={controller.busy} onCancel={() => setDeletingDeck(null)} onConfirm={async () => {
        if (await controller.execute(() => studyApi.deleteDeck(deletingDeck.id))) { setDeletingDeck(null); if (selected === deletingDeck.id) setSelected(null); }
      }} />}
    {deletingCard && <StudyConfirm error={controller.mutationError} title="Delete this flashcard?" message="The prompt, answer, and future schedule will be deleted. Historical review activity is kept."
      busy={controller.busy} onCancel={() => setDeletingCard(null)} onConfirm={async () => {
        if (await controller.execute(() => studyApi.deleteCard(deletingCard.id))) { setDeletingCard(null); setPage(1); }
      }} />}
  </div>;
}

function DeckForm({ deck, controller, close }: { deck?: StudyDeck; controller: StudyController; close: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = { title: String(form.get("title")), description: String(form.get("description") || ""), color: String(form.get("color")) as StudyDeck["color"] };
    if (await controller.execute(() => deck ? studyApi.updateDeck(deck.id, { ...input, archived: form.get("archived") === "on" }) : studyApi.createDeck(input))) close();
  }
  return <form onSubmit={submit} className="space-y-4">
    <StudyField label="Deck name"><input autoFocus className="input w-full" name="title" required maxLength={160} defaultValue={deck?.title} placeholder="Data structures" /></StudyField>
    <StudyField label="Description"><textarea className="input min-h-20 w-full" name="description" maxLength={4000} defaultValue={deck?.description} /></StudyField>
    <StudyField label="Color"><select className="input w-full" name="color" defaultValue={deck?.color || "indigo"}>{Object.keys(colors).map((color) => <option key={color} value={color}>{color}</option>)}</select></StudyField>
    {deck && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" defaultChecked={deck.archived} />Archive this deck (pause all reviews)</label>}
    <StudySubmit busy={controller.busy}>{deck ? "Save changes" : "Create deck"}</StudySubmit>
  </form>;
}

function CardForm({ deck, card, controller, close }: { deck: StudyDeck; card?: StudyCard; controller: StudyController; close: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = { front: String(form.get("front")), back: String(form.get("back")), tags: String(form.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean) };
    if (await controller.execute(() => card ? studyApi.updateCard(card.id, { ...input, suspended: form.get("suspended") === "on" }) : studyApi.createCard({ ...input, deck_id: deck.id }))) close();
  }
  return <form onSubmit={submit} className="space-y-4">
    <StudyField label="Front · question or prompt"><textarea autoFocus className="input min-h-28 w-full" name="front" required maxLength={4000} defaultValue={card?.front} placeholder="What is the time complexity of binary search?" /></StudyField>
    <StudyField label="Back · answer"><textarea className="input min-h-36 w-full" name="back" required maxLength={8000} defaultValue={card?.back} placeholder="O(log n), assuming a sorted array." /></StudyField>
    <StudyField label="Tags" hint="Separate up to 12 tags with commas; 40 characters per tag."><input className="input w-full" name="tags" maxLength={500} defaultValue={card?.tags.join(", ")} placeholder="algorithms, searching" /></StudyField>
    {card && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="suspended" defaultChecked={card.suspended} />Suspend this card (keep it out of reviews)</label>}
    <StudySubmit busy={controller.busy}>{card ? "Save changes" : "Add card"}</StudySubmit>
  </form>;
}

function CardImport({ deck, controller, close }: { deck: StudyDeck; controller: StudyController; close: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const cards = parseCardImport(text);
      if (await controller.execute(() => studyApi.importCards(deck.id, cards))) close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import cards"); }
  }
  return <form onSubmit={submit} className="space-y-4">
    <p className="text-sm text-fg-dim">Add 1–100 cards to {deck.title}. All cards are validated before anything is saved. Imported cards are immediately available for review.</p>
    <StudyField label="JSON file (optional)"><input type="file" accept=".json,application/json" className="input w-full" onChange={async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 200_000) { setError("Choose a file smaller than 200 KB."); return; }
      try { setText(await file.text()); setError(null); } catch { setError("This file could not be read."); }
    }} /></StudyField>
    <StudyField label="Cards as JSON" hint={'Example: [{"front":"What is a queue?","back":"A first-in, first-out collection.","tags":["structures"]}]'}>
      <textarea className="input min-h-48 w-full font-mono text-sm" required value={text} maxLength={200000} onChange={(event) => setText(event.target.value)} spellCheck={false} />
    </StudyField>
    {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    <StudySubmit busy={controller.busy}>Import cards</StudySubmit>
  </form>;
}
