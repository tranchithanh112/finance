import { fmtMoney } from './util.js';
import { tr, locale } from './i18n.js';

// Bảng màu phân loại — lấy theo theme đang chọn (biến CSS --chart), xem loadPalette()
export const PALETTE = ['#b8905f', '#e3c48d', '#3aa99f', '#e05a5a', '#8c7b6b', '#5b8def', '#c46f3d', '#4caf7a', '#a06cb4', '#a89b8c'];

/** Cập nhật PALETTE (tại chỗ) theo theme hiện tại; gọi trước mỗi lần render. */
export function loadPalette() {
  const v = css('--chart');
  const list = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (list.length >= 4) PALETTE.splice(0, PALETTE.length, ...list);
}

const charts = new Map();

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function mount(canvas, config) {
  if (!window.Chart || !canvas) return;
  // dịch nhãn (legend / tooltip) theo ngôn ngữ đang chọn
  config.data.labels = config.data.labels?.map((l) => tr(l));
  for (const d of config.data.datasets) if (d.label) d.label = tr(d.label);
  charts.get(canvas.id)?.destroy();
  charts.set(canvas.id, new window.Chart(canvas, config));
}

/** Biểu đồ donut phân bổ; gộp phần đuôi thành "Khác" nếu quá nhiều mục. */
export function donut(canvas, items, { max = 9 } = {}) {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  let data = sorted;
  if (sorted.length > max) {
    const rest = sorted.slice(max - 1).reduce((a, i) => a + i.value, 0);
    data = [...sorted.slice(0, max - 1), { label: 'Khác', value: rest }];
  }
  const total = data.reduce((a, i) => a + i.value, 0);
  mount(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map((d) => d.label),
      datasets: [{
        data: data.map((d) => d.value),
        backgroundColor: data.map((d, i) => d.color || PALETTE[i % PALETTE.length]),
        borderColor: css('--surface'),
        borderWidth: 2,
      }],
    },
    options: {
      cutout: '62%',
      maintainAspectRatio: false,
      plugins: {
        legend: { position: canvas.clientWidth < 440 ? 'bottom' : 'right', labels: { color: css('--text'), boxWidth: 10, boxHeight: 10, font: { size: 12 } } },
        tooltip: {
          callbacks: { label: (c) => ` ${c.label}: ${fmtMoney(c.raw)} (${((c.raw / total) * 100).toFixed(1)}%)` },
        },
      },
    },
  });
}

export function line(canvas, labels, datasets, { money = true } = {}) {
  mount(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        borderColor: d.color || PALETTE[i],
        backgroundColor: (d.color || PALETTE[i]) + '22',
        fill: d.fill ?? false,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.2,
        ...d,
      })),
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: css('--muted'), maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: css('--muted'), callback: (v) => (money ? fmtMoney(v, { compact: true }) : v) }, grid: { color: css('--grid') } },
      },
      plugins: {
        legend: { display: datasets.length > 1, labels: { color: css('--text'), boxWidth: 10 } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${money ? fmtMoney(c.raw) : c.raw}` } },
      },
    },
  });
}

/** Biểu đồ cột nhóm (vd thu / chi theo tháng). Giá trị là USD, hiển thị theo tiền tệ đang chọn. */
export function bars(canvas, labels, datasets) {
  mount(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({ backgroundColor: d.color || PALETTE[i], borderRadius: 3, maxBarThickness: 28, ...d })),
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: css('--muted') }, grid: { display: false } },
        y: { ticks: { color: css('--muted'), callback: (v) => fmtMoney(v, { compact: true }) }, grid: { color: css('--grid') } },
      },
      plugins: {
        legend: { labels: { color: css('--text'), boxWidth: 10 } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtMoney(c.raw)}` } },
      },
    },
  });
}

/** Tô chuyển sắc từ màu đường xuống trong suốt (cho biểu đồ vùng 1 chuỗi). */
function gradient(color) {
  return (c) => {
    const { ctx, chartArea } = c.chart;
    if (!chartArea) return color + '22';
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, color + '55');
    g.addColorStop(1, color + '00');
    return g;
  };
}

/**
 * Biểu đồ theo thời gian (1 trục Y, tiền tệ đang chọn).
 * rows: [{date:'YYYY-MM-DD', ...}], series: [{key, label, color, area, stack, dash}]
 *  - area: 'gradient' (vùng chuyển sắc) | 'stack' (vùng xếp chồng) | false
 */
export function timeline(canvas, rows, series) {
  const loc = locale();
  const short = new Intl.DateTimeFormat(loc, { day: '2-digit', month: '2-digit' });
  const long = new Intl.DateTimeFormat(loc, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const span = rows.length > 1 ? Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date) : 0;
  const monthYear = new Intl.DateTimeFormat(loc, { month: '2-digit', year: '2-digit' });
  const fmtTick = span > 200 * 864e5 ? (d) => monthYear.format(d) : (d) => short.format(d);
  const dates = rows.map((r) => new Date(r.date + 'T00:00:00'));
  const stacked = series.some((s) => s.area === 'stack');
  mount(canvas, {
    type: 'line',
    data: {
      labels: rows.map((r) => r.date),
      datasets: series.map((s, i) => {
        const color = s.color || PALETTE[i];
        return {
          label: s.label,
          data: rows.map((r) => r[s.key]),
          borderColor: color,
          backgroundColor: s.area === 'gradient' ? gradient(color) : s.area === 'stack' ? color + 'bb' : color,
          fill: s.area === 'gradient' ? 'origin' : s.area === 'stack' ? (series.findIndex((x) => x.area === 'stack') === i ? 'origin' : '-1') : false,
          stack: s.area === 'stack' ? 'assets' : `solo${i}`,
          borderWidth: s.area === 'stack' ? 1 : 2,
          borderDash: s.dash ? [5, 4] : undefined,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: css('--surface'),
          tension: 0.25,
          order: s.area === 'stack' ? 2 : 1,
        };
      }),
    },
    options: {
      maintainAspectRatio: false,
      animation: rows.length > 400 ? false : { duration: 350 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          ticks: { color: css('--muted'), maxTicksLimit: canvas.clientWidth < 440 ? 4 : 7, maxRotation: 0, autoSkip: true,
            callback: (v, idx) => fmtTick(dates[idx]) },
          grid: { display: false },
        },
        y: {
          stacked,
          ticks: { color: css('--muted'), maxTicksLimit: 5, callback: (v) => fmtMoney(v, { compact: true }) },
          grid: { color: css('--grid') },
          border: { display: false },
        },
      },
      plugins: {
        legend: { display: series.length > 1, labels: { color: css('--text'), boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded' } },
        tooltip: {
          callbacks: {
            title: (items) => long.format(dates[items[0].dataIndex]),
            label: (c) => ` ${c.dataset.label}: ${fmtMoney(c.raw)}`,
          },
        },
      },
    },
  });
}
