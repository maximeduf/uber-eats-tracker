<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Chart from 'chart.js/auto';

interface OrderRecord {
  id: number;
  restaurantName: string;
  totalPrice: number;
  orderedAtText: string;
  sourceSignature: string;
  createdAt: string;
}

interface ParsedOrder {
  date: Date;
  totalPrice: number;
}

interface PeriodBucket {
  key: string;
  label: string;
  totalSpend: number;
  totalOrders: number;
  avgSpendPerOrder: number;
}

const loading = ref(false);
const error = ref<string | null>(null);
const orders = ref<OrderRecord[]>([]);
const activeTab = ref<'summary' | 'analytics' | 'raw'>('summary');
const bucketPreviewLimit = 10;
const weeklyExpanded = ref(false);
const monthlyExpanded = ref(false);

const weeklySpendCanvas = ref<HTMLCanvasElement | null>(null);
const monthlySpendCanvas = ref<HTMLCanvasElement | null>(null);
const weeklyOrdersCanvas = ref<HTMLCanvasElement | null>(null);
const monthlyOrdersCanvas = ref<HTMLCanvasElement | null>(null);
const weeklyAvgCanvas = ref<HTMLCanvasElement | null>(null);
const monthlyAvgCanvas = ref<HTMLCanvasElement | null>(null);

const chartRefs = {
  weeklySpend: weeklySpendCanvas,
  monthlySpend: monthlySpendCanvas,
  weeklyOrders: weeklyOrdersCanvas,
  monthlyOrders: monthlyOrdersCanvas,
  weeklyAvg: weeklyAvgCanvas,
  monthlyAvg: monthlyAvgCanvas
};

const chartInstances = new Map<string, Chart>();
const yearLinePalette = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#db2777', '#0891b2', '#b45309', '#4f46e5'];
const monthAxisLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const expandedLineCharts = ref<Record<string, boolean>>({});

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
});

const integerFormatter = new Intl.NumberFormat('en-CA');

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

function formatNumber(value: number): string {
  return integerFormatter.format(Math.round(value));
}

function formatDate(value: Date): string {
  return value.toLocaleDateString('en-CA', {
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function parseOrderedDate(input: string): Date | null {
  const match = input.match(/(?:\w+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) {
    return null;
  }

  const monthName = match[1];
  const day = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(`${monthName} ${day}, ${year}`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
}

function yearKey(date: Date): string {
  return String(date.getFullYear());
}

function yearLabel(date: Date): string {
  return String(date.getFullYear());
}

function isoWeekInfo(date: Date): { year: number; week: number } {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return { year: utcDate.getUTCFullYear(), week };
}

function weekKey(date: Date): string {
  const info = isoWeekInfo(date);
  return `${info.year}-W${String(info.week).padStart(2, '0')}`;
}

function weekStartLabel(date: Date, includeYear: boolean): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (!includeYear) {
    return `${month}/${day}`;
  }

  const shortYear = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${shortYear}`;
}

function weekStartLabels(weekStarts: Date[]): string[] {
  let previousYear: number | null = null;

  return weekStarts.map((weekStart) => {
    const currentYear = weekStart.getFullYear();
    const includeYear = previousYear === null || currentYear !== previousYear;
    previousYear = currentYear;
    return weekStartLabel(weekStart, includeYear);
  });
}

function startOfIsoWeek(date: Date): Date {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = value.getDay() || 7;
  value.setDate(value.getDate() - day + 1);
  value.setHours(0, 0, 0, 0);
  return value;
}

function listMonthStarts(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return dates;
}

function listWeekStarts(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const cursor = startOfIsoWeek(startDate);
  const end = startOfIsoWeek(endDate);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return dates;
}

function listYearStarts(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(startDate.getFullYear(), 0, 1);
  const end = new Date(endDate.getFullYear(), 0, 1);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setFullYear(cursor.getFullYear() + 1);
  }

  return dates;
}

function buildAggregateMap(
  items: ParsedOrder[],
  getKey: (date: Date) => string,
): Map<string, { totalSpend: number; totalOrders: number }> {
  const map = new Map<string, { totalSpend: number; totalOrders: number }>();

  for (const item of items) {
    const key = getKey(item.date);
    const existing = map.get(key);
    if (existing) {
      existing.totalSpend += item.totalPrice;
      existing.totalOrders += 1;
      continue;
    }

    map.set(key, {
      totalSpend: item.totalPrice,
      totalOrders: 1
    });
  }

  return map;
}

function materializeBuckets(
  periodStarts: Date[],
  aggregateMap: Map<string, { totalSpend: number; totalOrders: number }>,
  getKey: (date: Date) => string,
  getLabel: (date: Date) => string
): PeriodBucket[] {
  return periodStarts.map((date) => {
    const key = getKey(date);
    const aggregate = aggregateMap.get(key);
    const totalSpend = aggregate?.totalSpend ?? 0;
    const totalOrders = aggregate?.totalOrders ?? 0;

    return {
      key,
      label: getLabel(date),
      totalSpend,
      totalOrders,
      avgSpendPerOrder: totalOrders > 0 ? totalSpend / totalOrders : 0
    };
  });
}

function percentOf(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return (value / max) * 100;
}

function interpolateChannel(start: number, end: number, amount: number): number {
  return Math.round(start + (end - start) * amount);
}

function interpolateColor(start: [number, number, number], end: [number, number, number], amount: number): string {
  const safeAmount = Math.min(1, Math.max(0, amount));
  const red = interpolateChannel(start[0], end[0], safeAmount);
  const green = interpolateChannel(start[1], end[1], safeAmount);
  const blue = interpolateChannel(start[2], end[2], safeAmount);
  return `rgb(${red}, ${green}, ${blue})`;
}

function sectionBarColor(value: number, max: number): string {
  if (max <= 0) {
    return 'rgb(210, 210, 210)';
  }

  const ratio = Math.min(1, Math.max(0, value / max));
  const green: [number, number, number] = [34, 197, 94];
  const yellow: [number, number, number] = [250, 204, 21];
  const red: [number, number, number] = [239, 68, 68];

  if (ratio <= 0.25) {
    return `rgb(${green[0]}, ${green[1]}, ${green[2]})`;
  }

  if (ratio <= 0.5) {
    const rangeAmount = (ratio - 0.25) / 0.25;
    return interpolateColor(green, yellow, rangeAmount);
  }

  const rangeAmount = (ratio - 0.5) / 0.5;
  return interpolateColor(yellow, red, rangeAmount);
}

const parsedOrders = computed(() =>
  orders.value
    .map((order) => {
      const date = parseOrderedDate(order.orderedAtText);
      if (!date) {
        return null;
      }

      return {
        date,
        totalPrice: order.totalPrice
      } as ParsedOrder;
    })
    .filter((value): value is ParsedOrder => value !== null)
);

const globalYearOrder = computed(() =>
  [...new Set(parsedOrders.value.map((order) => order.date.getFullYear()))]
    .sort((a, b) => a - b)
    .map(String)
);

function colorForYear(year: string): string {
  const index = globalYearOrder.value.indexOf(year);
  if (index >= 0) {
    return yearLinePalette[index % yearLinePalette.length];
  }

  const fallbackIndex = Math.abs(Number(year) || 0) % yearLinePalette.length;
  return yearLinePalette[fallbackIndex];
}

const totalSpend = computed(() => parsedOrders.value.reduce((sum, order) => sum + order.totalPrice, 0));
const totalOrders = computed(() => parsedOrders.value.length);
const avgSpentPerOrder = computed(() => (totalOrders.value > 0 ? totalSpend.value / totalOrders.value : 0));

const oldestOrderDate = computed(() => {
  if (parsedOrders.value.length === 0) {
    return null;
  }

  return parsedOrders.value.reduce((oldest, point) => (point.date < oldest ? point.date : oldest), parsedOrders.value[0].date);
});

const latestOrderDate = computed(() => {
  if (parsedOrders.value.length === 0) {
    return null;
  }

  return parsedOrders.value.reduce((latest, point) => (point.date > latest ? point.date : latest), parsedOrders.value[0].date);
});

const bucketRangeEndDate = computed(() => {
  const today = new Date();
  if (!latestOrderDate.value) {
    return today;
  }

  return latestOrderDate.value > today ? latestOrderDate.value : today;
});

const oldestOrderDateLabel = computed(() =>
  oldestOrderDate.value ? formatDate(oldestOrderDate.value) : '—'
);

const latestOrderDateLabel = computed(() =>
  latestOrderDate.value ? formatDate(latestOrderDate.value) : '—'
);

const monthlyBuckets = computed(() => {
  if (!oldestOrderDate.value) {
    return [];
  }

  const aggregateMap = buildAggregateMap(parsedOrders.value, monthKey);
  const periodStarts = listMonthStarts(oldestOrderDate.value, bucketRangeEndDate.value);
  return materializeBuckets(periodStarts, aggregateMap, monthKey, monthLabel);
});

const weeklyBuckets = computed(() => {
  if (!oldestOrderDate.value) {
    return [];
  }

  const aggregateMap = buildAggregateMap(parsedOrders.value, weekKey);
  const periodStarts = listWeekStarts(oldestOrderDate.value, bucketRangeEndDate.value);
  const labels = weekStartLabels(periodStarts);

  return periodStarts.map((date, index) => {
    const key = weekKey(date);
    const aggregate = aggregateMap.get(key);
    const totalSpend = aggregate?.totalSpend ?? 0;
    const totalOrders = aggregate?.totalOrders ?? 0;

    return {
      key,
      label: labels[index],
      totalSpend,
      totalOrders,
      avgSpendPerOrder: totalOrders > 0 ? totalSpend / totalOrders : 0
    };
  });
});

const yearlyBuckets = computed(() => {
  if (!oldestOrderDate.value) {
    return [];
  }

  const aggregateMap = buildAggregateMap(parsedOrders.value, yearKey);
  const periodStarts = listYearStarts(oldestOrderDate.value, bucketRangeEndDate.value);
  return materializeBuckets(periodStarts, aggregateMap, yearKey, yearLabel);
});

const monthlyBucketsDisplay = computed(() => [...monthlyBuckets.value].reverse());
const monthlyBucketsVisible = computed(() =>
  monthlyExpanded.value ? monthlyBucketsDisplay.value : monthlyBucketsDisplay.value.slice(0, bucketPreviewLimit)
);

const weeklyBucketsDisplay = computed(() => [...weeklyBuckets.value].reverse());
const weeklyBucketsVisible = computed(() =>
  weeklyExpanded.value ? weeklyBucketsDisplay.value : weeklyBucketsDisplay.value.slice(0, bucketPreviewLimit)
);
const yearlyBucketsDisplay = computed(() => [...yearlyBuckets.value].reverse());

const monthlyMaxSpend = computed(() => Math.max(0, ...monthlyBuckets.value.map((bucket) => bucket.totalSpend)));
const monthlyMaxOrders = computed(() => Math.max(0, ...monthlyBuckets.value.map((bucket) => bucket.totalOrders)));
const monthlyMaxAvgSpend = computed(() => Math.max(0, ...monthlyBuckets.value.map((bucket) => bucket.avgSpendPerOrder)));

const weeklyMaxSpend = computed(() => Math.max(0, ...weeklyBuckets.value.map((bucket) => bucket.totalSpend)));
const weeklyMaxOrders = computed(() => Math.max(0, ...weeklyBuckets.value.map((bucket) => bucket.totalOrders)));
const weeklyMaxAvgSpend = computed(() => Math.max(0, ...weeklyBuckets.value.map((bucket) => bucket.avgSpendPerOrder)));

const yearlyMaxSpend = computed(() => Math.max(0, ...yearlyBuckets.value.map((bucket) => bucket.totalSpend)));
const yearlyMaxOrders = computed(() => Math.max(0, ...yearlyBuckets.value.map((bucket) => bucket.totalOrders)));
const yearlyMaxAvgSpend = computed(() => Math.max(0, ...yearlyBuckets.value.map((bucket) => bucket.avgSpendPerOrder)));

function yCurrencyTick(value: string | number): string {
  return formatCurrency(Number(value));
}

function yCountTick(value: string | number): string {
  return formatNumber(Number(value));
}

function upsertChart(key: string, canvas: HTMLCanvasElement | null, config: any) {
  if (!canvas) {
    return;
  }

  const existing = chartInstances.get(key);
  if (existing) {
    existing.destroy();
  }

  chartInstances.set(key, new Chart(canvas, config));
}

function destroyAllCharts() {
  for (const chart of chartInstances.values()) {
    chart.destroy();
  }
  chartInstances.clear();
}

function isLineChartExpanded(key: string): boolean {
  return expandedLineCharts.value[key] === true;
}

async function toggleLineChartSize(key: string) {
  expandedLineCharts.value = {
    ...expandedLineCharts.value,
    [key]: !isLineChartExpanded(key)
  };

  await nextTick();
  const chart = chartInstances.get(key);
  chart?.resize();
}

function chartBaseOptions(currency = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 450
    },
    interaction: {
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: '#111827',
        titleColor: '#f9fafb',
        bodyColor: '#f3f4f6',
        callbacks: {
          label(context: any) {
            const value = Number(context.raw ?? 0);
            return currency ? formatCurrency(value) : formatNumber(value);
          }
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#4b5563',
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8
        },
        grid: {
          color: '#e5e7eb'
        }
      },
      y: {
        min: 0,
        beginAtZero: true,
        ticks: {
          color: '#4b5563',
          callback: currency ? yCurrencyTick : yCountTick
        },
        grid: {
          color: '#e5e7eb'
        }
      }
    }
  };
}

function yearFromBucketKey(key: string): string {
  const [yearPart] = key.split('-');
  return yearPart;
}

function weekIndexFromBucketKey(key: string): number {
  const match = key.match(/-W(\d{2})$/);
  if (!match) {
    return -1;
  }

  return Number(match[1]) - 1;
}

function monthIndexFromBucketKey(key: string): number {
  const parts = key.split('-');
  if (parts.length < 2) {
    return -1;
  }

  return Number(parts[1]) - 1;
}

function buildYearOverlayLineDatasets(
  buckets: PeriodBucket[],
  axisSize: number,
  axisIndexSelector: (bucket: PeriodBucket) => number,
  valueSelector: (bucket: PeriodBucket) => number,
  fill: boolean,
) {
  const years = [...new Set(buckets.map((bucket) => yearFromBucketKey(bucket.key)))].sort((a, b) => Number(a) - Number(b));

  return years.map((year) => {
    const color = colorForYear(year);
    const data = Array.from({ length: axisSize }, () => null as number | null);

    for (const bucket of buckets) {
      if (yearFromBucketKey(bucket.key) !== year) {
        continue;
      }

      const axisIndex = axisIndexSelector(bucket);
      if (axisIndex < 0 || axisIndex >= axisSize) {
        continue;
      }

      data[axisIndex] = valueSelector(bucket);
    }

    return {
      label: year,
      data,
      borderColor: color,
      backgroundColor: `${color}33`,
      tension: 0.3,
      pointRadius: 1.8,
      pointHoverRadius: 3,
      spanGaps: false,
      fill
    };
  });
}

function renderAnalyticsCharts() {
  if (activeTab.value !== 'analytics') {
    destroyAllCharts();
    return;
  }

  const weeklyOverlayLabels = Array.from({ length: 53 }, (_, index) => `W${index + 1}`);
  const monthlyOverlayLabels = monthAxisLabels;

  upsertChart('weekly-spend', chartRefs.weeklySpend.value, {
    type: 'line',
    data: {
      labels: weeklyOverlayLabels,
      datasets: buildYearOverlayLineDatasets(
        weeklyBuckets.value,
        53,
        (bucket) => weekIndexFromBucketKey(bucket.key),
        (bucket) => bucket.totalSpend,
        false
      )
    },
    options: {
      ...chartBaseOptions(true),
      plugins: {
        ...chartBaseOptions(true).plugins,
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#374151'
          }
        }
      }
    }
  });

  upsertChart('monthly-spend', chartRefs.monthlySpend.value, {
    type: 'line',
    data: {
      labels: monthlyOverlayLabels,
      datasets: buildYearOverlayLineDatasets(
        monthlyBuckets.value,
        12,
        (bucket) => monthIndexFromBucketKey(bucket.key),
        (bucket) => bucket.totalSpend,
        false
      )
    },
    options: {
      ...chartBaseOptions(true),
      plugins: {
        ...chartBaseOptions(true).plugins,
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#374151'
          }
        }
      }
    }
  });

  upsertChart('weekly-orders', chartRefs.weeklyOrders.value, {
    type: 'line',
    data: {
      labels: weeklyOverlayLabels,
      datasets: buildYearOverlayLineDatasets(
        weeklyBuckets.value,
        53,
        (bucket) => weekIndexFromBucketKey(bucket.key),
        (bucket) => bucket.totalOrders,
        false
      )
    },
    options: {
      ...chartBaseOptions(false),
      plugins: {
        ...chartBaseOptions(false).plugins,
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#374151'
          }
        }
      }
    }
  });

  upsertChart('monthly-orders', chartRefs.monthlyOrders.value, {
    type: 'line',
    data: {
      labels: monthlyOverlayLabels,
      datasets: buildYearOverlayLineDatasets(
        monthlyBuckets.value,
        12,
        (bucket) => monthIndexFromBucketKey(bucket.key),
        (bucket) => bucket.totalOrders,
        false
      )
    },
    options: {
      ...chartBaseOptions(false),
      plugins: {
        ...chartBaseOptions(false).plugins,
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#374151'
          }
        }
      }
    }
  });

  upsertChart('weekly-avg', chartRefs.weeklyAvg.value, {
    type: 'line',
    data: {
      labels: weeklyOverlayLabels,
      datasets: buildYearOverlayLineDatasets(
        weeklyBuckets.value,
        53,
        (bucket) => weekIndexFromBucketKey(bucket.key),
        (bucket) => bucket.avgSpendPerOrder,
        false
      )
    },
    options: {
      ...chartBaseOptions(true),
      plugins: {
        ...chartBaseOptions(true).plugins,
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#374151'
          }
        }
      }
    }
  });

  upsertChart('monthly-avg', chartRefs.monthlyAvg.value, {
    type: 'line',
    data: {
      labels: monthlyOverlayLabels,
      datasets: buildYearOverlayLineDatasets(
        monthlyBuckets.value,
        12,
        (bucket) => monthIndexFromBucketKey(bucket.key),
        (bucket) => bucket.avgSpendPerOrder,
        false
      )
    },
    options: {
      ...chartBaseOptions(true),
      plugins: {
        ...chartBaseOptions(true).plugins,
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#374151'
          }
        }
      }
    }
  });

}

async function loadOrders() {
  loading.value = true;
  error.value = null;

  try {
    const response = await fetch('/api/orders');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as OrderRecord[];
    orders.value = data;
    weeklyExpanded.value = false;
    monthlyExpanded.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error';
  } finally {
    loading.value = false;
  }
}

watch(
  () => [
    activeTab.value,
    weeklyBuckets.value,
    monthlyBuckets.value,
    error.value
  ],
  async () => {
    await nextTick();
    renderAnalyticsCharts();
  },
  { deep: true }
);

onMounted(loadOrders);
onBeforeUnmount(destroyAllCharts);
</script>

<template>
  <main class="app-shell">
    <section class="page-header">
      <div>
        <h1>Uber Eats Historical Orders</h1>
        <p class="subtitle">Use Summary for period totals and Analytics for polished Chart.js visualizations.</p>
      </div>

      <div class="header-meta" v-if="!error">
        <span class="meta-pill">Orders: {{ totalOrders }}</span>
        <span class="meta-pill">From: {{ oldestOrderDateLabel }}</span>
        <span class="meta-pill">Latest: {{ latestOrderDateLabel }}</span>
      </div>
    </section>

    <div class="top-controls">
      <button @click="loadOrders" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>

      <div class="tabs" role="tablist" aria-label="Data views">
        <button
          class="tab"
          :class="{ active: activeTab === 'summary' }"
          role="tab"
          :aria-selected="activeTab === 'summary'"
          @click="activeTab = 'summary'"
        >
          Summary
        </button>
        <button
          class="tab"
          :class="{ active: activeTab === 'analytics' }"
          role="tab"
          :aria-selected="activeTab === 'analytics'"
          @click="activeTab = 'analytics'"
        >
          Analytics
        </button>
        <button
          class="tab"
          :class="{ active: activeTab === 'raw' }"
          role="tab"
          :aria-selected="activeTab === 'raw'"
          @click="activeTab = 'raw'"
        >
          Raw JSON
        </button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <section v-else-if="activeTab === 'summary'" class="metrics-view">
      <section class="panel">
        <h2 class="panel-title">Overview</h2>

        <div class="kpi-grid">
          <article class="kpi-card">
            <p class="kpi-label">Total spend</p>
            <p class="kpi-value">{{ formatCurrency(totalSpend) }}</p>
          </article>
          <article class="kpi-card">
            <p class="kpi-label">Total orders</p>
            <p class="kpi-value">{{ totalOrders }}</p>
          </article>
          <article class="kpi-card">
            <p class="kpi-label">Date of oldest order</p>
            <p class="kpi-value small">{{ oldestOrderDateLabel }}</p>
          </article>
          <article class="kpi-card">
            <p class="kpi-label">Avg spent/order</p>
            <p class="kpi-value">{{ formatCurrency(avgSpentPerOrder) }}</p>
          </article>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel-title">By Week</h2>
        <p v-if="weeklyBuckets.length === 0" class="empty">No order data to graph yet.</p>
        <div v-else class="graph-grid week-grid">
          <article class="graph-card">
            <h3>Spending</h3>
            <ul class="bar-list">
              <li v-for="bucket in weeklyBucketsVisible" :key="`w-spend-${bucket.key}`">
                <span class="bar-label">{{ bucket.label }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: `${percentOf(bucket.totalSpend, weeklyMaxSpend)}%`,
                      backgroundColor: sectionBarColor(bucket.totalSpend, weeklyMaxSpend)
                    }"
                  ></div>
                </div>
                <span class="bar-value">{{ formatCurrency(bucket.totalSpend) }}</span>
              </li>
            </ul>
          </article>

          <article class="graph-card">
            <h3>Number of orders</h3>
            <ul class="bar-list">
              <li v-for="bucket in weeklyBucketsVisible" :key="`w-orders-${bucket.key}`">
                <span class="bar-label">{{ bucket.label }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: `${percentOf(bucket.totalOrders, weeklyMaxOrders)}%`,
                      backgroundColor: sectionBarColor(bucket.totalOrders, weeklyMaxOrders)
                    }"
                  ></div>
                </div>
                <span class="bar-value">{{ bucket.totalOrders }}</span>
              </li>
            </ul>
          </article>

          <article class="graph-card">
            <h3>Average spending per order</h3>
            <ul class="bar-list">
              <li v-for="bucket in weeklyBucketsVisible" :key="`w-avg-${bucket.key}`">
                <span class="bar-label">{{ bucket.label }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: `${percentOf(bucket.avgSpendPerOrder, weeklyMaxAvgSpend)}%`,
                      backgroundColor: sectionBarColor(bucket.avgSpendPerOrder, weeklyMaxAvgSpend)
                    }"
                  ></div>
                </div>
                <span class="bar-value">{{ formatCurrency(bucket.avgSpendPerOrder) }}</span>
              </li>
            </ul>
          </article>
        </div>
        <button
          v-if="!weeklyExpanded && weeklyBucketsDisplay.length > bucketPreviewLimit"
          @click="weeklyExpanded = true"
        >
          Show more
        </button>
        <button
          v-else-if="weeklyExpanded && weeklyBucketsDisplay.length > bucketPreviewLimit"
          @click="weeklyExpanded = false"
        >
          Show less
        </button>
      </section>

      <section class="panel">
        <h2 class="panel-title">By Month</h2>
        <p v-if="monthlyBuckets.length === 0" class="empty">No order data to graph yet.</p>
        <div v-else class="graph-grid month-grid">
          <article class="graph-card">
            <h3>Spending</h3>
            <ul class="bar-list">
              <li v-for="bucket in monthlyBucketsVisible" :key="`m-spend-${bucket.key}`">
                <span class="bar-label">{{ bucket.label }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: `${percentOf(bucket.totalSpend, monthlyMaxSpend)}%`,
                      backgroundColor: sectionBarColor(bucket.totalSpend, monthlyMaxSpend)
                    }"
                  ></div>
                </div>
                <span class="bar-value">{{ formatCurrency(bucket.totalSpend) }}</span>
              </li>
            </ul>
          </article>

          <article class="graph-card">
            <h3>Number of orders</h3>
            <ul class="bar-list">
              <li v-for="bucket in monthlyBucketsVisible" :key="`m-orders-${bucket.key}`">
                <span class="bar-label">{{ bucket.label }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: `${percentOf(bucket.totalOrders, monthlyMaxOrders)}%`,
                      backgroundColor: sectionBarColor(bucket.totalOrders, monthlyMaxOrders)
                    }"
                  ></div>
                </div>
                <span class="bar-value">{{ bucket.totalOrders }}</span>
              </li>
            </ul>
          </article>

          <article class="graph-card">
            <h3>Average spending per order</h3>
            <ul class="bar-list">
              <li v-for="bucket in monthlyBucketsVisible" :key="`m-avg-${bucket.key}`">
                <span class="bar-label">{{ bucket.label }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: `${percentOf(bucket.avgSpendPerOrder, monthlyMaxAvgSpend)}%`,
                      backgroundColor: sectionBarColor(bucket.avgSpendPerOrder, monthlyMaxAvgSpend)
                    }"
                  ></div>
                </div>
                <span class="bar-value">{{ formatCurrency(bucket.avgSpendPerOrder) }}</span>
              </li>
            </ul>
          </article>
        </div>
        <button
          v-if="!monthlyExpanded && monthlyBucketsDisplay.length > bucketPreviewLimit"
          @click="monthlyExpanded = true"
        >
          Show more
        </button>
        <button
          v-else-if="monthlyExpanded && monthlyBucketsDisplay.length > bucketPreviewLimit"
          @click="monthlyExpanded = false"
        >
          Show less
        </button>
      </section>

      <section class="panel">
        <h2 class="panel-title">By Year</h2>
        <p v-if="yearlyBuckets.length === 0" class="empty">No order data to graph yet.</p>
        <div v-else class="graph-grid year-grid">
          <article class="graph-card">
            <h3>Spending</h3>
            <ul class="bar-list">
              <li v-for="bucket in yearlyBucketsDisplay" :key="`y-spend-${bucket.key}`">
                <span class="bar-label">{{ bucket.label }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: `${percentOf(bucket.totalSpend, yearlyMaxSpend)}%`,
                      backgroundColor: sectionBarColor(bucket.totalSpend, yearlyMaxSpend)
                    }"
                  ></div>
                </div>
                <span class="bar-value">{{ formatCurrency(bucket.totalSpend) }}</span>
              </li>
            </ul>
          </article>

          <article class="graph-card">
            <h3>Number of orders</h3>
            <ul class="bar-list">
              <li v-for="bucket in yearlyBucketsDisplay" :key="`y-orders-${bucket.key}`">
                <span class="bar-label">{{ bucket.label }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: `${percentOf(bucket.totalOrders, yearlyMaxOrders)}%`,
                      backgroundColor: sectionBarColor(bucket.totalOrders, yearlyMaxOrders)
                    }"
                  ></div>
                </div>
                <span class="bar-value">{{ bucket.totalOrders }}</span>
              </li>
            </ul>
          </article>

          <article class="graph-card">
            <h3>Average spending per order</h3>
            <ul class="bar-list">
              <li v-for="bucket in yearlyBucketsDisplay" :key="`y-avg-${bucket.key}`">
                <span class="bar-label">{{ bucket.label }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :style="{
                      width: `${percentOf(bucket.avgSpendPerOrder, yearlyMaxAvgSpend)}%`,
                      backgroundColor: sectionBarColor(bucket.avgSpendPerOrder, yearlyMaxAvgSpend)
                    }"
                  ></div>
                </div>
                <span class="bar-value">{{ formatCurrency(bucket.avgSpendPerOrder) }}</span>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </section>

    <section v-else-if="activeTab === 'analytics'" class="metrics-view">
      <section class="panel">
        <h2 class="panel-title">Trend Lines</h2>
        <p class="raw-subtitle">Spend, order count, and average order value over weekly and monthly windows.</p>

        <div class="graph-grid trend-grid">
          <article class="graph-card line-card" :class="{ 'line-card-expanded': isLineChartExpanded('weekly-spend') }">
            <div class="line-card-header">
              <h3>Weekly spend</h3>
              <button class="chart-size-btn" @click="toggleLineChartSize('weekly-spend')">
                {{ isLineChartExpanded('weekly-spend') ? 'Normal size' : 'Larger view' }}
              </button>
            </div>
            <p class="chart-help">Smoothed line to highlight short-term shifts and spikes.</p>
            <div class="chart-canvas-wrap" :class="{ 'chart-canvas-wrap-xl': isLineChartExpanded('weekly-spend') }"><canvas ref="weeklySpendCanvas"></canvas></div>
          </article>
          <article class="graph-card line-card" :class="{ 'line-card-expanded': isLineChartExpanded('monthly-spend') }">
            <div class="line-card-header">
              <h3>Monthly spend</h3>
              <button class="chart-size-btn" @click="toggleLineChartSize('monthly-spend')">
                {{ isLineChartExpanded('monthly-spend') ? 'Normal size' : 'Larger view' }}
              </button>
            </div>
            <p class="chart-help">Longer-horizon spend trend with month-by-month movement.</p>
            <div class="chart-canvas-wrap" :class="{ 'chart-canvas-wrap-xl': isLineChartExpanded('monthly-spend') }"><canvas ref="monthlySpendCanvas"></canvas></div>
          </article>
          <article class="graph-card line-card" :class="{ 'line-card-expanded': isLineChartExpanded('weekly-orders') }">
            <div class="line-card-header">
              <h3>Weekly orders</h3>
              <button class="chart-size-btn" @click="toggleLineChartSize('weekly-orders')">
                {{ isLineChartExpanded('weekly-orders') ? 'Normal size' : 'Larger view' }}
              </button>
            </div>
            <p class="chart-help">Order frequency trend by week.</p>
            <div class="chart-canvas-wrap" :class="{ 'chart-canvas-wrap-xl': isLineChartExpanded('weekly-orders') }"><canvas ref="weeklyOrdersCanvas"></canvas></div>
          </article>
          <article class="graph-card line-card" :class="{ 'line-card-expanded': isLineChartExpanded('monthly-orders') }">
            <div class="line-card-header">
              <h3>Monthly orders</h3>
              <button class="chart-size-btn" @click="toggleLineChartSize('monthly-orders')">
                {{ isLineChartExpanded('monthly-orders') ? 'Normal size' : 'Larger view' }}
              </button>
            </div>
            <p class="chart-help">Order frequency trend by month.</p>
            <div class="chart-canvas-wrap" :class="{ 'chart-canvas-wrap-xl': isLineChartExpanded('monthly-orders') }"><canvas ref="monthlyOrdersCanvas"></canvas></div>
          </article>
          <article class="graph-card line-card" :class="{ 'line-card-expanded': isLineChartExpanded('weekly-avg') }">
            <div class="line-card-header">
              <h3>Weekly average order value</h3>
              <button class="chart-size-btn" @click="toggleLineChartSize('weekly-avg')">
                {{ isLineChartExpanded('weekly-avg') ? 'Normal size' : 'Larger view' }}
              </button>
            </div>
            <p class="chart-help">How basket size changes week-to-week.</p>
            <div class="chart-canvas-wrap" :class="{ 'chart-canvas-wrap-xl': isLineChartExpanded('weekly-avg') }"><canvas ref="weeklyAvgCanvas"></canvas></div>
          </article>
          <article class="graph-card line-card" :class="{ 'line-card-expanded': isLineChartExpanded('monthly-avg') }">
            <div class="line-card-header">
              <h3>Monthly average order value</h3>
              <button class="chart-size-btn" @click="toggleLineChartSize('monthly-avg')">
                {{ isLineChartExpanded('monthly-avg') ? 'Normal size' : 'Larger view' }}
              </button>
            </div>
            <p class="chart-help">Longer-term basket-size trend.</p>
            <div class="chart-canvas-wrap" :class="{ 'chart-canvas-wrap-xl': isLineChartExpanded('monthly-avg') }"><canvas ref="monthlyAvgCanvas"></canvas></div>
          </article>
        </div>
      </section>

    </section>

    <section v-else class="panel raw-panel">
      <h2 class="panel-title">Raw JSON</h2>
      <p class="raw-subtitle">Exact payload from the API endpoint.</p>
      <pre>{{ JSON.stringify(orders, null, 2) }}</pre>
    </section>
  </main>
</template>
