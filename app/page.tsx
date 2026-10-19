'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOfflineSync } from '@/hooks/useOfflineSync';

type Row = Record<string, any>;
type DB = { entries: Row[]; debts: Row[]; payments: Row[]; drawings: Row[]; closings: Row[]; shops: Row[] };

// local key -> Supabase table name
const TABLE: Record<keyof DB, string> = {
  entries: 'entries', debts: 'debts', payments: 'payments',
  drawings: 'drawings', closings: 'monthly_closings', shops: 'shops',
};
const DEFAULT_SHOPS = [{ id: 'shop-1', name: 'Shop 1 - Main' }, { id: 'shop-2', name: 'Shop 2 - Branch' }];
const EMPTY: DB = { entries: [], debts: [], payments: [], drawings: [], closings: [], shops: [] };

const n = (v: any) => Number(v) || 0;
const fmt = (v: any) => n(v).toLocaleString();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sum = (a: Row[], k: string) => a.reduce((s, r) => s + n(r[k]), 0);

// Auto date/time. Uses the phone's LOCAL date (toISOString would give yesterday's date between 00:00-03:00 in Uganda)
function stamp(d = new Date()) {
  const p = (x: number) => String(x).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { date, time: d.toLocaleTimeString(), month: date.slice(0, 7) };
}

function useForm(init: Row) {
  const [f, setF] = useState<Row>(init);
  return { f, set: (k: string, v: any) => setF((p) => ({ ...p, [k]: v })), reset: () => setF(init) };
}

const F = ({ label, children }: any) => (<label className="fld"><span>{label}</span>{children}</label>);
const TABS = ['Dashboard', 'Sales + Credit', 'Credit Payments', 'Owner Drawings', 'Monthly Close', 'Admin'];

export default function Page() {
  const { isOnline, queue, syncing, addToQueue, sync } = useOfflineSync();
  const [db, setDb] = useState<DB>(EMPTY);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState<Date>(new Date());
  const [tab, setTab] = useState('Dashboard');
  const [role, setRole] = useState('admin'); // 'admin' or a shop id
  const [fStore, setFStore] = useState('ALL');
  const [fMonth, setFMonth] = useState('cur');
  const [kind, setKind] = useState('sale');
  const [msg, setMsg] = useState('');
  const [newShop, setNewShop] = useState('');

  const stock = useForm({ product: '', qty: '', buy: '', sell: '', store: '' });
  const sale = useForm({ product: '', qty: '', sell: '', pay: 'cash', customer: '', phone: '', paidNow: '', store: '' });
  const exp = useForm({ category: 'Rent', amount: '', note: '', store: '' });
  const pay = useForm({ debt: '', amount: '' });
  const draw = useForm({ amount: '', reason: 'Personal Use', note: '', store: '' });
  const close = useForm({ month: stamp().month, stock: '', cash: '', notes: '', store: '' });

  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500); };

  // ---------- load local data, tick the clock ----------
  useEffect(() => {
    const raw = localStorage.getItem('app_data');
    const local = raw ? JSON.parse(raw) : {};
    setDb({ ...EMPTY, ...local, shops: local.shops?.length ? local.shops : DEFAULT_SHOPS });
    setReady(true);
    const t = setInterval(() => setNow(new Date()), 30000); // date/time auto-update
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (ready) localStorage.setItem('app_data', JSON.stringify(db)); }, [db, ready]);

  // ---------- pull from Supabase and merge by id ----------
  const pull = async () => {
    if (!supabase || !navigator.onLine) return;
    const pending = new Set<string>(
      JSON.parse(localStorage.getItem('sync_queue') || '[]').map((q: any) => q.table + ':' + q.data.id)
    );
    const remote: Partial<DB> = {};
    for (const key of Object.keys(TABLE) as (keyof DB)[]) {
      const { data, error } = await supabase.from(TABLE[key]).select('*');
      if (!error && data) remote[key] = data;
    }
    setDb((prev) => {
      const next: any = { ...prev };
      for (const key of Object.keys(remote) as (keyof DB)[]) {
        const merged = [...prev[key]];
        for (const r of remote[key] as Row[]) {
          const i = merged.findIndex((x) => x.id === r.id);
          if (i === -1) merged.push(r);
          else if (!pending.has(TABLE[key] + ':' + r.id)) merged[i] = r; // local unsynced edits win
        }
        next[key] = merged;
      }
      return next;
    });
  };
  useEffect(() => {
    if (!ready) return;
    pull();
    const t = setInterval(pull, 15000); // admin sees other shops live
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [ready, isOnline]);

  // ---------- save = local state + queue (+ auto sync) ----------
  const save = (key: keyof DB, row: Row) => {
    setDb((p) => {
      const i = p[key].findIndex((r) => r.id === row.id);
      const list = [...p[key]];
      if (i === -1) list.push(row); else list[i] = row;
      return { ...p, [key]: list };
    });
    addToQueue({ table: TABLE[key], data: row });
  };

  if (!ready) return <main>Loading...</main>;

  const staffShop = role === 'admin' ? null : role;
  const myShops = staffShop ? db.shops.filter((s) => s.id === staffShop) : db.shops;
  const shopName = (id: string) => db.shops.find((s) => s.id === id)?.name || id;
  const storeOf = (f: Row) => staffShop || f.store || myShops[0]?.id;
  const curMonth = stamp(now).month;
  const viewStore = staffShop || fStore;
  const viewMonth = fMonth === 'cur' ? curMonth : 'ALL';
  const tabs = role === 'admin' ? TABS : TABS.filter((t) => t !== 'Admin');
  const scoped = (rows: Row[]) => rows.filter((r) => !staffShop || r.store === staffShop);

  // ---------- one function that does all the maths ----------
  const stats = (store: string, month: string) => {
    const inS = (r: Row) => (store === 'ALL' || r.store === store) && (month === 'ALL' || r.month === month);
    const E = db.entries.filter(inS);
    const sales = E.filter((e) => e.type === 'sale');
    const salesTotal = sum(sales, 'amount');
    const profit = sum(sales, 'profit');
    const expenses = sum(E.filter((e) => e.type === 'expense'), 'amount');
    const drawings = sum(db.drawings.filter(inS), 'amount');
    const owed = sum(db.debts.filter(inS), 'balance'); // credit not yet collected
    const stockIn = sum(E.filter((e) => e.type === 'stockin'), 'qty');
    const sold = sum(sales, 'qty');
    let opening = 0; // opening = latest closing of an EARLIER month
    if (month !== 'ALL') {
      const ids = store === 'ALL' ? db.shops.map((s) => s.id) : [store];
      ids.forEach((id) => {
        const c = db.closings.filter((x) => x.store === id && x.month < month);
        if (c.length) opening += n(c.reduce((a, b) => (b.month >= a.month ? b : a)).remaining_stock);
      });
    }
    return {
      salesTotal, profit, expenses, drawings, owed, stockIn, sold, opening,
      netProfit: profit - expenses,
      cashShould: salesTotal - owed - expenses - drawings,
      remaining: opening + stockIn - sold,
    };
  };

  // ---------- actions ----------
  const addStock = () => {
    const { f } = stock; const s = stamp();
    if (!f.product || n(f.qty) <= 0) return toast('Enter product and quantity');
    save('entries', { id: uid(), store: storeOf(f), type: 'stockin', product: f.product.trim(), qty: n(f.qty), buy: n(f.buy), sell: n(f.sell), amount: n(f.qty) * n(f.buy), category: '', note: '', ...s, payment_type: '', profit: 0, synced_by: role });
    stock.reset(); toast('Stock saved');
  };

  const addSale = () => {
    const { f } = sale; const s = stamp(); const store = storeOf(f);
    if (!f.product || n(f.qty) <= 0 || n(f.sell) <= 0) return toast('Enter product, qty and price');
    const credit = f.pay !== 'cash';
    if (credit && !f.customer.trim()) return toast('Customer name is required for credit');
    const total = n(f.qty) * n(f.sell);
    const paidNow = f.pay === 'cash' ? total : f.pay === 'partial' ? Math.min(n(f.paidNow), total) : 0;
    const owed = total - paidNow;
    const last = db.entries.filter((e) => e.type === 'stockin' && e.store === store && e.product.toLowerCase() === f.product.trim().toLowerCase()).pop();
    const buy = last ? n(last.buy) : 0;
    const entryId = uid();
    save('entries', { id: entryId, store, type: 'sale', product: f.product.trim(), qty: n(f.qty), buy, sell: n(f.sell), amount: total, category: '', note: '', ...s, payment_type: f.pay, profit: (n(f.sell) - buy) * n(f.qty), synced_by: role });
    if (credit) {
      const debtId = uid();
      save('debts', { id: debtId, store, customer: f.customer.trim(), phone: f.phone, product: f.product.trim(), total, paid: paidNow, balance: owed, status: owed > 0 ? 'unpaid' : 'paid', date: s.date, month: s.month, entry_id: entryId });
      if (paidNow > 0) save('payments', { id: uid(), debt_id: debtId, amount: paidNow, date: s.date, time: s.time, store });
    }
    sale.reset(); toast(last ? 'Sale saved' : 'Sale saved (no stock-in found, profit uses buy price 0)');
  };

  const addExpense = () => {
    const { f } = exp; const s = stamp();
    if (n(f.amount) <= 0) return toast('Enter amount');
    save('entries', { id: uid(), store: storeOf(f), type: 'expense', product: '', qty: 0, buy: 0, sell: 0, amount: n(f.amount), category: f.category, note: f.note, ...s, payment_type: '', profit: 0, synced_by: role });
    exp.reset(); toast('Expense saved');
  };

  const selDebt = db.debts.find((d) => d.id === pay.f.debt);
  const recordPayment = () => {
    if (!selDebt) return toast('Select a debt');
    const amt = Math.min(n(pay.f.amount), n(selDebt.balance));
    if (amt <= 0) return toast('Enter amount');
    const s = stamp();
    const paid = n(selDebt.paid) + amt;
    const balance = Math.max(0, n(selDebt.total) - paid);
    save('debts', { ...selDebt, paid, balance, status: balance <= 0 ? 'paid' : 'unpaid' });
    save('payments', { id: uid(), debt_id: selDebt.id, amount: amt, date: s.date, time: s.time, store: selDebt.store });
    pay.reset(); toast(`Payment recorded. New balance: ${fmt(balance)} UGX`);
  };

  const addDrawing = () => {
    const { f } = draw; const s = stamp();
    if (n(f.amount) <= 0) return toast('Enter amount');
    save('drawings', { id: uid(), store: storeOf(f), amount: n(f.amount), reason: f.reason, note: f.note, ...s });
    draw.reset(); toast('Drawing saved');
  };

  const closeMonth = () => {
    const { f } = close; const s = stamp(); const store = storeOf(f);
    if (!f.month) return toast('Pick a month');
    const st = stats(store, f.month);
    save('closings', { id: uid(), store, month: f.month, remaining_stock: n(f.stock), cash: n(f.cash), total_sales: st.salesTotal, total_expenses: st.expenses, profit: st.netProfit, drawings: st.drawings, notes: f.notes, date: s.date, time: s.time });
    close.reset(); toast('Month closed. Remaining stock carries forward as next opening.');
  };

  const addShop = () => {
    const name = newShop.trim(); if (!name) return;
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid();
    if (db.shops.some((s) => s.id === id)) id += '-' + uid().slice(-3);
    save('shops', { id, name }); setNewShop(''); toast('Shop added');
  };

  const whatsapp = () => {
    const s = stamp(now);
    let t = `*REPORT ${s.date} ${s.time}*\n`;
    db.shops.forEach((sh) => {
      const x = stats(sh.id, curMonth);
      t += `\n*${sh.name}*\nSales: ${fmt(x.salesTotal)}\nProfit: ${fmt(x.netProfit)}\nRemain: ${fmt(x.remaining)}\nDrawings: ${fmt(x.drawings)}\n`;
    });
    window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank');
  };

  const StoreSel = ({ form }: { form: ReturnType<typeof useForm> }) => (
    <F label="Store">
      <select value={storeOf(form.f)} disabled={!!staffShop} onChange={(e) => form.set('store', e.target.value)}>
        {myShops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </F>
  );
  const AutoDate = () => {
    const s = stamp(now);
    return (<div className="grid"><F label="Date (auto)"><input readOnly value={s.date} /></F><F label="Time (auto)"><input readOnly value={s.time} /></F></div>);
  };

  const syncLabel = !isOnline ? `Offline - Queue ${queue.length} items - Saving Locally` : syncing ? 'Syncing...' : queue.length ? `Online - ${queue.length} waiting` : 'Online - Live Syncing';
  const st = stats(viewStore, viewMonth);
  const unpaidDebts = scoped(db.debts).filter((d) => d.status === 'unpaid');
  const unpaidAll = viewStore === 'ALL' ? unpaidDebts : unpaidDebts.filter((d) => d.store === viewStore);
  const today = stamp(now).date;

  return (
    <>
      <header>
        <h1>STORE PRO LIVE</h1>
        <div className="row">
          <select value={role} onChange={(e) => { setRole(e.target.value); setTab('Dashboard'); }} style={{ width: 'auto' }}>
            <option value="admin">Admin - Owner</option>
            {db.shops.map((s) => <option key={s.id} value={s.id}>Staff {s.name}</option>)}
          </select>
          <span className="sub">📅 {stamp(now).date} {stamp(now).time}</span>
        </div>
        <div className="sub" style={{ marginTop: 4 }}>{isOnline ? '🟢' : '🔴'} {syncLabel}</div>
      </header>

      <nav className="tabs">
        {tabs.map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </nav>

      <main>
        {tab === 'Dashboard' && (<>
          <div className="card row">
            {!staffShop && (
              <F label="Store">
                <select value={fStore} onChange={(e) => setFStore(e.target.value)}>
                  <option value="ALL">ALL</option>
                  {db.shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </F>
            )}
            <F label="Month">
              <select value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
                <option value="cur">Current Month ({curMonth})</option>
                <option value="all">All Time</option>
              </select>
            </F>
          </div>
          <div className="grid">
            <div className="stat blue"><span>Sales</span><b>{fmt(st.salesTotal)}</b></div>
            <div className="stat"><span>Expenses</span><b>{fmt(st.expenses)}</b></div>
            <div className="stat orange"><span>Owner Drawings</span><b>{fmt(st.drawings)}</b></div>
            <div className="stat green"><span>Net Profit</span><b>{fmt(st.netProfit)}</b></div>
            <div className="stat green"><span>Cash Should Be</span><b>{fmt(st.cashShould)}</b></div>
            <div className="stat red"><span>Unpaid Credit ({new Set(unpaidAll.map((d) => d.customer)).size} customers)</span><b>{fmt(sum(unpaidAll, 'balance'))}</b></div>
            <div className="stat"><span>Opening Stock</span><b>{fmt(st.opening)}</b></div>
            <div className="stat"><span>Stock In</span><b>{fmt(st.stockIn)}</b></div>
            <div className="stat"><span>Sold</span><b>{fmt(st.sold)}</b></div>
            <div className="stat blue"><span>Remaining Stock</span><b>{fmt(st.remaining)}</b></div>
          </div>
          <p className="note">Cash Should Be = Sales − credit not yet collected − Expenses − Drawings (UGX).</p>
        </>)}

        {tab === 'Sales + Credit' && (<>
          <div className="seg">
            {[['stockin', 'Stock In'], ['sale', 'Sale'], ['expense', 'Expense']].map(([k, l]) =>
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
          </div>
          <div className="card">
            {kind === 'stockin' && (<>
              <h3>Stock In</h3>
              <StoreSel form={stock} />
              <F label="Product"><input value={stock.f.product} onChange={(e) => stock.set('product', e.target.value)} /></F>
              <F label="Qty Added"><input type="number" value={stock.f.qty} onChange={(e) => stock.set('qty', e.target.value)} /></F>
              <F label="Buy Price / unit"><input type="number" value={stock.f.buy} onChange={(e) => stock.set('buy', e.target.value)} /></F>
              <F label="Sell Price / unit"><input type="number" value={stock.f.sell} onChange={(e) => stock.set('sell', e.target.value)} /></F>
              <AutoDate />
              <button className="btn" onClick={addStock}>Save Stock In</button>
            </>)}
            {kind === 'sale' && (<>
              <h3>Sale / Earnings</h3>
              <StoreSel form={sale} />
              <F label="Product"><input value={sale.f.product} onChange={(e) => sale.set('product', e.target.value)} /></F>
              <F label="Qty Sold"><input type="number" value={sale.f.qty} onChange={(e) => sale.set('qty', e.target.value)} /></F>
              <F label="Sell Price / unit"><input type="number" value={sale.f.sell} onChange={(e) => sale.set('sell', e.target.value)} /></F>
              <F label="Total (auto)"><input readOnly value={fmt(n(sale.f.qty) * n(sale.f.sell))} /></F>
              <F label="Payment Type">
                <select value={sale.f.pay} onChange={(e) => sale.set('pay', e.target.value)}>
                  <option value="cash">Cash Paid Now</option>
                  <option value="credit">Credit - Customer Will Pay Later</option>
                  <option value="partial">Partial - Some Cash + Some Credit</option>
                </select>
              </F>
              {sale.f.pay !== 'cash' && (<>
                <F label="Customer Name (required)"><input value={sale.f.customer} onChange={(e) => sale.set('customer', e.target.value)} /></F>
                <F label="Phone (optional)"><input value={sale.f.phone} onChange={(e) => sale.set('phone', e.target.value)} /></F>
                {sale.f.pay === 'partial' && <F label="Amount Paid Now"><input type="number" value={sale.f.paidNow} onChange={(e) => sale.set('paidNow', e.target.value)} /></F>}
                <F label="Balance Owed (auto)"><input readOnly value={fmt(n(sale.f.qty) * n(sale.f.sell) - (sale.f.pay === 'partial' ? Math.min(n(sale.f.paidNow), n(sale.f.qty) * n(sale.f.sell)) : 0))} /></F>
              </>)}
              <AutoDate />
              <button className="btn green" onClick={addSale}>Save Sale</button>
            </>)}
            {kind === 'expense' && (<>
              <h3>Expense</h3>
              <StoreSel form={exp} />
              <F label="Category">
                <select value={exp.f.category} onChange={(e) => exp.set('category', e.target.value)}>
                  {['Rent', 'Transport', 'Salary', 'Other'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </F>
              <F label="Amount"><input type="number" value={exp.f.amount} onChange={(e) => exp.set('amount', e.target.value)} /></F>
              <F label="Note"><input value={exp.f.note} onChange={(e) => exp.set('note', e.target.value)} /></F>
              <AutoDate />
              <button className="btn" onClick={addExpense}>Save Expense</button>
            </>)}
          </div>
          <div className="card scroll">
            <h3>Recent entries</h3>
            <table>
              <thead><tr><th>Date</th><th>Shop</th><th>Type</th><th>Item</th><th>Qty</th><th>Amount</th><th>Profit</th></tr></thead>
              <tbody>
                {scoped(db.entries).slice(-15).reverse().map((e) => (
                  <tr key={e.id}><td>{e.date}</td><td>{shopName(e.store)}</td><td>{e.type}</td><td>{e.product || e.category}</td><td>{fmt(e.qty)}</td><td>{fmt(e.amount)}</td><td>{fmt(e.profit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}

        {tab === 'Credit Payments' && (<>
          <div className="card">
            <h3>Customer Pays Old Debt</h3>
            <F label="Select unpaid debt">
              <select value={pay.f.debt} onChange={(e) => pay.set('debt', e.target.value)}>
                <option value="">-- choose --</option>
                {unpaidDebts.map((d) => <option key={d.id} value={d.id}>{shopName(d.store)} | {d.customer} owes {fmt(d.balance)} | {d.product} | {d.date}</option>)}
              </select>
            </F>
            {selDebt && <p><b>{selDebt.customer}</b> owes <b>{fmt(selDebt.balance)} UGX</b> for {selDebt.product} from {selDebt.date}. Total {fmt(selDebt.total)}, Paid {fmt(selDebt.paid)}.</p>}
            <F label="Amount Customer Is Paying Now"><input type="number" value={pay.f.amount} onChange={(e) => pay.set('amount', e.target.value)} /></F>
            <AutoDate />
            <button className="btn green" onClick={recordPayment}>Record Payment</button>
          </div>
          <div className="card scroll">
            <h3>All debts</h3>
            <table>
              <thead><tr><th>Date</th><th>Shop</th><th>Customer</th><th>Product</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
              <tbody>
                {scoped(db.debts).map((d) => (
                  <tr key={d.id}><td>{d.date}</td><td>{shopName(d.store)}</td><td>{d.customer}</td><td>{d.product}</td><td>{fmt(d.total)}</td><td>{fmt(d.paid)}</td><td>{fmt(d.balance)}</td><td><span className={`badge ${d.status}`}>{d.status}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}

        {tab === 'Owner Drawings' && (<>
          <div className="card">
            <h3>Owner Drawings <span className="badge owner">not an expense</span></h3>
            <StoreSel form={draw} />
            <F label="Amount Taken"><input type="number" value={draw.f.amount} onChange={(e) => draw.set('amount', e.target.value)} /></F>
            <F label="Reason">
              <select value={draw.f.reason} onChange={(e) => draw.set('reason', e.target.value)}>
                {['Personal Use', 'Family Emergency', 'School Fees', 'Other Business', 'Other'].map((r) => <option key={r}>{r}</option>)}
              </select>
            </F>
            <F label="Note"><input value={draw.f.note} onChange={(e) => draw.set('note', e.target.value)} /></F>
            <AutoDate />
            <button className="btn orange" onClick={addDrawing}>Save Drawing</button>
          </div>
          <div className="card scroll">
            <h3>Drawings history</h3>
            <table>
              <thead><tr><th>Date</th><th>Shop</th><th>Amount</th><th>Reason</th><th>Note</th></tr></thead>
              <tbody>
                {scoped(db.drawings).slice().reverse().map((d) => (
                  <tr key={d.id}><td>{d.date} {d.time}</td><td>{shopName(d.store)}</td><td>{fmt(d.amount)}</td><td><span className="badge owner">{d.reason}</span></td><td>{d.note}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}

        {tab === 'Monthly Close' && (() => {
          const store = storeOf(close.f);
          const x = stats(store, close.f.month);
          const diff = close.f.cash === '' ? null : n(close.f.cash) - x.cashShould;
          return (<>
            <div className="card">
              <h3>Close Month & Carry Forward</h3>
              <StoreSel form={close} />
              <F label="Month"><input type="month" value={close.f.month} onChange={(e) => close.set('month', e.target.value)} /></F>
              <p className="note">System says: Sales {fmt(x.salesTotal)} | Net Profit {fmt(x.netProfit)} | Drawings {fmt(x.drawings)} | Cash should be {fmt(x.cashShould)} | Stock should be {fmt(x.remaining)}</p>
              <F label="Remaining Stock Counted (Physical)"><input type="number" value={close.f.stock} onChange={(e) => close.set('stock', e.target.value)} /></F>
              <F label="Cash Counted"><input type="number" value={close.f.cash} onChange={(e) => close.set('cash', e.target.value)} /></F>
              {diff !== null && <p className="note">Difference: <b style={{ color: diff < 0 ? '#b91c1c' : '#15803d' }}>{fmt(diff)}</b> {diff < 0 ? '(cash missing - possible loss/theft)' : ''}</p>}
              <F label="Notes"><input value={close.f.notes} onChange={(e) => close.set('notes', e.target.value)} /></F>
              <AutoDate />
              <button className="btn" onClick={closeMonth}>Close Month & Carry Forward</button>
              <p className="note">You can close a month more than once. The latest closing is the official one.</p>
            </div>
            <div className="card scroll">
              <h3>Closings</h3>
              <table>
                <thead><tr><th>Month</th><th>Shop</th><th>Sales</th><th>Profit</th><th>Stock → next opening</th><th>Cash</th></tr></thead>
                <tbody>
                  {scoped(db.closings).slice().reverse().map((c) => (
                    <tr key={c.id}><td>{c.month}</td><td>{shopName(c.store)}</td><td>{fmt(c.total_sales)}</td><td>{fmt(c.profit)}</td><td>{fmt(c.remaining_stock)}</td><td>{fmt(c.cash)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>);
        })()}

        {tab === 'Admin' && role === 'admin' && (<>
          <div className="card">
            <h3>Add Another Shop</h3>
            <F label="Shop name (e.g. Shop 3 - New Branch)"><input value={newShop} onChange={(e) => setNewShop(e.target.value)} /></F>
            <button className="btn" onClick={addShop}>+ Add Shop</button>
            <p className="note">{db.shops.map((s) => s.name).join(' • ')}</p>
          </div>
          <div className="card">
            <h3>Today Report ({today})</h3>
            <div className="grid">
              <div className="stat blue"><span>Sales today</span><b>{fmt(sum(db.entries.filter((e) => e.type === 'sale' && e.date === today), 'amount'))}</b></div>
              <div className="stat red"><span>Unpaid debts</span><b>{fmt(sum(db.debts.filter((d) => d.status === 'unpaid'), 'balance'))}</b></div>
              <div className="stat orange"><span>Drawings today</span><b>{fmt(sum(db.drawings.filter((d) => d.date === today), 'amount'))}</b></div>
            </div>
            <br /><button className="btn green" onClick={whatsapp}>Share Report on WhatsApp</button>
          </div>
          <div className="card">
            <h3>Live Queue Status</h3>
            <p>Queue: <b>{queue.length}</b> | Online: <b>{isOnline ? 'yes' : 'no'}</b> | Syncing: <b>{syncing ? 'yes' : 'no'}</b>{!supabase && ' | Supabase keys missing (local only)'}</p>
            <button className="btn" onClick={() => { sync(); pull(); }}>Force Sync Now</button>
          </div>
          <div className="card scroll">
            <h3>All Monthly Closings</h3>
            <table>
              <thead><tr><th>Month</th><th>Shop</th><th>Sales</th><th>Profit</th><th>Remaining → next opening</th><th>Cash</th></tr></thead>
              <tbody>
                {db.closings.slice().reverse().map((c) => (
                  <tr key={c.id}><td>{c.month}</td><td>{shopName(c.store)}</td><td>{fmt(c.total_sales)}</td><td>{fmt(c.profit)}</td><td>{fmt(c.remaining_stock)}</td><td>{fmt(c.cash)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
      </main>
      {msg && <div className="toast">{msg}</div>}
    </>
  );
}
