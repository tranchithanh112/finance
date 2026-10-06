import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvToIncome, mergeIncome, computeFutures, emptyFutures, parseCsv, detectOffsetHours, shiftRecords, fileNameOffsetHours, syncFuturesIncome } from '../js/futures.js';

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

test('csvToIncome đọc file lịch sử khớp lệnh tiếng Việt (Trade History)', async () => {
  const { csvToIncome, mergeIncome, emptyFutures } = await import('../js/futures.js');
  const csv = '\ufeffUid,Thời gian,Mã,Bên,Giá,Số lượng,Số tiền,Phí,Lợi nhuận đã thực hiện,Người mua,Người tạo,ID giao dịch,ID lệnh\r\n'
    + '1,2023-06-28 16:56:20,BTCUSDT,SELL,30288.9,0.003,90.8667,0.03634668 USDT,0,false,false,11,21\r\n'
    + '1,2023-06-29 17:34:04,BTCUSDT,BUY,30673.9,0.19,5828.041,0.00000000 USDT,-73.245,true,false,12,22\r\n'
    + '1,2023-06-29 17:47:26,ETHBUSD,SELL,1800,0.1,180,0.0012 BNB,5,false,false,13,23\r\n'
    + '1,2023-06-29 17:47:26,ETHBUSD,SELL,1800,0.1,180,0.0012 BNB,5,false,false,14,23\r\n';
  const { records } = csvToIncome(csv);
  const pick = (r) => [r[2], r[3], r[4], r[5]];
  assert.deepEqual(records.map(pick), [
    ['COMMISSION', -0.03634668, 'USDT', 'BTCUSDT'],
    ['REALIZED_PNL', -73.245, 'USDT', 'BTCUSDT'],
    ['REALIZED_PNL', 5, 'BUSD', 'ETHBUSD'], ['COMMISSION', -0.0012, 'BNB', 'ETHBUSD'],
    ['REALIZED_PNL', 5, 'BUSD', 'ETHBUSD'], ['COMMISSION', -0.0012, 'BNB', 'ETHBUSD'],
  ]);
  const store = emptyFutures();
  // 2 lần khớp giống hệt nhau trong cùng giây vẫn được giữ; nhập lại file thì không trùng
  assert.equal(mergeIncome(store, records), 6);
  assert.equal(mergeIncome(store, records), 0);
});

test('file ví: các dòng giống hệt nhau trong cùng giây đều được giữ, nhập lại không trùng', () => {
  const csv = 'User_ID,UTC_Time,Account,Operation,Coin,Change,Remark\n'
    + '1,2024-01-01 10:00:00,USDT-Futures,Fee,USDT,-0.5,\n'
    + '1,2024-01-01 10:00:00,USDT-Futures,Fee,USDT,-0.5,\n'
    + '1,2024-01-01 10:00:00,USDT-Futures,Funding Fee,USDT,-1.2,\n';
  const { records } = csvToIncome(csv);
  assert.equal(records.length, 3);
  const store = emptyFutures();
  assert.equal(mergeIncome(store, records), 3);
  assert.equal(mergeIncome(store, records), 0);
  // file khớp lệnh cùng thời điểm: 2 khoản phí khớp đúng 2 bản ghi cũ, không thêm
  const trade = 'Thời gian,Mã,Bên,Giá,Số lượng,Phí,Lợi nhuận đã thực hiện,ID giao dịch\n'
    + '2024-01-01 10:00:00,BTCUSDT,SELL,1,1,0.5 USDT,0,a\n'
    + '2024-01-01 10:00:00,BTCUSDT,SELL,1,1,0.5 USDT,0,b\n'
    + '2024-01-01 10:00:00,BTCUSDT,SELL,1,1,0.5 USDT,0,c\n';
  assert.equal(mergeIncome(store, csvToIncome(trade).records), 1);
  const r = computeFutures(store, () => 1, null);
  close(r.byType.COMMISSION, -1.5);
  assert.deepEqual(r.yearly.map((y) => y.year), ['2024']);
  close(r.yearly[0].net, -2.7);
});

test('CSV giờ UTC+7: đọc múi giờ từ tiêu đề hoặc tự dò theo dữ liệu API', () => {
  const t = Date.UTC(2026, 6, 1, 3, 0, 0);
  const api = [0, 1, 2, 3].map((i) => [`um:${i}:FUNDING_FEE:BTCUSDT`, t + i * 8 * 3600e3, 'FUNDING_FEE', -1 - i, 'USDT', 'BTCUSDT', 'um']);
  const local = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const body = api.map((r) => `1,${local(r[1])},USDT-Futures,Funding Fee,USDT,${r[3]},`).join('\n');
  // có ghi múi giờ trong tiêu đề
  const withTz = csvToIncome(`User_ID,UTC_Time(UTC+7),Account,Operation,Coin,Change,Remark\n${body}`).records;
  assert.deepEqual(withTz.map((r) => r[1]), api.map((r) => r[1]));
  // không ghi → tự dò bằng dữ liệu API đã có
  const store = emptyFutures();
  mergeIncome(store, api);
  const raw = csvToIncome(`User_ID,Time,Account,Operation,Coin,Change,Remark\n${body}`).records;
  assert.equal(detectOffsetHours(store, raw), 7);
  assert.equal(mergeIncome(store, shiftRecords(raw, 7)), 0);
  // không có dữ liệu để so → giữ nguyên
  assert.equal(detectOffsetHours(emptyFutures(), raw), 0);
});

test('đọc múi giờ từ tên file', () => {
  assert.equal(fileNameOffsetHours('Binance-Thay đổi số dư-2024 (UTC+7).csv'), 7);
  assert.equal(fileNameOffsetHours('export_UTC+07_2024.csv'), 7);
  assert.equal(fileNameOffsetHours('history GMT-5.csv'), -5);
  assert.equal(fileNameOffsetHours('Binance-UTC-2024.csv'), 0);
  assert.equal(fileNameOffsetHours('Binance-Lịch sử-2023.csv'), 0);
});

test('syncFuturesIncome: trả về nguồn bị bỏ qua thay vì im lặng báo 0 bản ghi', async () => {
  const store = emptyFutures();
  const bn = async (path) => {
    if (path === '/dapi/v1/income') throw Object.assign(new Error('Unauthorized'), { status: 401 });
    return [];
  };
  const r = await syncFuturesIncome(bn, store, Date.now());
  assert.equal(r.added, 0);
  assert.deepEqual(r.skipped, [{ src: 'cm', status: 401, message: 'Unauthorized' }]);
});
