export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      saved_rubrics: {
        Row: {
          content: string
          created_at: string
          grade_level: string | null
          id: string
          last_used_at: string
          name: string
          subject: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          grade_level?: string | null
          id?: string
          last_used_at?: string
          name: string
          subject?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          grade_level?: string | null
          id?: string
          last_used_at?: string
          name?: string
          subject?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          audio_path: string | null
          created_at: string
          duration_seconds: number | null
          error_message: string | null
          id: string
          parent_message_draft: string | null
          snippet: string | null
          status: string
          summary_json: Json | null
          teacher_notes: string | null
          title: string | null
          transcript: string | null
          user_id: string
        }
        Insert: {
          audio_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          parent_message_draft?: string | null
          snippet?: string | null
          status?: string
          summary_json?: Json | null
          teacher_notes?: string | null
          title?: string | null
          transcript?: string | null
          user_id: string
        }
        Update: {
          audio_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          parent_message_draft?: string | null
          snippet?: string | null
          status?: string
          summary_json?: Json | null
          teacher_notes?: string | null
          title?: string | null
          transcript?: string | null
          user_id?: string
        }
        Relationships: []
      }
      submission_batches: {
        Row: {
          answer_key_text: string | null
          assignment_title: string | null
          completed_at: string | null
          created_at: string
          grade_level: string | null
          graded_count: number
          id: string
          rubric_id: string | null
          status: string
          subject: string | null
          total_count: number
          user_id: string
        }
        Insert: {
          answer_key_text?: string | null
          assignment_title?: string | null
          completed_at?: string | null
          created_at?: string
          grade_level?: string | null
          graded_count?: number
          id?: string
          rubric_id?: string | null
          status?: string
          subject?: string | null
          total_count?: number
          user_id: string
        }
        Update: {
          answer_key_text?: string | null
          assignment_title?: string | null
          completed_at?: string | null
          created_at?: string
          grade_level?: string | null
          graded_count?: number
          id?: string
          rubric_id?: string | null
          status?: string
          subject?: string | null
          total_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_batches_rubric_id_fkey"
            columns: ["rubric_id"]
            isOneToOne: false
            referencedRelation: "saved_rubrics"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          batch_id: string | null
          combined_text: string | null
          created_at: string
          date_detection: Json | null
          grading_result: Json | null
          id: string
          name_detection: Json | null
          pages: Json | null
          source: Database["public"]["Enums"]["submission_source"]
          source_metadata: Json | null
          status: Database["public"]["Enums"]["submission_status"]
          student_email: string | null
          student_id: string | null
          student_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          batch_id?: string | null
          combined_text?: string | null
          created_at?: string
          date_detection?: Json | null
          grading_result?: Json | null
          id?: string
          name_detection?: Json | null
          pages?: Json | null
          source?: Database["public"]["Enums"]["submission_source"]
          source_metadata?: Json | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_email?: string | null
          student_id?: string | null
          student_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          batch_id?: string | null
          combined_text?: string | null
          created_at?: string
          date_detection?: Json | null
          grading_result?: Json | null
          id?: string
          name_detection?: Json | null
          pages?: Json | null
          source?: Database["public"]["Enums"]["submission_source"]
          source_metadata?: Json | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_email?: string | null
          student_id?: string | null
          student_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "submission_batches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      submission_source:
        | "upload"
        | "google_classroom"
        | "canvas"
        | "manual_entry"
      submission_status:
        | "pending"
        | "processing"
        | "graded"
        | "review_needed"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      submission_source: [
        "upload",
        "google_classroom",
        "canvas",
        "manual_entry",
      ],
      submission_status: [
        "pending",
        "processing",
        "graded",
        "review_needed",
        "failed",
      ],
    },
  },
} as const
