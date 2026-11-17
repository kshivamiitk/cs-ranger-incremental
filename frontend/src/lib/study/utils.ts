import type { StudyCard, StudyWorkspace, StudyFocusSession } from "./types";

export function studyDate(timeZone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function minutesLabel(minutes: number) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  return hours ? `${hours}h${rounded % 60 ? ` ${rounded % 60}m` : ""}` : `${rounded}m`;
}
export function clockLabel(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
export function sessionElapsed(session: StudyFocusSession, instant: number) {
  const additional = session.status === "running" && session.running_since
    ? Math.max(0, Math.floor((instant - Date.parse(session.running_since)) / 1000)) : 0;
  return Math.min(session.planned_minutes * 60, session.elapsed_seconds + additional);
}
export function reviewQueue(workspace: StudyWorkspace, instant: number, deckId?: string): StudyCard[] {
  const active = new Set(workspace.decks.filter((deck) => !deck.archived).map((deck) => deck.id));
  return workspace.cards.filter((card) => !card.suspended && active.has(card.deck_id)
    && (!deckId || card.deck_id === deckId) && Date.parse(card.due_at) <= instant)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at) || a.id.localeCompare(b.id));
}
export function downloadStudyJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Explicit JSON import, atomic server-side, with bounded browser-side parsing. */
export function parseCardImport(text: string): { front: string; back: string; tags?: string[] }[] {
  if (new TextEncoder().encode(text).length > 200_000) throw new Error("Choose a JSON file smaller than 200 KB.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("Provide a JSON array containing 1–100 cards.");
  }
  return value.map((row, index) => {
    if (!row || typeof row !== "object" || typeof row.front !== "string" || !row.front.trim()
      || typeof row.back !== "string" || !row.back.trim()) {
      throw new Error(`Card ${index + 1} needs a non-empty front and back.`);
    }
    if (row.front.length > 4000 || row.back.length > 8000) throw new Error(`Card ${index + 1} is too long.`);
    if (row.tags !== undefined && (!Array.isArray(row.tags) || row.tags.length > 12
      || row.tags.some((tag: unknown) => typeof tag !== "string" || !tag.trim() || tag.length > 40))) {
      throw new Error(`Card ${index + 1} has invalid tags.`);
    }
    return { front: row.front.trim(), back: row.back.trim(), tags: row.tags };
  });
}
