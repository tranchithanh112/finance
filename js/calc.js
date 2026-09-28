import { state, local } from './store.js';
import { isStable } from './util.js';

export const fxRate = () => Number(state.settings.fxManual) || state.fx.USDVND || 25500;

export function toUSD(amount, cur) {
  if (!amount) return 0;
  return cur === 'VND' ? amount / fxRate() : amount;
}

export function cryptoHoldings() {
  const dust = Number(state.settings.dustUsd) || 0;
  return state.crypto.holdings.filter((h) => h.value >= dust);
}

export function cryptoTotal() {
  return state.crypto.holdings.reduce((a, h) => a + (h.value || 0), 0);
}

export function fundPrice(f) {
  return f.source === 'manual' ? Number(f.manualPrice) || 0 : Number(f.lastPrice) || Number(f.manualPrice) || 0;
}

/** Vị thế từng quỹ/cổ phiếu từ danh sách giao dịch (giá vốn bình quân). */
export function stockPositions() {
  const byT = {};
  const txs = [...state.stocks.txs].sort((a, b) => a.date.localeCompare(b.date));
  for (const tx of txs) {
    const p = (byT[tx.ticker] ||= { units: 0, cost: 0, realized: 0, invested: 0, fees: 0, txCount: 0, first: tx.date });
    const units = Number(tx.units);
    const price = Number(tx.price);
    const fee = Number(tx.fee) || 0;
    p.txCount++;
    p.fees += fee;
    if (units > 0) {
      p.units += units;
      p.cost += units * price + fee;
      p.invested += units * price + fee;
    } else if (units < 0) {
      const q = Math.min(-units, p.units);
      const avg = p.units ? p.cost / p.units : 0;
      p.realized += q * price - fee - avg * q;
      p.cost -= avg * q;
      p.units -= q;
    }
  }
  return state.stocks.funds.map((f) => {
    const p = byT[f.ticker] || { units: 0, cost: 0, realized: 0, invested: 0, fees: 0, txCount: 0 };
    const price = fundPrice(f);
    const value = p.units * price;
    const unrealized = value - p.cost;
    const dayChange = f.prevClose && f.source !== 'manual' ? (price - f.prevClose) * p.units : null;
    return {
      ...f, ...p, price,
      avg: p.units ? p.cost / p.units : 0,
      value, unrealized, total: unrealized + p.realized,
      valueUSD: toUSD(value, f.currency),
      costUSD: toUSD(p.cost, f.currency),
      unrealizedUSD: toUSD(unrealized, f.currency),
      realizedUSD: toUSD(p.realized, f.currency),
      totalUSD: toUSD(unrealized + p.realized, f.currency),
      investedUSD: toUSD(p.invested, f.currency),
      dayChangeUSD: dayChange == null ? null : toUSD(dayChange, f.currency),
    };
  });
}

export function stocksTotal() {
  return stockPositions().reduce((a, p) => a + p.valueUSD, 0);
}

export function cashTotal() {
  return state.cash.reduce((a, c) => a + toUSD(Number(c.amount) || 0, c.currency), 0);
}

export function totals() {
  const crypto = cryptoTotal();
  const stocks = stocksTotal();
  const cash = cashTotal();
  const stable = state.crypto.holdings.filter((h) => isStable(h.asset)).reduce((a, h) => a + h.value, 0);
  return { crypto, stocks, cash, stable, total: crypto + stocks + cash };
}

export const hasPassword = () => Boolean(local.appPassword);
