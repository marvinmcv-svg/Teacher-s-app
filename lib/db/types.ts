/**
 * Database types for the tables the app reads/writes so far.
 * Hand-written for Phase 0 (no linked Supabase project yet). Once a project
 * exists, replace with generated types:
 *   pnpm dlx supabase gen types typescript --project-id <id> > lib/db/types.ts
 * Keep in sync with supabase/migrations/*.sql.
 */
export type AppLocale = "es" | "en";

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type TeacherRow = {
  id: string;
  school_id: string | null;
  display_name: string | null;
  locale: AppLocale;
  subjects: string[];
  plan: string;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClassRow = {
  id: string;
  teacher_id: string;
  school_id: string | null;
  name: string;
  grade_level: string | null;
  subject: string | null;
  locale: AppLocale;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type StudentRow = {
  id: string;
  class_id: string;
  display_name: string;
  external_id: string | null;
  feedback_locale: AppLocale | null;
  qr_code_token: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      teachers: Table<
        TeacherRow,
        never,
        Partial<Pick<TeacherRow, "display_name" | "locale" | "subjects" | "onboarded_at">>
      >;
      classes: Table<
        ClassRow,
        Pick<ClassRow, "teacher_id" | "name"> &
          Partial<Pick<ClassRow, "grade_level" | "subject" | "locale" | "school_id" | "archived">>
      >;
      students: Table<
        StudentRow,
        Pick<StudentRow, "class_id" | "display_name"> &
          Partial<Pick<StudentRow, "external_id" | "feedback_locale" | "active">>
      >;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { app_locale: AppLocale };
    CompositeTypes: { [_ in never]: never };
  };
};
