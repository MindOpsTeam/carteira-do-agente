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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: number
          payload: Json
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: number
          payload?: Json
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: number
          payload?: Json
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          automation_id: string | null
          confirmation_message_id: string | null
          confirmation_token: string | null
          error: string | null
          finished_at: string | null
          id: number
          result: Json | null
          started_at: string
          status: string
          steps: Json
          trigger_payload: Json | null
        }
        Insert: {
          automation_id?: string | null
          confirmation_message_id?: string | null
          confirmation_token?: string | null
          error?: string | null
          finished_at?: string | null
          id?: number
          result?: Json | null
          started_at?: string
          status: string
          steps?: Json
          trigger_payload?: Json | null
        }
        Update: {
          automation_id?: string | null
          confirmation_message_id?: string | null
          confirmation_token?: string | null
          error?: string | null
          finished_at?: string | null
          id?: number
          result?: Json | null
          started_at?: string
          status?: string
          steps?: Json
          trigger_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          actions: Json
          active: boolean
          conditions: Json
          created_at: string
          description: string | null
          id: string
          last_run_at: string | null
          name: string
          next_run_at: string | null
          require_confirmation: boolean
          template_key: string | null
          trigger: Json
          updated_at: string
        }
        Insert: {
          actions?: Json
          active?: boolean
          conditions?: Json
          created_at?: string
          description?: string | null
          id?: string
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          require_confirmation?: boolean
          template_key?: string | null
          trigger: Json
          updated_at?: string
        }
        Update: {
          actions?: Json
          active?: boolean
          conditions?: Json
          created_at?: string
          description?: string | null
          id?: string
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          require_confirmation?: boolean
          template_key?: string | null
          trigger?: Json
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string | null
          id: number
          metadata: Json | null
          role: string
          status: string | null
          thread_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: number
          metadata?: Json | null
          role: string
          status?: string | null
          thread_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: number
          metadata?: Json | null
          role?: string
          status?: string | null
          thread_id?: string
        }
        Relationships: []
      }
      dashboard_snapshots: {
        Row: {
          created_at: string
          data: Json
          expires_at: string
          id: number
        }
        Insert: {
          created_at?: string
          data: Json
          expires_at?: string
          id?: number
        }
        Update: {
          created_at?: string
          data?: Json
          expires_at?: string
          id?: number
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          id: number
          instance_id: string
          payload: Json
          severity: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: number
          instance_id: string
          payload?: Json
          severity?: string
          type: string
        }
        Update: {
          created_at?: string
          id?: number
          instance_id?: string
          payload?: Json
          severity?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          active: boolean
          created_at: string
          id: string
          metric: string
          notes: string | null
          operator: string
          period: string
          target_value: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          metric: string
          notes?: string | null
          operator?: string
          period?: string
          target_value: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          metric?: string
          notes?: string | null
          operator?: string
          period?: string
          target_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      installer_tokens: {
        Row: {
          created_at: string
          expires_at: string
          metadata: Json
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          metadata?: Json
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          metadata?: Json
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      instances: {
        Row: {
          agente_cfo_version: string | null
          connected_integrations: Json
          created_at: string
          hooks_token: string | null
          hostname: string | null
          id: string
          ingress_url: string | null
          last_heartbeat: string | null
          openclaw_version: string | null
          status: string
        }
        Insert: {
          agente_cfo_version?: string | null
          connected_integrations?: Json
          created_at?: string
          hooks_token?: string | null
          hostname?: string | null
          id?: string
          ingress_url?: string | null
          last_heartbeat?: string | null
          openclaw_version?: string | null
          status?: string
        }
        Update: {
          agente_cfo_version?: string | null
          connected_integrations?: Json
          created_at?: string
          hooks_token?: string | null
          hostname?: string | null
          id?: string
          ingress_url?: string | null
          last_heartbeat?: string | null
          openclaw_version?: string | null
          status?: string
        }
        Relationships: []
      }
      llm_usage: {
        Row: {
          cost_brl: number
          created_at: string
          id: number
          input_tokens: number
          instance_id: string
          model: string
          output_tokens: number
          period: string
          session_id: string
        }
        Insert: {
          cost_brl?: number
          created_at?: string
          id?: number
          input_tokens?: number
          instance_id: string
          model?: string
          output_tokens?: number
          period: string
          session_id: string
        }
        Update: {
          cost_brl?: number
          created_at?: string
          id?: number
          input_tokens?: number
          instance_id?: string
          model?: string
          output_tokens?: number
          period?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_usage_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      marcos_insights: {
        Row: {
          created_at: string
          data: Json
          expires_at: string
          id: number
          section: string
          severity: string
          text: string
        }
        Insert: {
          created_at?: string
          data?: Json
          expires_at?: string
          id?: number
          section: string
          severity?: string
          text: string
        }
        Update: {
          created_at?: string
          data?: Json
          expires_at?: string
          id?: number
          section?: string
          severity?: string
          text?: string
        }
        Relationships: []
      }
      omie_errors: {
        Row: {
          command: string | null
          created_at: string
          http_status: number | null
          id: number
          instance_id: string
          message: string | null
        }
        Insert: {
          command?: string | null
          created_at?: string
          http_status?: number | null
          id?: number
          instance_id: string
          message?: string | null
        }
        Update: {
          command?: string | null
          created_at?: string
          http_status?: number | null
          id?: number
          instance_id?: string
          message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "omie_errors_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
        ]
      }
      scenarios: {
        Row: {
          created_at: string
          id: string
          inputs: Json
          name: string
          result: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          inputs?: Json
          name: string
          result?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          inputs?: Json
          name?: string
          result?: Json | null
        }
        Relationships: []
      }
      user_onboarding: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: number
          data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_status: {
        Row: {
          created_at: string
          id: number
          instance_id: string
          jid: string | null
          last_check: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: number
          instance_id: string
          jid?: string | null
          last_check?: string | null
          status: string
        }
        Update: {
          created_at?: string
          id?: number
          instance_id?: string
          jid?: string | null
          last_check?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_status_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
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
      [_ in never]: never
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
    Enums: {},
  },
} as const
