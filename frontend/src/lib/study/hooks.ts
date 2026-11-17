"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { studyApi } from "./api";
import type { StudyView } from "./types";

export function useStudy(userId: string | undefined) {
  const queryClient = useQueryClient();
  const key = ["study-workspace", userId];
  const query = useQuery({
    queryKey: key,
    queryFn: studyApi.snapshot,
    enabled: !!userId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const execute = async (operation: () => Promise<StudyView>): Promise<boolean> => {
    // Prevent double submits before React has rendered the disabled state.
    if (pending.current || !userId) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await queryClient.cancelQueries({ queryKey: ["study-workspace", userId] });
      const response = await operation();
      queryClient.setQueryData<StudyView>(["study-workspace", userId], (current) =>
        !current || response.version >= current.version ? response : current);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your changes were not saved. Please retry.");
      // A failed response can still represent a committed write. Reload before
      // the user retries so focus sessions and review state cannot drift.
      void queryClient.invalidateQueries({ queryKey: ["study-workspace", userId] });
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const clearError = useCallback(() => setError(null), []);
  return { ...query, execute, busy, mutationError: error, clearError };
}
export type StudyController = ReturnType<typeof useStudy>;
