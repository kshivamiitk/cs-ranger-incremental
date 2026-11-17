import type { StudyWorkspace, StudyDaySummary, StudySummary } from "../../../shared/types/study.js";
import { dueCards } from "./model.js";

export function localStudyDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (name: string) => parts.find((part) => part.type === name)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function shiftDay(key: string, offset: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function studySummary(w: StudyWorkspace, now: Date): StudySummary {
  const zone = w.preferences.time_zone;
  const todayKey = localStudyDate(now, zone);
  const days = new Map<string, StudyDaySummary>();
  const day = (key: string) => {
    let result = days.get(key);
    if (!result) {
      result = { date: key, focus_minutes: 0, completed_tasks: 0, reviews: 0 };
      days.set(key, result);
    }
    return result;
  };
  for (const session of w.sessions) {
    if (session.status === "completed" && session.ended_at) {
      day(localStudyDate(new Date(session.ended_at), zone)).focus_minutes += session.elapsed_seconds / 60;
    }
  }
  for (const task of w.tasks) {
    if (task.status === "done" && task.completed_at) day(localStudyDate(new Date(task.completed_at), zone)).completed_tasks++;
  }
  for (const review of w.reviews) day(localStudyDate(new Date(review.reviewed_at), zone)).reviews++;
  const weekday = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
  const start = w.preferences.week_starts_on === "monday" ? (weekday + 6) % 7 : weekday;
  const week = Array.from({ length: 7 }, (_, i) => day(shiftDay(todayKey, i - start)));
  const active = (key: string) => {
    const item = days.get(key);
    return !!item && (item.focus_minutes >= 1 || item.completed_tasks > 0 || item.reviews > 0);
  };
  // Yesterday can extend a streak before today's first activity.
  let cursor = active(todayKey) ? todayKey : shiftDay(todayKey, -1);
  let streak = 0;
  while (active(cursor) && streak < 36600) {
    streak++;
    cursor = shiftDay(cursor, -1);
  }
  const recentReviews = w.reviews.filter((review) => Date.parse(review.reviewed_at) >= now.getTime() - 30 * 86_400_000);
  const successful = recentReviews.filter((review) => review.grade !== "again").length;
  const round = (value: number) => Math.round(value * 10) / 10;
  const result: StudySummary = {
    today: day(todayKey), week,
    weekly_focus_minutes: round(week.reduce((sum, item) => sum + item.focus_minutes, 0)),
    weekly_target_minutes: w.preferences.weekly_target_minutes,
    due_cards: dueCards(w, now).length,
    overdue_tasks: w.tasks.filter((task) => task.status !== "done" && task.scheduled_date && task.scheduled_date < todayKey).length,
    active_goals: w.goals.filter((goal) => goal.status === "active").length,
    completed_goals: w.goals.filter((goal) => goal.status === "completed").length,
    streak_days: streak,
    retention_percent: recentReviews.length ? Math.round(successful / recentReviews.length * 100) : null,
    goal_progress: w.goals.map((goal) => ({
      goal_id: goal.id,
      minutes: round(w.sessions.filter((session) => session.goal_id === goal.id && session.status === "completed")
        .reduce((sum, session) => sum + session.elapsed_seconds / 60, 0)),
      tasks_done: w.tasks.filter((task) => task.goal_id === goal.id && task.status === "done").length,
      tasks_total: w.tasks.filter((task) => task.goal_id === goal.id).length,
    })),
  };
  for (const item of days.values()) item.focus_minutes = round(item.focus_minutes);
  return result;
}
