-- Groups the listener monitors
create table whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  group_jid text unique not null,
  group_name text not null,
  city text not null default 'amsterdam',
  organizer_name text,
  notes text,
  created_at timestamptz default now()
);

-- Raw incoming messages (append-only log)
create table raw_messages (
  id uuid primary key default gen_random_uuid(),
  group_jid text not null references whatsapp_groups(group_jid),
  sender_jid text not null,
  message_text text not null,
  message_timestamp timestamptz not null,
  processed boolean default false,
  skipped boolean default false,
  created_at timestamptz default now()
);

-- Published events
create table events (
  id uuid primary key default gen_random_uuid(),
  source_message_id uuid references raw_messages(id),
  title text not null,
  city text not null default 'amsterdam',
  venue text,
  event_date date not null,
  start_time time,
  end_time time,
  dance_styles text[] default '{}',
  description text,
  organizer_name text,
  status text not null default 'active',
  confidence numeric not null,
  published boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Human review queue for low-confidence extractions
create table review_queue (
  id uuid primary key default gen_random_uuid(),
  raw_message_id uuid not null references raw_messages(id),
  extracted_data jsonb not null,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz default now()
);

-- Baileys auth state — persists WhatsApp session across Render restarts
create table whatsapp_auth_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- RLS: anon can only read published active events
alter table events enable row level security;
create policy "public read published events"
  on events for select using (published = true);
