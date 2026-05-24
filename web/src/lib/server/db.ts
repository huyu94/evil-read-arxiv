import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { loadRootEnv } from "./env";

let pool: Pool | null = null;

export function isDatabaseConfigured() {
  loadRootEnv();
  return Boolean(process.env.MYSQL_HOST && process.env.MYSQL_DATABASE);
}

export function getDbPool() {
  loadRootEnv();
  if (!isDatabaseConfigured()) {
    throw new Error("MySQL is not configured. Set MYSQL_HOST and MYSQL_DATABASE.");
  }

  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      namedPlaceholders: true,
      dateStrings: true,
      charset: "utf8mb4",
    });
  }

  return pool;
}

export async function withConnection<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await getDbPool().getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

export type DbRow = RowDataPacket;
