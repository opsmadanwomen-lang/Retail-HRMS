-- ============================================================================
-- Retail HRMS — attendance_records: additive columns for Information / Half-
-- Day / Early-Going / Penalty / Extended-Duty / Night-Duty-payable data
-- Migration 0043
--
-- All nullable/additive. Existing rows get NULL in every new column — accurate,
-- since none of these dimensions existed when those rows were calculated.
-- No existing column is altered, no row is touched, no historical value changes.
-- ============================================================================

alter table public.attendance_records
  add column if not exists used_information boolean not null default false,
  add column if not exists information_rule_id uuid references public.attendance_information_rules (id) on delete set null,
  add column if not exists half_day_reason text check (half_day_reason is null or half_day_reason in ('late_coming', 'early_going')),
  add column if not exists half_day_rule_id uuid references public.attendance_half_day_rules (id) on delete set null,
  add column if not exists penalty_minutes int,
  add column if not exists penalty_rule_id uuid references public.attendance_penalty_rules (id) on delete set null,
  add column if not exists early_going_minutes int,
  add column if not exists early_going_rule_id uuid references public.attendance_early_going_rules (id) on delete set null,
  add column if not exists extended_duty_rule_id uuid references public.attendance_extended_duty_rules (id) on delete set null,
  add column if not exists extra_duty_value numeric,
  add column if not exists night_ot_minutes int,
  add column if not exists night_duty_approval_id uuid references public.attendance_night_duty_approvals (id) on delete set null,
  add column if not exists payable_working_minutes int,
  add column if not exists payable_overtime_minutes int;
