<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

interface OrderRecord {
  id: number;
  restaurantName: string;
  totalPrice: number;
  orderedAtText: string;
  sourceSignature: string;
  createdAt: string;
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
const activeTab = ref<'metrics' | 'raw'>('metrics');

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
});

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
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

function weekLabel(date: Date): string {
  const info = isoWeekInfo(date);
  return `W${String(info.week).padStart(2, '0')} ${info.year}`;
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
  items: { date: Date; totalPrice: number }[],
  getKey: (date: Date) => string,
): Map<string, { totalSpend: number; totalOrders: number }> {
  const map = new Map<string, { label: string; totalSpend: number; totalOrders: number }>();

  for (const item of items) {
    const key = getKey(item.date);
    const existing = map.get(key);
    if (existing) {
      existing.totalSpend += item.totalPrice;
      existing.totalOrders += 1;
      continue;
    }

    map.set(key, {
      label: '',
      totalSpend: item.totalPrice,
      totalOrders: 1
    });
  }

  const out = new Map<string, { totalSpend: number; totalOrders: number }>();
  for (const [key, value] of map.entries()) {
    out.set(key, {
      totalSpend: value.totalSpend,
      totalOrders: value.totalOrders
    });
  }

  return out;
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

const totalSpend = computed(() => orders.value.reduce((sum, order) => sum + order.totalPrice, 0));
const totalOrders = computed(() => orders.value.length);
const avgSpentPerOrder = computed(() => (totalOrders.value > 0 ? totalSpend.value / totalOrders.value : 0));

const parsedOrderPoints = computed(() =>
  orders.value
    .map((order) => {
      const date = parseOrderedDate(order.orderedAtText);
      if (!date) {
        return null;
      }

      return {
        date,
        totalPrice: order.totalPrice
      };
    })
    .filter((value): value is { date: Date; totalPrice: number } => value !== null)
);

const oldestOrderDate = computed(() => {
  if (parsedOrderPoints.value.length === 0) {
    return null;
  }

  return parsedOrderPoints.value.reduce((oldest, point) => (point.date < oldest ? point.date : oldest), parsedOrderPoints.value[0].date);
});

const latestOrderDate = computed(() => {
  if (parsedOrderPoints.value.length === 0) {
    return null;
  }

  return parsedOrderPoints.value.reduce((latest, point) => (point.date > latest ? point.date : latest), parsedOrderPoints.value[0].date);
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

  const aggregateMap = buildAggregateMap(parsedOrderPoints.value, monthKey);
  const periodStarts = listMonthStarts(oldestOrderDate.value, bucketRangeEndDate.value);
  return materializeBuckets(periodStarts, aggregateMap, monthKey, monthLabel);
});

const monthlyBucketsDisplay = computed(() => [...monthlyBuckets.value].reverse());

const weeklyBuckets = computed(() => {
  if (!oldestOrderDate.value) {
    return [];
  }

  const aggregateMap = buildAggregateMap(parsedOrderPoints.value, weekKey);
  const periodStarts = listWeekStarts(oldestOrderDate.value, bucketRangeEndDate.value);
  return materializeBuckets(periodStarts, aggregateMap, weekKey, weekLabel);
});

const yearlyBuckets = computed(() => {
  if (!oldestOrderDate.value) {
    return [];
  }

  const aggregateMap = buildAggregateMap(parsedOrderPoints.value, yearKey);
  const periodStarts = listYearStarts(oldestOrderDate.value, bucketRangeEndDate.value);
  return materializeBuckets(periodStarts, aggregateMap, yearKey, yearLabel);
});

const weeklyBucketsDisplay = computed(() => [...weeklyBuckets.value].reverse());
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
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error';
  } finally {
    loading.value = false;
  }
}

onMounted(loadOrders);
</script>

<template>
  <main class="app-shell">
    <section class="page-header">
      <div>
        <h1>Uber Eats Historical Orders</h1>
        <p class="subtitle">Track spending patterns over time with weekly, monthly, and yearly summaries.</p>
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
          :class="{ active: activeTab === 'metrics' }"
          role="tab"
          :aria-selected="activeTab === 'metrics'"
          @click="activeTab = 'metrics'"
        >
          Metrics
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

    <section v-else-if="activeTab === 'metrics'" class="metrics-view">
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

      <section class="panel">
      <h2 class="panel-title">By Month</h2>
      <p v-if="monthlyBuckets.length === 0" class="empty">No order data to graph yet.</p>
      <div v-else class="graph-grid month-grid">
        <article class="graph-card">
          <h3>Spending</h3>
          <ul class="bar-list">
            <li v-for="bucket in monthlyBucketsDisplay" :key="`m-spend-${bucket.key}`">
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
            <li v-for="bucket in monthlyBucketsDisplay" :key="`m-orders-${bucket.key}`">
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
            <li v-for="bucket in monthlyBucketsDisplay" :key="`m-avg-${bucket.key}`">
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
      </section>

      <section class="panel">
      <h2 class="panel-title">By Week</h2>
      <p v-if="weeklyBuckets.length === 0" class="empty">No order data to graph yet.</p>
      <div v-else class="graph-grid week-grid">
        <article class="graph-card">
          <h3>Spending</h3>
          <ul class="bar-list">
            <li v-for="bucket in weeklyBucketsDisplay" :key="`w-spend-${bucket.key}`">
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
            <li v-for="bucket in weeklyBucketsDisplay" :key="`w-orders-${bucket.key}`">
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
            <li v-for="bucket in weeklyBucketsDisplay" :key="`w-avg-${bucket.key}`">
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
      </section>
    </section>

    <section v-else class="panel raw-panel">
      <h2 class="panel-title">Raw JSON</h2>
      <p class="raw-subtitle">Exact payload from the API endpoint.</p>
      <pre>{{ JSON.stringify(orders, null, 2) }}</pre>
    </section>
  </main>
</template>
