import { state, local } from './store.js';
import { isStable } from './util.js';
import { debtTotalVnd, accountBalance } from './budget.js';
import { tcbsHoldings, tcbsCash } from './tcbs.js';

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
  const manual = state.stocks.funds.map((f) => {
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
  return [...manual, ...brokerPositions()];
}

/** Vị thế đọc trực tiếp từ TCBS (VND, giá vốn do TCBS tính). */
export function brokerPositions() {
  return tcbsHoldings(state.broker?.tcbs).map((h) => {
    const costTotal = h.qty * h.cost;
    const unrealized = h.value - costTotal;
    return {
      ticker: h.symbol, name: h.etf ? 'ETF' : '', currency: 'VND', source: 'tcbs', broker: 'tcbs',
      units: h.qty, cost: costTotal, avg: h.cost, price: h.price, realized: 0,
      value: h.value, unrealized, total: unrealized,
      valueUSD: toUSD(h.value, 'VND'),
      costUSD: toUSD(costTotal, 'VND'),
      unrealizedUSD: toUSD(unrealized, 'VND'),
      realizedUSD: 0,
      totalUSD: toUSD(unrealized, 'VND'),
      investedUSD: toUSD(costTotal, 'VND'),
      dayChangeUSD: null,
    };
  });
}

/** Tiền mặt nằm trong tài khoản chứng khoán (tính vào mảng chứng khoán). */
export const brokerCashUSD = () => toUSD(tcbsCash(state.broker?.tcbs), 'VND');

export function stocksTotal() {
  return stockPositions().reduce((a, p) => a + p.valueUSD, 0) + brokerCashUSD();
}

/** Số dư hiện tại của 1 tài khoản tiền mặt (đã tự cộng/trừ thu chi sau lần chốt). */
export function cashBalance(c) {
  return accountBalance(c, state.budget?.txs, fxRate());
}

export function cashTotal() {
  return state.cash.reduce((a, c) => a + toUSD(cashBalance(c).balance, c.currency), 0);
}

export function totals() {
  const crypto = cryptoTotal();
  const stocks = stocksTotal();
  const cash = cashTotal();
  const stable = state.crypto.holdings.filter((h) => isStable(h.asset)).reduce((a, h) => a + h.value, 0);
  const debt = state.budget ? debtTotalVnd(state.budget, fxRate()) / fxRate() : 0;
  return { crypto, stocks, cash, stable, debt, assets: crypto + stocks + cash, total: crypto + stocks + cash - debt };
}

export const hasPassword = () => Boolean(local.appPassword);
