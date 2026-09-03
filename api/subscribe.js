import { kvSet, kvDel } from './_kv.js';

// Conta única (esta app é de uma pessoa só) — por isso guarda-se sob
// chaves fixas, sem id de utilizador.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  try {
    const { subscription, settings } = req.body || {};

    if (subscription === null) {
      await kvDel('push:subscription');
      res.status(200).json({ ok: true, removido: true });
      return;
    }

    if (!subscription || !subscription.endpoint) {
      res.status(400).json({ error: 'subscription inválida' });
      return;
    }

    await kvSet('push:subscription', subscription);
    if (settings) await kvSet('push:settings', settings);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message || err) });
  }
}
