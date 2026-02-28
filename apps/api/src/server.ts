import express from 'express';
import cors from 'cors';
import { insertOrders, listOrders } from './db.js';
import type { CreateOrderPayload } from './types.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/orders', async (_req, res) => {
  const orders = await listOrders();
  res.json(orders);
});

app.post('/orders/bulk', async (req, res) => {
  const payload = req.body as { orders?: CreateOrderPayload[] };

  if (!Array.isArray(payload.orders)) {
    return res.status(400).json({ error: 'Body must be { orders: [...] }' });
  }

  for (const order of payload.orders) {
    if (
      typeof order.restaurantName !== 'string' ||
      typeof order.totalPrice !== 'number' ||
      typeof order.orderedAtText !== 'string' ||
      typeof order.sourceSignature !== 'string'
    ) {
      return res.status(400).json({ error: 'Invalid order object in payload.' });
    }
  }

  const result = await insertOrders(payload.orders);
  return res.status(201).json(result);
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
