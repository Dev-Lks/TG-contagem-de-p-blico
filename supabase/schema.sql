-- Execute no Supabase: SQL Editor > New query > Run.
create table if not exists public.counter_actions (
  id text primary key,
  event_id text not null,
  kind text not null check (kind in ('count', 'undo', 'session_start', 'session_end', 'estimate')),
  device_id text not null,
  operator text not null,
  gate text not null default '',
  flow text not null default 'in' check (flow in ('in', 'out')),
  amount smallint not null default 0 check (amount between -10 and 10),
  ref_id text not null default '',
  estimate integer not null default 0 check (estimate between 0 and 100000),
  note text not null default '',
  client_created_at timestamptz,
  received_at timestamptz not null default now()
);

create index if not exists counter_actions_event_received_idx
  on public.counter_actions (event_id, received_at, id);

create index if not exists counter_actions_event_device_idx
  on public.counter_actions (event_id, device_id, received_at);

-- O navegador nunca acessa esta tabela diretamente. Somente as funções da
-- Vercel usam a service role; portanto, não criamos políticas públicas.
alter table public.counter_actions enable row level security;
