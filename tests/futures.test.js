import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvToIncome, mergeIncome, computeFutures, emptyFutures, parseCsv } from '../js/futures.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

const WALLET_CSV = `﻿"User_ID","UTC_Time","Account","Operation","Coin","Change","Remark"
"1","2023-01-05 08:00:00","USDT-Futures","Realized Profit and Loss","USDT","-120.5",""
"1","2023-01-05 08:00:00","USDT-Futures","Fee","USDT","-1.2",""
"1","2023-01-05 16:00:00","USDT-Futures","Funding Fee","USDT","-0.3",""
"1","2023-01-06 09:00:00","USDT-Futures","Transfer Between Spot Account and UM Futures Account","USDT","500",""
"1","2023-01-06 09:00:00","Spot","Fee","BNB","-0.01",""
"1","2023-01-07 10:00:00","Coin-Futures","Realized Profit and Loss","BTC","0.001",""
`;

test('parseCsv xử lý dấu ngoặc kép và BOM', () => {
  const rows = parseCsv('a,"b,c","d ""x"""\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b,c', 'd "x"'], ['1', '2', '3']]);
});

test('CSV sao kê ví: chỉ lấy dòng futures, bỏ chuyển tiền', () => {
  const { records } = csvToIncome(WALLET_CSV);
  assert.equal(records.length, 4);
  assert.deepEqual(records.map((r) => r[2]), ['REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE', 'REALIZED_PNL']);
  assert.equal(records[0][1], Date.UTC(2023, 0, 5, 8));
  assert.equal(records[3][6], 'cm');
});

test('CSV futures dạng Time/Type/Amount/Asset/Symbol', () => {
  const csv = 'Time(UTC),Symbol,Type,Amount,Asset\n2024-03-01 10:00:00,ETHUSDT,REALIZED_PNL,55.5,USDT\n2024-03-01 10:00:00,ETHUSDT,COMMISSION,-0.5,USDT\n2024-03-01 11:00:00,ETHUSDT,TRANSFER,100,USDT\n';
  const { records } = csvToIncome(csv);
  assert.equal(records.length, 2);
  assert.equal(records[0][5], 'ETHUSDT');
});

test('khử trùng lặp giữa CSV và API, bổ sung symbol', () => {
  const store = emptyFutures();
  mergeIncome(store, csvToIncome(WALLET_CSV).records);
  const t = Date.UTC(2023, 0, 5, 8);
  const added = mergeIncome(store, [['um:1:REALIZED_PNL:BTCUSDT', t, 'REALIZED_PNL', -120.5, 'USDT', 'BTCUSDT', 'um']]);
  assert.equal(added, 0);
  assert.equal(store.income.find((r) => r[3] === -120.5)[5], 'BTCUSDT');
  assert.equal(mergeIncome(store, csvToIncome(WALLET_CSV).records), 0); // nhập lại file cũ
});

test('tính tổng futures, quy đổi COIN-M theo giá lịch sử', () => {
  const store = emptyFutures();
  mergeIncome(store, csvToIncome(WALLET_CSV).records);
  const r = computeFutures(store, (a) => (a === 'BTC' ? 20000 : null), {
    positions: [{ src: 'um', symbol: 'SOLUSDT', unrealized: -10, marginAsset: 'USDT' }],
  });
  close(r.byType.REALIZED_PNL, -120.5 + 20);
  close(r.byType.COMMISSION, -1.2);
  close(r.byType.FUNDING_FEE, -0.3);
  close(r.net, -120.5 - 1.2 - 0.3 + 20);
  close(r.unrealized, -10);
  assert.deepEqual(r.monthly.map((m) => m[0]), ['2023-01']);
});
