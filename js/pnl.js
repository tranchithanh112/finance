import { isStable, DAY } from './util.js';

/**
 * Tính PnL theo phương pháp giá vốn bình quân (average cost), quy đổi USD.
 *
 * Mỗi lệnh sinh ra các "sự kiện" cho từng tài sản:
 *  - Coin cơ sở: mua (+qty, giá trị = tiền trả + phí) / bán (−qty, giá trị = tiền nhận − phí)
 *  - Coin định giá (nếu không phải stablecoin, vd BTC trong ETHBTC): chiều ngược lại
 *  - Coin trả phí (nếu không phải stablecoin, vd BNB): bị "tiêu" theo giá thị trường
 * Nạp tiền: +qty theo giá thị trường lúc nạp. Rút: −qty theo giá vốn (không tính lãi/lỗ).
 */

export function makePriceLookup(priceHist) {
  return (asset, t) => {
    if (isStable(asset)) return 1;
    const days = priceHist[asset]?.days;
    if (!days) return null;
    const d = Math.floor(t / DAY);
    for (let k = 0; k < 7; k++) { // lùi tối đa 1 tuần nếu thiếu nến
      if (days[d - k] != null) return days[d - k];
      if (days[d + k] != null) return days[d + k];
    }
    return null;
  };
}

export function buildEvents(history, usdAt) {
  const ev = [];
  const missing = new Set();
  const price = (a, t) => {
    const p = usdAt(a, t);
    if (p == null) missing.add(a);
    return p;
  };
  const add = (asset, t, qty, value, kind, ref) => ev.push({ asset, t, qty, value, kind, ref });

  for (const [symbol, entry] of Object.entries(history.trades)) {
    const [base, quote] = history.meta[symbol] || [];
    if (!base) continue;
    for (const [id, t, p, qty, qq, fee, feeAsset, buyer] of entry.rows) {
      const qUsd = price(quote, t) ?? 0;
      const V = qq * qUsd;
      let feeV = 0;
      if (fee > 0) {
        if (feeAsset === quote) feeV = fee * qUsd;
        else if (feeAsset === base) feeV = fee * p * qUsd;
        else feeV = fee * (price(feeAsset, t) ?? 0);
      }
      const ref = { symbol, id, price: p, qty, side: buyer ? 'BUY' : 'SELL' };
      if (buyer) add(base, t, qty, V + feeV, 'buy', ref);
      else add(base, t, -qty, V - feeV, 'sell', ref);
      if (!isStable(quote)) {
        if (buyer) add(quote, t, -qq, V, 'sell', ref);
        else add(quote, t, qq, V, 'buy', ref);
      }
      if (fee > 0 && !isStable(feeAsset)) add(feeAsset, t, -fee, feeV, 'fee', ref);
    }
  }

  for (const [id, t, asset, amt] of history.deposits) {
    if (isStable(asset)) continue;
    add(asset, t, amt, amt * (price(asset, t) ?? 0), 'deposit', { id });
  }
  for (const [id, t, asset, amt, fee] of history.withdrawals) {
    if (isStable(asset)) continue;
    add(asset, t, -amt, null, 'withdraw', { id });
    if (fee > 0) add(asset, t, -fee, 0, 'fee', { id });
  }
  for (const [id, t, from, amt, bnb] of history.dust) {
    const v = bnb * (price('BNB', t) ?? 0);
    if (!isStable(from)) add(from, t, -amt, v, 'dust', { id });
    add('BNB', t, bnb, v, 'dust', { id });
  }
  for (const [id, t, from, fAmt, to, tAmt] of history.converts) {
    let v;
    if (isStable(from)) v = fAmt;
    else if (isStable(to)) v = tAmt;
    else v = fAmt * (price(from, t) ?? 0) || tAmt * (price(to, t) ?? 0);
    if (!isStable(from)) add(from, t, -fAmt, v, 'convert', { id, other: to });
    if (!isStable(to)) add(to, t, tAmt, v, 'convert', { id, other: from });
  }

  // cùng thời điểm: nhận vào trước, trả ra sau
  ev.sort((a, b) => a.t - b.t || b.qty - a.qty);
  return { events: ev, missing };
}

const EPS = 1e-9;

export function computePnl(history, priceHist, holdings, { dustUsd = 1 } = {}) {
  const usdAt = makePriceLookup(priceHist);
  const { events, missing } = buildEvents(history, usdAt);
  const per = {};
  const timeline = []; // [t, realizedCumulative]
  let realizedAll = 0;

  const get = (a) => (per[a] ||= {
    asset: a, qty: 0, cost: 0, realized: 0, invested: 0, proceeds: 0, buyQty: 0, sellQty: 0,
    fees: 0, trades: 0, untrackedQty: 0, first: null, last: null, events: [],
  });

  for (const e of events) {
    const s = get(e.asset);
    s.first ??= e.t;
    s.last = e.t;
    if (e.ref?.symbol) s.trades++;
    let realized = 0;
    if (e.qty > 0) {
      s.qty += e.qty;
      s.cost += e.value;
      if (e.kind !== 'deposit') { s.invested += e.value; s.buyQty += e.qty; }
    } else {
      const q = -e.qty;
      const avg = s.qty > EPS ? s.cost / s.qty : 0;
      const matched = Math.min(q, Math.max(s.qty, 0));
      const costOut = avg * matched;
      if (e.kind === 'withdraw') {
        // chuyển ra ngoài: giảm vị thế theo giá vốn, không phát sinh lãi/lỗ
      } else {
        const proceeds = q > 0 ? e.value * (matched / q) : 0;
        realized = proceeds - costOut;
        if (e.kind === 'fee') s.fees += costOut;
        else { s.proceeds += e.value; s.sellQty += q; }
      }
      s.untrackedQty += q - matched;
      s.cost -= costOut;
      s.qty -= matched;
      if (s.qty < EPS) { s.qty = 0; s.cost = 0; }
    }
    s.realized += realized;
    if (realized) {
      realizedAll += realized;
      timeline.push([e.t, realizedAll]);
    }
    if (s.events.length < 2000) s.events.push({ ...e, realized, avgAfter: s.qty > EPS ? s.cost / s.qty : 0, qtyAfter: s.qty });
  }

  const hold = Object.fromEntries(holdings.map((h) => [h.asset, h]));
  const assets = new Set([...Object.keys(per), ...holdings.filter((h) => !isStable(h.asset)).map((h) => h.asset)]);
  const rows = [];
  for (const a of assets) {
    if (isStable(a)) continue;
    const s = per[a] || get(a);
    const h = hold[a];
    const heldQty = h?.total || 0;
    const price = h?.price || 0;
    const value = heldQty * price;
    const avg = s.qty > EPS ? s.cost / s.qty : 0;
    const hasBasis = s.qty > EPS || s.invested > 0 || s.first != null;
    // Nếu số dư thực > số dư sổ sách (lãi Earn, airdrop…) thì phần dư có giá vốn 0.
    const costBasis = heldQty <= s.qty ? avg * heldQty : s.cost;
    const unrealized = hasBasis ? value - costBasis : null;
    const total = hasBasis ? s.realized + (unrealized || 0) : null;
    rows.push({
      asset: a, heldQty, ledgerQty: s.qty, price, value, avg, costBasis,
      realized: s.realized, unrealized, total,
      invested: s.invested, proceeds: s.proceeds, fees: s.fees,
      roi: s.invested > 0 && total != null ? total / s.invested : null,
      trades: s.trades, first: s.first, last: s.last,
      untrackedQty: s.untrackedQty,
      status: value >= dustUsd ? 'holding' : 'closed',
      hasBasis, events: s.events,
      noPrice: missing.has(a),
    });
  }
  rows.sort((x, y) => Math.abs(y.total ?? 0) - Math.abs(x.total ?? 0));

  const sum = (k) => rows.reduce((acc, r) => acc + (r[k] || 0), 0);
  return {
    rows,
    totals: {
      realized: sum('realized'), unrealized: sum('unrealized'), total: sum('total'),
      invested: sum('invested'), fees: sum('fees'),
    },
    timeline,
    missing: [...missing],
    eventCount: events.length,
  };
}
