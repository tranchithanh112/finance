import { state } from './store.js';
import { isStable } from './util.js';
import { debtTotalVnd, accountBalance } from './budget.js';
import { buy, sell, sortTxs } from './lots.js';

export const fxRate = () => Number(state.settings.fxManual) || state.fx.USDVND || 25500;

export function toUSD(amount, cur, fx = fxRate()) {
  if (!amount) return 0;
  return cur === 'VND' ? amount / fx : amount;
}

export function cryptoHoldings() {
  const dust = Number(state.settings.dustUsd) || 0;
  return state.crypto.holdings.filter((h) => h.value >= dust);
}

export function cryptoTotal() {
  return state.crypto.holdings.reduce((a, h) => a + (h.value || 0), 0);
}

/** Mã gửi cho /api/quote: quỹ mở lấy NAV từ Fmarket (FMARKET:DCDS), còn lại hỏi Yahoo. */
export const quoteSymbol = (f) => (f.source === 'fmarket' ? 'FMARKET:' + String(f.ticker).toUpperCase().replace(/\.VN$/, '') : f.ticker);

export function fundPrice(f) {
  return f.source === 'manual' ? Number(f.manualPrice) || 0 : Number(f.lastPrice) || Number(f.manualPrice) || 0;
}

/**
 * Vị thế từng quỹ/cổ phiếu từ danh sách giao dịch (giá vốn bình quân).
 * `short` = số đơn vị bán vượt số đã mua (thiếu dữ liệu) — phần vượt không tạo lãi/lỗ.
 */
export function stockPositions(txs = state.stocks.txs, funds = state.stocks.funds, fx = fxRate()) {
  const byT = {};
  for (const tx of sortTxs(txs)) {
    const p = (byT[tx.ticker] ||= { qty: 0, cost: 0, realized: 0, invested: 0, fees: 0, txCount: 0, short: 0, first: tx.date });
    const units = Number(tx.units);
    const price = Number(tx.price);
    const fee = Number(tx.fee) || 0;
    p.txCount++;
    p.fees += fee;
    if (units > 0) {
      buy(p, units, units * price + fee);
      p.invested += units * price + fee;
    } else if (units < 0) {
      const r = sell(p, -units, -units * price - fee);
      p.realized += r.realized;
      p.short += r.short;
    }
  }
  return funds.map((f) => {
    const { qty: units, ...p } = byT[f.ticker] || { qty: 0, cost: 0, realized: 0, invested: 0, fees: 0, txCount: 0, short: 0 };
    const price = fundPrice(f);
    const value = units * price;
    const unrealized = value - p.cost;
    const dayChange = f.prevClose && f.source !== 'manual' ? (price - f.prevClose) * units : null;
    const usd = (v) => toUSD(v, f.currency, fx);
    return {
      ...f, ...p, units, price,
      avg: units ? p.cost / units : 0,
      value, unrealized, total: unrealized + p.realized,
      valueUSD: usd(value),
      costUSD: usd(p.cost),
      unrealizedUSD: usd(unrealized),
      realizedUSD: usd(p.realized),
      totalUSD: usd(unrealized + p.realized),
      investedUSD: usd(p.invested),
      dayChangeUSD: dayChange == null ? null : usd(dayChange),
    };
  });
}

export function stocksTotal(txs, funds, fx) {
  return stockPositions(txs, funds, fx).reduce((a, p) => a + p.valueUSD, 0);
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

