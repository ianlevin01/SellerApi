// src/utils/s3Client.js
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "sa-east-1",
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY     || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY     || process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const BUCKET = process.env.AWS_BUCKET || process.env.S3_BUCKET;

// Devuelve una URL firmada válida por 1 hora
export async function signKey(key) {
  if (!key || typeof key !== "string") return null;
  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return await getSignedUrl(s3, cmd, { expiresIn: 604800 });
  } catch (err) {
    console.error(`[s3] signKey error for "${key}": ${err.message}`);
    return null;
  }
}

// Firma un array de keys y devuelve el array con las URLs
export async function signKeys(keys = []) {
  return Promise.all(keys.map(k => signKey(k)));
}

// Descarga un objeto de S3 y devuelve un Buffer
export async function getBuffer(key) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const res = await s3.send(cmd);
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Sube un Buffer a S3 y devuelve la URL firmada
export async function uploadBuffer(key, buffer, contentType = "image/png") {
  const cmd = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
  });
  await s3.send(cmd);
  return signKey(key);
}

export default s3;
