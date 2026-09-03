// Guarda de key-value sobre o Vercel Blob (loja privada "agenda-semanal-kv",
// ligada ao projeto — injeta BLOB_READ_WRITE_TOKEN automaticamente). Serve
// só para os dois ou três valores pequenos de que a API de notificações
// precisa (subscrição push, definições, marcas de "já enviado"); não é
// uma base de dados a sério, mas para uma app de uma pessoa só chega.
import { put, get, del as blobDel } from '@vercel/blob';

const PREFIX = 'kv/';

export async function kvGet(key) {
  const res = await get(PREFIX + key + '.json', { access: 'private' });
  if (!res) return null;
  const text = await new Response(res.stream).text();
  return JSON.parse(text);
}

export async function kvSet(key, value) {
  await put(PREFIX + key + '.json', JSON.stringify(value), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function kvDel(key) {
  await blobDel(PREFIX + key + '.json');
}
