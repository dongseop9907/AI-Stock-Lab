-- OpenDART disclosure RECEIPT-date inventory. Never claims event-date coverage.
-- Requires existing migration 054. Does not update OHLCV, events or assertions.
begin;
create table public.corporate_action_source_inventory_runs (
  id uuid primary key,
  universe_code text not null default 'KRX_ALL_LISTED' check (universe_code = 'KRX_ALL_LISTED'),
  start_date date not null,
  end_date date not null,
  status text not null default 'RUNNING' check (status in ('RUNNING','INVENTORY_COMPLETE')),
  chunk_start date not null,
  chunk_end date not null,
  corp_cls text not null default 'Y' check (corp_cls in ('Y','K')),
  next_page integer not null default 1 check (next_page > 0),
  segment_total integer,
  stored_pages integer not null default 0,
  disclosure_count integer not null default 0,
  candidate_count integer not null default 0,
  source_coverage_window_id uuid references public.corporate_action_source_coverage_windows(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check (start_date <= end_date),
  check (start_date <= chunk_start and chunk_start <= chunk_end and chunk_end <= end_date)
);
create table public.corporate_action_source_inventory_pages (
  run_id uuid not null references public.corporate_action_source_inventory_runs(id),
  chunk_start date not null,
  chunk_end date not null,
  corp_cls text not null check (corp_cls in ('Y','K')),
  page_no integer not null check (page_no > 0),
  total_count integer not null check (total_count >= 0),
  total_pages integer not null check (total_pages >= 0),
  response_sha256 text not null check (response_sha256 ~ '^[0-9a-f]{64}$'),
  raw_response jsonb not null,
  candidates jsonb not null check (jsonb_typeof(candidates) = 'array'),
  fetched_at timestamptz not null default now(),
  primary key (run_id, chunk_start, corp_cls, page_no)
);
alter table public.corporate_action_source_inventory_runs enable row level security;
alter table public.corporate_action_source_inventory_pages enable row level security;
revoke all on public.corporate_action_source_inventory_runs, public.corporate_action_source_inventory_pages from anon, authenticated;
grant select, insert, update on public.corporate_action_source_inventory_runs to service_role;
grant select, insert on public.corporate_action_source_inventory_pages to service_role;

-- Atomic append and cursor advance. Concurrent calls with a stale cursor do not write.
create function public.append_corporate_action_source_page_v9_7_1(
 p_run_id uuid, p_chunk_start date, p_corp_cls text, p_page_no integer,
 p_total_count integer, p_total_pages integer, p_response_sha256 text,
 p_raw_response jsonb, p_candidates jsonb
) returns jsonb language plpgsql set search_path = public as $$
declare
 r public.corporate_action_source_inventory_runs%rowtype;
 rows_json jsonb;
 row_count integer;
 expected_count integer;
 duplicate_count integer;
 coverage_id uuid;
 inventory_hash text;
begin
 select * into strict r from public.corporate_action_source_inventory_runs where id=p_run_id for update;
 if r.status='INVENTORY_COMPLETE' or r.chunk_start<>p_chunk_start or r.corp_cls<>p_corp_cls or r.next_page<>p_page_no then
   return jsonb_build_object('staleRequest',true,'run',to_jsonb(r));
 end if;
 if p_total_count is null or p_total_pages is null or p_total_count<0 or p_total_pages<>ceil(p_total_count/100.0)::int then
   raise exception 'INVALID_PAGINATION';
 end if;
 rows_json := coalesce(p_raw_response->'list','[]'::jsonb);
 if jsonb_typeof(rows_json) is distinct from 'array' or jsonb_typeof(p_candidates) is distinct from 'array' then raise exception 'INVALID_ROWS'; end if;
 row_count := jsonb_array_length(rows_json);
 if p_total_count=0 then
   if p_page_no<>1 or p_raw_response->>'status' is distinct from '013' then raise exception 'UNEXPECTED_EMPTY_PAGE'; end if;
 else
   if p_raw_response->>'status' is distinct from '000' or (p_raw_response->>'page_no')::int is distinct from p_page_no
      or (p_raw_response->>'page_count')::int is distinct from 100
      or (p_raw_response->>'total_count')::int is distinct from p_total_count
      or (p_raw_response->>'total_page')::int is distinct from p_total_pages then raise exception 'RESPONSE_METADATA_MISMATCH'; end if;
 end if;
 expected_count := least(100,p_total_count-(p_page_no-1)*100);
 if expected_count<0 or row_count<>expected_count then raise exception 'PAGE_ROW_COUNT_MISMATCH'; end if;
 if r.segment_total is not null and r.segment_total<>p_total_count then raise exception 'SOURCE_TOTAL_CHANGED_START_NEW_RUN'; end if;
 if exists (select 1 from jsonb_array_elements(rows_json) x where
   (x->>'rcept_no') is null or (x->>'rcept_no') !~ '^[0-9]{14}$' or
   x->>'corp_cls' is distinct from p_corp_cls or
   x->>'rcept_dt' is null or (x->>'rcept_dt') !~ '^[0-9]{8}$' or
   (x->>'rcept_dt') < to_char(r.chunk_start,'YYYYMMDD') or
   (x->>'rcept_dt') > to_char(r.chunk_end,'YYYYMMDD')) then raise exception 'INVALID_RECEIPT'; end if;
 select count(*)-count(distinct x->>'rcept_no') into duplicate_count from jsonb_array_elements(rows_json) x;
 if duplicate_count>0 or exists (
   select 1 from public.corporate_action_source_inventory_pages p,
     lateral jsonb_array_elements(coalesce(p.raw_response->'list','[]'::jsonb)) old_row,
     jsonb_array_elements(rows_json) new_row
   where p.run_id=p_run_id and p.chunk_start=p_chunk_start and p.corp_cls=p_corp_cls
     and old_row->>'rcept_no'=new_row->>'rcept_no'
 ) then raise exception 'DUPLICATE_RECEIPT_START_NEW_RUN'; end if;
 insert into public.corporate_action_source_inventory_pages values
 (p_run_id,r.chunk_start,r.chunk_end,p_corp_cls,p_page_no,p_total_count,p_total_pages,p_response_sha256,p_raw_response,p_candidates,now());
 r.stored_pages:=r.stored_pages+1;
 r.disclosure_count:=r.disclosure_count+row_count;
 r.candidate_count:=r.candidate_count+jsonb_array_length(p_candidates);
 r.segment_total:=p_total_count;
 if p_page_no < p_total_pages then
   r.next_page:=r.next_page+1;
 else
   r.next_page:=1; r.segment_total:=null;
   if r.corp_cls='Y' then r.corp_cls:='K';
   elsif r.chunk_end<r.end_date then
     r.corp_cls:='Y'; r.chunk_start:=r.chunk_end+1; r.chunk_end:=least(r.chunk_start+29,r.end_date);
   else
     r.status:='INVENTORY_COMPLETE'; r.finished_at:=now();
     select encode(sha256(convert_to(string_agg(response_sha256,'' order by chunk_start,corp_cls,page_no),'UTF8')),'hex')
       into inventory_hash from public.corporate_action_source_inventory_pages where run_id=r.id;
     -- Empty action_types: no action type has been proven complete by a title scan.
     insert into public.corporate_action_source_coverage_windows
       (universe_code,provider,provider_version,start_date,end_date,coverage_status,markets,action_types,source_fingerprint,evidence,is_validation,production_applied)
     values (r.universe_code,'OPENDART_DISCLOSURE_LIST','V9_7_1_DB_INVENTORY',r.start_date,r.end_date,'PARTIAL',
       '["KOSPI","KOSDAQ"]','[]',inventory_hash,
       jsonb_build_object('inventoryRunId',r.id,'scope','DISCLOSURE_RECEIPT_DATE_ONLY',
         'allRequestedPagesStored',true,'storedPages',r.stored_pages,'disclosureCount',r.disclosure_count,
         'candidateCount',r.candidate_count,'rawResponseHashesStored',true,
         'effectiveDateCoverageProven',false,'historicalPitMembershipReconciled',false,
         'candidateClassificationExhaustive',false,'eventImportComplete',false,
         'eventAbsenceInterpretedAsNoAction',false,'productionApplied',false),false,false)
     on conflict (universe_code,provider,start_date,end_date,source_fingerprint,is_validation)
       do update set source_fingerprint=excluded.source_fingerprint
     returning id into coverage_id;
     r.source_coverage_window_id:=coverage_id;
   end if;
 end if;
 update public.corporate_action_source_inventory_runs set
   status=r.status,chunk_start=r.chunk_start,chunk_end=r.chunk_end,corp_cls=r.corp_cls,
   next_page=r.next_page,segment_total=r.segment_total,stored_pages=r.stored_pages,
   disclosure_count=r.disclosure_count,candidate_count=r.candidate_count,
   source_coverage_window_id=r.source_coverage_window_id,finished_at=r.finished_at,updated_at=now()
 where id=r.id returning * into r;
 return jsonb_build_object('staleRequest',false,'run',to_jsonb(r));
end;
$$;
revoke all on function public.append_corporate_action_source_page_v9_7_1(uuid,date,text,integer,integer,integer,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.append_corporate_action_source_page_v9_7_1(uuid,date,text,integer,integer,integer,text,jsonb,jsonb) to service_role;
commit;
