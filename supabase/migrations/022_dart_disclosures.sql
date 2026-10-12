begin;

create table if not exists
  public.dart_disclosures (
    id bigint generated always as identity
      primary key,

    rcept_no text not null unique,

    stock_code text not null
      references public.stocks(stock_code)
      on delete cascade,

    corp_code text,
    corp_name text,
    corp_class text,

    report_name text not null,
    filer_name text,

    received_date date not null,
    remark text,

    importance_score numeric
      not null default 0.30
      check (
        importance_score
        between 0 and 1
      ),

    sentiment_hint text
      not null default 'NEUTRAL'
      check (
        sentiment_hint in (
          'POSITIVE',
          'NEGATIVE',
          'NEUTRAL'
        )
      ),

    matched_keywords text[]
      not null default '{}',

    raw_payload jsonb
      not null default '{}'::jsonb,

    first_seen_at timestamptz
      not null default now(),

    last_seen_at timestamptz
      not null default now(),

    created_at timestamptz
      not null default now(),

    updated_at timestamptz
      not null default now()
  );

create index if not exists
  dart_disclosures_stock_date_idx
on public.dart_disclosures (
  stock_code,
  received_date desc
);

create index if not exists
  dart_disclosures_importance_idx
on public.dart_disclosures (
  importance_score desc,
  received_date desc
);

create index if not exists
  dart_disclosures_sentiment_idx
on public.dart_disclosures (
  sentiment_hint,
  received_date desc
);

alter table
  public.dart_disclosures
enable row level security;

revoke all
on public.dart_disclosures
from anon, authenticated;

grant all
on public.dart_disclosures
to service_role;

notify pgrst, 'reload schema';

commit;