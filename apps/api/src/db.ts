import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import type { CreateOrderPayload, OrderRecord } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultDbPath = path.resolve(__dirname, '../../../data/ubereats.db');
const dbFilePath = process.env.DB_PATH ?? defaultDbPath;

let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = open({
      filename: dbFilePath,
      driver: sqlite3.Database
    });
  }

  const db = await dbPromise;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_name TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      total_price REAL NOT NULL,
      ordered_date TEXT NOT NULL DEFAULT '',
      ordered_time TEXT NOT NULL DEFAULT '',
      ordered_at_text TEXT NOT NULL,
      source_signature TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureColumnExists(db, 'orders', 'ordered_date', "TEXT NOT NULL DEFAULT ''");
  await ensureColumnExists(db, 'orders', 'ordered_time', "TEXT NOT NULL DEFAULT ''");

  return db;
}

export async function listOrders(): Promise<OrderRecord[]> {
  const db = await getDb();

  const rows = await db.all<{
    id: number;
    restaurant_name: string;
    total_price: number;
    ordered_at_text: string;
    source_signature: string;
    created_at: string;
  }[]>(`SELECT * FROM orders ORDER BY id DESC`);

  return rows.map((row) => ({
    id: row.id,
    restaurantName: row.restaurant_name,
    totalPrice: row.total_price,
    orderedAtText: row.ordered_at_text,
    sourceSignature: row.source_signature,
    createdAt: row.created_at
  }));
}

export async function insertOrders(orders: CreateOrderPayload[]): Promise<{ inserted: number; skipped: number }> {
  if (orders.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  const db = await getDb();
  await db.exec('BEGIN TRANSACTION');

  let inserted = 0;
  let skipped = 0;

  try {
    const stmt = await db.prepare(`
      INSERT INTO orders (
        restaurant_name,
        item_count,
        total_price,
        ordered_date,
        ordered_time,
        ordered_at_text,
        source_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const order of orders) {
      try {
        const orderedDateTime = splitOrderedAtText(order.orderedAtText);

        await stmt.run(
          order.restaurantName,
          1,
          order.totalPrice,
          orderedDateTime.orderedDate,
          orderedDateTime.orderedTime,
          order.orderedAtText,
          order.sourceSignature
        );
        inserted += 1;
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          skipped += 1;
        } else {
          throw error;
        }
      }
    }

    await stmt.finalize();
    await db.exec('COMMIT');
    return { inserted, skipped };
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

function splitOrderedAtText(orderedAtText: string): { orderedDate: string; orderedTime: string } {
  const segments = orderedAtText
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length >= 3) {
    return {
      orderedDate: `${segments[0]}, ${segments[1]}`,
      orderedTime: segments.slice(2).join(', ')
    };
  }

  return {
    orderedDate: orderedAtText,
    orderedTime: ''
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}

async function ensureColumnExists(
  db: Database,
  tableName: string,
  columnName: string,
  columnDefinition: string
): Promise<void> {
  const columns = await db.all<{ name: string }[]>(`PRAGMA table_info(${tableName});`);
  if (!columns.some((column) => column.name === columnName)) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
  }
}