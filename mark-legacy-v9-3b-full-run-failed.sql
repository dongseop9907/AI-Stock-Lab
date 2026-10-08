begin;

delete from public.historical_universe_compiled_memberships
where compilation_run_id = '2a97528b-8037-4c54-a04a-a1da0d97ae17';

update public.historical_universe_compilation_runs
set
  status = 'FAILED',
  compiled_interval_count = 0,
  error_message =
    'LEGACY_V9_3B_ABORTED_DURING_FULL_RANGE_COMPILE_NODE_WORKER_TERMINATED_BEFORE_CATCH',
  finished_at = now(),
  metadata =
    coalesce(metadata, '{}'::jsonb)
    ||
    jsonb_build_object(
      'manualRecovery',
      true,
      'supersededBy',
      'HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_2'
    )
where id = '2a97528b-8037-4c54-a04a-a1da0d97ae17'
  and status = 'RUNNING';

commit;
