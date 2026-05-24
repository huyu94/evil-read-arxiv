import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const requireFromWeb = createRequire(path.join(root, "web", "package.json"));
const mysql = requireFromWeb("mysql2/promise");
const Minio = requireFromWeb("minio");

function loadEnv() {
  const envPath = path.join(root, ".env");
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

const env = {
  ...loadEnv(),
  ...process.env,
};

const required = [
  "MYSQL_HOST",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET",
];

const missing = required.filter((key) => !env[key]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST,
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.MYSQL_DATABASE,
  multipleStatements: true,
});

await conn.query(fs.readFileSync(path.join(root, "database", "schema.sql"), "utf8"));
const [tables] = await conn.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('papers','crawl_runs','daily_papers','paper_assets','paper_analyses') ORDER BY table_name",
  [env.MYSQL_DATABASE]
);
await conn.end();

const minio = new Minio.Client({
  endPoint: env.MINIO_ENDPOINT,
  port: Number(env.MINIO_PORT || 9000),
  useSSL: env.MINIO_USE_SSL === "true",
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

const exists = await minio.bucketExists(env.MINIO_BUCKET).catch(async (error) => {
  if (error?.code !== "NoSuchBucket") throw error;
  return false;
});

if (!exists) {
  await minio.makeBucket(env.MINIO_BUCKET);
}

console.log(
  JSON.stringify(
    {
      mysqlDatabase: env.MYSQL_DATABASE,
      tables: tables.map((row) => row.TABLE_NAME || row.table_name),
      minioBucket: env.MINIO_BUCKET,
      minioBucketCreated: !exists,
    },
    null,
    2
  )
);
