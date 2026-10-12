begin;

create table if not exists
  public.ai_stock_predictions (
    id uuid primary key
      default gen_random_uuid(),

    stock_code text not null
      references public.stocks(stock_code)
      on delete cascade,

    prediction_date date not null,

    generated_at timestamptz
      not null default now(),

    model_name text
      not null default
        'DISCLOSURE_PRICE_RULE',

    model_version text
      not null default 'v1',

    score numeric
      not null
      check (
        score between 0 and 1
      ),

    direction text
      not null
      check (
        direction in (
          'UP',
          'NEUTRAL',
          'DOWN'
        )
      ),

    confidence numeric
      not null
      check (
        confidence between 0 and 1
      ),

    is_candidate boolean
      not null default false,

    price_momentum numeric,
    intraday_return numeric,
    volume_ratio numeric,
    range_position numeric,

    disclosure_score numeric,

    positive_disclosure_count integer
      not null default 0,

    negative_disclosure_count integer
      not null default 0,

    neutral_disclosure_count integer
      not null default 0,

    latest_disclosure_date date,

    source_snapshot_id bigint
      references public.market_snapshots(id)
      on delete set null,

    reasons jsonb
      not null default '[]'::jsonb,

    factors jsonb
      not null default '{}'::jsonb,

    raw_payload jsonb
      not null default '{}'::jsonb,

    created_at timestamptz
      not null default now(),

    updated_at timestamptz
      not null default now(),

    constraint
      ai_stock_predictions_daily_key
      unique (
        stock_code,
        prediction_date,
        model_name,
        model_version
      )
  );

create index if not exists
  ai_stock_predictions_score_idx
on public.ai_stock_predictions (
  prediction_date desc,
  score desc
);

create index if not exists
  ai_stock_predictions_stock_idx
on public.ai_stock_predictions (
  stock_code,
  generated_at desc
);

create index if not exists
  ai_stock_predictions_candidate_idx
on public.ai_stock_predictions (
  is_candidate,
  score desc,
  generated_at desc
);

alter table
  public.ai_stock_predictions
enable row level security;

revoke all
on public.ai_stock_predictions
from anon, authenticated;

grant all
on public.ai_stock_predictions
to service_role;

notify pgrst, 'reload schema';

commit;