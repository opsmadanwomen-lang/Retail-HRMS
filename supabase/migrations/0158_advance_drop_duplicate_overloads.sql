-- ============================================================================
-- Retail HRMS — Drop duplicate function overloads left by migration 0157
-- Migration 0158
--
-- FOUND LIVE (post-deploy verification, this session): Postgres identifies a
-- function by name + ordered parameter TYPE list. Appending a new trailing
-- parameter (even one with a DEFAULT) to advance_apply() / advance_manager_
-- decide() / advance_boss_decide() via `CREATE OR REPLACE FUNCTION` does NOT
-- replace the existing function — it creates a SECOND, overloaded function,
-- because the parameter count differs. Verified via pg_proc immediately
-- after applying 0157: all three functions had two live overloads (the
-- original short signature untouched, plus the new longer one). Left as-is,
-- this is a real production defect: PostgREST resolves an RPC call by
-- matching the request body's argument names against a function's
-- signature, and with two candidates where the new parameter is optional,
-- a caller supplying only the original arguments is ambiguous between them
-- (PGRST203 "Could not choose the best candidate function").
--
-- FIX: explicitly DROP the three original (shorter) signatures. The new,
-- longer signatures created by 0157 already carry every original line of
-- logic plus the additive installment-count behavior, so nothing is lost —
-- this migration removes ONLY the stale duplicate, not any real capability.
-- ============================================================================

drop function if exists public.advance_apply(uuid, numeric, text, text, text, text, text, bigint);
drop function if exists public.advance_manager_decide(uuid, text, numeric, text);
drop function if exists public.advance_boss_decide(uuid, text, numeric, text, text);
