-- Run AFTER migration 061. All synthetic test rows are rolled back.
-- Execute this whole script together, including the final ROLLBACK.
begin;
do $$
declare
 rid uuid:=gen_random_uuid();
 result jsonb;
 coverage_id uuid;
 coverage_status text;
 covered_types jsonb;
 before_events bigint;
 after_events bigint;
begin
 select count(*) into before_events from public.corporate_action_events;
 insert into public.corporate_action_source_inventory_runs(id,start_date,end_date,chunk_start,chunk_end)
 values(rid,'2024-01-02','2024-01-02','2024-01-02','2024-01-02');
 -- A malformed nonempty page must fail without advancing the cursor.
 begin
   perform public.append_corporate_action_source_page_v9_7_1(rid,'2024-01-02','Y',1,1,1,repeat('a',64),
     '{"status":"000","page_no":1,"page_count":100,"total_count":1,"total_page":1,"list":[]}', '[]');
   raise exception 'TEST_DID_NOT_REJECT_BAD_PAGE';
 exception when others then
   if SQLERRM <> 'PAGE_ROW_COUNT_MISMATCH' then raise; end if;
 end;
 if (select stored_pages from public.corporate_action_source_inventory_runs where id=rid)<>0 then raise exception 'TEST_FAILED_CURSOR_MOVED'; end if;
 result:=public.append_corporate_action_source_page_v9_7_1(rid,'2024-01-02','Y',1,0,0,repeat('a',64),'{"status":"013"}','[]');
 if result->'run'->>'corp_cls'<>'K' then raise exception 'TEST_FAILED_MARKET_CURSOR'; end if;
 -- Repeated old cursor: no second page insert.
 result:=public.append_corporate_action_source_page_v9_7_1(rid,'2024-01-02','Y',1,0,0,repeat('a',64),'{"status":"013"}','[]');
 if result->>'staleRequest'<>'true' then raise exception 'TEST_FAILED_STALE_REQUEST'; end if;
 result:=public.append_corporate_action_source_page_v9_7_1(rid,'2024-01-02','K',1,0,0,repeat('b',64),'{"status":"013"}','[]');
 if result->'run'->>'status'<>'INVENTORY_COMPLETE' then raise exception 'TEST_FAILED_INVENTORY_FINISH'; end if;
 coverage_id:=(result->'run'->>'source_coverage_window_id')::uuid;
 select w.coverage_status,w.action_types into coverage_status,covered_types
 from public.corporate_action_source_coverage_windows w where id=coverage_id;
 if coverage_status is distinct from 'PARTIAL' or covered_types is distinct from '[]'::jsonb then raise exception 'TEST_FAILED_FAIL_CLOSED'; end if;
 if (select count(*) from public.corporate_action_source_inventory_pages where run_id=rid)<>2 then raise exception 'TEST_FAILED_PAGE_COUNT'; end if;
 select count(*) into after_events from public.corporate_action_events;
 if before_events<>after_events then raise exception 'TEST_FAILED_EVENT_MUTATION'; end if;
 raise notice 'PASS: invalid page rejected, cursor durable, retry idempotent, empty inventory PARTIAL, events untouched. Rolling back.';
end;
$$;
rollback;
