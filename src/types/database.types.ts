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
      attendance_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["attendance_action"]
          attendance_record_id: string
          company_id: string
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          performed_by: string | null
          recorded_at: string
          source: Database["public"]["Enums"]["attendance_source"]
          updated_at: string
        }
        Insert: {
          action: Database["public"]["Enums"]["attendance_action"]
          attendance_record_id: string
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          performed_by?: string | null
          recorded_at?: string
          source: Database["public"]["Enums"]["attendance_source"]
          updated_at?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["attendance_action"]
          attendance_record_id?: string
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          performed_by?: string | null
          recorded_at?: string
          source?: Database["public"]["Enums"]["attendance_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_audit_logs_attendance_record_id_fkey"
            columns: ["attendance_record_id"]
            isOneToOne: false
            referencedRelation: "attendance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_audit_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_audit_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_corrections: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attendance_record_id: string
          company_id: string
          created_at: string
          employee_id: string
          id: string
          reason: string | null
          rejection_reason: string | null
          requested_by: string | null
          requested_punch_in: string | null
          requested_punch_out: string | null
          status: Database["public"]["Enums"]["correction_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attendance_record_id: string
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          reason?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          requested_punch_in?: string | null
          requested_punch_out?: string | null
          status?: Database["public"]["Enums"]["correction_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attendance_record_id?: string
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          reason?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          requested_punch_in?: string | null
          requested_punch_out?: string | null
          status?: Database["public"]["Enums"]["correction_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_corrections_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_attendance_record_id_fkey"
            columns: ["attendance_record_id"]
            isOneToOne: false
            referencedRelation: "attendance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_early_going_rule_thresholds: {
        Row: {
          calculated_minutes: number
          company_id: string
          created_at: string
          early_going_rule_id: string
          from_minutes: number
          id: string
          sort_order: number
          to_minutes: number | null
          updated_at: string
        }
        Insert: {
          calculated_minutes: number
          company_id: string
          created_at?: string
          early_going_rule_id: string
          from_minutes: number
          id?: string
          sort_order?: number
          to_minutes?: number | null
          updated_at?: string
        }
        Update: {
          calculated_minutes?: number
          company_id?: string
          created_at?: string
          early_going_rule_id?: string
          from_minutes?: number
          id?: string
          sort_order?: number
          to_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_early_going_rule_thresholds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_early_going_rule_thresholds_early_going_rule_id_fkey"
            columns: ["early_going_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_early_going_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_early_going_rules: {
        Row: {
          calculation_method: string
          company_id: string
          created_at: string
          created_by: string | null
          custom_rounding_minutes: number | null
          effective_from: string
          effective_to: string | null
          grace_minutes: number
          id: string
          is_active: boolean
          remark: string | null
          rounding_method: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          calculation_method?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          custom_rounding_minutes?: number | null
          effective_from: string
          effective_to?: string | null
          grace_minutes?: number
          id?: string
          is_active?: boolean
          remark?: string | null
          rounding_method?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          calculation_method?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          custom_rounding_minutes?: number | null
          effective_from?: string
          effective_to?: string | null
          grace_minutes?: number
          id?: string
          is_active?: boolean
          remark?: string | null
          rounding_method?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_early_going_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_extended_duty_rules: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          first_day_extra_duty_value: number
          first_day_salary_threshold_time: string
          hourly_ot_custom_rounding_minutes: number | null
          hourly_ot_rounding_method: string
          id: string
          is_active: boolean
          midnight_extra_duty_value: number
          midnight_threshold_time: string
          remark: string | null
          second_day_extra_duty_value: number
          second_day_salary_threshold_time: string
          third_day_salary_threshold_time: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          first_day_extra_duty_value?: number
          first_day_salary_threshold_time?: string
          hourly_ot_custom_rounding_minutes?: number | null
          hourly_ot_rounding_method?: string
          id?: string
          is_active?: boolean
          midnight_extra_duty_value?: number
          midnight_threshold_time?: string
          remark?: string | null
          second_day_extra_duty_value?: number
          second_day_salary_threshold_time?: string
          third_day_salary_threshold_time?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          first_day_extra_duty_value?: number
          first_day_salary_threshold_time?: string
          hourly_ot_custom_rounding_minutes?: number | null
          hourly_ot_rounding_method?: string
          id?: string
          is_active?: boolean
          midnight_extra_duty_value?: number
          midnight_threshold_time?: string
          remark?: string | null
          second_day_extra_duty_value?: number
          second_day_salary_threshold_time?: string
          third_day_salary_threshold_time?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_extended_duty_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_half_day_rules: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          early_going_cutoff_time: string
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          late_arrival_cutoff_time: string
          remark: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          early_going_cutoff_time?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          late_arrival_cutoff_time?: string
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          early_going_cutoff_time?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          late_arrival_cutoff_time?: string
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_half_day_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_information_rules: {
        Row: {
          applicable_on_weekly_off: boolean
          company_id: string
          created_at: string
          created_by: string | null
          cutoff_time: string
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          monthly_limit: number
          remark: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          applicable_on_weekly_off?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          cutoff_time?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          monthly_limit?: number
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          applicable_on_weekly_off?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          cutoff_time?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          monthly_limit?: number
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_information_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_late_rule_thresholds: {
        Row: {
          calculated_minutes: number
          company_id: string
          created_at: string
          from_minutes: number
          id: string
          late_rule_id: string
          sort_order: number
          to_minutes: number | null
          updated_at: string
        }
        Insert: {
          calculated_minutes: number
          company_id: string
          created_at?: string
          from_minutes: number
          id?: string
          late_rule_id: string
          sort_order?: number
          to_minutes?: number | null
          updated_at?: string
        }
        Update: {
          calculated_minutes?: number
          company_id?: string
          created_at?: string
          from_minutes?: number
          id?: string
          late_rule_id?: string
          sort_order?: number
          to_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_late_rule_thresholds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_late_rule_thresholds_late_rule_id_fkey"
            columns: ["late_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_late_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_late_rules: {
        Row: {
          calculation_method: string
          company_id: string
          created_at: string
          created_by: string | null
          custom_rounding_minutes: number | null
          description: string | null
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          maximum_late_minutes: number | null
          minimum_late_minutes: number
          remark: string | null
          rounding_method: string
          rule_code: string
          rule_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          calculation_method?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          custom_rounding_minutes?: number | null
          description?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          maximum_late_minutes?: number | null
          minimum_late_minutes?: number
          remark?: string | null
          rounding_method?: string
          rule_code: string
          rule_name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          calculation_method?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          custom_rounding_minutes?: number | null
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          maximum_late_minutes?: number | null
          minimum_late_minutes?: number
          remark?: string | null
          rounding_method?: string
          rule_code?: string
          rule_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_late_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_night_duty_approval_config: {
        Row: {
          allow_payable_out_override: boolean
          approval_required: boolean
          company_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          remark: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_payable_out_override?: boolean
          approval_required?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_payable_out_override?: boolean
          approval_required?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_night_duty_approval_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_night_duty_approvals: {
        Row: {
          actual_punch_out_at: string
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          attendance_date: string
          attendance_record_id: string
          company_id: string
          created_at: string
          employee_id: string
          extra_duty_value: number
          id: string
          manager_confirmed_payable_out_at: string | null
          manager_remark: string | null
          night_ot_minutes: number
          om_acted_at: string | null
          om_action: string | null
          om_id: string | null
          om_remark: string | null
          shift_end_at: string | null
          store_id: string | null
          super_manager_acted_at: string | null
          super_manager_action: string | null
          super_manager_id: string | null
          super_manager_remark: string | null
          updated_at: string
        }
        Insert: {
          actual_punch_out_at: string
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          attendance_date: string
          attendance_record_id: string
          company_id: string
          created_at?: string
          employee_id: string
          extra_duty_value?: number
          id?: string
          manager_confirmed_payable_out_at?: string | null
          manager_remark?: string | null
          night_ot_minutes?: number
          om_acted_at?: string | null
          om_action?: string | null
          om_id?: string | null
          om_remark?: string | null
          shift_end_at?: string | null
          store_id?: string | null
          super_manager_acted_at?: string | null
          super_manager_action?: string | null
          super_manager_id?: string | null
          super_manager_remark?: string | null
          updated_at?: string
        }
        Update: {
          actual_punch_out_at?: string
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          attendance_date?: string
          attendance_record_id?: string
          company_id?: string
          created_at?: string
          employee_id?: string
          extra_duty_value?: number
          id?: string
          manager_confirmed_payable_out_at?: string | null
          manager_remark?: string | null
          night_ot_minutes?: number
          om_acted_at?: string | null
          om_action?: string | null
          om_id?: string | null
          om_remark?: string | null
          shift_end_at?: string | null
          store_id?: string | null
          super_manager_acted_at?: string | null
          super_manager_action?: string | null
          super_manager_id?: string | null
          super_manager_remark?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_night_duty_approvals_attendance_record_id_fkey"
            columns: ["attendance_record_id"]
            isOneToOne: true
            referencedRelation: "attendance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_night_duty_approvals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_night_duty_approvals_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_night_duty_approvals_om_id_fkey"
            columns: ["om_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_night_duty_approvals_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_night_duty_approvals_super_manager_id_fkey"
            columns: ["super_manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_operations_manager_assignments: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          is_active: boolean
          remark: string | null
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          is_active?: boolean
          remark?: string | null
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean
          remark?: string | null
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_operations_manager_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_operations_manager_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_operations_manager_assignments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_overtime_rule_thresholds: {
        Row: {
          calculated_minutes: number
          company_id: string
          created_at: string
          from_minutes: number
          id: string
          overtime_rule_id: string
          sort_order: number
          to_minutes: number | null
          updated_at: string
        }
        Insert: {
          calculated_minutes: number
          company_id: string
          created_at?: string
          from_minutes: number
          id?: string
          overtime_rule_id: string
          sort_order?: number
          to_minutes?: number | null
          updated_at?: string
        }
        Update: {
          calculated_minutes?: number
          company_id?: string
          created_at?: string
          from_minutes?: number
          id?: string
          overtime_rule_id?: string
          sort_order?: number
          to_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_overtime_rule_thresholds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_overtime_rule_thresholds_overtime_rule_id_fkey"
            columns: ["overtime_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_overtime_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_overtime_rules: {
        Row: {
          calculation_method: string
          company_id: string
          created_at: string
          created_by: string | null
          custom_rounding_minutes: number | null
          description: string | null
          effective_from: string
          effective_to: string | null
          holiday_overtime_allowed: boolean
          id: string
          is_active: boolean
          leave_overtime_allowed: boolean
          maximum_overtime_minutes: number | null
          minimum_overtime_minutes: number
          remark: string | null
          rounding_method: string
          rule_code: string
          rule_name: string
          updated_at: string
          updated_by: string | null
          weekly_off_overtime_allowed: boolean
        }
        Insert: {
          calculation_method?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          custom_rounding_minutes?: number | null
          description?: string | null
          effective_from: string
          effective_to?: string | null
          holiday_overtime_allowed?: boolean
          id?: string
          is_active?: boolean
          leave_overtime_allowed?: boolean
          maximum_overtime_minutes?: number | null
          minimum_overtime_minutes?: number
          remark?: string | null
          rounding_method?: string
          rule_code: string
          rule_name: string
          updated_at?: string
          updated_by?: string | null
          weekly_off_overtime_allowed?: boolean
        }
        Update: {
          calculation_method?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          custom_rounding_minutes?: number | null
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          holiday_overtime_allowed?: boolean
          id?: string
          is_active?: boolean
          leave_overtime_allowed?: boolean
          maximum_overtime_minutes?: number | null
          minimum_overtime_minutes?: number
          remark?: string | null
          rounding_method?: string
          rule_code?: string
          rule_name?: string
          updated_at?: string
          updated_by?: string | null
          weekly_off_overtime_allowed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "attendance_overtime_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_penalty_rule_thresholds: {
        Row: {
          calculated_minutes: number
          company_id: string
          created_at: string
          from_minutes: number
          id: string
          penalty_rule_id: string
          sort_order: number
          to_minutes: number | null
          updated_at: string
        }
        Insert: {
          calculated_minutes: number
          company_id: string
          created_at?: string
          from_minutes: number
          id?: string
          penalty_rule_id: string
          sort_order?: number
          to_minutes?: number | null
          updated_at?: string
        }
        Update: {
          calculated_minutes?: number
          company_id?: string
          created_at?: string
          from_minutes?: number
          id?: string
          penalty_rule_id?: string
          sort_order?: number
          to_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_penalty_rule_thresholds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_penalty_rule_thresholds_penalty_rule_id_fkey"
            columns: ["penalty_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_penalty_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_penalty_rules: {
        Row: {
          applicability: string
          apply_on_information_day: boolean
          apply_on_weekly_off: boolean
          company_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          fixed_minutes: number | null
          id: string
          is_active: boolean
          method: string
          multiplier: number | null
          remark: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          applicability?: string
          apply_on_information_day?: boolean
          apply_on_weekly_off?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          fixed_minutes?: number | null
          id?: string
          is_active?: boolean
          method?: string
          multiplier?: number | null
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          applicability?: string
          apply_on_information_day?: boolean
          apply_on_weekly_off?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          fixed_minutes?: number | null
          id?: string
          is_active?: boolean
          method?: string
          multiplier?: number | null
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_penalty_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          attendance_date: string
          break_deduction_minutes: number | null
          company_id: string
          created_at: string
          created_by: string | null
          early_going_minutes: number | null
          early_going_rule_id: string | null
          employee_id: string
          extended_duty_rule_id: string | null
          extra_duty_value: number | null
          half_day_reason: string | null
          half_day_rule_id: string | null
          id: string
          information_rule_id: string | null
          is_demo: boolean
          late_minutes: number | null
          late_rule_id: string | null
          night_duty_approval_id: string | null
          night_ot_minutes: number | null
          overtime_minutes: number | null
          overtime_rule_id: string | null
          payable_extra_duty_value: number | null
          payable_overtime_minutes: number | null
          payable_working_minutes: number | null
          penalty_minutes: number | null
          penalty_rule_id: string | null
          punch_in_at: string | null
          punch_out_at: string | null
          remarks: string | null
          shift_id: string
          source: Database["public"]["Enums"]["attendance_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          store_id: string
          total_working_minutes: number | null
          updated_at: string
          updated_by: string | null
          used_information: boolean
          working_minutes: number | null
        }
        Insert: {
          attendance_date: string
          break_deduction_minutes?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          early_going_minutes?: number | null
          early_going_rule_id?: string | null
          employee_id: string
          extended_duty_rule_id?: string | null
          extra_duty_value?: number | null
          half_day_reason?: string | null
          half_day_rule_id?: string | null
          id?: string
          information_rule_id?: string | null
          is_demo?: boolean
          late_minutes?: number | null
          late_rule_id?: string | null
          night_duty_approval_id?: string | null
          night_ot_minutes?: number | null
          overtime_minutes?: number | null
          overtime_rule_id?: string | null
          payable_extra_duty_value?: number | null
          payable_overtime_minutes?: number | null
          payable_working_minutes?: number | null
          penalty_minutes?: number | null
          penalty_rule_id?: string | null
          punch_in_at?: string | null
          punch_out_at?: string | null
          remarks?: string | null
          shift_id: string
          source?: Database["public"]["Enums"]["attendance_source"]
          status?: Database["public"]["Enums"]["attendance_status"]
          store_id: string
          total_working_minutes?: number | null
          updated_at?: string
          updated_by?: string | null
          used_information?: boolean
          working_minutes?: number | null
        }
        Update: {
          attendance_date?: string
          break_deduction_minutes?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          early_going_minutes?: number | null
          early_going_rule_id?: string | null
          employee_id?: string
          extended_duty_rule_id?: string | null
          extra_duty_value?: number | null
          half_day_reason?: string | null
          half_day_rule_id?: string | null
          id?: string
          information_rule_id?: string | null
          is_demo?: boolean
          late_minutes?: number | null
          late_rule_id?: string | null
          night_duty_approval_id?: string | null
          night_ot_minutes?: number | null
          overtime_minutes?: number | null
          overtime_rule_id?: string | null
          payable_extra_duty_value?: number | null
          payable_overtime_minutes?: number | null
          payable_working_minutes?: number | null
          penalty_minutes?: number | null
          penalty_rule_id?: string | null
          punch_in_at?: string | null
          punch_out_at?: string | null
          remarks?: string | null
          shift_id?: string
          source?: Database["public"]["Enums"]["attendance_source"]
          status?: Database["public"]["Enums"]["attendance_status"]
          store_id?: string
          total_working_minutes?: number | null
          updated_at?: string
          updated_by?: string | null
          used_information?: boolean
          working_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_early_going_rule_id_fkey"
            columns: ["early_going_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_early_going_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_extended_duty_rule_id_fkey"
            columns: ["extended_duty_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_extended_duty_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_half_day_rule_id_fkey"
            columns: ["half_day_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_half_day_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_information_rule_id_fkey"
            columns: ["information_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_information_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_late_rule_id_fkey"
            columns: ["late_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_late_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_night_duty_approval_id_fkey"
            columns: ["night_duty_approval_id"]
            isOneToOne: false
            referencedRelation: "attendance_night_duty_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_overtime_rule_id_fkey"
            columns: ["overtime_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_overtime_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_penalty_rule_id_fkey"
            columns: ["penalty_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_penalty_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "attendance_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_rule_assignments: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          early_going_rule_id: string | null
          effective_from: string
          effective_to: string | null
          employee_id: string | null
          extended_duty_rule_id: string | null
          half_day_rule_id: string | null
          id: string
          information_rule_id: string | null
          is_active: boolean
          late_rule_id: string | null
          overtime_rule_id: string | null
          penalty_rule_id: string | null
          remark: string | null
          scope_id: string | null
          scope_type: string
          store_id: string | null
          updated_at: string
          updated_by: string | null
          weekly_off_late_rule_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          early_going_rule_id?: string | null
          effective_from: string
          effective_to?: string | null
          employee_id?: string | null
          extended_duty_rule_id?: string | null
          half_day_rule_id?: string | null
          id?: string
          information_rule_id?: string | null
          is_active?: boolean
          late_rule_id?: string | null
          overtime_rule_id?: string | null
          penalty_rule_id?: string | null
          remark?: string | null
          scope_id?: string | null
          scope_type: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
          weekly_off_late_rule_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          early_going_rule_id?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id?: string | null
          extended_duty_rule_id?: string | null
          half_day_rule_id?: string | null
          id?: string
          information_rule_id?: string | null
          is_active?: boolean
          late_rule_id?: string | null
          overtime_rule_id?: string | null
          penalty_rule_id?: string | null
          remark?: string | null
          scope_id?: string | null
          scope_type?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
          weekly_off_late_rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_rule_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_early_going_rule_id_fkey"
            columns: ["early_going_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_early_going_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_extended_duty_rule_id_fkey"
            columns: ["extended_duty_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_extended_duty_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_half_day_rule_id_fkey"
            columns: ["half_day_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_half_day_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_information_rule_id_fkey"
            columns: ["information_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_information_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_late_rule_id_fkey"
            columns: ["late_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_late_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_overtime_rule_id_fkey"
            columns: ["overtime_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_overtime_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_penalty_rule_id_fkey"
            columns: ["penalty_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_penalty_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_rule_assignments_weekly_off_late_rule_id_fkey"
            columns: ["weekly_off_late_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_weekly_off_late_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_shift_stores: {
        Row: {
          created_at: string
          id: string
          shift_id: string
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          shift_id: string
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          shift_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_shift_stores_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "attendance_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_shift_stores_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_shifts: {
        Row: {
          break_minutes: number
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          end_time: string
          grace_minutes: number
          id: string
          is_active: boolean
          late_eligible: boolean
          minimum_work_minutes: number
          name: string
          overtime_enabled: boolean
          shift_code: string | null
          start_time: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          break_minutes?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time: string
          grace_minutes?: number
          id?: string
          is_active?: boolean
          late_eligible?: boolean
          minimum_work_minutes?: number
          name: string
          overtime_enabled?: boolean
          shift_code?: string | null
          start_time: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          break_minutes?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time?: string
          grace_minutes?: number
          id?: string
          is_active?: boolean
          late_eligible?: boolean
          minimum_work_minutes?: number
          name?: string
          overtime_enabled?: boolean
          shift_code?: string | null
          start_time?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_shifts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_super_managers: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          is_active: boolean
          remark: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          is_active?: boolean
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_super_managers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_super_managers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_weekly_off_late_rules: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          cutoff_time: string
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          remark: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          cutoff_time?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          cutoff_time?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_weekly_off_late_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          changed_data: Json | null
          id: string
          performed_at: string
          performed_by: string | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          changed_data?: Json | null
          id?: string
          performed_at?: string
          performed_by?: string | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          changed_data?: Json | null
          id?: string
          performed_at?: string
          performed_by?: string | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          email: string | null
          gst_number: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          name: string
          phone: string | null
          registration_number: string | null
          state: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name: string
          phone?: string | null
          registration_number?: string | null
          state?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name?: string
          phone?: string | null
          registration_number?: string | null
          state?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      department_daily_metrics: {
        Row: {
          company_id: string
          created_at: string
          department_id: string
          entry_date: string
          id: string
          metric_id: string
          store_id: string
          value: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          department_id: string
          entry_date: string
          id?: string
          metric_id: string
          store_id: string
          value?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          department_id?: string
          entry_date?: string
          id?: string
          metric_id?: string
          store_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "department_daily_metrics_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_daily_metrics_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_daily_metrics_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_daily_metrics_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_daily_metrics: {
        Row: {
          company_id: string
          created_at: string
          employee_id: string
          entry_date: string
          id: string
          metric_id: string
          value: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          employee_id: string
          entry_date: string
          id?: string
          metric_id: string
          value?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          employee_id?: string
          entry_date?: string
          id?: string
          metric_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_daily_metrics_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_daily_metrics_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_daily_metrics_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_documents: {
        Row: {
          company_id: string
          created_at: string
          document_number: string | null
          document_type: Database["public"]["Enums"]["employee_document_type"]
          employee_id: string
          expiry_date: string | null
          file_name: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          notes: string | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          document_number?: string | null
          document_type: Database["public"]["Enums"]["employee_document_type"]
          employee_id: string
          expiry_date?: string | null
          file_name: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          document_number?: string | null
          document_type?: Database["public"]["Enums"]["employee_document_type"]
          employee_id?: string
          expiry_date?: string | null
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_import_batches: {
        Row: {
          company_id: string
          error_rows: number
          errors: Json | null
          file_name: string
          id: string
          imported_rows: number
          performed_at: string
          performed_by: string | null
          skipped_rows: number
          total_rows: number
          valid_rows: number
        }
        Insert: {
          company_id: string
          error_rows?: number
          errors?: Json | null
          file_name: string
          id?: string
          imported_rows?: number
          performed_at?: string
          performed_by?: string | null
          skipped_rows?: number
          total_rows?: number
          valid_rows?: number
        }
        Update: {
          company_id?: string
          error_rows?: number
          errors?: Json | null
          file_name?: string
          id?: string
          imported_rows?: number
          performed_at?: string
          performed_by?: string | null
          skipped_rows?: number
          total_rows?: number
          valid_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_import_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_information_usage: {
        Row: {
          attendance_date: string
          company_id: string
          created_at: string
          employee_id: string
          id: string
          remark: string | null
          used_by: string | null
        }
        Insert: {
          attendance_date: string
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          remark?: string | null
          used_by?: string | null
        }
        Update: {
          attendance_date?: string
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          remark?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_information_usage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_information_usage_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_kpi_assignment: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          is_active: boolean
          kpi_id: string
          role_id: string | null
          source: Database["public"]["Enums"]["kpi_assignment_source"]
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          is_active?: boolean
          kpi_id: string
          role_id?: string | null
          source?: Database["public"]["Enums"]["kpi_assignment_source"]
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean
          kpi_id?: string
          role_id?: string | null
          source?: Database["public"]["Enums"]["kpi_assignment_source"]
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_kpi_assignment_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_kpi_assignment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_kpi_assignment_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_kpi_assignment_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_kpi_assignment_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_kpi_assignment_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_notes: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          note: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          note: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_promotions: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          from_store_designation_id: string | null
          id: string
          promotion_date: string
          remarks: string | null
          to_store_designation_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          from_store_designation_id?: string | null
          id?: string
          promotion_date?: string
          remarks?: string | null
          to_store_designation_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          from_store_designation_id?: string | null
          id?: string
          promotion_date?: string
          remarks?: string | null
          to_store_designation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_promotions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_promotions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_promotions_from_store_designation_id_fkey"
            columns: ["from_store_designation_id"]
            isOneToOne: false
            referencedRelation: "store_designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_promotions_to_store_designation_id_fkey"
            columns: ["to_store_designation_id"]
            isOneToOne: false
            referencedRelation: "store_designations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_role_history: {
        Row: {
          action: string
          assigned_by: string | null
          assigned_date: string | null
          company_id: string
          created_at: string
          employee_id: string
          employee_role_id: string
          id: string
          reason: string | null
          removed_by: string | null
          removed_date: string | null
          role_id: string
          status_id: string | null
          store_id: string
        }
        Insert: {
          action: string
          assigned_by?: string | null
          assigned_date?: string | null
          company_id: string
          created_at?: string
          employee_id: string
          employee_role_id: string
          id?: string
          reason?: string | null
          removed_by?: string | null
          removed_date?: string | null
          role_id: string
          status_id?: string | null
          store_id: string
        }
        Update: {
          action?: string
          assigned_by?: string | null
          assigned_date?: string | null
          company_id?: string
          created_at?: string
          employee_id?: string
          employee_role_id?: string
          id?: string
          reason?: string | null
          removed_by?: string | null
          removed_date?: string | null
          role_id?: string
          status_id?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_role_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_role_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_role_history_employee_role_id_fkey"
            columns: ["employee_role_id"]
            isOneToOne: false
            referencedRelation: "employee_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_role_history_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_role_history_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "role_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_role_history_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_role_metrics: {
        Row: {
          calculated_at: string
          company_id: string
          created_at: string
          employee_id: string
          entry_count: number
          id: string
          metric_id: string
          period_end: string
          period_start: string
          role_id: string
          total_value: number | null
        }
        Insert: {
          calculated_at?: string
          company_id: string
          created_at?: string
          employee_id: string
          entry_count?: number
          id?: string
          metric_id: string
          period_end: string
          period_start: string
          role_id: string
          total_value?: number | null
        }
        Update: {
          calculated_at?: string
          company_id?: string
          created_at?: string
          employee_id?: string
          entry_count?: number
          id?: string
          metric_id?: string
          period_end?: string
          period_start?: string
          role_id?: string
          total_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_role_metrics_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_role_metrics_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_role_metrics_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_role_metrics_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          effective_date: string
          employee_id: string
          end_date: string | null
          id: string
          reason: string | null
          remarks: string | null
          removed_at: string | null
          removed_by: string | null
          role_id: string
          status_id: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_date?: string
          employee_id: string
          end_date?: string | null
          id?: string
          reason?: string | null
          remarks?: string | null
          removed_at?: string | null
          removed_by?: string | null
          role_id: string
          status_id: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string
          employee_id?: string
          end_date?: string | null
          id?: string
          reason?: string | null
          remarks?: string | null
          removed_at?: string | null
          removed_by?: string | null
          role_id?: string
          status_id?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_roles_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_roles_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_roles_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "role_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_roles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_salary_components: {
        Row: {
          basic_salary: number
          company_id: string
          created_at: string
          created_by: string | null
          da: number
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          remark: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          basic_salary: number
          company_id: string
          created_at?: string
          created_by?: string | null
          da?: number
          effective_from: string
          effective_to?: string | null
          employee_id: string
          id?: string
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          basic_salary?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          da?: number
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_salary_components_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_salary_components_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_shift_assignments: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          is_active: boolean
          remark: string | null
          shift_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id: string
          id?: string
          is_active?: boolean
          remark?: string | null
          shift_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean
          remark?: string | null
          shift_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_shift_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_shift_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_shift_assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "attendance_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_task_assignment: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string
          due_time: string | null
          employee_id: string
          id: string
          is_active: boolean
          priority: Database["public"]["Enums"]["task_priority"]
          role_id: string | null
          status_id: string
          store_id: string
          task_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          due_time?: string | null
          employee_id: string
          id?: string
          is_active?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          role_id?: string | null
          status_id: string
          store_id: string
          task_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          due_time?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          role_id?: string | null
          status_id?: string
          store_id?: string
          task_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_task_assignment_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_task_assignment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_task_assignment_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_task_assignment_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_task_assignment_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "task_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_task_assignment_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_task_assignment_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_master"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_transfers: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          from_store_designation_id: string | null
          from_store_id: string | null
          id: string
          reason: string | null
          to_store_designation_id: string | null
          to_store_id: string | null
          transfer_date: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          from_store_designation_id?: string | null
          from_store_id?: string | null
          id?: string
          reason?: string | null
          to_store_designation_id?: string | null
          to_store_id?: string | null
          transfer_date?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          from_store_designation_id?: string | null
          from_store_id?: string | null
          id?: string
          reason?: string | null
          to_store_designation_id?: string | null
          to_store_id?: string | null
          transfer_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_transfers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_transfers_from_store_designation_id_fkey"
            columns: ["from_store_designation_id"]
            isOneToOne: false
            referencedRelation: "store_designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_transfers_from_store_id_fkey"
            columns: ["from_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_transfers_to_store_designation_id_fkey"
            columns: ["to_store_designation_id"]
            isOneToOne: false
            referencedRelation: "store_designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_transfers_to_store_id_fkey"
            columns: ["to_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_weekly_off_history: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          is_active: boolean
          remark: string | null
          updated_at: string
          updated_by: string | null
          weekly_off_day: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id: string
          id?: string
          is_active?: boolean
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
          weekly_off_day: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
          weekly_off_day?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_weekly_off_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_weekly_off_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          alternate_mobile: string | null
          auth_user_id: string | null
          blood_group: string | null
          company_id: string
          confirmation_date: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          email: string | null
          employee_code: string | null
          employee_scope: string
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          first_name: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: string
          is_active: boolean
          joining_date: string | null
          last_name: string | null
          middle_name: string | null
          mobile: string | null
          phone: string | null
          photo_url: string | null
          reporting_manager_id: string | null
          salary_type: Database["public"]["Enums"]["salary_type"] | null
          status: Database["public"]["Enums"]["employee_status"]
          store_department_id: string | null
          store_designation_id: string | null
          store_id: string | null
          store_team_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alternate_mobile?: string | null
          auth_user_id?: string | null
          blood_group?: string | null
          company_id: string
          confirmation_date?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          employee_code?: string | null
          employee_scope?: string
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          first_name?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          is_active?: boolean
          joining_date?: string | null
          last_name?: string | null
          middle_name?: string | null
          mobile?: string | null
          phone?: string | null
          photo_url?: string | null
          reporting_manager_id?: string | null
          salary_type?: Database["public"]["Enums"]["salary_type"] | null
          status?: Database["public"]["Enums"]["employee_status"]
          store_department_id?: string | null
          store_designation_id?: string | null
          store_id?: string | null
          store_team_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alternate_mobile?: string | null
          auth_user_id?: string | null
          blood_group?: string | null
          company_id?: string
          confirmation_date?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          employee_code?: string | null
          employee_scope?: string
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          first_name?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          is_active?: boolean
          joining_date?: string | null
          last_name?: string | null
          middle_name?: string | null
          mobile?: string | null
          phone?: string | null
          photo_url?: string | null
          reporting_manager_id?: string | null
          salary_type?: Database["public"]["Enums"]["salary_type"] | null
          status?: Database["public"]["Enums"]["employee_status"]
          store_department_id?: string | null
          store_designation_id?: string | null
          store_id?: string | null
          store_team_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_store_department_id_fkey"
            columns: ["store_department_id"]
            isOneToOne: false
            referencedRelation: "store_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_store_designation_id_fkey"
            columns: ["store_designation_id"]
            isOneToOne: false
            referencedRelation: "store_designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_store_team_id_fkey"
            columns: ["store_team_id"]
            isOneToOne: false
            referencedRelation: "store_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      future_ai_metrics: {
        Row: {
          company_id: string | null
          created_at: string
          employee_id: string | null
          event_type: string | null
          id: string
          metric_id: string | null
          payload: Json | null
          store_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          employee_id?: string | null
          event_type?: string | null
          id?: string
          metric_id?: string | null
          payload?: Json | null
          store_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          employee_id?: string | null
          event_type?: string | null
          id?: string
          metric_id?: string | null
          payload?: Json | null
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "future_ai_metrics_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_ai_metrics_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_ai_metrics_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_ai_metrics_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      future_performance_history: {
        Row: {
          created_at: string
          employee_id: string
          event_type: string | null
          id: string
          payload: Json | null
          performance_cycle_id: string | null
        }
        Insert: {
          created_at?: string
          employee_id: string
          event_type?: string | null
          id?: string
          payload?: Json | null
          performance_cycle_id?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string
          event_type?: string | null
          id?: string
          payload?: Json | null
          performance_cycle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "future_performance_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_performance_history_performance_cycle_id_fkey"
            columns: ["performance_cycle_id"]
            isOneToOne: false
            referencedRelation: "performance_cycle"
            referencedColumns: ["id"]
          },
        ]
      }
      future_role_kpi_mapping: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kpi_key: string | null
          kpi_target: number | null
          role_id: string
          weight: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kpi_key?: string | null
          kpi_target?: number | null
          role_id: string
          weight?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kpi_key?: string | null
          kpi_target?: number | null
          role_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "future_role_kpi_mapping_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      future_task_performance_mapping: {
        Row: {
          created_at: string
          employee_task_assignment_id: string
          event_type: string | null
          id: string
          payload: Json | null
        }
        Insert: {
          created_at?: string
          employee_task_assignment_id: string
          event_type?: string | null
          id?: string
          payload?: Json | null
        }
        Update: {
          created_at?: string
          employee_task_assignment_id?: string
          event_type?: string | null
          id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "future_task_performance_mappin_employee_task_assignment_id_fkey"
            columns: ["employee_task_assignment_id"]
            isOneToOne: false
            referencedRelation: "employee_task_assignment"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          holiday_date: string
          id: string
          is_optional: boolean
          name: string
          remark: string | null
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          holiday_date: string
          id?: string
          is_optional?: boolean
          name: string
          remark?: string | null
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          id?: string
          is_optional?: boolean
          name?: string
          remark?: string | null
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holidays_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_actual: {
        Row: {
          actual_value: number
          company_id: string
          created_at: string
          data_source: string
          employee_id: string
          entered_by: string | null
          id: string
          kpi_id: string
          notes: string | null
          period_end: string
          period_start: string
          store_id: string
        }
        Insert: {
          actual_value: number
          company_id: string
          created_at?: string
          data_source?: string
          employee_id: string
          entered_by?: string | null
          id?: string
          kpi_id: string
          notes?: string | null
          period_end: string
          period_start: string
          store_id: string
        }
        Update: {
          actual_value?: number
          company_id?: string
          created_at?: string
          data_source?: string
          employee_id?: string
          entered_by?: string | null
          id?: string
          kpi_id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_actual_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_actual_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_actual_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_actual_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_actual_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_categories: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      kpi_master: {
        Row: {
          calculation_type: Database["public"]["Enums"]["kpi_calculation_type"]
          category_id: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          data_source: string
          description: string | null
          display_order: number
          formula_type: Database["public"]["Enums"]["kpi_formula_type"]
          id: string
          is_active: boolean
          is_system_kpi: boolean
          kpi_code: string
          kpi_name: string
          measurement_unit: Database["public"]["Enums"]["kpi_measurement_unit"]
          target_type: Database["public"]["Enums"]["kpi_target_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          calculation_type?: Database["public"]["Enums"]["kpi_calculation_type"]
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          data_source?: string
          description?: string | null
          display_order?: number
          formula_type?: Database["public"]["Enums"]["kpi_formula_type"]
          id?: string
          is_active?: boolean
          is_system_kpi?: boolean
          kpi_code: string
          kpi_name: string
          measurement_unit?: Database["public"]["Enums"]["kpi_measurement_unit"]
          target_type?: Database["public"]["Enums"]["kpi_target_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          calculation_type?: Database["public"]["Enums"]["kpi_calculation_type"]
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          data_source?: string
          description?: string | null
          display_order?: number
          formula_type?: Database["public"]["Enums"]["kpi_formula_type"]
          id?: string
          is_active?: boolean
          is_system_kpi?: boolean
          kpi_code?: string
          kpi_name?: string
          measurement_unit?: Database["public"]["Enums"]["kpi_measurement_unit"]
          target_type?: Database["public"]["Enums"]["kpi_target_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_master_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "kpi_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_master_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_result: {
        Row: {
          achievement_percentage: number | null
          actual_value: number | null
          calculated_at: string
          calculated_by: string | null
          company_id: string
          created_at: string
          employee_id: string
          id: string
          kpi_id: string
          performance_cycle_id: string | null
          role_id: string | null
          score: number | null
          target_value: number | null
          weightage: number | null
          weighted_score: number | null
        }
        Insert: {
          achievement_percentage?: number | null
          actual_value?: number | null
          calculated_at?: string
          calculated_by?: string | null
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          kpi_id: string
          performance_cycle_id?: string | null
          role_id?: string | null
          score?: number | null
          target_value?: number | null
          weightage?: number | null
          weighted_score?: number | null
        }
        Update: {
          achievement_percentage?: number | null
          actual_value?: number | null
          calculated_at?: string
          calculated_by?: string | null
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          kpi_id?: string
          performance_cycle_id?: string | null
          role_id?: string | null
          score?: number | null
          target_value?: number | null
          weightage?: number | null
          weighted_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_result_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_result_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_result_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_result_performance_cycle_id_fkey"
            columns: ["performance_cycle_id"]
            isOneToOne: false
            referencedRelation: "performance_cycle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_result_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_scoring_rules: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          display_order: number
          formula: string | null
          id: string
          is_active: boolean
          kpi_id: string
          max_value: number | null
          min_value: number | null
          rule_type: Database["public"]["Enums"]["kpi_formula_type"]
          score_value: number | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number
          formula?: string | null
          id?: string
          is_active?: boolean
          kpi_id: string
          max_value?: number | null
          min_value?: number | null
          rule_type: Database["public"]["Enums"]["kpi_formula_type"]
          score_value?: number | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number
          formula?: string | null
          id?: string
          is_active?: boolean
          kpi_id?: string
          max_value?: number | null
          min_value?: number | null
          rule_type?: Database["public"]["Enums"]["kpi_formula_type"]
          score_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_scoring_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_scoring_rules_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_master"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_target: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          department_id: string | null
          effective_date: string
          employee_id: string | null
          expiry_date: string | null
          id: string
          is_active: boolean
          kpi_id: string
          role_id: string | null
          store_id: string | null
          target_value: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          effective_date?: string
          employee_id?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          kpi_id: string
          role_id?: string | null
          store_id?: string | null
          target_value: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          effective_date?: string
          employee_id?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          kpi_id?: string
          role_id?: string | null
          store_id?: string | null
          target_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_target_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_target_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_target_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_target_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_target_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_target_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_weightage: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          effective_date: string
          expiry_date: string | null
          id: string
          is_active: boolean
          role_kpi_mapping_id: string
          weightage: number
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          effective_date?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          role_kpi_mapping_id: string
          weightage: number
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          effective_date?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          role_kpi_mapping_id?: string
          weightage?: number
        }
        Relationships: [
          {
            foreignKeyName: "kpi_weightage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_weightage_role_kpi_mapping_id_fkey"
            columns: ["role_kpi_mapping_id"]
            isOneToOne: false
            referencedRelation: "role_kpi_mapping"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_accrual_periods: {
        Row: {
          accrual_amount: number
          created_at: string
          created_by: string | null
          id: string
          period_end_month: number
          period_start_month: number
          policy_type_config_id: string
          remark: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accrual_amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          period_end_month: number
          period_start_month: number
          policy_type_config_id: string
          remark?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accrual_amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          period_end_month?: number
          period_start_month?: number
          policy_type_config_id?: string
          remark?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_accrual_periods_policy_type_config_id_fkey"
            columns: ["policy_type_config_id"]
            isOneToOne: false
            referencedRelation: "leave_policy_type_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_application_documents: {
        Row: {
          created_at: string
          created_by: string | null
          file_name: string
          file_size_bytes: number | null
          id: string
          leave_application_id: string
          mime_type: string | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_name: string
          file_size_bytes?: number | null
          id?: string
          leave_application_id: string
          mime_type?: string | null
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          leave_application_id?: string
          mime_type?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_application_documents_leave_application_id_fkey"
            columns: ["leave_application_id"]
            isOneToOne: false
            referencedRelation: "leave_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_applications: {
        Row: {
          applied_at: string
          company_id: string
          created_at: string
          created_by: string | null
          current_step: number
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          financial_year_id: string
          from_date: string
          half_day_session: string | null
          id: string
          is_half_day: boolean
          leave_type_id: string
          policy_id: string
          reason: string | null
          remarks: string | null
          short_or_long: string | null
          status: string
          to_date: string
          total_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          applied_at?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          current_step?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_remark?: string | null
          employee_id: string
          financial_year_id: string
          from_date: string
          half_day_session?: string | null
          id?: string
          is_half_day?: boolean
          leave_type_id: string
          policy_id: string
          reason?: string | null
          remarks?: string | null
          short_or_long?: string | null
          status?: string
          to_date: string
          total_days: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          applied_at?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          current_step?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_remark?: string | null
          employee_id?: string
          financial_year_id?: string
          from_date?: string
          half_day_session?: string | null
          id?: string
          is_half_day?: boolean
          leave_type_id?: string
          policy_id?: string
          reason?: string | null
          remarks?: string | null
          short_or_long?: string | null
          status?: string
          to_date?: string
          total_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_applications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_applications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_applications_financial_year_id_fkey"
            columns: ["financial_year_id"]
            isOneToOne: false
            referencedRelation: "leave_financial_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_applications_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_applications_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "leave_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_approval_actions: {
        Row: {
          acted_at: string
          action: string
          approver_employee_id: string
          approver_role: string
          created_at: string
          id: string
          leave_application_id: string
          remark: string | null
          step_order: number
        }
        Insert: {
          acted_at?: string
          action: string
          approver_employee_id: string
          approver_role: string
          created_at?: string
          id?: string
          leave_application_id: string
          remark?: string | null
          step_order: number
        }
        Update: {
          acted_at?: string
          action?: string
          approver_employee_id?: string
          approver_role?: string
          created_at?: string
          id?: string
          leave_application_id?: string
          remark?: string | null
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_approval_actions_approver_employee_id_fkey"
            columns: ["approver_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_approval_actions_leave_application_id_fkey"
            columns: ["leave_application_id"]
            isOneToOne: false
            referencedRelation: "leave_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_encashment_rules: {
        Row: {
          created_at: string
          created_by: string | null
          divisor_custom_value: number | null
          divisor_type: string
          enabled: boolean
          id: string
          policy_id: string
          remark: string | null
          salary_base_type: string
          salary_threshold: number | null
          threshold_base_type: string
          threshold_comparison: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          divisor_custom_value?: number | null
          divisor_type?: string
          enabled?: boolean
          id?: string
          policy_id: string
          remark?: string | null
          salary_base_type?: string
          salary_threshold?: number | null
          threshold_base_type?: string
          threshold_comparison?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          divisor_custom_value?: number | null
          divisor_type?: string
          enabled?: boolean
          id?: string
          policy_id?: string
          remark?: string | null
          salary_base_type?: string
          salary_threshold?: number | null
          threshold_base_type?: string
          threshold_comparison?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_encashment_rules_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: true
            referencedRelation: "leave_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_financial_years: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          label: string
          remark: string | null
          start_date: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          label: string
          remark?: string | null
          start_date: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          label?: string
          remark?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_financial_years_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_fy_closing_batches: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          financial_year_id: string
          id: string
          initiated_at: string
          initiated_by: string
          next_financial_year_id: string | null
          remark: string | null
          status: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          financial_year_id: string
          id?: string
          initiated_at?: string
          initiated_by: string
          next_financial_year_id?: string | null
          remark?: string | null
          status?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          financial_year_id?: string
          id?: string
          initiated_at?: string
          initiated_by?: string
          next_financial_year_id?: string | null
          remark?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_fy_closing_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_fy_closing_batches_financial_year_id_fkey"
            columns: ["financial_year_id"]
            isOneToOne: false
            referencedRelation: "leave_financial_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_fy_closing_batches_next_financial_year_id_fkey"
            columns: ["next_financial_year_id"]
            isOneToOne: false
            referencedRelation: "leave_financial_years"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_fy_closing_lines: {
        Row: {
          available: number
          basic_salary_snapshot: number | null
          batch_id: string
          carry_forward_days: number
          created_at: string
          da_snapshot: number | null
          daily_rate: number | null
          divisor_snapshot: number | null
          earned: number
          employee_id: string
          encashment_amount: number | null
          encashment_days: number
          final_status: string
          id: string
          lapse_days: number
          leave_type_id: string
          opening: number
          pending: number
          policy_id: string | null
          policy_version: number | null
          salary_base_snapshot: number | null
          used: number
        }
        Insert: {
          available?: number
          basic_salary_snapshot?: number | null
          batch_id: string
          carry_forward_days?: number
          created_at?: string
          da_snapshot?: number | null
          daily_rate?: number | null
          divisor_snapshot?: number | null
          earned?: number
          employee_id: string
          encashment_amount?: number | null
          encashment_days?: number
          final_status: string
          id?: string
          lapse_days?: number
          leave_type_id: string
          opening?: number
          pending?: number
          policy_id?: string | null
          policy_version?: number | null
          salary_base_snapshot?: number | null
          used?: number
        }
        Update: {
          available?: number
          basic_salary_snapshot?: number | null
          batch_id?: string
          carry_forward_days?: number
          created_at?: string
          da_snapshot?: number | null
          daily_rate?: number | null
          divisor_snapshot?: number | null
          earned?: number
          employee_id?: string
          encashment_amount?: number | null
          encashment_days?: number
          final_status?: string
          id?: string
          lapse_days?: number
          leave_type_id?: string
          opening?: number
          pending?: number
          policy_id?: string | null
          policy_version?: number | null
          salary_base_snapshot?: number | null
          used?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_fy_closing_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "leave_fy_closing_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_fy_closing_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_fy_closing_lines_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_ledger: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          days: number
          employee_id: string
          financial_year_id: string
          id: string
          leave_type_id: string
          reference_id: string | null
          reference_type: string | null
          remark: string | null
          transaction_date: string
          transaction_type: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          days: number
          employee_id: string
          financial_year_id: string
          id?: string
          leave_type_id: string
          reference_id?: string | null
          reference_type?: string | null
          remark?: string | null
          transaction_date: string
          transaction_type: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          days?: number
          employee_id?: string
          financial_year_id?: string
          id?: string
          leave_type_id?: string
          reference_id?: string | null
          reference_type?: string | null
          remark?: string | null
          transaction_date?: string
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_ledger_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_ledger_financial_year_id_fkey"
            columns: ["financial_year_id"]
            isOneToOne: false
            referencedRelation: "leave_financial_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_ledger_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_notification_settings: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          email_enabled: boolean
          event_type: string
          id: string
          in_app_enabled: boolean
          push_enabled: boolean
          sms_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          email_enabled?: boolean
          event_type: string
          id?: string
          in_app_enabled?: boolean
          push_enabled?: boolean
          sms_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          email_enabled?: boolean
          event_type?: string
          id?: string
          in_app_enabled?: boolean
          push_enabled?: boolean
          sms_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_notification_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_policies: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          change_reason: string | null
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          financial_year_id: string
          id: string
          name: string
          previous_version_id: string | null
          remark: string | null
          status: string
          updated_at: string
          updated_by: string | null
          version_number: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          change_reason?: string | null
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          financial_year_id: string
          id?: string
          name: string
          previous_version_id?: string | null
          remark?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          version_number?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          change_reason?: string | null
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          financial_year_id?: string
          id?: string
          name?: string
          previous_version_id?: string | null
          remark?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_policies_financial_year_id_fkey"
            columns: ["financial_year_id"]
            isOneToOne: false
            referencedRelation: "leave_financial_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_policies_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "leave_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_policy_assignments: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          employee_id: string | null
          employment_type: string | null
          id: string
          is_active: boolean
          policy_id: string
          remark: string | null
          scope_type: string
          store_department_id: string | null
          store_designation_id: string | null
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          employee_id?: string | null
          employment_type?: string | null
          id?: string
          is_active?: boolean
          policy_id: string
          remark?: string | null
          scope_type: string
          store_department_id?: string | null
          store_designation_id?: string | null
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id?: string | null
          employment_type?: string | null
          id?: string
          is_active?: boolean
          policy_id?: string
          remark?: string | null
          scope_type?: string
          store_department_id?: string | null
          store_designation_id?: string | null
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_policy_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_policy_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_policy_assignments_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "leave_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_policy_assignments_store_department_id_fkey"
            columns: ["store_department_id"]
            isOneToOne: false
            referencedRelation: "store_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_policy_assignments_store_designation_id_fkey"
            columns: ["store_designation_id"]
            isOneToOne: false
            referencedRelation: "store_designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_policy_assignments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_policy_type_configs: {
        Row: {
          accrual_enabled: boolean
          accrual_frequency: string
          carry_forward_allowed: boolean
          carry_forward_expiry_months: number | null
          carry_forward_expiry_type: string
          carry_forward_max_days: number | null
          created_at: string
          created_by: string | null
          encashment_allowed: boolean
          holiday_count_rule: string
          id: string
          lapse_allowed: boolean
          leave_type_id: string
          negative_balance_allowed: boolean
          policy_id: string
          probation_eligible: boolean
          remark: string | null
          sandwich_rule_enabled: boolean
          updated_at: string
          updated_by: string | null
          weekly_off_count_rule: string
        }
        Insert: {
          accrual_enabled?: boolean
          accrual_frequency?: string
          carry_forward_allowed?: boolean
          carry_forward_expiry_months?: number | null
          carry_forward_expiry_type?: string
          carry_forward_max_days?: number | null
          created_at?: string
          created_by?: string | null
          encashment_allowed?: boolean
          holiday_count_rule?: string
          id?: string
          lapse_allowed?: boolean
          leave_type_id: string
          negative_balance_allowed?: boolean
          policy_id: string
          probation_eligible?: boolean
          remark?: string | null
          sandwich_rule_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
          weekly_off_count_rule?: string
        }
        Update: {
          accrual_enabled?: boolean
          accrual_frequency?: string
          carry_forward_allowed?: boolean
          carry_forward_expiry_months?: number | null
          carry_forward_expiry_type?: string
          carry_forward_max_days?: number | null
          created_at?: string
          created_by?: string | null
          encashment_allowed?: boolean
          holiday_count_rule?: string
          id?: string
          lapse_allowed?: boolean
          leave_type_id?: string
          negative_balance_allowed?: boolean
          policy_id?: string
          probation_eligible?: boolean
          remark?: string | null
          sandwich_rule_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
          weekly_off_count_rule?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_policy_type_configs_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_policy_type_configs_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "leave_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_prior_notice_exceptions: {
        Row: {
          company_id: string
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          exception_behavior: string
          from_date: string
          id: string
          leave_application_id: string | null
          leave_type_id: string
          reason: string
          requested_at: string
          requested_by: string
          status: string
          to_date: string
        }
        Insert: {
          company_id: string
          decided_at?: string | null
          decided_by?: string | null
          decision_remark?: string | null
          employee_id: string
          exception_behavior: string
          from_date: string
          id?: string
          leave_application_id?: string | null
          leave_type_id: string
          reason: string
          requested_at?: string
          requested_by: string
          status?: string
          to_date: string
        }
        Update: {
          company_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_remark?: string | null
          employee_id?: string
          exception_behavior?: string
          from_date?: string
          id?: string
          leave_application_id?: string | null
          leave_type_id?: string
          reason?: string
          requested_at?: string
          requested_by?: string
          status?: string
          to_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_prior_notice_exceptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_prior_notice_exceptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_prior_notice_exceptions_leave_application_id_fkey"
            columns: ["leave_application_id"]
            isOneToOne: false
            referencedRelation: "leave_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_prior_notice_exceptions_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_prior_notice_rules: {
        Row: {
          created_at: string
          created_by: string | null
          exception_behavior: string
          id: string
          notice_days: number
          policy_id: string
          remark: string | null
          required: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          exception_behavior?: string
          id?: string
          notice_days?: number
          policy_id: string
          remark?: string | null
          required?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          exception_behavior?: string
          id?: string
          notice_days?: number
          policy_id?: string
          remark?: string | null
          required?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_prior_notice_rules_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: true
            referencedRelation: "leave_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_pro_rata_rules: {
        Row: {
          basis: string
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          policy_type_config_id: string
          remark: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          basis?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          policy_type_config_id: string
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          basis?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          policy_type_config_id?: string
          remark?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_pro_rata_rules_policy_type_config_id_fkey"
            columns: ["policy_type_config_id"]
            isOneToOne: true
            referencedRelation: "leave_policy_type_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_probation_rules: {
        Row: {
          created_at: string
          created_by: string | null
          duration_unit: string
          duration_value: number
          extra_leave_during_probation: number
          id: string
          policy_id: string
          post_probation_start_rule: string
          remark: string | null
          specific_start_date: string | null
          updated_at: string
          updated_by: string | null
          weekly_off_during_probation: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duration_unit?: string
          duration_value?: number
          extra_leave_during_probation?: number
          id?: string
          policy_id: string
          post_probation_start_rule?: string
          remark?: string | null
          specific_start_date?: string | null
          updated_at?: string
          updated_by?: string | null
          weekly_off_during_probation?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duration_unit?: string
          duration_value?: number
          extra_leave_during_probation?: number
          id?: string
          policy_id?: string
          post_probation_start_rule?: string
          remark?: string | null
          specific_start_date?: string | null
          updated_at?: string
          updated_by?: string | null
          weekly_off_during_probation?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "leave_probation_rules_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: true
            referencedRelation: "leave_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_short_long_rules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          policy_id: string
          remark: string | null
          threshold_days: number
          threshold_operator: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          policy_id: string
          remark?: string | null
          threshold_days?: number
          threshold_operator?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          policy_id?: string
          remark?: string | null
          threshold_days?: number
          threshold_operator?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_short_long_rules_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: true
            referencedRelation: "leave_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          document_required: boolean
          half_day_allowed: boolean
          id: string
          is_active: boolean
          is_paid: boolean
          minimum_unit: number
          name: string
          quarter_day_allowed: boolean
          remark: string | null
          requires_reason: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          document_required?: boolean
          half_day_allowed?: boolean
          id?: string
          is_active?: boolean
          is_paid?: boolean
          minimum_unit?: number
          name: string
          quarter_day_allowed?: boolean
          remark?: string | null
          requires_reason?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          document_required?: boolean
          half_day_allowed?: boolean
          id?: string
          is_active?: boolean
          is_paid?: boolean
          minimum_unit?: number
          name?: string
          quarter_day_allowed?: boolean
          remark?: string | null
          requires_reason?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_types_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      master_departments: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          master_team_id: string
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_team_id: string
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_team_id?: string
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_departments_master_team_id_fkey"
            columns: ["master_team_id"]
            isOneToOne: false
            referencedRelation: "master_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      master_designations: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          master_department_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_department_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_department_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_designations_master_department_id_fkey"
            columns: ["master_department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      master_teams: {
        Row: {
          category: Database["public"]["Enums"]["team_category"]
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["team_category"]
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["team_category"]
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      metric_actual: {
        Row: {
          actual_value: number
          company_id: string
          created_at: string
          department_id: string | null
          employee_id: string | null
          id: string
          metric_id: string
          period_end: string
          period_start: string
          role_id: string | null
          source_id: string | null
          store_id: string | null
        }
        Insert: {
          actual_value: number
          company_id: string
          created_at?: string
          department_id?: string | null
          employee_id?: string | null
          id?: string
          metric_id: string
          period_end: string
          period_start: string
          role_id?: string | null
          source_id?: string | null
          store_id?: string | null
        }
        Update: {
          actual_value?: number
          company_id?: string
          created_at?: string
          department_id?: string | null
          employee_id?: string | null
          id?: string
          metric_id?: string
          period_end?: string
          period_start?: string
          role_id?: string | null
          source_id?: string | null
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_actual_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_actual_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_actual_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_actual_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_actual_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_actual_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "performance_data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_actual_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_approval: {
        Row: {
          created_at: string
          decided_at: string
          decision: Database["public"]["Enums"]["metric_approval_decision"]
          id: string
          performance_entry_id: string
          remarks: string | null
          verifier_id: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string
          decision: Database["public"]["Enums"]["metric_approval_decision"]
          id?: string
          performance_entry_id: string
          remarks?: string | null
          verifier_id?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string
          decision?: Database["public"]["Enums"]["metric_approval_decision"]
          id?: string
          performance_entry_id?: string
          remarks?: string | null
          verifier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_approval_performance_entry_id_fkey"
            columns: ["performance_entry_id"]
            isOneToOne: false
            referencedRelation: "performance_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_approval_verifier_id_fkey"
            columns: ["verifier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_comments: {
        Row: {
          comment: string
          commented_by: string | null
          created_at: string
          id: string
          performance_entry_id: string
        }
        Insert: {
          comment: string
          commented_by?: string | null
          created_at?: string
          id?: string
          performance_entry_id: string
        }
        Update: {
          comment?: string
          commented_by?: string | null
          created_at?: string
          id?: string
          performance_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_comments_commented_by_fkey"
            columns: ["commented_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_comments_performance_entry_id_fkey"
            columns: ["performance_entry_id"]
            isOneToOne: false
            referencedRelation: "performance_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_history: {
        Row: {
          action: string
          created_at: string
          id: string
          new_value: number | null
          old_value: number | null
          performance_entry_id: string
          performed_by: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          performance_entry_id: string
          performed_by?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          performance_entry_id?: string
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_history_performance_entry_id_fkey"
            columns: ["performance_entry_id"]
            isOneToOne: false
            referencedRelation: "performance_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_history_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_mapping: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          employee_id: string | null
          id: string
          is_active: boolean
          metric_id: string
          role_id: string | null
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          employee_id?: string | null
          id?: string
          is_active?: boolean
          metric_id: string
          role_id?: string | null
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          employee_id?: string | null
          id?: string
          is_active?: boolean
          metric_id?: string
          role_id?: string | null
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_mapping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_mapping_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_mapping_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_mapping_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_mapping_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_mapping_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_master: {
        Row: {
          calculation_type: Database["public"]["Enums"]["metric_calculation_type"]
          category: Database["public"]["Enums"]["metric_category"]
          company_id: string | null
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          is_system_metric: boolean
          measurement_unit: string
          metric_code: string
          metric_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          calculation_type?: Database["public"]["Enums"]["metric_calculation_type"]
          category?: Database["public"]["Enums"]["metric_category"]
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_system_metric?: boolean
          measurement_unit?: string
          metric_code: string
          metric_name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          calculation_type?: Database["public"]["Enums"]["metric_calculation_type"]
          category?: Database["public"]["Enums"]["metric_category"]
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_system_metric?: boolean
          measurement_unit?: string
          metric_code?: string
          metric_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_master_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_target: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          department_id: string | null
          effective_date: string
          employee_id: string | null
          expiry_date: string | null
          id: string
          is_active: boolean
          metric_id: string
          role_id: string | null
          store_id: string | null
          target_value: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          effective_date?: string
          employee_id?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          metric_id: string
          role_id?: string | null
          store_id?: string | null
          target_value: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          effective_date?: string
          employee_id?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          metric_id?: string
          role_id?: string | null
          store_id?: string | null
          target_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_target_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_target_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_target_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_target_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_target_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_target_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          company_id: string
          created_at: string
          event_type: string
          id: string
          is_read: boolean
          recipient_employee_id: string
          related_id: string | null
          related_table: string | null
          title: string
        }
        Insert: {
          body?: string | null
          company_id: string
          created_at?: string
          event_type: string
          id?: string
          is_read?: boolean
          recipient_employee_id: string
          related_id?: string | null
          related_table?: string | null
          title: string
        }
        Update: {
          body?: string | null
          company_id?: string
          created_at?: string
          event_type?: string
          id?: string
          is_read?: boolean
          recipient_employee_id?: string
          related_id?: string | null
          related_table?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_employee_id_fkey"
            columns: ["recipient_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_leave_transactions: {
        Row: {
          amount: number | null
          company_id: string
          created_at: string
          created_by: string | null
          days: number
          employee_id: string
          financial_year_id: string
          fy_closing_batch_id: string | null
          id: string
          leave_type_id: string
          source: string
          status: string
          transaction_type: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          days: number
          employee_id: string
          financial_year_id: string
          fy_closing_batch_id?: string | null
          id?: string
          leave_type_id: string
          source?: string
          status?: string
          transaction_type: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          days?: number
          employee_id?: string
          financial_year_id?: string
          fy_closing_batch_id?: string | null
          id?: string
          leave_type_id?: string
          source?: string
          status?: string
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_leave_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_leave_transactions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_leave_transactions_financial_year_id_fkey"
            columns: ["financial_year_id"]
            isOneToOne: false
            referencedRelation: "leave_financial_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_leave_transactions_fy_closing_batch_id_fkey"
            columns: ["fy_closing_batch_id"]
            isOneToOne: false
            referencedRelation: "leave_fy_closing_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_leave_transactions_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_cycle: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          cycle_type: Database["public"]["Enums"]["performance_cycle_type"]
          end_date: string
          id: string
          is_active: boolean
          name: string
          start_date: string
          status: Database["public"]["Enums"]["performance_cycle_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_type?: Database["public"]["Enums"]["performance_cycle_type"]
          end_date: string
          id?: string
          is_active?: boolean
          name: string
          start_date: string
          status?: Database["public"]["Enums"]["performance_cycle_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_type?: Database["public"]["Enums"]["performance_cycle_type"]
          end_date?: string
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string
          status?: Database["public"]["Enums"]["performance_cycle_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_cycle_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_cycles: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          cycle_type: Database["public"]["Enums"]["performance_cycle_grain"]
          end_date: string
          id: string
          is_active: boolean
          name: string
          start_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_type?: Database["public"]["Enums"]["performance_cycle_grain"]
          end_date: string
          id?: string
          is_active?: boolean
          name: string
          start_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_type?: Database["public"]["Enums"]["performance_cycle_grain"]
          end_date?: string
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_cycles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_daily_summary: {
        Row: {
          calculated_at: string
          company_id: string
          created_at: string
          department_id: string | null
          entry_count: number
          id: string
          metric_id: string
          role_id: string | null
          store_id: string | null
          summary_date: string
          total_value: number | null
        }
        Insert: {
          calculated_at?: string
          company_id: string
          created_at?: string
          department_id?: string | null
          entry_count?: number
          id?: string
          metric_id: string
          role_id?: string | null
          store_id?: string | null
          summary_date: string
          total_value?: number | null
        }
        Update: {
          calculated_at?: string
          company_id?: string
          created_at?: string
          department_id?: string | null
          entry_count?: number
          id?: string
          metric_id?: string
          role_id?: string | null
          store_id?: string | null
          summary_date?: string
          total_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_daily_summary_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_daily_summary_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_daily_summary_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_daily_summary_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_daily_summary_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_data_sources: {
        Row: {
          code: string
          display_order: number
          id: string
          is_active: boolean
          is_automated: boolean
          label: string
        }
        Insert: {
          code: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_automated?: boolean
          label: string
        }
        Update: {
          code?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_automated?: boolean
          label?: string
        }
        Relationships: []
      }
      performance_entries: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          department_id: string | null
          employee_id: string | null
          entered_by: string | null
          entry_date: string
          entry_value: number
          id: string
          is_locked: boolean
          metric_id: string
          performance_cycle_id: string | null
          remarks: string | null
          role_id: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["performance_entry_status"]
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          employee_id?: string | null
          entered_by?: string | null
          entry_date: string
          entry_value: number
          id?: string
          is_locked?: boolean
          metric_id: string
          performance_cycle_id?: string | null
          remarks?: string | null
          role_id?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["performance_entry_status"]
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          employee_id?: string | null
          entered_by?: string | null
          entry_date?: string
          entry_value?: number
          id?: string
          is_locked?: boolean
          metric_id?: string
          performance_cycle_id?: string | null
          remarks?: string | null
          role_id?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["performance_entry_status"]
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_entries_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_entries_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_entries_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_entries_performance_cycle_id_fkey"
            columns: ["performance_cycle_id"]
            isOneToOne: false
            referencedRelation: "performance_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_entries_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_entries_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "performance_data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_entries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_monthly_summary: {
        Row: {
          calculated_at: string
          company_id: string
          created_at: string
          department_id: string | null
          entry_count: number
          id: string
          metric_id: string
          role_id: string | null
          store_id: string | null
          summary_month: string
          total_value: number | null
        }
        Insert: {
          calculated_at?: string
          company_id: string
          created_at?: string
          department_id?: string | null
          entry_count?: number
          id?: string
          metric_id: string
          role_id?: string | null
          store_id?: string | null
          summary_month: string
          total_value?: number | null
        }
        Update: {
          calculated_at?: string
          company_id?: string
          created_at?: string
          department_id?: string | null
          entry_count?: number
          id?: string
          metric_id?: string
          role_id?: string | null
          store_id?: string | null
          summary_month?: string
          total_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_monthly_summary_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_monthly_summary_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_monthly_summary_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_monthly_summary_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_monthly_summary_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_rating: {
        Row: {
          code: string
          color: string | null
          display_order: number
          id: string
          is_active: boolean
          label: string
          max_score: number
          min_score: number
        }
        Insert: {
          code: string
          color?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          label: string
          max_score: number
          min_score: number
        }
        Update: {
          code?: string
          color?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          label?: string
          max_score?: number
          min_score?: number
        }
        Relationships: []
      }
      performance_summary: {
        Row: {
          calculated_at: string
          calculated_by: string | null
          company_id: string
          created_at: string
          employee_id: string
          id: string
          overall_rating_id: string | null
          overall_score: number | null
          performance_cycle_id: string
          role_wise_scores: Json | null
        }
        Insert: {
          calculated_at?: string
          calculated_by?: string | null
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          overall_rating_id?: string | null
          overall_score?: number | null
          performance_cycle_id: string
          role_wise_scores?: Json | null
        }
        Update: {
          calculated_at?: string
          calculated_by?: string | null
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          overall_rating_id?: string | null
          overall_score?: number | null
          performance_cycle_id?: string
          role_wise_scores?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_summary_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_summary_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_summary_overall_rating_id_fkey"
            columns: ["overall_rating_id"]
            isOneToOne: false
            referencedRelation: "performance_rating"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_summary_performance_cycle_id_fkey"
            columns: ["performance_cycle_id"]
            isOneToOne: false
            referencedRelation: "performance_cycle"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          must_change_password: boolean
          role: Database["public"]["Enums"]["app_role"]
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          full_name: string
          id: string
          is_active?: boolean
          must_change_password?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          must_change_password?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      role_categories: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      role_kpi_mapping: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          kpi_id: string
          role_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kpi_id: string
          role_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kpi_id?: string
          role_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_kpi_mapping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_kpi_mapping_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_kpi_mapping_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_notes: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          note: string
          role_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          role_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_notes_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions_placeholder: {
        Row: {
          created_at: string
          id: string
          permission_key: string | null
          permission_value: Json | null
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_key?: string | null
          permission_value?: Json | null
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_key?: string | null
          permission_value?: Json | null
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_placeholder_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_status: {
        Row: {
          code: string
          display_order: number
          id: string
          is_active: boolean
          label: string
        }
        Insert: {
          code: string
          display_order?: number
          id?: string
          is_active?: boolean
          label: string
        }
        Update: {
          code?: string
          display_order?: number
          id?: string
          is_active?: boolean
          label?: string
        }
        Relationships: []
      }
      role_task_mapping: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          role_id: string
          task_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          role_id: string
          task_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          role_id?: string
          task_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_task_mapping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_task_mapping_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_task_mapping_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_master"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          category_id: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_system_role: boolean
          role_code: string
          role_name: string
          role_type: Database["public"]["Enums"]["role_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_system_role?: boolean
          role_code: string
          role_name: string
          role_type?: Database["public"]["Enums"]["role_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_system_role?: boolean
          role_code?: string
          role_name?: string
          role_type?: Database["public"]["Enums"]["role_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "role_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      store_daily_metrics: {
        Row: {
          company_id: string
          created_at: string
          entry_date: string
          id: string
          metric_id: string
          store_id: string
          value: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          entry_date: string
          id?: string
          metric_id: string
          store_id: string
          value?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          entry_date?: string
          id?: string
          metric_id?: string
          store_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_daily_metrics_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_daily_metrics_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_daily_metrics_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_departments: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          master_department_id: string | null
          name: string
          store_id: string
          store_team_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_department_id?: string | null
          name: string
          store_id: string
          store_team_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_department_id?: string | null
          name?: string
          store_id?: string
          store_team_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_departments_master_department_id_fkey"
            columns: ["master_department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_departments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_departments_store_team_id_fkey"
            columns: ["store_team_id"]
            isOneToOne: false
            referencedRelation: "store_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      store_designations: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          master_designation_id: string | null
          store_department_id: string
          store_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_designation_id?: string | null
          store_department_id: string
          store_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_designation_id?: string | null
          store_department_id?: string
          store_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_designations_master_designation_id_fkey"
            columns: ["master_designation_id"]
            isOneToOne: false
            referencedRelation: "master_designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_designations_store_department_id_fkey"
            columns: ["store_department_id"]
            isOneToOne: false
            referencedRelation: "store_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_designations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_teams: {
        Row: {
          category: Database["public"]["Enums"]["team_category"]
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          master_team_id: string | null
          name: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["team_category"]
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_team_id?: string | null
          name: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["team_category"]
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          master_team_id?: string | null
          name?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_teams_master_team_id_fkey"
            columns: ["master_team_id"]
            isOneToOne: false
            referencedRelation: "master_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_teams_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          city: string | null
          code: string
          company_id: string
          country: string | null
          created_at: string
          created_by: string | null
          email: string | null
          gst_number: string | null
          id: string
          name: string
          phone: string | null
          provisioned_at: string | null
          state: string | null
          status: Database["public"]["Enums"]["store_status"]
          store_type: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          company_id: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          name: string
          phone?: string | null
          provisioned_at?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["store_status"]
          store_type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          company_id?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          name?: string
          phone?: string | null
          provisioned_at?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["store_status"]
          store_type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          attachment_type: Database["public"]["Enums"]["task_attachment_type"]
          company_id: string
          created_at: string
          employee_task_assignment_id: string
          file_name: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          storage_path: string
          task_submission_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          attachment_type: Database["public"]["Enums"]["task_attachment_type"]
          company_id: string
          created_at?: string
          employee_task_assignment_id: string
          file_name: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          task_submission_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          attachment_type?: Database["public"]["Enums"]["task_attachment_type"]
          company_id?: string
          created_at?: string
          employee_task_assignment_id?: string
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          task_submission_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_employee_task_assignment_id_fkey"
            columns: ["employee_task_assignment_id"]
            isOneToOne: false
            referencedRelation: "employee_task_assignment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_task_submission_id_fkey"
            columns: ["task_submission_id"]
            isOneToOne: false
            referencedRelation: "task_submission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_categories: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      task_checklist_items: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_mandatory: boolean
          item_name: string
          sequence: number
          task_checklist_id: string
          updated_at: string
          updated_by: string | null
          weightage: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_mandatory?: boolean
          item_name: string
          sequence?: number
          task_checklist_id: string
          updated_at?: string
          updated_by?: string | null
          weightage?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_mandatory?: boolean
          item_name?: string
          sequence?: number
          task_checklist_id?: string
          updated_at?: string
          updated_by?: string | null
          weightage?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_task_checklist_id_fkey"
            columns: ["task_checklist_id"]
            isOneToOne: false
            referencedRelation: "task_checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklists: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          task_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          task_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          task_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_checklists_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_master"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          comment: string
          commented_by: string | null
          created_at: string
          employee_task_assignment_id: string
          id: string
        }
        Insert: {
          comment: string
          commented_by?: string | null
          created_at?: string
          employee_task_assignment_id: string
          id?: string
        }
        Update: {
          comment?: string
          commented_by?: string | null
          created_at?: string
          employee_task_assignment_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_commented_by_fkey"
            columns: ["commented_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_employee_task_assignment_id_fkey"
            columns: ["employee_task_assignment_id"]
            isOneToOne: false
            referencedRelation: "employee_task_assignment"
            referencedColumns: ["id"]
          },
        ]
      }
      task_frequency: {
        Row: {
          code: string
          display_order: number
          id: string
          is_active: boolean
          label: string
        }
        Insert: {
          code: string
          display_order?: number
          id?: string
          is_active?: boolean
          label: string
        }
        Update: {
          code?: string
          display_order?: number
          id?: string
          is_active?: boolean
          label?: string
        }
        Relationships: []
      }
      task_history: {
        Row: {
          action: Database["public"]["Enums"]["task_history_action"]
          created_at: string
          employee_task_assignment_id: string
          id: string
          performed_by: string | null
          remarks: string | null
          status_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["task_history_action"]
          created_at?: string
          employee_task_assignment_id: string
          id?: string
          performed_by?: string | null
          remarks?: string | null
          status_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["task_history_action"]
          created_at?: string
          employee_task_assignment_id?: string
          id?: string
          performed_by?: string | null
          remarks?: string | null
          status_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_history_employee_task_assignment_id_fkey"
            columns: ["employee_task_assignment_id"]
            isOneToOne: false
            referencedRelation: "employee_task_assignment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_history_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_history_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "task_status"
            referencedColumns: ["id"]
          },
        ]
      }
      task_master: {
        Row: {
          allow_document_upload: boolean
          allow_gps_placeholder: boolean
          allow_photo_upload: boolean
          allow_qr_placeholder: boolean
          allow_remarks: boolean
          category_id: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          estimated_time_minutes: number | null
          frequency_id: string | null
          id: string
          is_active: boolean
          is_system_task: boolean
          priority: Database["public"]["Enums"]["task_priority"]
          requires_verification: boolean
          task_code: string
          task_name: string
          template_id: string | null
          updated_at: string
          updated_by: string | null
          weightage: number
        }
        Insert: {
          allow_document_upload?: boolean
          allow_gps_placeholder?: boolean
          allow_photo_upload?: boolean
          allow_qr_placeholder?: boolean
          allow_remarks?: boolean
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          estimated_time_minutes?: number | null
          frequency_id?: string | null
          id?: string
          is_active?: boolean
          is_system_task?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          requires_verification?: boolean
          task_code: string
          task_name: string
          template_id?: string | null
          updated_at?: string
          updated_by?: string | null
          weightage?: number
        }
        Update: {
          allow_document_upload?: boolean
          allow_gps_placeholder?: boolean
          allow_photo_upload?: boolean
          allow_qr_placeholder?: boolean
          allow_remarks?: boolean
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          estimated_time_minutes?: number | null
          frequency_id?: string | null
          id?: string
          is_active?: boolean
          is_system_task?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          requires_verification?: boolean
          task_code?: string
          task_name?: string
          template_id?: string | null
          updated_at?: string
          updated_by?: string | null
          weightage?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_master_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "task_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_master_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_master_frequency_id_fkey"
            columns: ["frequency_id"]
            isOneToOne: false
            referencedRelation: "task_frequency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_master_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      task_score: {
        Row: {
          calculated_at: string
          calculated_by: string | null
          completion_percentage: number | null
          created_at: string
          employee_task_assignment_id: string
          final_score: number | null
          id: string
          quality_score: number | null
          verification_percentage: number | null
          weightage: number | null
        }
        Insert: {
          calculated_at?: string
          calculated_by?: string | null
          completion_percentage?: number | null
          created_at?: string
          employee_task_assignment_id: string
          final_score?: number | null
          id?: string
          quality_score?: number | null
          verification_percentage?: number | null
          weightage?: number | null
        }
        Update: {
          calculated_at?: string
          calculated_by?: string | null
          completion_percentage?: number | null
          created_at?: string
          employee_task_assignment_id?: string
          final_score?: number | null
          id?: string
          quality_score?: number | null
          verification_percentage?: number | null
          weightage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "task_score_employee_task_assignment_id_fkey"
            columns: ["employee_task_assignment_id"]
            isOneToOne: true
            referencedRelation: "employee_task_assignment"
            referencedColumns: ["id"]
          },
        ]
      }
      task_status: {
        Row: {
          code: string
          display_order: number
          id: string
          is_active: boolean
          label: string
        }
        Insert: {
          code: string
          display_order?: number
          id?: string
          is_active?: boolean
          label: string
        }
        Update: {
          code?: string
          display_order?: number
          id?: string
          is_active?: boolean
          label?: string
        }
        Relationships: []
      }
      task_submission: {
        Row: {
          checklist_responses: Json | null
          completion_time: string | null
          created_at: string
          employee_task_assignment_id: string
          id: string
          remarks: string | null
          submitted_at: string
          submitted_by: string | null
        }
        Insert: {
          checklist_responses?: Json | null
          completion_time?: string | null
          created_at?: string
          employee_task_assignment_id: string
          id?: string
          remarks?: string | null
          submitted_at?: string
          submitted_by?: string | null
        }
        Update: {
          checklist_responses?: Json | null
          completion_time?: string | null
          created_at?: string
          employee_task_assignment_id?: string
          id?: string
          remarks?: string | null
          submitted_at?: string
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_submission_employee_task_assignment_id_fkey"
            columns: ["employee_task_assignment_id"]
            isOneToOne: false
            referencedRelation: "employee_task_assignment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_submission_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          category_id: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_system_template: boolean
          template_code: string
          template_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_system_template?: boolean
          template_code: string
          template_name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_system_template?: boolean
          template_code?: string
          template_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "task_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      task_verification: {
        Row: {
          created_at: string
          decision: Database["public"]["Enums"]["task_verification_decision"]
          id: string
          remarks: string | null
          score: number | null
          task_submission_id: string
          verified_at: string
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          decision: Database["public"]["Enums"]["task_verification_decision"]
          id?: string
          remarks?: string | null
          score?: number | null
          task_submission_id: string
          verified_at?: string
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          decision?: Database["public"]["Enums"]["task_verification_decision"]
          id?: string
          remarks?: string | null
          score?: number | null
          task_submission_id?: string
          verified_at?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_verification_task_submission_id_fkey"
            columns: ["task_submission_id"]
            isOneToOne: false
            referencedRelation: "task_submission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_verification_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_off_overrides: {
        Row: {
          approved_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          new_off_date: string
          original_off_date: string
          reason: string | null
        }
        Insert: {
          approved_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          new_off_date: string
          original_off_date: string
          reason?: string | null
        }
        Update: {
          approved_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          new_off_date?: string
          original_off_date?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weekly_off_overrides_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_off_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_off_overrides_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_attendance_rounding: {
        Args: { p_custom_minutes: number; p_method: string; p_minutes: number }
        Returns: number
      }
      attendance_admin_punch: {
        Args: { p_employee_id: string; p_remark?: string; p_type: string }
        Returns: {
          attendance_date: string
          break_deduction_minutes: number | null
          company_id: string
          created_at: string
          created_by: string | null
          early_going_minutes: number | null
          early_going_rule_id: string | null
          employee_id: string
          extended_duty_rule_id: string | null
          extra_duty_value: number | null
          half_day_reason: string | null
          half_day_rule_id: string | null
          id: string
          information_rule_id: string | null
          is_demo: boolean
          late_minutes: number | null
          late_rule_id: string | null
          night_duty_approval_id: string | null
          night_ot_minutes: number | null
          overtime_minutes: number | null
          overtime_rule_id: string | null
          payable_extra_duty_value: number | null
          payable_overtime_minutes: number | null
          payable_working_minutes: number | null
          penalty_minutes: number | null
          penalty_rule_id: string | null
          punch_in_at: string | null
          punch_out_at: string | null
          remarks: string | null
          shift_id: string
          source: Database["public"]["Enums"]["attendance_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          store_id: string
          total_working_minutes: number | null
          updated_at: string
          updated_by: string | null
          used_information: boolean
          working_minutes: number | null
        }
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_import_preview: {
        Args: { p_company_id: string; p_rows: Json }
        Returns: Json
      }
      attendance_import_commit: {
        Args: { p_company_id: string; p_rows: Json }
        Returns: Json
      }
      attendance_admin_upsert: {
        Args: {
          p_attendance_date: string
          p_employee_id: string
          p_punch_in_time?: string
          p_punch_out_time?: string
          p_remark?: string
          p_status: string
          p_use_information?: boolean
        }
        Returns: {
          attendance_date: string
          break_deduction_minutes: number | null
          company_id: string
          created_at: string
          created_by: string | null
          early_going_minutes: number | null
          early_going_rule_id: string | null
          employee_id: string
          extended_duty_rule_id: string | null
          extra_duty_value: number | null
          half_day_reason: string | null
          half_day_rule_id: string | null
          id: string
          information_rule_id: string | null
          is_demo: boolean
          late_minutes: number | null
          late_rule_id: string | null
          night_duty_approval_id: string | null
          night_ot_minutes: number | null
          overtime_minutes: number | null
          overtime_rule_id: string | null
          payable_extra_duty_value: number | null
          payable_overtime_minutes: number | null
          payable_working_minutes: number | null
          penalty_minutes: number | null
          penalty_rule_id: string | null
          punch_in_at: string | null
          punch_out_at: string | null
          remarks: string | null
          shift_id: string
          source: Database["public"]["Enums"]["attendance_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          store_id: string
          total_working_minutes: number | null
          updated_at: string
          updated_by: string | null
          used_information: boolean
          working_minutes: number | null
        }
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_explain_rules: {
        Args: {
          p_attendance_date: string
          p_company_id: string
          p_employee_id: string
          p_punch_in_at: string
          p_punch_out_at: string
          p_shift_id: string
          p_store_id: string
          p_use_information?: boolean
        }
        Returns: {
          config: Json
          effective_from: string
          effective_to: string
          is_assigned: boolean
          kind: string
          resolved_employee_id: string
          resolved_store_id: string
          result_note: string
          result_value: number
          rule_id: string
          scope_source: string
          triggered: boolean
        }[]
      }
      attendance_night_duty_decide: {
        Args: {
          p_approval_id: string
          p_decision: string
          p_manager_payable_out_time?: string
          p_remark?: string
        }
        Returns: {
          actual_punch_out_at: string
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          attendance_date: string
          attendance_record_id: string
          company_id: string
          created_at: string
          employee_id: string
          extra_duty_value: number
          id: string
          manager_confirmed_payable_out_at: string | null
          manager_remark: string | null
          night_ot_minutes: number
          om_acted_at: string | null
          om_action: string | null
          om_id: string | null
          om_remark: string | null
          shift_end_at: string | null
          store_id: string | null
          super_manager_acted_at: string | null
          super_manager_action: string | null
          super_manager_id: string | null
          super_manager_remark: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_night_duty_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_night_duty_om_decide: {
        Args: {
          p_approval_id: string
          p_decision: string
          p_manager_payable_out_time?: string
          p_remark?: string
        }
        Returns: {
          actual_punch_out_at: string
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          attendance_date: string
          attendance_record_id: string
          company_id: string
          created_at: string
          employee_id: string
          extra_duty_value: number
          id: string
          manager_confirmed_payable_out_at: string | null
          manager_remark: string | null
          night_ot_minutes: number
          om_acted_at: string | null
          om_action: string | null
          om_id: string | null
          om_remark: string | null
          shift_end_at: string | null
          store_id: string | null
          super_manager_acted_at: string | null
          super_manager_action: string | null
          super_manager_id: string | null
          super_manager_remark: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_night_duty_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_night_duty_super_manager_decide: {
        Args: {
          p_approval_id: string
          p_decision: string
          p_manager_payable_out_time?: string
          p_remark?: string
        }
        Returns: {
          actual_punch_out_at: string
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          attendance_date: string
          attendance_record_id: string
          company_id: string
          created_at: string
          employee_id: string
          extra_duty_value: number
          id: string
          manager_confirmed_payable_out_at: string | null
          manager_remark: string | null
          night_ot_minutes: number
          om_acted_at: string | null
          om_action: string | null
          om_id: string | null
          om_remark: string | null
          shift_end_at: string | null
          store_id: string | null
          super_manager_acted_at: string | null
          super_manager_action: string | null
          super_manager_id: string | null
          super_manager_remark: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_night_duty_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_punch_in: {
        Args: { p_use_information?: boolean }
        Returns: {
          attendance_date: string
          break_deduction_minutes: number | null
          company_id: string
          created_at: string
          created_by: string | null
          early_going_minutes: number | null
          early_going_rule_id: string | null
          employee_id: string
          extended_duty_rule_id: string | null
          extra_duty_value: number | null
          half_day_reason: string | null
          half_day_rule_id: string | null
          id: string
          information_rule_id: string | null
          is_demo: boolean
          late_minutes: number | null
          late_rule_id: string | null
          night_duty_approval_id: string | null
          night_ot_minutes: number | null
          overtime_minutes: number | null
          overtime_rule_id: string | null
          payable_extra_duty_value: number | null
          payable_overtime_minutes: number | null
          payable_working_minutes: number | null
          penalty_minutes: number | null
          penalty_rule_id: string | null
          punch_in_at: string | null
          punch_out_at: string | null
          remarks: string | null
          shift_id: string
          source: Database["public"]["Enums"]["attendance_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          store_id: string
          total_working_minutes: number | null
          updated_at: string
          updated_by: string | null
          used_information: boolean
          working_minutes: number | null
        }
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_punch_out: {
        Args: never
        Returns: {
          attendance_date: string
          break_deduction_minutes: number | null
          company_id: string
          created_at: string
          created_by: string | null
          early_going_minutes: number | null
          early_going_rule_id: string | null
          employee_id: string
          extended_duty_rule_id: string | null
          extra_duty_value: number | null
          half_day_reason: string | null
          half_day_rule_id: string | null
          id: string
          information_rule_id: string | null
          is_demo: boolean
          late_minutes: number | null
          late_rule_id: string | null
          night_duty_approval_id: string | null
          night_ot_minutes: number | null
          overtime_minutes: number | null
          overtime_rule_id: string | null
          payable_extra_duty_value: number | null
          payable_overtime_minutes: number | null
          payable_working_minutes: number | null
          penalty_minutes: number | null
          penalty_rule_id: string | null
          punch_in_at: string | null
          punch_out_at: string | null
          remarks: string | null
          shift_id: string
          source: Database["public"]["Enums"]["attendance_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          store_id: string
          total_working_minutes: number | null
          updated_at: string
          updated_by: string | null
          used_information: boolean
          working_minutes: number | null
        }
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_reset_late_overtime_rules: {
        Args: { p_company_id: string }
        Returns: Json
      }
      attendance_rule_assignment_upsert: {
        Args: {
          p_company_id: string
          p_early_going_rule_id: string
          p_effective_from: string
          p_effective_to?: string
          p_employee_id: string
          p_extended_duty_rule_id: string
          p_half_day_rule_id: string
          p_information_rule_id: string
          p_late_rule_id: string
          p_overtime_rule_id: string
          p_penalty_rule_id: string
          p_remark?: string
          p_store_id: string
          p_touch_early_going: boolean
          p_touch_extended_duty: boolean
          p_touch_half_day: boolean
          p_touch_information: boolean
          p_touch_late: boolean
          p_touch_overtime: boolean
          p_touch_penalty: boolean
          p_touch_weekly_off_late: boolean
          p_user_id?: string
          p_weekly_off_late_rule_id: string
        }
        Returns: {
          assignment_id: string
          recalculated_count: number
        }[]
      }
      attendance_use_information: {
        Args: { p_attendance_record_id: string; p_remark?: string }
        Returns: {
          attendance_date: string
          break_deduction_minutes: number | null
          company_id: string
          created_at: string
          created_by: string | null
          early_going_minutes: number | null
          early_going_rule_id: string | null
          employee_id: string
          extended_duty_rule_id: string | null
          extra_duty_value: number | null
          half_day_reason: string | null
          half_day_rule_id: string | null
          id: string
          information_rule_id: string | null
          is_demo: boolean
          late_minutes: number | null
          late_rule_id: string | null
          night_duty_approval_id: string | null
          night_ot_minutes: number | null
          overtime_minutes: number | null
          overtime_rule_id: string | null
          payable_extra_duty_value: number | null
          payable_overtime_minutes: number | null
          payable_working_minutes: number | null
          penalty_minutes: number | null
          penalty_rule_id: string | null
          punch_in_at: string | null
          punch_out_at: string | null
          remarks: string | null
          shift_id: string
          source: Database["public"]["Enums"]["attendance_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          store_id: string
          total_working_minutes: number | null
          updated_at: string
          updated_by: string | null
          used_information: boolean
          working_minutes: number | null
        }
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calculate_extended_duty: {
        Args: {
          p_attendance_date: string
          p_extended_duty_rule_id: string
          p_punch_out_at: string
          p_shift_end_at: string
        }
        Returns: Record<string, unknown>
      }
      calculate_late_minutes: {
        Args: { p_late_rule_id: string; p_raw_late_minutes: number }
        Returns: number
      }
      calculate_overtime_minutes: {
        Args: {
          p_day_type: string
          p_overtime_rule_id: string
          p_raw_overtime_minutes: number
        }
        Returns: number
      }
      calculate_penalty_minutes: {
        Args: { p_actual_late_minutes: number; p_penalty_rule_id: string }
        Returns: number
      }
      compute_extended_attendance_facts: {
        Args: {
          p_attendance_date: string
          p_company_id: string
          p_day_type_override: string
          p_employee_id: string
          p_punch_in_at: string
          p_punch_out_at: string
          p_read_only?: boolean
          p_shift_id: string
          p_store_id: string
          p_use_information: boolean
        }
        Returns: Record<string, unknown>
      }
      compute_late_and_penalty_facts: {
        Args: {
          p_attendance_date: string
          p_company_id: string
          p_day_type_override?: string
          p_employee_id: string
          p_punch_in_at: string
          p_read_only?: boolean
          p_shift_id: string
          p_store_id: string
          p_use_information: boolean
        }
        Returns: Record<string, unknown>
      }
      current_user_company_id: { Args: never; Returns: string }
      current_user_employee_id: { Args: never; Returns: string }
      current_user_profile_email: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      ensure_night_duty_approval:
        | {
            Args: {
              p_actual_punch_out_at: string
              p_attendance_date: string
              p_attendance_record_id: string
              p_company_id: string
              p_employee_id: string
              p_extra_duty_value: number
              p_night_ot_minutes: number
              p_shift_end_at: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_actual_punch_out_at: string
              p_attendance_date: string
              p_attendance_record_id: string
              p_company_id: string
              p_employee_id: string
              p_extra_duty_value: number
              p_night_ot_minutes: number
              p_shift_end_at: string
              p_store_id: string
            }
            Returns: undefined
          }
      get_store_organization_tree: {
        Args: { p_store_id: string }
        Returns: Json
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_weekly_off_on_date: {
        Args: { p_date: string; p_employee_id: string }
        Returns: boolean
      }
      leave_active_super_manager_exists: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      leave_admin_decide: {
        Args: {
          p_application_id: string
          p_decision: string
          p_remark?: string
        }
        Returns: {
          applied_at: string
          company_id: string
          created_at: string
          created_by: string | null
          current_step: number
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          financial_year_id: string
          from_date: string
          half_day_session: string | null
          id: string
          is_half_day: boolean
          leave_type_id: string
          policy_id: string
          reason: string | null
          remarks: string | null
          short_or_long: string | null
          status: string
          to_date: string
          total_days: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "leave_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_am_i_a_manager: { Args: never; Returns: boolean }
      leave_apply: {
        Args: {
          p_document_file_name?: string
          p_document_file_size_bytes?: number
          p_document_mime_type?: string
          p_document_storage_path?: string
          p_from_date: string
          p_half_day_session?: string
          p_is_half_day?: boolean
          p_leave_type_id: string
          p_prior_notice_reason?: string
          p_reason?: string
          p_remarks?: string
          p_to_date: string
        }
        Returns: {
          applied_at: string
          company_id: string
          created_at: string
          created_by: string | null
          current_step: number
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          financial_year_id: string
          from_date: string
          half_day_session: string | null
          id: string
          is_half_day: boolean
          leave_type_id: string
          policy_id: string
          reason: string | null
          remarks: string | null
          short_or_long: string | null
          status: string
          to_date: string
          total_days: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "leave_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_cancel: {
        Args: { p_application_id: string; p_remark?: string }
        Returns: {
          applied_at: string
          company_id: string
          created_at: string
          created_by: string | null
          current_step: number
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          financial_year_id: string
          from_date: string
          half_day_session: string | null
          id: string
          is_half_day: boolean
          leave_type_id: string
          policy_id: string
          reason: string | null
          remarks: string | null
          short_or_long: string | null
          status: string
          to_date: string
          total_days: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "leave_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_compute_fy_closing: {
        Args: { p_financial_year_id: string }
        Returns: {
          available: number
          basic_salary_snapshot: number
          carry_forward_days: number
          da_snapshot: number
          daily_rate: number
          divisor_snapshot: number
          earned: number
          employee_id: string
          encashment_amount: number
          encashment_days: number
          final_status: string
          lapse_days: number
          leave_type_id: string
          opening: number
          pending: number
          policy_id: string
          policy_version: number
          salary_base_snapshot: number
          used: number
        }[]
      }
      leave_compute_month_entitlement: {
        Args: { p_month: number; p_policy_type_config_id: string }
        Returns: number
      }
      leave_compute_total_days: {
        Args: {
          p_employee_id: string
          p_from_date: string
          p_is_half_day: boolean
          p_policy_type_config_id: string
          p_to_date: string
        }
        Returns: number
      }
      leave_confirm_fy_closing: {
        Args: {
          p_financial_year_id: string
          p_next_financial_year_id?: string
          p_remark?: string
        }
        Returns: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          financial_year_id: string
          id: string
          initiated_at: string
          initiated_by: string
          next_financial_year_id: string | null
          remark: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "leave_fy_closing_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_decide_prior_notice_exception: {
        Args: { p_decision: string; p_exception_id: string; p_remark?: string }
        Returns: {
          company_id: string
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          exception_behavior: string
          from_date: string
          id: string
          leave_application_id: string | null
          leave_type_id: string
          reason: string
          requested_at: string
          requested_by: string
          status: string
          to_date: string
        }
        SetofOptions: {
          from: "*"
          to: "leave_prior_notice_exceptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_get_balance: {
        Args: {
          p_employee_id: string
          p_financial_year_id: string
          p_leave_type_id: string
        }
        Returns: Record<string, unknown>
      }
      leave_get_fy_closing_batch: {
        Args: { p_financial_year_id: string }
        Returns: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          financial_year_id: string
          id: string
          initiated_at: string
          initiated_by: string
          next_financial_year_id: string | null
          remark: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "leave_fy_closing_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_list_approval_history: {
        Args: { p_application_id: string }
        Returns: {
          acted_at: string
          action: string
          approver_employee_id: string
          approver_name: string
          approver_role: string
          remark: string
          step_order: number
        }[]
      }
      leave_list_fy_closing_lines: {
        Args: { p_batch_id: string }
        Returns: {
          available: number
          basic_salary_snapshot: number | null
          batch_id: string
          carry_forward_days: number
          created_at: string
          da_snapshot: number | null
          daily_rate: number | null
          divisor_snapshot: number | null
          earned: number
          employee_id: string
          encashment_amount: number | null
          encashment_days: number
          final_status: string
          id: string
          lapse_days: number
          leave_type_id: string
          opening: number
          pending: number
          policy_id: string | null
          policy_version: number | null
          salary_base_snapshot: number | null
          used: number
        }[]
        SetofOptions: {
          from: "*"
          to: "leave_fy_closing_lines"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      leave_list_manager_pending: {
        Args: never
        Returns: {
          applied_at: string
          employee_code: string
          employee_id: string
          employee_name: string
          from_date: string
          id: string
          leave_type_id: string
          leave_type_name: string
          reason: string
          short_or_long: string
          status: string
          to_date: string
          total_days: number
        }[]
      }
      leave_list_my_notifications: {
        Args: { p_limit?: number }
        Returns: {
          body: string | null
          company_id: string
          created_at: string
          event_type: string
          id: string
          is_read: boolean
          recipient_employee_id: string
          related_id: string | null
          related_table: string | null
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      leave_list_pending_prior_notice_exceptions: {
        Args: never
        Returns: {
          company_id: string
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          exception_behavior: string
          from_date: string
          id: string
          leave_application_id: string | null
          leave_type_id: string
          reason: string
          requested_at: string
          requested_by: string
          status: string
          to_date: string
        }[]
        SetofOptions: {
          from: "*"
          to: "leave_prior_notice_exceptions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      leave_list_super_manager_pending: {
        Args: never
        Returns: {
          applied_at: string
          employee_code: string
          employee_id: string
          employee_name: string
          from_date: string
          id: string
          leave_type_id: string
          leave_type_name: string
          reason: string
          short_or_long: string
          status: string
          to_date: string
          total_days: number
        }[]
      }
      leave_manager_decide: {
        Args: {
          p_application_id: string
          p_decision: string
          p_remark?: string
        }
        Returns: {
          applied_at: string
          company_id: string
          created_at: string
          created_by: string | null
          current_step: number
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          financial_year_id: string
          from_date: string
          half_day_session: string | null
          id: string
          is_half_day: boolean
          leave_type_id: string
          policy_id: string
          reason: string | null
          remarks: string | null
          short_or_long: string | null
          status: string
          to_date: string
          total_days: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "leave_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_mark_all_notifications_read: { Args: never; Returns: undefined }
      leave_mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      leave_month_in_period: {
        Args: { p_end_month: number; p_month: number; p_start_month: number }
        Returns: boolean
      }
      leave_notify: {
        Args: {
          p_body?: string
          p_company_id: string
          p_event_type: string
          p_recipient_employee_id: string
          p_related_id?: string
          p_related_table?: string
          p_title: string
        }
        Returns: undefined
      }
      leave_preview_calculation: {
        Args: {
          p_employee_id: string
          p_financial_year_id: string
          p_leave_type_id: string
        }
        Returns: {
          closing_balance: number
          cumulative_earned: number
          is_eligible: boolean
          is_probation: boolean
          month_start: string
          monthly_entitlement: number
          note: string
          pending: number
          policy_id: string
          used: number
        }[]
      }
      leave_preview_fy_closing: {
        Args: { p_financial_year_id: string }
        Returns: {
          available: number
          basic_salary_snapshot: number
          carry_forward_days: number
          da_snapshot: number
          daily_rate: number
          divisor_snapshot: number
          earned: number
          employee_id: string
          encashment_amount: number
          encashment_days: number
          final_status: string
          lapse_days: number
          leave_type_id: string
          opening: number
          pending: number
          policy_id: string
          policy_version: number
          salary_base_snapshot: number
          used: number
        }[]
      }
      leave_request_prior_notice_exception: {
        Args: {
          p_from_date: string
          p_leave_type_id: string
          p_reason: string
          p_to_date: string
        }
        Returns: {
          company_id: string
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          exception_behavior: string
          from_date: string
          id: string
          leave_application_id: string | null
          leave_type_id: string
          reason: string
          requested_at: string
          requested_by: string
          status: string
          to_date: string
        }
        SetofOptions: {
          from: "*"
          to: "leave_prior_notice_exceptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_resolve_direct_manager: {
        Args: { p_employee_id: string }
        Returns: string
      }
      leave_resolve_eligibility: {
        Args: {
          p_employee_id: string
          p_policy_id: string
          p_probation_eligible: boolean
        }
        Returns: Record<string, unknown>
      }
      leave_resolve_policy_assignment: {
        Args: { p_company_id: string; p_date: string; p_employee_id: string }
        Returns: string
      }
      leave_resolve_salary_components: {
        Args: { p_as_of_date: string; p_employee_id: string }
        Returns: Record<string, unknown>
      }
      leave_super_manager_decide: {
        Args: {
          p_application_id: string
          p_decision: string
          p_remark?: string
        }
        Returns: {
          applied_at: string
          company_id: string
          created_at: string
          created_by: string | null
          current_step: number
          decided_at: string | null
          decided_by: string | null
          decision_remark: string | null
          employee_id: string
          financial_year_id: string
          from_date: string
          half_day_session: string | null
          id: string
          is_half_day: boolean
          leave_type_id: string
          policy_id: string
          reason: string | null
          remarks: string | null
          short_or_long: string | null
          status: string
          to_date: string
          total_days: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "leave_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_unread_notification_count: { Args: never; Returns: number }
      night_duty_normal_ot_suppressed: {
        Args: { p_extended_duty_rule_id: string; p_extra_duty_value: number }
        Returns: boolean
      }
      resolve_attendance_rule: {
        Args: {
          p_company_id: string
          p_date: string
          p_employee_id: string
          p_kind: string
          p_shift_id: string
          p_store_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "company_admin"
        | "staff"
        | "store_manager"
        | "department_manager"
      attendance_action:
        | "punch_in"
        | "punch_out"
        | "correction_requested"
        | "correction_approved"
        | "correction_rejected"
        | "admin_correction"
      attendance_source: "web" | "mobile" | "backend" | "admin" | "import"
      attendance_status:
        | "present"
        | "absent"
        | "half_day"
        | "leave"
        | "weekly_off"
        | "holiday"
        | "work_from_home"
        | "on_duty"
      audit_action: "insert" | "update" | "delete"
      correction_status: "pending" | "approved" | "rejected"
      employee_document_type:
        | "photo"
        | "aadhaar"
        | "pan"
        | "address_proof"
        | "joining_letter"
        | "appointment_letter"
        | "resume"
        | "certificate"
        | "other"
      employee_status:
        | "active"
        | "inactive"
        | "on_leave"
        | "notice_period"
        | "resigned"
        | "terminated"
        | "transferred"
      employment_type:
        | "full_time"
        | "part_time"
        | "contract"
        | "intern"
        | "consultant"
      gender_type: "male" | "female" | "other" | "prefer_not_to_say"
      kpi_assignment_source: "role" | "manual"
      kpi_calculation_type: "manual" | "automatic" | "hybrid"
      kpi_formula_type:
        | "greater_than_target"
        | "equal_to_target"
        | "less_than_target"
        | "range_based"
        | "percentage_based"
        | "formula_based"
      kpi_measurement_unit:
        | "percentage"
        | "number"
        | "amount"
        | "hours"
        | "days"
        | "quantity"
        | "score"
        | "rating"
      kpi_target_type: "daily" | "weekly" | "monthly" | "quarterly" | "yearly"
      metric_approval_decision: "approved" | "rejected"
      metric_calculation_type: "manual" | "automatic" | "hybrid"
      metric_category:
        | "sales"
        | "billing"
        | "customer"
        | "operations"
        | "inventory"
        | "attendance"
        | "task"
        | "checklist"
        | "audit"
        | "training"
        | "security"
        | "housekeeping"
        | "maintenance"
        | "custom"
      performance_cycle_grain:
        | "daily"
        | "weekly"
        | "monthly"
        | "quarterly"
        | "yearly"
      performance_cycle_status: "draft" | "active" | "closed"
      performance_cycle_type: "monthly" | "quarterly" | "yearly" | "custom"
      performance_entry_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "locked"
      role_type: "frontend" | "backend" | "both"
      salary_type: "monthly" | "daily" | "hourly" | "piece_rate"
      store_status: "active" | "inactive" | "onboarding" | "closed"
      task_attachment_type: "photo" | "document"
      task_history_action:
        | "assigned"
        | "started"
        | "submitted"
        | "verified"
        | "rejected"
        | "cancelled"
        | "status_changed"
      task_priority: "low" | "medium" | "high" | "critical"
      task_verification_decision: "approved" | "rejected"
      team_category: "frontend" | "backend"
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
      app_role: [
        "super_admin",
        "company_admin",
        "staff",
        "store_manager",
        "department_manager",
      ],
      attendance_action: [
        "punch_in",
        "punch_out",
        "correction_requested",
        "correction_approved",
        "correction_rejected",
        "admin_correction",
      ],
      attendance_source: ["web", "mobile", "backend", "admin", "import"],
      attendance_status: [
        "present",
        "absent",
        "half_day",
        "leave",
        "weekly_off",
        "holiday",
        "work_from_home",
        "on_duty",
      ],
      audit_action: ["insert", "update", "delete"],
      correction_status: ["pending", "approved", "rejected"],
      employee_document_type: [
        "photo",
        "aadhaar",
        "pan",
        "address_proof",
        "joining_letter",
        "appointment_letter",
        "resume",
        "certificate",
        "other",
      ],
      employee_status: [
        "active",
        "inactive",
        "on_leave",
        "notice_period",
        "resigned",
        "terminated",
        "transferred",
      ],
      employment_type: [
        "full_time",
        "part_time",
        "contract",
        "intern",
        "consultant",
      ],
      gender_type: ["male", "female", "other", "prefer_not_to_say"],
      kpi_assignment_source: ["role", "manual"],
      kpi_calculation_type: ["manual", "automatic", "hybrid"],
      kpi_formula_type: [
        "greater_than_target",
        "equal_to_target",
        "less_than_target",
        "range_based",
        "percentage_based",
        "formula_based",
      ],
      kpi_measurement_unit: [
        "percentage",
        "number",
        "amount",
        "hours",
        "days",
        "quantity",
        "score",
        "rating",
      ],
      kpi_target_type: ["daily", "weekly", "monthly", "quarterly", "yearly"],
      metric_approval_decision: ["approved", "rejected"],
      metric_calculation_type: ["manual", "automatic", "hybrid"],
      metric_category: [
        "sales",
        "billing",
        "customer",
        "operations",
        "inventory",
        "attendance",
        "task",
        "checklist",
        "audit",
        "training",
        "security",
        "housekeeping",
        "maintenance",
        "custom",
      ],
      performance_cycle_grain: [
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
      ],
      performance_cycle_status: ["draft", "active", "closed"],
      performance_cycle_type: ["monthly", "quarterly", "yearly", "custom"],
      performance_entry_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "locked",
      ],
      role_type: ["frontend", "backend", "both"],
      salary_type: ["monthly", "daily", "hourly", "piece_rate"],
      store_status: ["active", "inactive", "onboarding", "closed"],
      task_attachment_type: ["photo", "document"],
      task_history_action: [
        "assigned",
        "started",
        "submitted",
        "verified",
        "rejected",
        "cancelled",
        "status_changed",
      ],
      task_priority: ["low", "medium", "high", "critical"],
      task_verification_decision: ["approved", "rejected"],
      team_category: ["frontend", "backend"],
    },
  },
} as const

// ============================================================================
// Legacy compatibility layer
//
// Before this file was regenerated from the live schema (Phase 3, Leave
// Approval Workflow), it was a hand-authored file with two properties every
// other module in this app was written against:
//   1) Named convenience aliases per table/enum (EmployeeRow, RoleRow,
//      AttendanceStatus, ...) instead of `Database["public"]["Tables"][...]`.
//   2) Deliberately loose Insert/Update types (`Partial<Row> &
//      Record<string, unknown>`), so a dynamically-built `Record<string,
//      unknown>` payload (the pattern most services/*.ts files use) always
//      satisfied `.insert()`/`.update()`, and `.from(someStringConstant)`
//      accepted any string, not just a literal union member.
//
// Regenerating from the live schema is strictly more ACCURATE (it reflects
// every migration, including each phase's own additions — the hand file was
// last touched long before most of those existed), but losing the two
// properties above broke every other module's compilation. Rather than
// rewrite dozens of unrelated service files (well outside any one phase's
// scope, and risky for the "do not modify existing Attendance" constraint),
// this section restores both properties on top of the accurate generated
// `Database` above — the generated type itself is never edited. Re-applied
// verbatim after every `supabase gen types` regeneration.
// ============================================================================

type LoosenTable<T> = T extends { Row: infer R; Relationships: infer Rel }
  ? { Row: R; Insert: Partial<R> & Record<string, unknown>; Update: Partial<R> & Record<string, unknown>; Relationships: Rel }
  : T

type LoosenedTables = { [K in keyof Database["public"]["Tables"]]: LoosenTable<Database["public"]["Tables"][K]> }

// RPC Args: the generated type marks an optional (DEFAULT-having) SQL parameter as `T | undefined`
// (omittable) but not `T | null` (explicit null). Every service file in this app was written
// against the old convention of passing `paramValue ?? null` for an unset optional argument — which
// is exactly the SQL parameter's own default value in every such function, so allowing an explicit
// null here changes nothing about what Postgres actually receives/does.
type AllowNullArgs<T> = { [K in keyof T]: T[K] | null }
type LoosenedFunctions = {
  [K in keyof Database["public"]["Functions"]]: {
    Args: AllowNullArgs<Database["public"]["Functions"][K]["Args"]>
    Returns: Database["public"]["Functions"][K]["Returns"]
  }
}

// ============================================================================
// Phase 5 (Leave -> Attendance integration + Leave Reports) additions.
//
// The generated `Database` block above is only refreshed by `supabase gen
// types` against a database that has every migration applied. Migrations
// 0121-0123 add one table (leave_attendance_effects) and eight RPCs that the
// current generated block predates. Rather than edit the generated block (it
// is "never edited" — see the note above), these are layered on top of
// LoosenedTables/LoosenedFunctions here, exactly like the legacy-compat layer
// itself. Delete this section and regenerate once the live schema includes
// 0121-0123.
// ============================================================================
type Phase5LeaveAttendanceEffectRow = {
  id: string
  company_id: string
  employee_id: string
  leave_application_id: string
  attendance_date: string
  is_half_day: boolean
  half_day_session: string | null
  status: string
  created_at: string
  reversed_at: string | null
  reversed_by: string | null
}

type Phase5LeaveTables = {
  leave_attendance_effects: {
    Row: Phase5LeaveAttendanceEffectRow
    Insert: Partial<Phase5LeaveAttendanceEffectRow> & Record<string, unknown>
    Update: Partial<Phase5LeaveAttendanceEffectRow> & Record<string, unknown>
    Relationships: []
  }
}

type Phase5LeaveFunctions = {
  leave_materialize_attendance_dates: {
    Args: { p_application_id: string }
    Returns: undefined
  }
  leave_list_attendance_effects: {
    Args: { p_employee_id: string; p_from_date: string; p_to_date: string }
    Returns: {
      attendance_date: string
      is_half_day: boolean
      half_day_session: string | null
    }[]
  }
  leave_get_active_financial_year: {
    Args: Record<string, never>
    Returns: Database["public"]["Tables"]["leave_financial_years"]["Row"]
  }
  leave_list_my_applications: {
    Args: Record<string, never>
    Returns: {
      id: string
      company_id: string
      employee_id: string
      leave_type_id: string
      leave_type_name: string
      financial_year_id: string
      policy_id: string
      from_date: string
      to_date: string
      is_half_day: boolean
      half_day_session: string | null
      total_days: number
      reason: string | null
      remarks: string | null
      short_or_long: string | null
      status: string
      current_step: number
      applied_at: string
      decided_by: string | null
      decided_at: string | null
      decision_remark: string | null
      created_at: string
      approved_effect_days: number
      paid_days: number
      unpaid_days: number
    }[]
  }
  attendance_night_duty_list_mine: {
    Args: Record<string, never>
    Returns: {
      id: string
      employee_id: string
      employee_name: string
      attendance_record_id: string
      attendance_date: string
      punch_in_at: string | null
      actual_punch_out_at: string
      extra_duty_value: number
      night_ot_minutes: number
      payable_extra_duty_value: number | null
      payable_overtime_minutes: number | null
      approval_status: string
      om_id: string | null
      om_name: string | null
      om_action: string | null
      om_acted_at: string | null
      om_remark: string | null
      super_manager_id: string | null
      super_manager_name: string | null
      super_manager_action: string | null
      super_manager_acted_at: string | null
      super_manager_remark: string | null
      manager_confirmed_payable_out_at: string | null
      manager_remark: string | null
      created_at: string
      decided_stage: string | null
      decided_by_name: string | null
      decided_action: string | null
      decided_at: string | null
      decided_remark: string | null
    }[]
  }
  leave_list_my_leave_history: {
    Args: Record<string, never>
    Returns: {
      id: string
      employee_id: string
      employee_name: string
      employee_code: string | null
      leave_type_id: string
      leave_type_name: string
      from_date: string
      to_date: string
      total_days: number
      is_half_day: boolean
      short_or_long: string | null
      reason: string | null
      status: string
      current_step: number
      applied_at: string
      decided_action: string | null
      decided_by_name: string | null
      decided_role: string | null
      decided_step: number | null
      decided_at: string | null
      decision_remark: string | null
      approved_effect_days: number
      paid_days: number
      unpaid_days: number
    }[]
  }
  leave_get_paid_day_selection: {
    Args: { p_application_id: string }
    Returns: {
      effect_id: string
      attendance_date: string
      is_half_day: boolean
      half_day_session: string | null
      paid_status: string
      paid_units: number
      payroll_locked: boolean
    }[]
  }
  leave_set_paid_days: {
    Args: { p_application_id: string; p_paid_full_dates?: string[] | null; p_paid_half_dates?: string[] | null }
    Returns: {
      approved_days: number
      paid_days: number
      unpaid_days: number
      available_paid_balance: number
    }[]
  }
  leave_list_my_approval_history: {
    Args: { p_action: string }
    Returns: {
      id: string
      leave_application_id: string
      employee_id: string
      employee_name: string
      employee_code: string | null
      leave_type_id: string
      leave_type_name: string
      from_date: string
      to_date: string
      total_days: number
      short_or_long: string | null
      status: string
      reason: string | null
      applied_at: string
      acted_at: string
      approver_role: string
      step_order: number
      approver_employee_id: string
      approver_name: string
      remark: string | null
    }[]
  }
  leave_activate_financial_year: {
    Args: { p_financial_year_id: string }
    Returns: Database["public"]["Tables"]["leave_financial_years"]["Row"]
  }
  leave_accrual_run: {
    Args: {
      p_financial_year_id: string
      p_policy_id: string
      p_leave_type_id: string
      p_up_to_month?: string | null
      p_dry_run?: boolean | null
    }
    Returns: {
      employee_id: string
      employee_name: string
      employee_code: string
      eligible: boolean
      entitlement_days: number
      already_posted_days: number
      to_post_days: number
      to_post_months: number
      posted: boolean
    }[]
  }
  leave_preview_total_days: {
    Args: {
      p_leave_type_id: string
      p_from_date: string
      p_to_date: string
      p_is_half_day?: boolean | null
    }
    Returns: number | null
  }
  leave_report_applications: {
    Args: { p_from_date?: string | null; p_to_date?: string | null }
    Returns: {
      id: string
      employee_id: string
      employee_name: string
      employee_code: string
      store_id: string | null
      store_name: string | null
      department_id: string | null
      department_name: string | null
      leave_type_id: string
      leave_type_name: string
      financial_year_id: string
      from_date: string
      to_date: string
      total_days: number
      is_half_day: boolean
      short_or_long: string
      status: string
      applied_at: string
      decided_by: string | null
      decided_at: string | null
      decision_remark: string | null
      pending_with: string | null
      paid_days: number
      unpaid_days: number
    }[]
  }
  leave_report_balances: {
    Args: { p_financial_year_id: string }
    Returns: {
      employee_id: string
      employee_name: string
      employee_code: string
      leave_type_id: string
      leave_type_name: string
      earned: number
      used: number
      pending: number
      available: number
    }[]
  }
  leave_report_probation: {
    Args: { p_company_id: string }
    Returns: {
      employee_id: string
      employee_name: string
      employee_code: string
      joining_date: string
      policy_id: string
      probation_duration_value: number
      probation_duration_unit: string
      post_probation_start_rule: string
      eligibility_start: string | null
      is_currently_in_probation: boolean
    }[]
  }
  leave_list_fy_closing_batches_for_company: {
    Args: { p_company_id: string }
    Returns: Database["public"]["Functions"]["leave_get_fy_closing_batch"]["Returns"][]
  }
  leave_report_policy_changes: {
    Args: { p_company_id: string }
    Returns: {
      policy_id: string
      policy_name: string
      version_number: number
      previous_version_id: string | null
      status: string
      change_reason: string | null
      approved_by: string | null
      approved_at: string | null
      created_at: string
      audit_action: string | null
      audit_changed_data: Json | null
      audit_performed_by: string | null
      audit_performed_at: string | null
    }[]
  }
  leave_report_audit: {
    Args: { p_company_id: string; p_from_date?: string | null; p_to_date?: string | null }
    Returns: {
      id: string
      table_name: string
      record_id: string
      action: string
      changed_data: Json | null
      performed_by: string | null
      performed_at: string
    }[]
  }
}

// ============================================================================
// Advance Management — Phase 1 (migrations 0132 + 0133) additions.
//
// Same rationale as the Phase 5 Leave block above: the generated `Database`
// block predates these migrations, so the eleven advance_* tables and their
// RPCs are layered on here (loose Insert/Update, exactly like Phase5LeaveTables).
// Delete this section and regenerate once the live schema includes 0132-0133.
// ============================================================================
type AdvanceTypeRow = {
  id: string
  company_id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  requires_document: boolean
  allows_multiple: boolean
  remark: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvancePolicyRow = {
  id: string
  company_id: string
  name: string
  code: string
  description: string | null
  status: string
  version_number: number
  previous_version_id: string | null
  effective_from: string
  effective_to: string | null
  change_reason: string | null
  approved_by: string | null
  approved_at: string | null
  remark: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvancePolicyConfigRow = {
  id: string
  company_id: string
  policy_id: string
  max_amount: number | null
  max_pct_of_salary: number | null
  min_service_months: number
  max_active_advances: number
  max_installments: number
  min_installment_amount: number | null
  allow_multiple_advances: boolean
  allow_early_settlement: boolean
  allow_partial_payment: boolean
  allow_partial_recovery: boolean
  manager_approval_required: boolean
  boss_final_approval_required: boolean
  boss_can_modify_amount: boolean
  boss_can_increase_amount: boolean
  max_boss_approval_limit: number | null
  modification_reason_mandatory: boolean
  recovery_start_rule: string
  remark: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvancePolicyAssignmentRow = {
  id: string
  company_id: string
  policy_id: string
  scope_type: string
  employee_id: string | null
  store_id: string | null
  store_designation_id: string | null
  store_department_id: string | null
  employment_type: string | null
  effective_from: string
  effective_to: string | null
  is_active: boolean
  remark: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
// Migration 0155 — Policy -> Advance Type restriction (zero rows = all types).
type AdvancePolicyTypeRow = {
  id: string
  company_id: string
  policy_id: string
  advance_type_id: string
  created_by: string | null
  created_at: string
}
// Migration 0155 — advance_validate_policy() checklist row (read-only, no table backs this).
type AdvancePolicyValidationRow = {
  check_key: string
  label: string
  passed: boolean
  detail: string
}
type AdvanceFinalApproverRow = {
  id: string
  company_id: string
  employee_id: string
  is_active: boolean
  max_approval_limit: number | null
  can_modify_amount: boolean
  can_increase_amount: boolean
  backup_approver_employee_id: string | null
  remark: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvanceProcessorRow = {
  id: string
  company_id: string
  employee_id: string
  is_active: boolean
  remark: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvanceNotificationSettingRow = {
  id: string
  company_id: string
  event_type: string
  in_app_enabled: boolean
  push_enabled: boolean
  email_enabled: boolean
  sms_enabled: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvanceRequestRow = {
  id: string
  company_id: string
  employee_id: string
  advance_type_id: string
  policy_id: string
  policy_version: number
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  boss_modification_reason: string | null
  reason: string
  remarks: string | null
  status: string
  current_step: number
  requested_at: string
  decided_by: string | null
  decided_at: string | null
  decision_remark: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvanceRequestDocumentRow = {
  id: string
  advance_request_id: string
  doc_kind: string
  storage_path: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  created_by: string | null
  created_at: string
}
type AdvanceApprovalActionRow = {
  id: string
  company_id: string
  advance_request_id: string
  step_order: number
  actor_role: string
  actor_employee_id: string
  action: string
  old_amount: number | null
  new_amount: number | null
  remark: string | null
  acted_at: string
  created_at: string
}
type AdvanceHrProcessRow = {
  id: string
  company_id: string
  advance_request_id: string
  employee_id: string
  boss_approved_amount: number
  status: string
  processed_by: string | null
  processed_at: string | null
  hold_reason: string | null
  send_back_reason: string | null
  process_remarks: string | null
  verification_status: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvanceHrProcessActionTableRow = {
  id: string
  company_id: string
  advance_request_id: string
  hr_process_id: string
  actor_employee_id: string
  action: string
  remark: string | null
  old_status: string | null
  new_status: string | null
  acted_at: string
  created_at: string
}
type LooseAdvanceTable<R> = {
  Row: R
  Insert: Partial<R> & Record<string, unknown>
  Update: Partial<R> & Record<string, unknown>
  Relationships: []
}
type AdvanceTables = {
  advance_types: LooseAdvanceTable<AdvanceTypeRow>
  advance_policies: LooseAdvanceTable<AdvancePolicyRow>
  advance_policy_configs: LooseAdvanceTable<AdvancePolicyConfigRow>
  advance_policy_assignments: LooseAdvanceTable<AdvancePolicyAssignmentRow>
  advance_policy_types: LooseAdvanceTable<AdvancePolicyTypeRow>
  advance_final_approvers: LooseAdvanceTable<AdvanceFinalApproverRow>
  advance_hr_processors: LooseAdvanceTable<AdvanceProcessorRow>
  advance_finance_processors: LooseAdvanceTable<AdvanceProcessorRow>
  advance_notification_settings: LooseAdvanceTable<AdvanceNotificationSettingRow>
  advance_requests: LooseAdvanceTable<AdvanceRequestRow>
  advance_request_documents: LooseAdvanceTable<AdvanceRequestDocumentRow>
  advance_approval_actions: LooseAdvanceTable<AdvanceApprovalActionRow>
  advance_hr_processes: LooseAdvanceTable<AdvanceHrProcessRow>
  advance_hr_process_actions: LooseAdvanceTable<AdvanceHrProcessActionTableRow>
  advance_payment_modes: LooseAdvanceTable<AdvancePaymentModeRow>
  advance_finance_payments: LooseAdvanceTable<AdvanceFinancePaymentRow>
  advance_finance_payment_actions: LooseAdvanceTable<AdvanceFinancePaymentActionTableRow>
  advance_payroll_periods: LooseAdvanceTable<AdvancePayrollPeriodRow>
  advance_recovery_plans: LooseAdvanceTable<AdvanceRecoveryPlanTableRow>
  advance_recovery_installments: LooseAdvanceTable<AdvanceRecoveryInstallmentTableRow>
  advance_recovery_transactions: LooseAdvanceTable<AdvanceRecoveryTransactionTableRow>
  advance_recovery_settlements: LooseAdvanceTable<AdvanceRecoverySettlementTableRow>
  payroll_policies: LooseAdvanceTable<PayrollGenericRow>
  payroll_salary_components: LooseAdvanceTable<PayrollGenericRow>
  payroll_periods: LooseAdvanceTable<PayrollGenericRow>
  payroll_runs: LooseAdvanceTable<PayrollGenericRow>
  payroll_employee_results: LooseAdvanceTable<PayrollGenericRow>
  payroll_lines: LooseAdvanceTable<PayrollGenericRow>
  payslips: LooseAdvanceTable<PayrollGenericRow>
  // Phase 5A (migration 0138) — Dynamic Salary Bifurcation
  salary_structures: LooseAdvanceTable<PayrollGenericRow>
  salary_structure_components: LooseAdvanceTable<PayrollGenericRow>
  salary_slab_rules: LooseAdvanceTable<PayrollGenericRow>
  salary_structure_assignments: LooseAdvanceTable<PayrollGenericRow>
  employee_salary_assignments: LooseAdvanceTable<PayrollGenericRow>
  // Phase 6 (migration 0139) — Payroll Policy Engine
  payroll_statutory_rules: LooseAdvanceTable<PayrollGenericRow>
  payroll_pt_slabs: LooseAdvanceTable<PayrollGenericRow>
  payroll_deduction_order: LooseAdvanceTable<PayrollGenericRow>
  // PF/ESI manual + Excel-imported amounts (migration 0143)
  payroll_component_amounts: LooseAdvanceTable<PayrollGenericRow>
  payroll_component_import_batches: LooseAdvanceTable<PayrollGenericRow>
  payroll_component_amount_audit: LooseAdvanceTable<PayrollGenericRow>
  // Full & Final Settlement (migrations 0145 / 0146)
  exit_approvers: LooseAdvanceTable<PayrollGenericRow>
  exit_notice_policies: LooseAdvanceTable<PayrollGenericRow>
  fnf_settings: LooseAdvanceTable<PayrollGenericRow>
  fnf_settlements: LooseAdvanceTable<PayrollGenericRow>
  fnf_lines: LooseAdvanceTable<PayrollGenericRow>
  fnf_adjustments: LooseAdvanceTable<PayrollGenericRow>
  fnf_events: LooseAdvanceTable<PayrollGenericRow>
  fnf_payments: LooseAdvanceTable<PayrollGenericRow>
  // Employee Exit Request workflow + Exit Type master (migration 0147)
  exit_types: LooseAdvanceTable<PayrollGenericRow>
  employee_exit_requests: LooseAdvanceTable<PayrollGenericRow>
  employee_exit_request_decisions: LooseAdvanceTable<PayrollGenericRow>
  // Employee Transfer module (migration 0148)
  transfer_approvers: LooseAdvanceTable<PayrollGenericRow>
  employee_assignment_history: LooseAdvanceTable<PayrollGenericRow>
  employee_transfer_requests: LooseAdvanceTable<PayrollGenericRow>
  employee_transfer_decisions: LooseAdvanceTable<PayrollGenericRow>
  // Phase 7 (migration 0140) — Payroll Master Enhancement
  employee_grades: LooseAdvanceTable<PayrollGenericRow>
  employee_categories: LooseAdvanceTable<PayrollGenericRow>
  payroll_policy_assignments: LooseAdvanceTable<PayrollGenericRow>
  payroll_policy_change_history: LooseAdvanceTable<PayrollGenericRow>
  store_payroll_calendars: LooseAdvanceTable<PayrollGenericRow>
  tds_policies: LooseAdvanceTable<PayrollGenericRow>
  tds_slabs: LooseAdvanceTable<PayrollGenericRow>
  tds_employee_declarations: LooseAdvanceTable<PayrollGenericRow>
  tds_calculations: LooseAdvanceTable<PayrollGenericRow>
}

type AdvanceApplyContextRow = {
  employee_id: string
  employee_name: string
  employee_code: string | null
  policy_id: string | null
  policy_name: string | null
  policy_version: number | null
  service_months: number
  active_advance_count: number
  reporting_manager_configured: boolean
  boss_configured: boolean
  max_amount: number | null
  max_pct_of_salary: number | null
  max_allowed_amount: number | null
  min_service_months: number | null
  max_active_advances: number | null
  allow_multiple_advances: boolean | null
  manager_approval_required: boolean | null
  boss_final_approval_required: boolean | null
  max_installments: number | null
  default_installment_count: number | null
  min_installment_amount: number | null
  eligible: boolean
  ineligible_reason: string | null
}
type AdvanceMyRequestRow = {
  id: string
  company_id: string
  employee_id: string
  advance_type_id: string
  advance_type_name: string
  policy_id: string
  policy_name: string
  policy_version: number
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  boss_modification_reason: string | null
  reason: string
  remarks: string | null
  status: string
  current_step: number
  requested_at: string
  decided_at: string | null
  decision_remark: string | null
  paid_amount: number | null
  payment_date: string | null
  payment_mode_label: string | null
  requested_installment_count: number | null
  manager_recommended_installment_count: number | null
  boss_final_installment_count: number | null
}
type AdvanceManagerPendingRow = {
  id: string
  employee_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  requested_amount: number
  reason: string
  requested_at: string
  status: string
  requested_installment_count: number | null
}
type AdvanceBossPendingRow = {
  id: string
  employee_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  requested_amount: number
  manager_recommended_amount: number | null
  reason: string
  requested_at: string
  status: string
  requested_installment_count: number | null
  manager_recommended_installment_count: number | null
}
type AdvanceMyDecisionRow = {
  id: string
  advance_request_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  status: string
  my_role: string
  my_action: string
  my_old_amount: number | null
  my_new_amount: number | null
  my_remark: string | null
  acted_at: string
  requested_at: string
}
type AdvanceApprovalHistoryRow = {
  step_order: number
  actor_role: string
  actor_employee_id: string
  actor_name: string
  action: string
  old_amount: number | null
  new_amount: number | null
  remark: string | null
  acted_at: string
}

// ---- Phase 2 (migration 0134) — HR Process Execution ----
type AdvanceHrPendingRow = {
  id: string
  employee_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  reason: string
  requested_at: string
  approval_completed_at: string | null
  status: string
}
type AdvanceHrProcessDetailRow = {
  advance_request_id: string
  employee_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  policy_name: string
  policy_version: number
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  reason: string
  remarks: string | null
  request_status: string
  requested_at: string
  approval_completed_at: string | null
  document_count: number
  hr_process_id: string | null
  hr_status: string | null
  hold_reason: string | null
  send_back_reason: string | null
  process_remarks: string | null
  verification_status: string | null
  processed_by_name: string | null
  processed_at: string | null
}
type AdvanceHrProcessActionRow = {
  action: string
  actor_employee_id: string
  actor_name: string
  remark: string | null
  old_status: string | null
  new_status: string | null
  acted_at: string
}
type AdvanceHrHistoryRow = {
  id: string
  employee_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  reason: string
  requested_at: string
  approval_completed_at: string | null
  status: string
  hr_status: string | null
  hold_reason: string | null
  send_back_reason: string | null
  processed_at: string | null
}

// ---- Phase 3 (migration 0135) — Finance Payment ----
type AdvancePaymentModeRow = {
  id: string
  company_id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  requires_reference: boolean
  sort_order: number
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvanceFinancePaymentRow = {
  id: string
  company_id: string
  advance_request_id: string
  employee_id: string
  boss_approved_amount: number
  payment_amount: number | null
  payment_date: string | null
  payment_mode_id: string | null
  payment_mode: string | null
  payment_mode_label: string | null
  transaction_reference: string | null
  utr_number: string | null
  bank_reference: string | null
  payment_proof_path: string | null
  payment_remarks: string | null
  hold_reason: string | null
  status: string
  processed_by: string | null
  processed_at: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvanceFinancePaymentActionTableRow = {
  id: string
  company_id: string
  advance_request_id: string
  finance_payment_id: string
  actor_employee_id: string
  action: string
  old_status: string | null
  new_status: string | null
  old_payment_amount: number | null
  new_payment_amount: number | null
  remark: string | null
  acted_at: string
  created_at: string
}
type AdvanceFinancePendingRow = {
  id: string
  employee_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  hr_processed_at: string | null
  reason: string
  requested_at: string
  status: string
}
type AdvanceFinanceHistoryRow = {
  id: string
  employee_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  status: string
  finance_status: string | null
  payment_amount: number | null
  payment_date: string | null
  payment_mode: string | null
  payment_mode_label: string | null
  transaction_reference: string | null
  utr_number: string | null
  bank_reference: string | null
  hold_reason: string | null
  processed_by_name: string | null
  processed_at: string | null
}
type AdvanceFinancePaymentDetailRow = {
  advance_request_id: string
  employee_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  policy_name: string
  policy_version: number
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  max_payable_amount: number | null
  allow_partial_payment: boolean
  reason: string
  remarks: string | null
  request_status: string
  requested_at: string
  document_count: number
  hr_processed_amount: number | null
  hr_processed_at: string | null
  hr_process_remarks: string | null
  hr_processed_by_name: string | null
  finance_payment_id: string | null
  finance_status: string | null
  payment_amount: number | null
  payment_date: string | null
  payment_mode: string | null
  payment_mode_label: string | null
  transaction_reference: string | null
  utr_number: string | null
  bank_reference: string | null
  payment_proof_path: string | null
  payment_remarks: string | null
  hold_reason: string | null
  processed_by_name: string | null
  processed_at: string | null
}
type AdvanceFinancePaymentActionRow = {
  action: string
  actor_employee_id: string
  actor_name: string
  old_status: string | null
  new_status: string | null
  old_payment_amount: number | null
  new_payment_amount: number | null
  remark: string | null
  acted_at: string
}

// ---- Phase 4 (migration 0136) — Payroll Recovery ----
type AdvancePayrollPeriodRow = {
  id: string
  company_id: string
  period_month: string
  label: string | null
  status: string
  finalized_by: string | null
  finalized_at: string | null
  reversed_by: string | null
  reversed_at: string | null
  reverse_reason: string | null
  remark: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvanceRecoveryPlanTableRow = {
  id: string
  company_id: string
  advance_request_id: string
  employee_id: string
  actual_paid_amount: number
  payment_date: string | null
  policy_id: string | null
  policy_version: number | null
  recovery_method: string
  installment_count: number | null
  monthly_amount: number | null
  recovery_start_date: string
  total_scheduled: number
  total_recovered: number
  total_settled: number
  total_reversed: number
  outstanding_amount: number
  status: string
  closed_reason: string | null
  settled_at: string | null
  closed_at: string | null
  payslip_component_label: string
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
type AdvanceRecoveryInstallmentTableRow = {
  id: string
  company_id: string
  advance_request_id: string
  recovery_plan_id: string
  employee_id: string
  installment_number: number
  due_month: string
  scheduled_amount: number
  recovered_amount: number
  outstanding_after: number | null
  status: string
  payroll_period_id: string | null
  processed_at: string | null
  created_at: string
  updated_at: string
}
type AdvanceRecoveryTransactionTableRow = {
  id: string
  company_id: string
  advance_request_id: string
  recovery_plan_id: string
  employee_id: string
  payroll_period_id: string | null
  period_month: string | null
  installment_number: number | null
  txn_type: string
  scheduled_amount: number | null
  amount: number
  opening_outstanding: number
  closing_outstanding: number
  deduction_date: string | null
  reverses_transaction_id: string | null
  remark: string | null
  processed_by: string | null
  processed_at: string | null
  created_at: string
}
type AdvanceRecoverySettlementTableRow = {
  id: string
  company_id: string
  advance_request_id: string
  recovery_plan_id: string
  employee_id: string
  outstanding_before: number
  settlement_amount: number
  outstanding_after: number
  settlement_date: string
  payment_mode_id: string | null
  payment_mode: string | null
  payment_mode_label: string | null
  transaction_reference: string | null
  remarks: string | null
  processed_by: string | null
  processed_at: string | null
  created_at: string
}
type AdvanceMyRecoveryRow = {
  advance_request_id: string
  advance_type_name: string
  actual_paid_amount: number
  total_recovered: number
  total_settled: number
  outstanding_amount: number
  recovery_method: string
  installment_count: number | null
  monthly_amount: number | null
  recovery_start_date: string
  next_due_month: string | null
  completed_installments: number
  total_installments: number
  status: string
  closed_reason: string | null
}
type AdvanceRecoveryPlanListRow = AdvanceMyRecoveryRow & {
  employee_id: string
  employee_name: string
  employee_code: string | null
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
}
type AdvanceRecoveryDetailRow = {
  advance_request_id: string
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  policy_name: string
  policy_version: number
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  actual_paid_amount: number
  payment_date: string | null
  total_recovered: number
  total_settled: number
  total_reversed: number
  outstanding_amount: number
  recovery_method: string
  installment_count: number | null
  monthly_amount: number | null
  recovery_start_date: string
  next_due_month: string | null
  last_deduction_date: string | null
  status: string
  closed_reason: string | null
  recovery_enabled: boolean
  allow_early_settlement: boolean
}
type AdvanceRecoveryInstallmentListRow = {
  installment_number: number
  due_month: string
  scheduled_amount: number
  recovered_amount: number
  outstanding_after: number | null
  status: string
  processed_at: string | null
}
type AdvanceRecoveryTxnListRow = {
  kind: string
  period_month: string | null
  installment_number: number | null
  scheduled_amount: number | null
  amount: number
  opening_outstanding: number
  closing_outstanding: number
  txn_date: string | null
  actor_name: string | null
  remark: string | null
  acted_at: string
}
// Migration 0157 — HR pre-payroll-lock recovery schedule adjustment.
type AdvanceRecoveryScheduleRow = {
  installment_number: number
  due_month: string
  scheduled_amount: number
  status: string
}
type AdvanceRecoveryInstallmentAdjustmentRow = {
  batch_id: string
  adjustment_scope: string
  installment_number: number | null
  due_month: string | null
  old_scheduled_amount: number
  new_scheduled_amount: number
  adjustment_type: string
  reason: string
  processed_by_name: string | null
  payroll_lock_status_at_time: string | null
  created_at: string
}
type AdvanceRecoveryPeriodListRow = {
  id: string
  company_id: string
  period_month: string
  label: string | null
  status: string
  finalized_at: string | null
  reversed_at: string | null
  reverse_reason: string | null
  deduction_count: number
  deducted_total: number
}
type AdvanceRecoveryRunRow = {
  advance_request_id: string
  employee_id: string
  employee_name: string
  installment_number: number
  scheduled_amount: number
  deducted_amount: number
  opening_outstanding: number
  closing_outstanding: number
  plan_status: string
}

// ---- Phase 5 (migration 0137) — Payroll Engine ----
type PayrollGenericRow = { [k: string]: unknown }
type PayrollPeriodListRow = {
  id: string
  period_month: string
  period_start_date: string
  period_end_date: string
  label: string | null
  status: string
  current_run_id: string | null
  run_status: string | null
  employee_count: number | null
  gross_total: number | null
  deduction_total: number | null
  advance_recovery_total: number | null
  net_total: number | null
  finalized_at: string | null
  locked_at: string | null
}
type PayrollRunResultRow = {
  id: string
  employee_id: string
  employee_code: string | null
  employee_name: string | null
  department: string | null
  designation: string | null
  store: string | null
  basic: number
  da: number
  paid_days: number
  unpaid_days: number
  lwp_days: number
  gross_earnings: number
  total_deductions: number
  advance_recovery_amount: number
  net_salary: number
  employer_contribution_total: number | null
  salary_structure_id: string | null
  gross_from_structure: number | null
  structure_reconciled: boolean | null
  has_negative_net: boolean
  needs_review: boolean
  review_notes: string | null
  status: string
}
type PayrollEmployeeResultRow = {
  result_id: string
  payroll_run_id: string
  run_status: string
  period_month: string
  employee_id: string
  employee_code: string | null
  employee_name: string | null
  department: string | null
  designation: string | null
  store: string | null
  salary_effective_from: string | null
  basic: number
  da: number
  calendar_days: number
  working_days: number
  present_days: number
  paid_leave_days: number
  lwp_days: number
  weekly_off_days: number
  holiday_days: number
  absent_days: number
  paid_days: number
  unpaid_days: number
  gross_earnings: number
  total_deductions: number
  advance_recovery_amount: number
  net_salary: number
  employer_contribution_total: number | null
  salary_structure_id: string | null
  structure_name: string | null
  gross_from_structure: number | null
  structure_reconciled: boolean | null
  payroll_policy_id: string | null
  policy_snapshot: Json | null
  proration_factor: number | null
  lwp_deduction_amount: number | null
  statutory_deduction_total: number | null
  store_calendar_id: string | null
  store_calendar_snapshot: Json | null
  exit_proration_amount: number | null
  eligible_days: number | null
  salary_structure_scope: string | null
  payroll_policy_scope: string | null
  leaving_date_snapshot: string | null
  has_negative_net: boolean
  needs_review: boolean
  review_notes: string | null
  status: string
}
type PayrollLineRow = {
  line_type: string
  code: string
  name: string
  quantity: number | null
  rate: number | null
  amount: number
  source: string | null
  calc_type: string | null
  calc_base: string | null
  calc_rate: number | null
  calc_formula: string | null
  calculation_ref: string | null
  is_reversal: boolean
  sort_order: number
}
type PayrollMyPayslipRow = {
  result_id: string
  payslip_id: string | null
  payslip_number: string | null
  period_month: string
  run_status: string
  gross_earnings: number
  total_deductions: number
  advance_recovery_amount: number
  net_salary: number
  status: string
}
type PayrollAdvanceRecoveryReportRow = {
  employee_name: string
  employee_code: string | null
  advance_type_name: string
  actual_paid_amount: number
  recovered_this_period: number
  total_recovered: number
  outstanding_amount: number
  period_month: string
}
type SalaryBifurcateRow = {
  code: string
  name: string
  category: string
  calculation_type: string
  calc_base: string | null
  calc_rate: number | null
  calc_formula: string | null
  amount: number
  included_in_gross: boolean
  included_in_ctc?: boolean
  is_statutory: boolean
  statutory_kind?: string | null
  display_order?: number
  is_basic?: boolean
}
type SalaryResolveRow = {
  gross_salary: number
  salary_structure_id: string | null
  structure_name: string | null
  source: string | null
  ambiguous: boolean
  resolve_note: string | null
}
type SalaryStructureValidateRow = { ok: boolean; error: string | null }
type SalaryStructureListRow = { [k: string]: unknown }
type SalaryEmployeeAssignmentRow = {
  id: string
  gross_salary: number
  salary_structure_id: string | null
  structure_name: string | null
  effective_from: string
  effective_to: string | null
  reason: string | null
  remark: string | null
  created_at: string
  // migration 0178 — revision audit trail (optional so older rows/servers still type-check)
  previous_gross?: number | null
  previous_structure_name?: string | null
  resolved_structure_id?: string | null
  resolved_structure_name?: string | null
  resolved_structure_code?: string | null
  assigned_by_name?: string | null
}
// ---- Advance Management Ledger (migration 0154) — operational, staff-wise ledger. Additive only;
// none of the Advance row/function types above are touched. ----
type AdvanceLedgerStoreRow = { id: string; name: string }
type AdvanceLedgerRow = {
  employee_id: string
  employee_code: string | null
  full_name: string
  mobile: string | null
  email: string | null
  store_id: string | null
  store_name: string | null
  department_name: string | null
  designation_title: string | null
  advance_count: number
  total_approved: number
  total_paid: number
  total_recovered: number
  total_outstanding: number
  derived_status: string
}
type AdvanceLedgerListRow = AdvanceLedgerRow & { total_count: number }
type AdvanceLedgerSummaryRow = {
  total_staff: number
  total_approved: number
  total_paid: number
  total_recovered: number
  total_outstanding: number
}
type AdvanceLedgerEmployeeAdvanceRow = {
  advance_request_id: string
  advance_type_name: string
  request_date: string
  requested_amount: number
  manager_recommended_amount: number | null
  boss_approved_amount: number | null
  actual_paid_amount: number | null
  payment_date: string | null
  recovery_start_date: string | null
  total_recovered: number
  outstanding_amount: number
  status: string
}
type AdvanceLedgerFunctions = {
  advance_ledger_stores: { Args: Record<string, never>; Returns: AdvanceLedgerStoreRow[] }
  advance_ledger_list: {
    Args: {
      p_store_id?: string | null
      p_department_id?: string | null
      p_designation_id?: string | null
      p_employee_id?: string | null
      p_status?: string | null
      p_search?: string | null
      p_date_from?: string | null
      p_date_to?: string | null
      p_show_all?: boolean
      p_limit?: number
      p_offset?: number
    }
    Returns: AdvanceLedgerListRow[]
  }
  advance_ledger_summary: {
    Args: {
      p_store_id?: string | null
      p_department_id?: string | null
      p_designation_id?: string | null
      p_employee_id?: string | null
      p_status?: string | null
      p_search?: string | null
      p_date_from?: string | null
      p_date_to?: string | null
      p_show_all?: boolean
    }
    Returns: AdvanceLedgerSummaryRow[]
  }
  advance_ledger_employee_advances: { Args: { p_employee_id: string }; Returns: AdvanceLedgerEmployeeAdvanceRow[] }
  // ---- migration 0168 — HR Panel Advance Workflow consolidation ----
  advance_hr_workflow_list: { Args: Record<string, never>; Returns: AdvanceHrWorkflowRow[] }
}
type AdvanceHrWorkflowRow = {
  id: string; employee_id: string; employee_name: string; employee_code: string | null; store_name: string | null
  advance_type_name: string; status: string; requested_amount: number; manager_recommended_amount: number | null
  boss_approved_amount: number | null; requested_installment_count: number | null
  manager_recommended_installment_count: number | null; boss_final_installment_count: number | null
  requested_at: string; decided_at: string | null; decided_by_name: string | null; hr_processed_at: string | null
  hr_hold_reason: string | null; hr_send_back_reason: string | null; payment_amount: number | null
  payment_date: string | null; payment_mode_label: string | null; finance_hold_reason: string | null
  receipt_status: string; total_recovered: number | null; outstanding_amount: number | null; recovery_status: string | null
  reason: string; reporting_manager_id: string | null; reporting_manager_name: string | null
}
type AdvanceFunctions = {
  advance_get_apply_context: { Args: Record<string, never>; Returns: AdvanceApplyContextRow[] }
  advance_apply: {
    Args: {
      p_advance_type_id: string
      p_requested_amount: number
      p_reason: string
      p_remarks?: string | null
      p_document_storage_path?: string | null
      p_document_file_name?: string | null
      p_document_mime_type?: string | null
      p_document_file_size_bytes?: number | null
      p_installment_count?: number | null
    }
    Returns: AdvanceRequestRow
  }
  advance_manager_decide: {
    Args: {
      p_request_id: string
      p_decision: string
      p_recommended_amount?: number | null
      p_remark?: string | null
      p_recommended_installment_count?: number | null
    }
    Returns: AdvanceRequestRow
  }
  advance_boss_decide: {
    Args: {
      p_request_id: string
      p_decision: string
      p_approved_amount?: number | null
      p_modification_reason?: string | null
      p_remark?: string | null
      p_final_installment_count?: number | null
    }
    Returns: AdvanceRequestRow
  }
  advance_cancel: { Args: { p_request_id: string; p_remark?: string | null }; Returns: AdvanceRequestRow }
  advance_list_my_requests: { Args: Record<string, never>; Returns: AdvanceMyRequestRow[] }
  advance_list_manager_pending: { Args: Record<string, never>; Returns: AdvanceManagerPendingRow[] }
  advance_list_boss_pending: { Args: Record<string, never>; Returns: AdvanceBossPendingRow[] }
  advance_list_my_decisions: { Args: Record<string, never>; Returns: AdvanceMyDecisionRow[] }
  advance_list_approval_history: { Args: { p_request_id: string }; Returns: AdvanceApprovalHistoryRow[] }
  advance_resolve_direct_manager: { Args: { p_employee_id: string }; Returns: string | null }
  advance_am_i_manager: { Args: { p_employee_id: string }; Returns: boolean }
  advance_am_i_boss: { Args: { p_employee_id: string }; Returns: boolean }
  advance_am_i_hr: { Args: { p_employee_id: string }; Returns: boolean }
  advance_am_i_finance: { Args: { p_employee_id: string }; Returns: boolean }
  advance_resolve_final_approver: { Args: { p_company_id: string }; Returns: string | null }

  // ---- Migration 0155 — Policy configuration completion ----
  advance_validate_policy: { Args: { p_policy_id: string }; Returns: AdvancePolicyValidationRow[] }
  advance_activate_policy: { Args: { p_policy_id: string; p_change_reason?: string | null }; Returns: AdvancePolicyRow }

  // ---- Phase 2 (migration 0134) — HR Process Execution ----
  advance_list_hr_pending: { Args: Record<string, never>; Returns: AdvanceHrPendingRow[] }
  advance_list_hr_history: { Args: Record<string, never>; Returns: AdvanceHrHistoryRow[] }
  advance_get_hr_process: { Args: { p_advance_request_id: string }; Returns: AdvanceHrProcessDetailRow[] }
  advance_list_hr_process_actions: { Args: { p_advance_request_id: string }; Returns: AdvanceHrProcessActionRow[] }
  advance_hr_process: { Args: { p_advance_request_id: string; p_remarks?: string | null }; Returns: AdvanceRequestRow }
  advance_hr_hold: { Args: { p_advance_request_id: string; p_reason: string }; Returns: AdvanceRequestRow }
  advance_hr_send_back: { Args: { p_advance_request_id: string; p_reason: string }; Returns: AdvanceRequestRow }
  advance_hr_resume: { Args: { p_advance_request_id: string; p_remark?: string | null }; Returns: AdvanceRequestRow }

  // ---- Phase 3 (migration 0135) — Finance Payment (advance_am_i_finance declared above) ----
  advance_list_finance_pending: { Args: Record<string, never>; Returns: AdvanceFinancePendingRow[] }
  advance_list_finance_history: { Args: Record<string, never>; Returns: AdvanceFinanceHistoryRow[] }
  advance_get_finance_payment: { Args: { p_advance_request_id: string }; Returns: AdvanceFinancePaymentDetailRow[] }
  advance_list_finance_payment_actions: { Args: { p_advance_request_id: string }; Returns: AdvanceFinancePaymentActionRow[] }
  advance_finance_start: { Args: { p_advance_request_id: string }; Returns: AdvanceRequestRow }
  advance_finance_pay: {
    Args: {
      p_advance_request_id: string
      p_payment_amount: number
      p_payment_date: string
      p_payment_mode_id: string
      p_transaction_reference?: string | null
      p_utr_number?: string | null
      p_bank_reference?: string | null
      p_payment_remarks?: string | null
      p_payment_proof_path?: string | null
    }
    Returns: AdvanceRequestRow
  }
  advance_finance_hold: { Args: { p_advance_request_id: string; p_reason: string }; Returns: AdvanceRequestRow }
  advance_finance_resume: { Args: { p_advance_request_id: string; p_remark?: string | null }; Returns: AdvanceRequestRow }

  // ---- Phase 4 (migration 0136) — Payroll Recovery ----
  advance_recovery_generate_plan: {
    Args: {
      p_advance_request_id: string
      p_start_date?: string | null
      p_installment_count?: number | null
      p_monthly_amount?: number | null
      p_custom_schedule?: Json | null
    }
    Returns: AdvanceRecoveryPlanTableRow
  }
  advance_recovery_create_period: { Args: { p_period_month: string; p_company_id?: string | null; p_label?: string | null }; Returns: AdvancePayrollPeriodRow }
  advance_recovery_run_period: { Args: { p_payroll_period_id: string; p_employee_id?: string | null }; Returns: AdvanceRecoveryRunRow[] }
  advance_recovery_finalize_period: { Args: { p_payroll_period_id: string }; Returns: AdvancePayrollPeriodRow }
  advance_recovery_reverse_period: { Args: { p_payroll_period_id: string; p_reason: string }; Returns: AdvancePayrollPeriodRow }
  advance_recovery_settle: {
    Args: {
      p_advance_request_id: string
      p_settlement_amount: number
      p_settlement_date: string
      p_payment_mode_id?: string | null
      p_transaction_reference?: string | null
      p_remarks?: string | null
    }
    Returns: AdvanceRecoveryPlanTableRow
  }
  advance_recovery_close: { Args: { p_advance_request_id: string; p_remark?: string | null }; Returns: AdvanceRecoveryPlanTableRow }
  advance_list_my_recoveries: { Args: Record<string, never>; Returns: AdvanceMyRecoveryRow[] }
  advance_recovery_list_plans: { Args: { p_status?: string | null }; Returns: AdvanceRecoveryPlanListRow[] }
  advance_get_recovery_detail: { Args: { p_advance_request_id: string }; Returns: AdvanceRecoveryDetailRow[] }
  advance_list_recovery_installments: { Args: { p_advance_request_id: string }; Returns: AdvanceRecoveryInstallmentListRow[] }
  advance_list_recovery_transactions: { Args: { p_advance_request_id: string }; Returns: AdvanceRecoveryTxnListRow[] }
  advance_recovery_list_periods: { Args: Record<string, never>; Returns: AdvanceRecoveryPeriodListRow[] }

  // ---- Migration 0157 — Installment selection + HR recovery schedule adjustment ----
  advance_recovery_adjust_installment: {
    Args: {
      p_advance_request_id: string
      p_installment_number: number
      p_new_amount: number
      p_reason: string
      p_new_future_installment_count?: number | null
    }
    Returns: AdvanceRecoveryScheduleRow[]
  }
  advance_list_recovery_installment_adjustments: { Args: { p_advance_request_id: string }; Returns: AdvanceRecoveryInstallmentAdjustmentRow[] }

  // ---- Phase 5 (migration 0137) — Payroll Engine ----
  payroll_can_manage: { Args: { p_company_id: string }; Returns: boolean }
  payroll_create_period: { Args: { p_company_id: string; p_period_month: string; p_label?: string | null }; Returns: PayrollGenericRow }
  payroll_start_run: { Args: { p_payroll_period_id: string }; Returns: PayrollGenericRow }
  payroll_calculate_run: { Args: { p_payroll_run_id: string }; Returns: PayrollGenericRow }
  payroll_finalize_run: { Args: { p_payroll_run_id: string }; Returns: PayrollGenericRow }
  payroll_lock_run: { Args: { p_payroll_run_id: string }; Returns: PayrollGenericRow }
  payroll_reverse_run: { Args: { p_payroll_run_id: string; p_reason: string }; Returns: PayrollGenericRow }
  payroll_list_periods: { Args: { p_company_id: string }; Returns: PayrollPeriodListRow[] }
  payroll_list_run_results: { Args: { p_payroll_run_id: string }; Returns: PayrollRunResultRow[] }
  payroll_get_employee_result: { Args: { p_result_id: string }; Returns: PayrollEmployeeResultRow[] }
  payroll_list_employee_result_lines: { Args: { p_result_id: string }; Returns: PayrollLineRow[] }
  payroll_list_my_payslips: { Args: Record<string, never>; Returns: PayrollMyPayslipRow[] }
  payroll_get_payslip: { Args: { p_result_id: string }; Returns: Json }
  payroll_report_advance_recovery: { Args: { p_payroll_run_id: string }; Returns: PayrollAdvanceRecoveryReportRow[] }

  // ---- Phase 5A (migration 0138) — Dynamic Salary Bifurcation ----
  salary_bifurcate: { Args: { p_structure_id: string; p_gross: number }; Returns: SalaryBifurcateRow[] }
  salary_preview: { Args: { p_structure_id: string; p_gross: number }; Returns: SalaryBifurcateRow[] }
  salary_structure_validate: { Args: { p_structure_id: string }; Returns: SalaryStructureValidateRow[] }
  salary_structure_activate: { Args: { p_structure_id: string }; Returns: PayrollGenericRow }
  salary_structure_clone: { Args: { p_structure_id: string; p_new_code: string; p_new_name: string }; Returns: PayrollGenericRow }
  // migration 0177 — Super Admin only; both raise (with a hint code) instead of returning a failure row
  salary_structure_delete_check: { Args: { p_structure_id: string }; Returns: Json }
  salary_structure_delete: { Args: { p_structure_id: string }; Returns: Json }
  salary_assign_employee: {
    Args: {
      p_employee_id: string
      p_gross_salary: number
      p_effective_from: string
      p_salary_structure_id?: string | null
      p_reason?: string | null
      p_remark?: string | null
    }
    Returns: PayrollGenericRow
  }
  // Migration 0179: the raw resolver is no longer executable by API roles; clients use the guarded salary_resolve_secure.
  salary_resolve_for_employee: { Args: { p_employee_id: string; p_as_of: string }; Returns: SalaryResolveRow[] }
  salary_resolve_secure: { Args: { p_employee_id: string; p_as_of: string }; Returns: SalaryResolveRow[] }
  salary_list_structures: { Args: { p_company_id: string }; Returns: SalaryStructureListRow[] }
  salary_list_structure_components: { Args: { p_structure_id: string }; Returns: SalaryStructureListRow[] }
  salary_list_employee_assignments: { Args: { p_employee_id: string }; Returns: SalaryEmployeeAssignmentRow[] }

  // ---- Phase 6 (migration 0139) — Payroll Policy Engine ----
  payroll_policy_list: { Args: { p_company_id: string }; Returns: PayrollGenericRow[] }
  payroll_resolve_policy: { Args: { p_company_id: string; p_as_of: string }; Returns: PayrollGenericRow }
  payroll_policy_validate: { Args: { p_policy_id: string }; Returns: { ok: boolean; error: string | null }[] }
  payroll_policy_activate: { Args: { p_policy_id: string }; Returns: PayrollGenericRow }
  payroll_policy_preview: { Args: { p_employee_id: string | null; p_period_month: string; p_inputs?: Json | null }; Returns: Json }
  // Migration 0180 — validates/evaluates a Custom Formula with the SAME evaluator payroll uses.
  payroll_formula_test: { Args: { p_expr: string; p_gross: number; p_basic?: number | null; p_da?: number | null }; Returns: Json }
  // Migration 0182 — amount formula + the shared eligibility rule for an UNSAVED configuration (test-only joining date / month).
  payroll_component_test: {
    Args: { p_expr: string; p_gross: number; p_basic?: number | null; p_da?: number | null; p_eligibility_type?: string | null; p_eligibility_months?: number | null; p_joining_date?: string | null; p_payroll_month?: string | null }
    Returns: Json
  }
  payroll_policy_compute_lines: {
    Args: {
      p_policy_id: string; p_period_start: string; p_period_end: string; p_working_days: number
      p_joining_date?: string | null; p_basic: number; p_da: number; p_gross: number
      p_lwp_days: number; p_ot_minutes: number; p_nd_value: number
      p_structure_id?: string | null; p_existing_codes?: string[] | null
    }
    Returns: PayrollGenericRow[]
  }
  payroll_policy_finalize: { Args: { p_policy_id: string; p_gross: number; p_deductions: Json }; Returns: Json }

  // ---- PF/ESI configurable calc methods + manual/Excel amounts (migration 0143) ----
  payroll_component_import_eligible: { Args: { p_company_id: string; p_code: string }; Returns: boolean }
  payroll_component_import_codes: { Args: { p_company_id: string }; Returns: string[] }
  payroll_component_amount_set: {
    Args: {
      p_period_id: string; p_employee_id: string; p_component_code: string
      p_employee_amount?: number | null; p_employer_amount?: number | null; p_note?: string | null
    }
    Returns: PayrollGenericRow
  }
  payroll_component_amounts_bulk_set: { Args: { p_period_id: string; p_rows: Json }; Returns: Json }
  payroll_component_import_preview: { Args: { p_company_id: string; p_period_id: string; p_component_codes: string[]; p_rows: Json }; Returns: Json }
  payroll_component_import_commit: {
    Args: { p_company_id: string; p_period_id: string; p_component_codes: string[]; p_rows: Json; p_file_name?: string | null }
    Returns: Json
  }

  // ---- Full & Final Settlement (migrations 0145 / 0146) ----
  fnf_can_approve: { Args: { p_company_id: string }; Returns: boolean }
  exit_notice_resolve: { Args: { p_company_id: string; p_as_of: string }; Returns: PayrollGenericRow }
  leave_encashment_compute: { Args: { p_policy_id: string; p_days: number; p_basic: number; p_da: number; p_gross?: number | null }; Returns: PayrollGenericRow[] }
  fnf_create: {
    Args: {
      p_company_id: string; p_employee_id: string; p_exit_type: string; p_leaving_date: string
      p_notice_served_days?: number | null; p_notice_waived?: boolean | null
      p_encashable_leave_days?: number | null; p_leave_policy_id?: string | null
    }
    Returns: PayrollGenericRow
  }
  fnf_add_adjustment: { Args: { p_fnf_id: string; p_line_type: string; p_code: string; p_name: string; p_amount: number; p_reason: string }; Returns: PayrollGenericRow }
  fnf_calculate: { Args: { p_fnf_id: string }; Returns: Json }
  fnf_get: { Args: { p_fnf_id: string }; Returns: Json }
  fnf_submit: { Args: { p_fnf_id: string }; Returns: PayrollGenericRow }
  fnf_approve: { Args: { p_fnf_id: string; p_note?: string | null }; Returns: PayrollGenericRow }
  fnf_reject: { Args: { p_fnf_id: string; p_reason: string }; Returns: PayrollGenericRow }
  fnf_send_back: { Args: { p_fnf_id: string; p_reason: string }; Returns: PayrollGenericRow }
  fnf_pay: {
    Args: {
      p_fnf_id: string; p_amount: number; p_payment_date: string
      p_payment_mode?: string | null; p_transaction_reference?: string | null
      p_bank_details?: string | null; p_notes?: string | null
    }
    Returns: PayrollGenericRow
  }
  fnf_reverse: { Args: { p_fnf_id: string; p_reason: string }; Returns: PayrollGenericRow }
  fnf_list: { Args: { p_company_id: string }; Returns: PayrollGenericRow[] }
  fnf_register: { Args: { p_company_id: string; p_from?: string | null; p_to?: string | null }; Returns: PayrollGenericRow[] }

  // ---- Employee Exit Request workflow + Exit Type master (migration 0147) ----
  exit_request_max_stage: { Args: { p_company_id: string }; Returns: number }
  exit_request_can_decide_stage: { Args: { p_company_id: string; p_employee_id: string; p_stage: number }; Returns: boolean }
  exit_request_create: {
    Args: {
      p_company_id: string; p_employee_id: string; p_exit_type_id: string; p_requested_leaving_date: string
      p_reason?: string | null; p_notes?: string | null; p_notice_period_days?: number | null
      p_notice_served_days?: number | null; p_expected_last_working_date?: string | null
    }
    Returns: PayrollGenericRow
  }
  exit_request_submit: { Args: { p_id: string }; Returns: PayrollGenericRow }
  exit_request_decide: { Args: { p_id: string; p_action: string; p_remark?: string | null }; Returns: PayrollGenericRow }
  exit_request_cancel: { Args: { p_id: string; p_reason: string }; Returns: PayrollGenericRow }
  exit_request_correct_leaving_date: { Args: { p_id: string; p_new_leaving_date: string; p_reason: string }; Returns: PayrollGenericRow }
  fnf_create_from_exit_request: { Args: { p_exit_request_id: string }; Returns: PayrollGenericRow }
  exit_request_list: { Args: { p_company_id: string }; Returns: PayrollGenericRow[] }
  exit_request_get: { Args: { p_id: string }; Returns: Json }
  exit_register: { Args: { p_company_id: string; p_from?: string | null; p_to?: string | null }; Returns: PayrollGenericRow[] }

  // ---- Employee Transfer module (migration 0148) ----
  transfer_can_approve: { Args: { p_company_id: string }; Returns: boolean }
  transfer_max_stage: { Args: { p_company_id: string }; Returns: number }
  transfer_can_decide_stage: { Args: { p_company_id: string; p_stage: number }; Returns: boolean }
  employee_assignment_as_of: { Args: { p_employee_id: string; p_as_of: string }; Returns: PayrollGenericRow }
  transfer_request_create: {
    Args: {
      p_company_id: string; p_employee_id: string; p_effective_date: string; p_reason?: string | null
      p_new_store_id?: string | null; p_new_store_department_id?: string | null; p_new_store_designation_id?: string | null
      p_new_store_team_id?: string | null; p_new_grade_id?: string | null; p_new_category_id?: string | null
      p_new_reporting_manager_id?: string | null; p_new_super_manager_id?: string | null
      p_new_employment_type?: string | null; p_new_salary_structure_id?: string | null; p_new_shift_id?: string | null
    }
    Returns: PayrollGenericRow
  }
  transfer_request_submit: { Args: { p_id: string }; Returns: PayrollGenericRow }
  transfer_request_decide: { Args: { p_id: string; p_action: string; p_remark?: string | null }; Returns: PayrollGenericRow }
  transfer_request_cancel: { Args: { p_id: string; p_reason: string }; Returns: PayrollGenericRow }
  transfer_apply_due_effective: { Args: { p_company_id: string }; Returns: number }
  transfer_request_list: { Args: { p_company_id: string }; Returns: PayrollGenericRow[] }
  transfer_request_get: { Args: { p_id: string }; Returns: Json }
  transfer_register: {
    Args: { p_company_id: string; p_from?: string | null; p_to?: string | null; p_employee_id?: string | null; p_status?: string | null }
    Returns: PayrollGenericRow[]
  }

  // ---- Automatic leave encashment at exit (migration 0150) ----
  leave_encashable_balance_at_exit: {
    Args: { p_company_id: string; p_employee_id: string; p_leaving_date: string; p_basic: number; p_da: number; p_gross?: number | null }
    Returns: PayrollGenericRow[]
  }

  // ---- Phase 7 (migration 0140) — Payroll Master Enhancement ----
  employee_grades_list: { Args: { p_company_id: string }; Returns: PayrollGenericRow[] }
  employee_categories_list: { Args: { p_company_id: string }; Returns: PayrollGenericRow[] }
  payroll_policy_assignments_list: { Args: { p_company_id: string }; Returns: PayrollGenericRow[] }
  payroll_policy_change_history_list: { Args: { p_employee_id: string }; Returns: PayrollGenericRow[] }
  payroll_assign_policy: { Args: { p_employee_id: string; p_payroll_policy_id: string; p_effective_from: string; p_reason?: string | null }; Returns: PayrollGenericRow }
  payroll_resolve_policy_for_employee: { Args: { p_company_id: string; p_employee_id: string; p_as_of: string }; Returns: PayrollGenericRow }
  store_payroll_calendars_list: { Args: { p_company_id: string }; Returns: PayrollGenericRow[] }
  store_calendar_preview: { Args: { p_calendar_id: string; p_start: string; p_end: string }; Returns: Json }
  payroll_calendar_working_days: { Args: { p_calendar_id: string; p_start: string; p_end: string }; Returns: number }
  payroll_resolve_store_calendar: { Args: { p_company_id: string; p_store_id: string; p_as_of: string }; Returns: PayrollGenericRow }
  tds_policies_list: { Args: { p_company_id: string }; Returns: PayrollGenericRow[] }
  tds_slabs_list: { Args: { p_policy_id: string }; Returns: PayrollGenericRow[] }
  tds_resolve_policy: { Args: { p_company_id: string; p_as_of: string }; Returns: PayrollGenericRow }
  tds_compute: { Args: { p_policy_id: string; p_annual_taxable: number }; Returns: Json }
  payroll_round: { Args: { p_val: number; p_mode: string; p_precision: number }; Returns: number }
}

// ---- Migration 0160 — Advance Payment Receipt Management ----
type AdvancePaymentReceiptRow = {
  id: string
  company_id: string
  advance_request_id: string
  finance_payment_id: string
  employee_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  status: string
  replaced_by_receipt_id: string | null
  replace_reason: string | null
  uploaded_by: string | null
  uploaded_at: string
}
type AdvanceGetPaymentReceiptRow = {
  receipt_id: string | null
  storage_path: string | null
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  uploaded_by_name: string | null
  uploaded_at: string | null
  receipt_status: string
}
type AdvancePaymentReceiptHistoryRow = {
  id: string
  file_name: string
  storage_path: string
  status: string
  uploaded_by_name: string | null
  uploaded_at: string
  replace_reason: string | null
  replaced_by_receipt_id: string | null
}
type AdvanceReceiptFunctions = {
  advance_finance_upload_receipt: {
    Args: { p_advance_request_id: string; p_storage_path: string; p_file_name: string; p_mime_type?: string | null; p_file_size_bytes?: number | null }
    Returns: AdvancePaymentReceiptRow
  }
  advance_finance_replace_receipt: {
    Args: { p_advance_request_id: string; p_storage_path: string; p_file_name: string; p_reason: string; p_mime_type?: string | null; p_file_size_bytes?: number | null }
    Returns: AdvancePaymentReceiptRow
  }
  advance_get_payment_receipt: { Args: { p_advance_request_id: string }; Returns: AdvanceGetPaymentReceiptRow[] }
  advance_list_payment_receipt_history: { Args: { p_advance_request_id: string }; Returns: AdvancePaymentReceiptHistoryRow[] }
}

// ---- Migration 0161 — Dynamic Role & Permission System ----
type PermissionModuleRow = { id: string; code: string; label: string; category: string | null; display_order: number; is_active: boolean }
type PermissionActionRow = { id: string; code: string; label: string; display_order: number }
type PermissionFieldRow = { id: string; module_code: string; field_code: string; label: string; is_sensitive: boolean; display_order: number }
type DynamicRoleRow = { id: string; company_id: string; code: string; name: string; description: string | null; is_active: boolean; display_order: number }
type RolePermissionRow = { id: string; dynamic_role_id: string; module_code: string; action_code: string; is_allowed: boolean }
type RoleFieldPermissionRow = { id: string; dynamic_role_id: string; module_code: string; field_code: string; is_allowed: boolean }
type UserPermissionOverrideRow = { id: string; user_id: string; module_code: string; action_code: string; is_allowed: boolean }
type UserDynamicRoleRow = { id: string; user_id: string; dynamic_role_id: string; assigned_by: string | null; assigned_at: string }
type PermissionUserRoleRow = { dynamic_role_id: string; role_name: string }
type PermissionBulkRow = { module_code: string; action_code: string; is_allowed: boolean }
type PermissionFieldBulkRow = { field_code: string; is_allowed: boolean }
type PermissionAuditRow = { id: string; table_name: string; record_id: string; action: string; changed_data: Json; performed_by_name: string | null; performed_at: string }
type PermissionFunctions = {
  has_dynamic_permission: { Args: { p_user_id: string; p_module_code: string; p_action_code: string }; Returns: boolean }
  has_field_permission: { Args: { p_user_id: string; p_module_code: string; p_field_code: string }; Returns: boolean }
  my_dynamic_permission: { Args: { p_module_code: string; p_action_code: string }; Returns: boolean }
  my_field_permission: { Args: { p_module_code: string; p_field_code: string }; Returns: boolean }
  my_permissions_bulk: { Args: { p_module_codes?: string[] | null }; Returns: PermissionBulkRow[] }
  my_field_permissions_bulk: { Args: { p_module_code: string }; Returns: PermissionFieldBulkRow[] }
  permission_upsert_module: { Args: { p_code: string; p_label: string; p_category?: string | null; p_display_order?: number }; Returns: PermissionModuleRow }
  permission_create_role: { Args: { p_company_id: string; p_code: string; p_name: string; p_description?: string | null; p_display_order?: number }; Returns: DynamicRoleRow }
  permission_set_role_status: { Args: { p_role_id: string; p_is_active: boolean }; Returns: DynamicRoleRow }
  permission_set_role_permission: { Args: { p_role_id: string; p_module_code: string; p_action_code: string; p_is_allowed: boolean }; Returns: RolePermissionRow }
  permission_clear_role_permission: { Args: { p_role_id: string; p_module_code: string; p_action_code: string }; Returns: undefined }
  permission_set_role_field_permission: { Args: { p_role_id: string; p_module_code: string; p_field_code: string; p_is_allowed: boolean }; Returns: RoleFieldPermissionRow }
  permission_set_user_dynamic_role: { Args: { p_user_id: string; p_role_id?: string | null }; Returns: UserDynamicRoleRow | null }
  permission_set_user_override: { Args: { p_user_id: string; p_module_code: string; p_action_code: string; p_is_allowed: boolean }; Returns: UserPermissionOverrideRow }
  permission_clear_user_override: { Args: { p_user_id: string; p_module_code: string; p_action_code: string }; Returns: undefined }
  permission_set_user_field_override: { Args: { p_user_id: string; p_module_code: string; p_field_code: string; p_is_allowed: boolean }; Returns: unknown }
  permission_list_modules: { Args: Record<string, never>; Returns: PermissionModuleRow[] }
  permission_list_actions: { Args: Record<string, never>; Returns: PermissionActionRow[] }
  permission_list_fields: { Args: { p_module_code: string }; Returns: PermissionFieldRow[] }
  permission_list_roles: { Args: { p_company_id: string }; Returns: DynamicRoleRow[] }
  permission_list_role_permissions: { Args: { p_role_id: string }; Returns: RolePermissionRow[] }
  permission_list_role_field_permissions: { Args: { p_role_id: string }; Returns: RoleFieldPermissionRow[] }
  permission_list_user_overrides: { Args: { p_user_id: string }; Returns: UserPermissionOverrideRow[] }
  permission_get_user_role: { Args: { p_user_id: string }; Returns: PermissionUserRoleRow[] }
  permission_audit_history: { Args: { p_limit?: number }; Returns: PermissionAuditRow[] }
  // ---- migration 0164 — scope + effective summary + bulk role copy ----
  has_dynamic_scope_access: { Args: { p_user_id: string; p_module_code: string; p_target_employee_id: string }; Returns: boolean }
  permission_effective_summary: { Args: { p_user_id: string }; Returns: PermissionEffectiveSummaryRow[] }
  permission_copy_role: { Args: { p_source_role_id: string; p_target_role_id: string }; Returns: undefined }
  permission_set_role_scope: { Args: { p_role_id: string; p_module_code: string; p_scope_type: string; p_store_ids?: string[] | null }; Returns: RoleModuleScopeRow }
  permission_list_role_scopes: { Args: { p_role_id: string }; Returns: RoleModuleScopeRow[] }
  permission_update_role: { Args: { p_role_id: string; p_name: string; p_description?: string | null; p_display_order?: number }; Returns: DynamicRoleRow }
  // ---- migration 0169 — Sub-Category / Tab permission dimension ----
  permission_list_tabs: { Args: { p_module_code: string }; Returns: PermissionTabRow[] }
  permission_upsert_tab: { Args: { p_module_code: string; p_tab_code: string; p_label: string; p_display_order?: number }; Returns: PermissionTabRow }
  permission_list_role_tab_permissions: { Args: { p_role_id: string }; Returns: RoleTabPermissionRow[] }
  permission_set_role_tab_permission: { Args: { p_role_id: string; p_module_code: string; p_tab_code: string; p_action_code: string; p_is_allowed: boolean }; Returns: RoleTabPermissionRow }
  permission_clear_role_tab_permission: { Args: { p_role_id: string; p_module_code: string; p_tab_code: string; p_action_code: string }; Returns: undefined }
  permission_list_user_tab_overrides: { Args: { p_user_id: string }; Returns: UserTabPermissionOverrideRow[] }
  permission_set_user_tab_override: { Args: { p_user_id: string; p_module_code: string; p_tab_code: string; p_action_code: string; p_is_allowed: boolean }; Returns: UserTabPermissionOverrideRow }
  permission_clear_user_tab_override: { Args: { p_user_id: string; p_module_code: string; p_tab_code: string; p_action_code: string }; Returns: undefined }
  permission_effective_actions: { Args: { p_user_id: string; p_module_code: string; p_tab_code?: string | null }; Returns: EffectiveActionRow[] }
  has_dynamic_tab_permission: { Args: { p_user_id: string; p_module_code: string; p_tab_code: string; p_action_code: string }; Returns: boolean }
  my_dynamic_tab_permission: { Args: { p_module_code: string; p_tab_code: string; p_action_code: string }; Returns: boolean }
}
type RoleModuleScopeRow = { id: string; dynamic_role_id: string; module_code: string; scope_type: string; store_ids: string[] | null }
type PermissionEffectiveSummaryRow = { module_code: string; module_label: string; access: boolean; scope_type: string; allowed_actions: string[]; denied_actions: string[] }
type PermissionTabRow = { id: string; module_code: string; tab_code: string; label: string; display_order: number }
type RoleTabPermissionRow = { id: string; dynamic_role_id: string; module_code: string; tab_code: string; action_code: string; is_allowed: boolean }
type UserTabPermissionOverrideRow = { id: string; user_id: string; module_code: string; tab_code: string; action_code: string; is_allowed: boolean }
type EffectiveActionRow = { action_code: string; label: string; is_allowed: boolean; source: string }

/** Used ONLY as the generic parameter to `createClient<...>()` (see src/lib/supabaseClient.ts) — a
 *  compile-time-only substitution restoring the pre-regeneration permissiveness described above.
 *  The generated `Database` type remains the accurate one; every table/RPC any phase added is
 *  reachable through both. */
export type LooseDatabase = {
  public: {
    Tables: LoosenedTables & Phase5LeaveTables & AdvanceTables
    Views: Database["public"]["Views"]
    Functions: LoosenedFunctions & Phase5LeaveFunctions & AdvanceFunctions & AdvanceLedgerFunctions & AdvanceReceiptFunctions & PermissionFunctions
    Enums: Database["public"]["Enums"]
    CompositeTypes: Database["public"]["CompositeTypes"]
  }
}

// ---------------------------------------------------------------------------
// Named Row aliases — one per legacy `XRow` name every services/*.ts file
// already imports. Each simply points at the accurate generated Row shape.
// ---------------------------------------------------------------------------
export type CompanyRow = Database["public"]["Tables"]["companies"]["Row"]
export type StoreRow = Database["public"]["Tables"]["stores"]["Row"]
export type EmployeeRow = Database["public"]["Tables"]["employees"]["Row"]
export type EmployeeDocumentRow = Database["public"]["Tables"]["employee_documents"]["Row"]
export type EmployeeTransferRow = Database["public"]["Tables"]["employee_transfers"]["Row"]
export type EmployeePromotionRow = Database["public"]["Tables"]["employee_promotions"]["Row"]
export type EmployeeNoteRow = Database["public"]["Tables"]["employee_notes"]["Row"]
export type EmployeeRoleRow = Database["public"]["Tables"]["employee_roles"]["Row"]
export type EmployeeRoleHistoryRow = Database["public"]["Tables"]["employee_role_history"]["Row"]
export type EmployeeKpiAssignmentRow = Database["public"]["Tables"]["employee_kpi_assignment"]["Row"]
export type KpiActualRow = Database["public"]["Tables"]["kpi_actual"]["Row"]
export type KpiTargetRow = Database["public"]["Tables"]["kpi_target"]["Row"]
export type KpiCategoryRow = Database["public"]["Tables"]["kpi_categories"]["Row"]
export type KpiMasterRow = Database["public"]["Tables"]["kpi_master"]["Row"]
export type RoleCategoryRow = Database["public"]["Tables"]["role_categories"]["Row"]
export type RoleStatusRow = Database["public"]["Tables"]["role_status"]["Row"]
export type RoleRow = Database["public"]["Tables"]["roles"]["Row"]
export type RoleKpiMappingRow = Database["public"]["Tables"]["role_kpi_mapping"]["Row"]
export type RoleTaskMappingRow = Database["public"]["Tables"]["role_task_mapping"]["Row"]
export type TaskAttachmentRow = Database["public"]["Tables"]["task_attachments"]["Row"]
export type TaskCategoryRow = Database["public"]["Tables"]["task_categories"]["Row"]
export type TaskChecklistItemRow = Database["public"]["Tables"]["task_checklist_items"]["Row"]
export type TaskChecklistRow = Database["public"]["Tables"]["task_checklists"]["Row"]
export type TaskFrequencyRow = Database["public"]["Tables"]["task_frequency"]["Row"]
export type TaskStatusRow = Database["public"]["Tables"]["task_status"]["Row"]
export type TaskMasterRow = Database["public"]["Tables"]["task_master"]["Row"]
export type TaskScoreRow = Database["public"]["Tables"]["task_score"]["Row"]
export type TaskTemplateRow = Database["public"]["Tables"]["task_templates"]["Row"]
export type EmployeeTaskAssignmentRow = Database["public"]["Tables"]["employee_task_assignment"]["Row"]
export type TaskSubmissionRow = Database["public"]["Tables"]["task_submission"]["Row"]
export type TaskVerificationRow = Database["public"]["Tables"]["task_verification"]["Row"]
export type MetricApprovalRow = Database["public"]["Tables"]["metric_approval"]["Row"]
export type MetricCommentRow = Database["public"]["Tables"]["metric_comments"]["Row"]
export type MetricHistoryRow = Database["public"]["Tables"]["metric_history"]["Row"]
export type MetricMappingRow = Database["public"]["Tables"]["metric_mapping"]["Row"]
export type MetricMasterRow = Database["public"]["Tables"]["metric_master"]["Row"]
export type PerformanceCyclesRow = Database["public"]["Tables"]["performance_cycles"]["Row"]
export type PerformanceCycleRow = Database["public"]["Tables"]["performance_cycle"]["Row"]
export type PerformanceDataSourceRow = Database["public"]["Tables"]["performance_data_sources"]["Row"]
export type PerformanceEntryRow = Database["public"]["Tables"]["performance_entries"]["Row"]
export type PerformanceRatingRow = Database["public"]["Tables"]["performance_rating"]["Row"]
export type AuditLogRow = Database["public"]["Tables"]["audit_logs"]["Row"]

// ---------------------------------------------------------------------------
// Named enum aliases
// ---------------------------------------------------------------------------
export type AppRole = Database["public"]["Enums"]["app_role"]
export type StoreStatus = Database["public"]["Enums"]["store_status"]
export type EmployeeStatus = Database["public"]["Enums"]["employee_status"]
export type EmploymentType = Database["public"]["Enums"]["employment_type"]
export type SalaryType = Database["public"]["Enums"]["salary_type"]
export type GenderType = Database["public"]["Enums"]["gender_type"]
export type EmployeeDocumentType = Database["public"]["Enums"]["employee_document_type"]
export type AttendanceStatus = Database["public"]["Enums"]["attendance_status"]
export type AttendanceSource = Database["public"]["Enums"]["attendance_source"]
export type RoleType = Database["public"]["Enums"]["role_type"]
export type KpiCalculationType = Database["public"]["Enums"]["kpi_calculation_type"]
export type KpiTargetType = Database["public"]["Enums"]["kpi_target_type"]
export type KpiMeasurementUnit = Database["public"]["Enums"]["kpi_measurement_unit"]
export type KpiFormulaType = Database["public"]["Enums"]["kpi_formula_type"]
export type PerformanceCycleType = Database["public"]["Enums"]["performance_cycle_type"]
export type PerformanceCycleStatus = Database["public"]["Enums"]["performance_cycle_status"]
export type KpiAssignmentSource = Database["public"]["Enums"]["kpi_assignment_source"]
export type TaskPriority = Database["public"]["Enums"]["task_priority"]
export type TaskAttachmentType = Database["public"]["Enums"]["task_attachment_type"]
export type TaskVerificationDecision = Database["public"]["Enums"]["task_verification_decision"]
export type TaskHistoryAction = Database["public"]["Enums"]["task_history_action"]
export type PerformanceCycleGrain = Database["public"]["Enums"]["performance_cycle_grain"]
export type MetricCategory = Database["public"]["Enums"]["metric_category"]
export type MetricCalculationType = Database["public"]["Enums"]["metric_calculation_type"]
export type PerformanceEntryStatus = Database["public"]["Enums"]["performance_entry_status"]
export type MetricApprovalDecision = Database["public"]["Enums"]["metric_approval_decision"]
