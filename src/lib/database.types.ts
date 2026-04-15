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
      contractor_presets: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          key: string
          name: string
          organization_id: string | null
          scope: Database["public"]["Enums"]["preset_scope"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          key: string
          name: string
          organization_id?: string | null
          scope?: Database["public"]["Enums"]["preset_scope"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          key?: string
          name?: string
          organization_id?: string | null
          scope?: Database["public"]["Enums"]["preset_scope"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_presets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_presets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["organization_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_employee_library: {
        Row: {
          created_at: string
          hourly_rate: number
          id: string
          name: string
          organization_id: string
          role: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          hourly_rate?: number
          id?: string
          name: string
          organization_id: string
          role?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          hourly_rate?: number
          id?: string
          name?: string
          organization_id?: string
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_employee_library_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_equipment_library: {
        Row: {
          created_at: string
          daily_rate: number
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_rate?: number
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_rate?: number
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_equipment_library_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_material_library: {
        Row: {
          cost_per_unit: number
          created_at: string
          id: string
          name: string
          organization_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          cost_per_unit?: number
          created_at?: string
          id?: string
          name: string
          organization_id: string
          unit: string
          updated_at?: string
        }
        Update: {
          cost_per_unit?: number
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_material_library_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      preset_wbs_items: {
        Row: {
          active_default: boolean
          default_equipment_days: number
          default_equipment_rate: number
          default_labor_hours: number
          default_labor_rate: number
          default_material_cost: number
          default_overhead_percent: number
          default_profit_percent: number
          default_quantity: number
          default_subcontract_cost: number
          id: string
          item_code: string
          item_name: string
          preset_id: string
          section_code: string
          section_name: string
          sort_order: number
          unit: string
        }
        Insert: {
          active_default?: boolean
          default_equipment_days?: number
          default_equipment_rate?: number
          default_labor_hours?: number
          default_labor_rate?: number
          default_material_cost?: number
          default_overhead_percent?: number
          default_profit_percent?: number
          default_quantity?: number
          default_subcontract_cost?: number
          id?: string
          item_code: string
          item_name: string
          preset_id: string
          section_code: string
          section_name: string
          sort_order?: number
          unit: string
        }
        Update: {
          active_default?: boolean
          default_equipment_days?: number
          default_equipment_rate?: number
          default_labor_hours?: number
          default_labor_rate?: number
          default_material_cost?: number
          default_overhead_percent?: number
          default_profit_percent?: number
          default_quantity?: number
          default_subcontract_cost?: number
          id?: string
          item_code?: string
          item_name?: string
          preset_id?: string
          section_code?: string
          section_name?: string
          sort_order?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "preset_wbs_items_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "contractor_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_estimate_items: {
        Row: {
          created_at: string
          equipment_breakdown: Json
          equipment_days: number
          equipment_rate: number
          id: string
          is_included: boolean
          item_code: string
          item_name: string
          labor_breakdown: Json
          labor_hours: number
          labor_rate: number
          material_breakdown: Json
          material_cost: number
          notes: string | null
          overhead_percent: number
          preset_item_id: string | null
          profit_percent: number
          project_id: string
          quantity: number
          section_code: string
          section_name: string
          sort_order: number
          subcontract_cost: number
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          equipment_breakdown?: Json
          equipment_days?: number
          equipment_rate?: number
          id?: string
          is_included?: boolean
          item_code: string
          item_name: string
          labor_breakdown?: Json
          labor_hours?: number
          labor_rate?: number
          material_breakdown?: Json
          material_cost?: number
          notes?: string | null
          overhead_percent?: number
          preset_item_id?: string | null
          profit_percent?: number
          project_id: string
          quantity?: number
          section_code: string
          section_name: string
          sort_order?: number
          subcontract_cost?: number
          unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          equipment_breakdown?: Json
          equipment_days?: number
          equipment_rate?: number
          id?: string
          is_included?: boolean
          item_code?: string
          item_name?: string
          labor_breakdown?: Json
          labor_hours?: number
          labor_rate?: number
          material_breakdown?: Json
          material_cost?: number
          notes?: string | null
          overhead_percent?: number
          preset_item_id?: string | null
          profit_percent?: number
          project_id?: string
          quantity?: number
          section_code?: string
          section_name?: string
          sort_order?: number
          subcontract_cost?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_estimate_items_preset_item_id_fkey"
            columns: ["preset_item_id"]
            isOneToOne: false
            referencedRelation: "preset_wbs_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_estimate_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_estimate_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_item_actuals: {
        Row: {
          actual_equipment_breakdown: Json
          actual_equipment_cost: number
          actual_equipment_days: number
          actual_finish_date: string | null
          actual_labor_breakdown: Json
          actual_labor_cost: number
          actual_labor_hours: number
          actual_material_breakdown: Json
          actual_material_cost: number
          actual_overhead_cost: number
          actual_profit_amount: number
          actual_quantity: number
          actual_start_date: string | null
          actual_subcontract_cost: number
          invoice_amount: number
          invoice_percent_complete: number
          percent_complete: number
          planned_finish_date: string | null
          planned_start_date: string | null
          project_estimate_item_id: string
          updated_at: string
        }
        Insert: {
          actual_equipment_breakdown?: Json
          actual_equipment_cost?: number
          actual_equipment_days?: number
          actual_finish_date?: string | null
          actual_labor_breakdown?: Json
          actual_labor_cost?: number
          actual_labor_hours?: number
          actual_material_breakdown?: Json
          actual_material_cost?: number
          actual_overhead_cost?: number
          actual_profit_amount?: number
          actual_quantity?: number
          actual_start_date?: string | null
          actual_subcontract_cost?: number
          invoice_amount?: number
          invoice_percent_complete?: number
          percent_complete?: number
          planned_finish_date?: string | null
          planned_start_date?: string | null
          project_estimate_item_id: string
          updated_at?: string
        }
        Update: {
          actual_equipment_breakdown?: Json
          actual_equipment_cost?: number
          actual_equipment_days?: number
          actual_finish_date?: string | null
          actual_labor_breakdown?: Json
          actual_labor_cost?: number
          actual_labor_hours?: number
          actual_material_breakdown?: Json
          actual_material_cost?: number
          actual_overhead_cost?: number
          actual_profit_amount?: number
          actual_quantity?: number
          actual_start_date?: string | null
          actual_subcontract_cost?: number
          invoice_amount?: number
          invoice_percent_complete?: number
          percent_complete?: number
          planned_finish_date?: string | null
          planned_start_date?: string | null
          project_estimate_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_item_actuals_project_estimate_item_id_fkey"
            columns: ["project_estimate_item_id"]
            isOneToOne: true
            referencedRelation: "project_estimate_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_item_actuals_project_estimate_item_id_fkey"
            columns: ["project_estimate_item_id"]
            isOneToOne: true
            referencedRelation: "project_item_metrics"
            referencedColumns: ["project_estimate_item_id"]
          },
        ]
      }
      projects: {
        Row: {
          bid_due_date: string | null
          created_at: string
          created_by: string | null
          customer_name: string | null
          id: string
          location: string | null
          name: string
          notes: string | null
          organization_id: string
          preset_id: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          bid_due_date?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          organization_id: string
          preset_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          bid_due_date?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          preset_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "contractor_presets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      project_item_metrics: {
        Row: {
          actual_direct_cost: number | null
          actual_equipment_breakdown: Json | null
          actual_equipment_cost: number | null
          actual_equipment_days: number | null
          actual_finish_date: string | null
          actual_labor_breakdown: Json | null
          actual_labor_cost: number | null
          actual_labor_hours: number | null
          actual_material_breakdown: Json | null
          actual_material_cost: number | null
          actual_overhead_cost: number | null
          actual_profit_amount: number | null
          actual_quantity: number | null
          actual_start_date: string | null
          actual_subcontract_cost: number | null
          actual_total_cost: number | null
          cost_variance: number | null
          earned_value_amount: number | null
          equipment_breakdown: Json | null
          equipment_days: number | null
          equipment_rate: number | null
          estimated_direct_cost: number | null
          estimated_equipment_cost: number | null
          estimated_labor_cost: number | null
          estimated_overhead_cost: number | null
          estimated_profit_cost: number | null
          estimated_total_cost: number | null
          invoice_amount: number | null
          invoice_percent_complete: number | null
          is_included: boolean | null
          item_code: string | null
          item_name: string | null
          labor_breakdown: Json | null
          labor_hour_variance: number | null
          labor_hours: number | null
          labor_rate: number | null
          material_breakdown: Json | null
          material_cost: number | null
          overhead_percent: number | null
          percent_complete: number | null
          planned_finish_date: string | null
          planned_start_date: string | null
          profit_percent: number | null
          project_estimate_item_id: string | null
          project_id: string | null
          quantity: number | null
          section_code: string | null
          section_name: string | null
          sort_order: number | null
          subcontract_cost: number | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_estimate_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_estimate_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_summary: {
        Row: {
          actual_labor_hours: number | null
          actual_total_cost: number | null
          bid_due_date: string | null
          created_at: string | null
          created_by: string | null
          customer_name: string | null
          earned_value_amount: number | null
          estimated_direct_cost: number | null
          estimated_labor_hours: number | null
          estimated_overhead_cost: number | null
          estimated_profit_cost: number | null
          estimated_total_cost: number | null
          included_item_count: number | null
          invoice_amount: number | null
          location: string | null
          name: string | null
          notes: string | null
          organization_id: string | null
          preset_id: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["project_status"] | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "contractor_presets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      create_organization: {
        Args: { p_name: string; p_slug?: string }
        Returns: string
      }
      create_project_from_preset: {
        Args: {
          p_bid_due_date?: string
          p_customer_name?: string
          p_location?: string
          p_name: string
          p_notes?: string
          p_organization_id: string
          p_preset_id: string
        }
        Returns: string
      }
      is_org_admin: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      slugify: { Args: { value: string }; Returns: string }
    }
    Enums: {
      organization_role: "owner" | "admin" | "member"
      preset_scope: "system" | "organization"
      project_status:
        | "draft"
        | "bidding"
        | "submitted"
        | "won"
        | "active"
        | "completed"
        | "lost"
        | "archived"
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
      organization_role: ["owner", "admin", "member"],
      preset_scope: ["system", "organization"],
      project_status: [
        "draft",
        "bidding",
        "submitted",
        "won",
        "active",
        "completed",
        "lost",
        "archived",
      ],
    },
  },
} as const
