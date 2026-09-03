import { kvGet, kvSet } from './_kv.js';

// Conta única (esta app é de uma pessoa só). O "registo" (email + hash da
// palavra-passe + se ainda tem de a trocar) e os "dados" (papéis,
// objetivos, atividades, missão…) vivem em dois valores separados no
// Vercel Blob, para o cliente poder atualizar só os dados sem repetir o
// registo a toda a hora.
//
// Autorização: quem sabe o hash da palavra-passe atual (enviado como
// `Authorization: Bearer <hash>`) pode ler e escrever. Não há conta
// nenhuma ainda? A primeira chamada POST cria-a, sem precisar de token —
// é o "primeiro acesso" do telemóvel a criar a conta no servidor.
function getBearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const hash = getBearer(req);
      const record = await kvGet('account:record');
      if (!record) { res.status(404).json({ exists: false }); return; }
      if (!hash || hash !== record.passHash) { res.status(401).json({ error: 'não autorizado' }); return; }
      const data = await kvGet('account:data');
      res.status(200).json({ exists: true, email: record.email, mustChangePassword: record.mustChangePassword, data: data || {} });
      return;
    }

    if (req.method === 'POST') {
      const { email, passHash, mustChangePassword, data } = req.body || {};
      if (!passHash) { res.status(400).json({ error: 'passHash em falta' }); return; }

      const record = await kvGet('account:record');
      if (record) {
        const hash = getBearer(req);
        if (hash !== record.passHash) { res.status(401).json({ error: 'não autorizado' }); return; }
      }

      await kvSet('account:record', {
        email: email || (record && record.email) || '',
        passHash,
        mustChangePassword: mustChangePassword !== undefined ? !!mustChangePassword : !!(record && record.mustChangePassword),
      });
      if (data !== undefined) await kvSet('account:data', data);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message || err) });
  }
}
