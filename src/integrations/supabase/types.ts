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
