/** API contracts for the learner-owned study workspace. No runtime dependencies. */
export type GoalStatus = "active" | "completed" | "archived";
export type TaskStatus = "planned" | "in_progress" | "done";
export type TaskPriority = "low" | "normal" | "high";
export type ReviewGrade = "again" | "hard" | "good" | "easy";
export type FocusStatus = "running" | "paused" | "completed" | "cancelled";

export interface StudyGoal {
  id: string;
  title: string;
  description: string;
  target_minutes: number;
  due_date: string | null;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
}

export interface StudyTask {
  id: string;
  title: string;
  notes: string;
  goal_id: string | null;
  scheduled_date: string | null;
  estimated_minutes: number;
  priority: TaskPriority;
  status: TaskStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudyDeck {
  id: string;
  title: string;
  description: string;
  color: "indigo" | "emerald" | "amber" | "rose" | "sky";
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface StudyCard {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  tags: string[];
  suspended: boolean;
  repetitions: number;
  lapses: number;
  interval_days: number;
  ease: number;
  due_at: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudyReview {
  id: string;
  card_id: string;
  deck_id: string;
  grade: ReviewGrade;
  reviewed_at: string;
  next_due_at: string;
  interval_days: number;
}

export interface StudyFocusSession {
  id: string;
  goal_id: string | null;
  task_id: string | null;
  label: string;
  planned_minutes: number;
  status: FocusStatus;
  elapsed_seconds: number;
  running_since: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface StudyPreferences {
  time_zone: string;
  weekly_target_minutes: number;
  focus_minutes: number;
  review_session_limit: number;
  week_starts_on: "monday" | "sunday";
}

export interface StudyWorkspace {
  schema_version: 1;
  preferences: StudyPreferences;
  goals: StudyGoal[];
  tasks: StudyTask[];
  decks: StudyDeck[];
  cards: StudyCard[];
  reviews: StudyReview[];
  sessions: StudyFocusSession[];
}

export interface StudySnapshot {
  version: number;
  workspace: StudyWorkspace;
  storage: "database" | "local";
  server_time: string;
}

export interface StudyGoalInput {
  title: string;
  description?: string;
  target_minutes: number;
  due_date?: string | null;
}

export interface StudyTaskInput {
  title: string;
  notes?: string;
  goal_id?: string | null;
  scheduled_date?: string | null;
  estimated_minutes?: number;
  priority?: TaskPriority;
}

export interface StudyDeckInput {
  title: string;
  description?: string;
  color?: StudyDeck["color"];
}

export interface StudyCardInput {
  deck_id: string;
  front: string;
  back: string;
  tags?: string[];
}

export interface StudyFocusInput {
  label: string;
  planned_minutes: number;
  goal_id?: string | null;
  task_id?: string | null;
}

export interface StudyDaySummary {
  date: string;
  focus_minutes: number;
  completed_tasks: number;
  reviews: number;
}

export interface StudySummary {
  today: StudyDaySummary;
  week: StudyDaySummary[];
  weekly_focus_minutes: number;
  weekly_target_minutes: number;
  due_cards: number;
  overdue_tasks: number;
  active_goals: number;
  completed_goals: number;
  streak_days: number;
  retention_percent: number | null;
  goal_progress: { goal_id: string; minutes: number; tasks_done: number; tasks_total: number }[];
}
