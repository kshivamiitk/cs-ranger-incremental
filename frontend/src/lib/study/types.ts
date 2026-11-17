export type {
  StudyWorkspace, StudySnapshot, StudySummary, StudyGoal, StudyTask, StudyDeck,
  StudyCard, StudyReview, StudyFocusSession, StudyPreferences, StudyDaySummary,
  StudyGoalInput, StudyTaskInput, StudyDeckInput, StudyCardInput, StudyFocusInput,
  GoalStatus, TaskStatus, TaskPriority, ReviewGrade, FocusStatus,
} from "../../../../backend/shared/types/study";
import type { StudySnapshot, StudySummary } from "../../../../backend/shared/types/study";
export type StudyView = StudySnapshot & { summary: StudySummary };
