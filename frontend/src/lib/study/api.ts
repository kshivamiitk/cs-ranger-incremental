"use client";

import axios from "axios";
import { axiosClient, type ApiResponse } from "../api";
import type {
  StudyView, StudyGoal, StudyTask, StudyDeck, StudyCard, StudyPreferences,
  StudyGoalInput, StudyTaskInput, StudyDeckInput, StudyCardInput, StudyFocusInput, ReviewGrade,
} from "./types";

const base = "/users/me/study";
async function request(method: "get" | "post" | "patch" | "delete", path = "", data?: unknown): Promise<StudyView> {
  try {
    const response = await axiosClient().request<ApiResponse<StudyView>>({ method, url: `${base}${path}`, data });
    if (!response.data.success || !response.data.data) throw new Error(response.data.error?.message || "Study request failed");
    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error((error.response?.data as ApiResponse<unknown> | undefined)?.error?.message || error.message);
    }
    throw error;
  }
}

export const studyApi = {
  snapshot: () => request("get"),
  createGoal: (input: StudyGoalInput) => request("post", "/goals", input),
  updateGoal: (id: string, input: Partial<StudyGoalInput> & { status?: StudyGoal["status"] }) => request("patch", `/goals/${id}`, input),
  deleteGoal: (id: string) => request("delete", `/goals/${id}`),
  createTask: (input: StudyTaskInput) => request("post", "/tasks", input),
  updateTask: (id: string, input: Partial<StudyTaskInput> & { status?: StudyTask["status"] }) => request("patch", `/tasks/${id}`, input),
  deleteTask: (id: string) => request("delete", `/tasks/${id}`),
  createDeck: (input: StudyDeckInput) => request("post", "/decks", input),
  updateDeck: (id: string, input: Partial<StudyDeckInput> & { archived?: StudyDeck["archived"] }) => request("patch", `/decks/${id}`, input),
  deleteDeck: (id: string) => request("delete", `/decks/${id}`),
  createCard: (input: StudyCardInput) => request("post", "/cards", input),
  updateCard: (id: string, input: Partial<Omit<StudyCardInput, "deck_id">> & { suspended?: StudyCard["suspended"] }) => request("patch", `/cards/${id}`, input),
  deleteCard: (id: string) => request("delete", `/cards/${id}`),
  importCards: (deck_id: string, cards: Omit<StudyCardInput, "deck_id">[]) => request("post", "/cards/import", { deck_id, cards }),
  reviewCard: (id: string, grade: ReviewGrade, review_id: string) => request("post", `/cards/${id}/review`, { grade, review_id }),
  startFocus: (input: StudyFocusInput) => request("post", "/focus", input),
  focusAction: (id: string, action: "pause" | "resume" | "complete" | "cancel") => request("post", `/focus/${id}`, { action }),
  preferences: (input: Partial<StudyPreferences>) => request("patch", "/preferences", input),
};
