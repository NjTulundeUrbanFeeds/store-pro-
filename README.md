# STORE PRO LIVE

Multi-shop retail tracker. Works offline for days, syncs to Supabase when internet returns.
No login: pick a role from the dropdown at the top (testing only).

## Setup (5 steps)
1. Create a free project at supabase.com.
2. Supabase > SQL Editor > paste `supabase.sql` > Run.
3. Supabase > Project Settings > API > copy the Project URL and the anon key.
4. Copy `.env.example` to `.env.local` and paste the two values.
5. `npm install` then `npm run dev` and open http://localhost:3000

## Deploy to Vercel
1. Push this folder to a GitHub repo.
2. vercel.com > Add New > Project > import the repo.
3. Before clicking Deploy, open Environment Variables and add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy. Open the link on your phone and test.

## How it works
**Offline queue.** Every save (sale, debt, payment, drawing, closing, shop) is written to the screen and to `localStorage` (`app_data`), and also added to `sync_queue`. When online, `hooks/useOfflineSync.ts` sends each queued item to Supabase with `upsert`. Sent items leave the queue; failed items stay and retry. It tries on the browser `online` event, every 10 seconds, and when you press Force Sync. Because it is an upsert by `id`, a retry never creates duplicates. On load (and every 15 seconds) the app also downloads from Supabase and merges by `id`, so the admin sees other shops. Unsynced local edits are never overwritten.

**Dates.** Date, time and month are read-only and generated from the phone clock at the moment you save. The header clock refreshes every 30 seconds. We use the phone's local date (not `toISOString`, which is UTC and shows yesterday between midnight and 3am in Uganda).

**Credit sales and payments.** A Credit or Partial sale creates the sale entry plus a row in `debts` (`unpaid` while balance > 0). Partial also creates a `payments` row for the cash paid now. Later, in Credit Payments, pick the debt, enter the amount: `paid` goes up, `balance = total - paid`, and at 0 the status becomes `paid`. Each payment is a row in `payments`.

**Owner drawings.** Saved in their own table, never counted as an expense.
- Net Profit = sales profit - expenses
- Cash Should Be = sales - credit not yet collected - expenses - drawings
Compare it with the cash you count at month end. A shortage is possible loss or theft.
(We subtract uncollected credit because that money is not in the till yet.)

**Monthly carry forward.** Closing saves totals plus the physical remaining stock. In the next month: Opening = latest closing's remaining stock, Remaining = Opening + Stock In - Sold, and sales start at 0. Closing twice is allowed; the latest closing is the official one.

**Profit.** Buy price comes from the last Stock In of the same product in the same shop. If none exists, buy price is 0.

## Notes
- Stock is counted in units (qty), not money.
- Security is OFF on purpose (anyone can read/write). Before real use, add Supabase Auth and proper RLS policies.
- Data in `localStorage` is per browser/device, so don't clear browser data while the queue has items.
