
create table if not exists shops (id text primary key, name text);
create table if not exists entries (id text primary key, store text, type text, product text, qty numeric, buy numeric, sell numeric, amount numeric, category text, note text, date date, month text, time text, payment_type text, profit numeric, synced_by text, created_at timestamp default now());
create table if not exists debts (id text primary key, store text, customer text, phone text, product text, total numeric, paid numeric, balance numeric, status text, date date, month text, entry_id text, created_at timestamp default now());
create table if not exists payments (id text primary key, debt_id text, amount numeric, date date, time text, store text, created_at timestamp default now());
create table if not exists drawings (id text primary key, store text, amount numeric, reason text, note text, date date, time text, month text, created_at timestamp default now());
create table if not exists monthly_closings (id text primary key, store text, month text, remaining_stock numeric, cash numeric, total_sales numeric, total_expenses numeric, profit numeric, drawings numeric, notes text, date date, time text, created_at timestamp default now());

-- RLS ON + allow-all for anon (TESTING ONLY - replace before real use)
alter table shops enable row level security;
alter table entries enable row level security;
alter table debts enable row level security;
alter table payments enable row level security;
alter table drawings enable row level security;
alter table monthly_closings enable row level security;

create policy "allow all shops" on shops for all to anon using (true) with check (true);
create policy "allow all entries" on entries for all to anon using (true) with check (true);
create policy "allow all debts" on debts for all to anon using (true) with check (true);
create policy "allow all payments" on payments for all to anon using (true) with check (true);
create policy "allow all drawings" on drawings for all to anon using (true) with check (true);
create policy "allow all closings" on monthly_closings for all to anon using (true) with check (true);

insert into shops (id, name) values ('shop-1','Shop 1 - Main'), ('shop-2','Shop 2 - Branch') on conflict do nothing;
