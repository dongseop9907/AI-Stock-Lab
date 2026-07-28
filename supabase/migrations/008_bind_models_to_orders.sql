alter table public.risk_decisions
  add column if not exists model_id uuid
    references public.ai_model_versions(id)
    on delete set null;

alter table public.risk_decisions
  add column if not exists model_snapshot jsonb;


alter table public.paper_order_requests
  add column if not exists model_id uuid
    references public.ai_model_versions(id)
    on delete set null;

alter table public.paper_order_requests
  add column if not exists model_snapshot jsonb;


create index if not exists idx_risk_decisions_model
  on public.risk_decisions(
    model_id,
    created_at desc
  );

create index if not exists idx_paper_orders_model
  on public.paper_order_requests(
    model_id,
    created_at desc
  );