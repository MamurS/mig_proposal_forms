-- ============================================================
-- Confidentiality phase 2 (DESTRUCTIVE). DO NOT apply until PR #2 is merged and
-- live: the admin page must already read/write submission_private, and the
-- analyze-submission edge function must already be repointed to it.
-- This is the step that actually closes the leak (customers can no longer read
-- underwriter notes / AI analysis on their own submissions via the API).
-- ============================================================
alter table public.submissions drop column if exists internal_notes;
alter table public.submissions drop column if exists ai_analysis;
alter table public.submissions drop column if exists ai_analyzed_at;
alter table public.submissions drop column if exists assigned_to;
