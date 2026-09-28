import { fmtMoney } from './util.js';

// Bảng màu phân loại (đã kiểm tra độ tương phản trên nền sáng & tối)
export const PALETTE = ['#4f7cff', '#f5a524', '#17c3a5', '#e5484d', '#a162f7', '#3fb8f0', '#f76b15', '#8bc34a', '#e93d82', '#94a3b8'];

const charts = new Map();

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function mount(canvas, config) {
  if (!window.Chart || !canvas) return;
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
