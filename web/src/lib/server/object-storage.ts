import { Client } from "minio";
import { loadRootEnv } from "./env";

let client: Client | null = null;

export function isObjectStorageConfigured() {
  loadRootEnv();
  return Boolean(
    process.env.MINIO_ENDPOINT &&
      process.env.MINIO_ACCESS_KEY &&
      process.env.MINIO_SECRET_KEY &&
      process.env.MINIO_BUCKET
  );
}

export function getObjectBucket() {
  loadRootEnv();
  return process.env.MINIO_BUCKET || "evil-read-arxiv";
}

export function getObjectClient() {
  loadRootEnv();
  if (!isObjectStorageConfigured()) {
    throw new Error("MinIO is not configured. Set MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, and MINIO_BUCKET.");
  }

  if (!client) {
    client = new Client({
      endPoint: process.env.MINIO_ENDPOINT!,
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY!,
      secretKey: process.env.MINIO_SECRET_KEY!,
    });
  }

  return client;
}

export async function ensureBucket() {
  const minio = getObjectClient();
  const bucket = getObjectBucket();
  const exists = await minio.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await minio.makeBucket(bucket);
  }
  return bucket;
}

export async function putJsonObject(objectKey: string, data: unknown) {
  const bucket = await ensureBucket();
  const body = Buffer.from(JSON.stringify(data, null, 2), "utf-8");
  await getObjectClient().putObject(bucket, objectKey, body, body.length, {
    "Content-Type": "application/json; charset=utf-8",
  });
  return {
    bucket,
    objectKey,
    size: body.length,
    contentType: "application/json; charset=utf-8",
  };
}

export async function putTextObject(
  objectKey: string,
  text: string,
  contentType = "text/markdown; charset=utf-8"
) {
  const bucket = await ensureBucket();
  const body = Buffer.from(text, "utf-8");
  await getObjectClient().putObject(bucket, objectKey, body, body.length, {
    "Content-Type": contentType,
  });
  return { bucket, objectKey, size: body.length, contentType };
}

export async function putRemoteObject(
  objectKey: string,
  url: string,
  contentType = "application/pdf",
  timeoutMs = 30000
) {
  const bucket = await ensureBucket();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  await getObjectClient().putObject(bucket, objectKey, body, body.length, {
    "Content-Type": response.headers.get("content-type") || contentType,
  });
  return {
    bucket,
    objectKey,
    size: body.length,
    contentType: response.headers.get("content-type") || contentType,
  };
}
