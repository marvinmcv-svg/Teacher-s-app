/**
 * App-facing DB types. `database.types.ts` is generated from the local
 * Supabase schema (`pnpm db:types`); regenerate after every migration.
 */
import type { Database as Generated, Tables } from "./database.types";

export type Database = Generated;
export type AppLocale = Generated["public"]["Enums"]["app_locale"];
export type TeacherRow = Tables<"teachers">;
export type ClassRow = Tables<"classes">;
export type StudentRow = Tables<"students">;
export type AssignmentRow = Tables<"assignments">;
export type QuestionRow = Tables<"questions">;
export type SubmissionRow = Tables<"submissions">;
export type PageRow = Tables<"pages">;
export type OcrLineRow = Tables<"ocr_lines">;
export type AnswerRow = Tables<"answers">;
export type CriterionScoreRow = Tables<"criterion_scores">;
export type AnnotationRow = Tables<"annotations">;
export type FeedbackRow = Tables<"feedback">;
export type ReleaseRow = Tables<"releases">;
export type { Json, Tables } from "./database.types";
