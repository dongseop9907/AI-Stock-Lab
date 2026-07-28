alter table public.paper_positions
  add column if not exists highest_price numeric(18, 2);

alter table public.paper_positions
  add column if not exists trailing_stop_active boolean
    not null default false;

alter table public.paper_positions
  add column if not exists trailing_activated_at timestamptz;

alter table public.paper_positions
  add column if not exists last_trailing_update_at timestamptz;

update public.paper_positions
set highest_price = average_price
where highest_price is null;


create table if not exists public.paper_stop_adjustments (
  id uuid primary key default gen_random_uuid(),

  position_id uuid not null,

  account_id uuid not null
    references public.paper_accounts(id)
    on delete cascade,

  stock_code text not null
    references public.stocks(stock_code),

  old_stop_price numeric(18, 2) not null,
  new_stop_price numeric(18, 2) not null,

  previous_highest_price numeric(18, 2) not null,
  new_highest_price numeric(18, 2) not null,

  observed_price numeric(18, 2) not null,
  activation_price numeric(18, 2) not null,

  trailing_distance_rate numeric(12, 6) not null,

  reason text not null
    check (
      reason in (
        'HIGH_UPDATED',
        'TRAILING_ACTIVATED',
        'TRAILING_RAISED'
      )
    ),

  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_stop_adjustments_stock
  on public.paper_stop_adjustments(
    stock_code,
    observed_at desc
  );

alter table public.paper_stop_adjustments
  enable row level security;


create or replace function public.update_paper_trailing_stop(
  p_position_id uuid,
  p_current_price numeric,
  p_snapshot_high numeric,
  p_observed_at timestamptz,
  p_activation_rate numeric default 0.03,
  p_trailing_distance_rate numeric default 0.02
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position public.paper_positions%rowtype;

  v_previous_highest numeric(18, 2);
  v_observed_high numeric(18, 2);
  v_new_highest numeric(18, 2);

  v_activation_price numeric(18, 2);
  v_candidate_stop numeric(18, 2);
  v_new_stop numeric(18, 2);

  v_was_active boolean;
  v_is_active boolean;

  v_stop_raised boolean;
  v_activated_now boolean;
  v_triggered boolean;

  v_reason text;
begin
  if p_current_price is null or p_current_price <= 0 then
    raise exception 'INVALID_CURRENT_PRICE';
  end if;

  if p_activation_rate <= 0 or p_activation_rate >= 1 then
    raise exception 'INVALID_ACTIVATION_RATE';
  end if;

  if (
    p_trailing_distance_rate <= 0
    or p_trailing_distance_rate >= 1
  ) then
    raise exception 'INVALID_TRAILING_DISTANCE_RATE';
  end if;

  select *
  into v_position
  from public.paper_positions
  where id = p_position_id
  for update;

  if not found then
    raise exception 'POSITION_NOT_FOUND';
  end if;

  v_previous_highest :=
    greatest(
      coalesce(
        v_position.highest_price,
        v_position.average_price
      ),
      v_position.average_price
    );

  v_observed_high :=
    greatest(
      p_current_price,
      coalesce(p_snapshot_high, p_current_price)
    );

  v_new_highest :=
    greatest(
      v_previous_highest,
      v_observed_high
    );

  v_activation_price :=
    round(
      v_position.average_price
      * (1 + p_activation_rate),
      2
    );

  v_was_active :=
    coalesce(
      v_position.trailing_stop_active,
      false
    );

  v_is_active :=
    v_was_active
    or v_new_highest >= v_activation_price;

  v_activated_now :=
    not v_was_active and v_is_active;

  if v_is_active then
    v_candidate_stop :=
      round(
        v_new_highest
        * (1 - p_trailing_distance_rate),
        2
      );
  else
    v_candidate_stop :=
      v_position.current_stop_price;
  end if;

  /*
   * 손절가는 기존 값보다 절대 낮아질 수 없다.
   */
  v_new_stop :=
    greatest(
      v_position.current_stop_price,
      v_candidate_stop
    );

  v_stop_raised :=
    v_new_stop > v_position.current_stop_price;

  v_triggered :=
    p_current_price <= v_new_stop;

  update public.paper_positions
  set
    highest_price = v_new_highest,
    trailing_stop_active = v_is_active,

    trailing_activated_at =
      case
        when v_activated_now
          then coalesce(p_observed_at, now())
        else trailing_activated_at
      end,

    current_stop_price = v_new_stop,
    last_trailing_update_at =
      coalesce(p_observed_at, now()),

    updated_at = now()
  where id = v_position.id;

  if (
    v_activated_now
    or v_stop_raised
    or v_new_highest > v_previous_highest
  ) then
    v_reason :=
      case
        when v_activated_now
          then 'TRAILING_ACTIVATED'

        when v_stop_raised
          then 'TRAILING_RAISED'

        else 'HIGH_UPDATED'
      end;

    insert into public.paper_stop_adjustments (
      position_id,
      account_id,
      stock_code,
      old_stop_price,
      new_stop_price,
      previous_highest_price,
      new_highest_price,
      observed_price,
      activation_price,
      trailing_distance_rate,
      reason,
      observed_at
    )
    values (
      v_position.id,
      v_position.account_id,
      v_position.stock_code,
      v_position.current_stop_price,
      v_new_stop,
      v_previous_highest,
      v_new_highest,
      p_current_price,
      v_activation_price,
      p_trailing_distance_rate,
      v_reason,
      coalesce(p_observed_at, now())
    );
  end if;

  return jsonb_build_object(
    'positionId', v_position.id,
    'stockCode', v_position.stock_code,
    'averagePrice', v_position.average_price,
    'currentPrice', p_current_price,
    'previousHighestPrice', v_previous_highest,
    'highestPrice', v_new_highest,
    'activationPrice', v_activation_price,
    'oldStopPrice', v_position.current_stop_price,
    'newStopPrice', v_new_stop,
    'trailingActive', v_is_active,
    'activatedNow', v_activated_now,
    'stopRaised', v_stop_raised,
    'triggered', v_triggered,
    'observedAt', coalesce(p_observed_at, now())
  );
end;
$$;

revoke all
on function public.update_paper_trailing_stop(
  uuid,
  numeric,
  numeric,
  timestamptz,
  numeric,
  numeric
)
from public, anon, authenticated;

grant execute
on function public.update_paper_trailing_stop(
  uuid,
  numeric,
  numeric,
  timestamptz,
  numeric,
  numeric
)
to service_role;