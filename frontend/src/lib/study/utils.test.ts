import { describe, expect, it } from "vitest";
import { clockLabel, minutesLabel, studyDate, parseCardImport, reviewQueue, sessionElapsed } from "./utils";
import type { StudyWorkspace, StudyFocusSession } from "./types";

describe("study display utilities", () => {
  it("formats durations without wrapping hours or displaying negative time", () => {
    expect(clockLabel(1500)).toBe("25:00");
    expect(clockLabel(-2)).toBe("00:00");
    expect(clockLabel(7200)).toBe("120:00");
    expect(minutesLabel(90)).toBe("1h 30m");
    expect(minutesLabel(60)).toBe("1h");
  });
  it("uses the selected timezone at date boundaries", () => {
    expect(studyDate("Asia/Kolkata", new Date("2026-11-17T20:00:00Z"))).toBe("2026-11-18");
    expect(studyDate("America/New_York", new Date("2026-11-17T02:00:00Z"))).toBe("2026-11-16");
  });
  it("caps focus time and excludes pauses", () => {
    const session = { status: "running", planned_minutes: 25, elapsed_seconds: 10, running_since: "2026-11-17T10:00:00Z" } as StudyFocusSession;
    expect(sessionElapsed(session, Date.parse("2026-11-17T10:00:20Z"))).toBe(30);
    expect(sessionElapsed(session, Date.parse("2026-11-17T20:00:00Z"))).toBe(1500);
    expect(sessionElapsed({ ...session, status: "paused" }, Date.parse("2026-11-17T20:00:00Z"))).toBe(10);
  });
});

describe("flashcard import", () => {
  it("imports and normalizes cards while discarding untrusted metadata", () => {
    expect(parseCardImport(JSON.stringify([{ front: " Q ", back: " A ", tags: ["test"], user_id: "other", ease: 999 }]))).toEqual([{ front: "Q", back: "A", tags: ["test"] }]);
  });
  it.each(["not json", "{}", "[]", '[{"front":"Q"}]', '[{"front":"","back":"A"}]', '[{"front":"Q","back":"A","tags":[7]}]'])("rejects malformed import %s", (text) => {
    expect(() => parseCardImport(text)).toThrow();
  });
  it("rejects oversized files, batches, and fields before making a request", () => {
    expect(() => parseCardImport(" ".repeat(200001))).toThrow("200 KB");
    expect(() => parseCardImport(JSON.stringify(Array.from({ length: 101 }, () => ({ front: "Q", back: "A" }))))).toThrow("1–100");
    expect(() => parseCardImport(JSON.stringify([{ front: "x".repeat(4001), back: "A" }]))).toThrow("too long");
  });
});

describe("review queue", () => {
  it("excludes future, suspended and archived cards and orders by due instant", () => {
    const workspace = {
      decks: [{ id: "active", archived: false }, { id: "archived", archived: true }],
      cards: [
        { id: "due", deck_id: "active", suspended: false, due_at: "2026-11-17T10:00:00Z" },
        { id: "oldest", deck_id: "active", suspended: false, due_at: "2026-11-16T10:00:00Z" },
        { id: "future", deck_id: "active", suspended: false, due_at: "2026-11-18T10:00:00Z" },
        { id: "suspended", deck_id: "active", suspended: true, due_at: "2026-11-16T10:00:00Z" },
        { id: "archived", deck_id: "archived", suspended: false, due_at: "2026-11-16T10:00:00Z" },
      ],
    } as StudyWorkspace;
    expect(reviewQueue(workspace, Date.parse("2026-11-17T10:00:00Z")).map((card) => card.id)).toEqual(["oldest", "due"]);
  });
});
