import webpush from 'web-push';
import { kvGet, kvSet, kvDel } from './_kv.js';

// Mesma chave pública que está em src/App.jsx (VAPID_PUBLIC_KEY) — não é
// secreta. A privada vem obrigatoriamente de uma env var (nunca no código).
const VAPID_PUBLIC_KEY = 'BLYg4v90ays1aBCcEm_1OV3wiu3tIYPNATntYXCoaFJ_sbUR54RE9QdMT0sfRStVWhZc-ZejNve3uyqBJ8IUxU0';

const DIAS_EN_PT = {
  sunday: 'domingo', monday: 'segunda', tuesday: 'terca', wednesday: 'quarta',
  thursday: 'quinta', friday: 'sexta', saturday: 'sabado',
};

function dentroDaJanela(horaAtualStr, horaAlvoStr, minutosAntes, janelaMin) {
  const [ha, ma] = horaAtualStr.split(':').map(Number);
  const [hb, mb] = horaAlvoStr.split(':').map(Number);
  const atualMin = ha * 60 + ma;
  const alvoMin = hb * 60 + mb - minutosAntes;
  return atualMin >= alvoMin && atualMin < alvoMin + janelaMin;
}

async function enviarPush(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err && (err.statusCode === 410 || err.statusCode === 404)) {
      // subscrição caducada (app desinstalada, permissão revogada) — limpa.
      await kvDel('push:subscription');
    }
    return false;
  }
}

// Alvo do cron job (ver vercel.json). Também pode ser chamado à mão, por
// GET, para testar (ex.: abrir o URL no navegador).
export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) { res.status(401).json({ error: 'não autorizado' }); return; }
  }

  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) { res.status(500).json({ error: 'VAPID_PRIVATE_KEY não configurada' }); return; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:fcaculo@icloud.com', VAPID_PUBLIC_KEY, privateKey);

  try {
    const subscription = await kvGet('push:subscription');
    const settings = await kvGet('push:settings');
    if (!subscription || !settings) { res.status(200).json({ ok: true, enviados: 0, motivo: 'sem subscrição ativa' }); return; }

    const tz = settings.timezone || 'UTC';
    const agora = new Date();
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(agora).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const diaPt = DIAS_EN_PT[partes.weekday.toLowerCase()];
    const horaAtual = `${partes.hour}:${partes.minute}`;
    const dataHoje = `${partes.year}-${partes.month}-${partes.day}`;

    // A cron corre a cada 15 min (ver vercel.json) — janela de 15 min
    // garante que nenhum disparo é perdido entre duas execuções.
    const JANELA_MIN = 15;
    const notificacoes = [];

    if (settings.lembreteAtivo && diaPt === (settings.lembreteDia || 'domingo')
      && dentroDaJanela(horaAtual, settings.lembreteHora || '14:00', 0, JANELA_MIN)) {
      const chave = `push:sent:weekly:${dataHoje}`;
      if (!(await kvGet(chave))) {
        notificacoes.push({ title: 'Planeamento semanal', body: 'É hora de planear a semana — abra a Agenda Semanal.', url: '/' });
        await kvSet(chave, true);
      }
    }

    for (const a of settings.atividades || []) {
      if (a.dia === diaPt && dentroDaJanela(horaAtual, a.hora, 15, JANELA_MIN)) {
        const chave = `push:sent:act:${a.id}:${dataHoje}`;
        if (!(await kvGet(chave))) {
          notificacoes.push({ title: a.titulo, body: `Às ${a.hora} — não se esqueça.`, url: '/' });
          await kvSet(chave, true);
        }
      }
    }

    let enviados = 0;
    for (const n of notificacoes) { if (await enviarPush(subscription, n)) enviados++; }

    res.status(200).json({ ok: true, enviados, dataHoje, diaPt, horaAtual });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message || err) });
  }
}
