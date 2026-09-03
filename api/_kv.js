// Guarda de key-value sobre o Vercel Blob (loja privada "agenda-semanal-kv",
// ligada ao projeto — injeta BLOB_READ_WRITE_TOKEN automaticamente). Serve
// só para os dois ou três valores pequenos de que a API de notificações
// precisa (subscrição push, definições, marcas de "já enviado"); não é
// uma base de dados a sério, mas para uma app de uma pessoa só chega.
import { put, get, del as blobDel } from '@vercel/blob';

const PREFIX = 'kv/';

export async function kvGet(key) {
  // useCache:false — isto guarda coisas como "já enviei este aviso?" e a
  // conta atual; uma leitura da cache da CDN (até 1 min a refletir uma
  // escrita) pode reenviar uma notificação ou rejeitar um login que acabou
  // de mudar a palavra-passe. Este KV é pouco lido, o custo é desprezável.
  const res = await get(PREFIX + key + '.json', { access: 'private', useCache: false });
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
