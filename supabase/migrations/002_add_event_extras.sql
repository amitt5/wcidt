alter table events add column if not exists ticket_price text;
alter table events add column if not exists extras jsonb default '{}';
