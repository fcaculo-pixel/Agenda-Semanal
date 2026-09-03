/* Agenda Semanal — aplicação React (JSX).
   Depende de: React 18+, IOSFrame.jsx, industry.css (tokens do design
   system) e app.css. */

import React from 'react';
import IOSDevice from './IOSFrame.jsx';

const Frag = React.Fragment;

const STORAGE_KEY = 'agenda-semanal:v1';
// Só a "informação" persiste — o resto (sheet aberta, notif, toast, os
// campos de formulário de login) é estado de UI que não faz sentido
// sobreviver a um refresh.
const PERSIST_KEYS = [
  'stage', 'auth', 'lembrete', 'tab', 'weekOffset', 'dia',
  'transitado', 'sincronizar', 'done', 'tempos', 'rascunho',
  'msCriadoEm', 'msUltimaEdicaoEm', 'ms', 'renov',
  'roles', 'longos', 'curtos', 'acts',
];

// Conta única, sem servidor: isto NÃO é segurança a sério — é só um
// bloqueio de ecrã. A palavra-passe fica com hash (SHA-256 + sal fixo) no
// localStorage do próprio telemóvel, nunca em texto simples, mas quem
// tiver acesso às ferramentas de programador do telemóvel consegue
// contornar isto. Para segurança real seria preciso um servidor a validar
// o login.
const AUTH_SALT = 'agenda-semanal::';
const DEFAULT_EMAIL = 'fcaculo@icloud.com';
// hash de 'agenda-semanal::12345' — a palavra-passe de arranque, trocada
// obrigatoriamente no primeiro login (ver mustChangePassword).
const DEFAULT_PASS_HASH = 'd1718f42bfbcef2325736d9712e34594729936a5d8373d57657b503bfc171c71';

async function hashPassword(pw) {
  const bytes = new TextEncoder().encode(AUTH_SALT + pw);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Chave pública VAPID — não é secreta, pode viver no código do cliente.
// A privada (para assinar os envios) fica só no servidor (env var no Vercel).
const VAPID_PUBLIC_KEY = 'BLYg4v90ays1aBCcEm_1OV3wiu3tIYPNATntYXCoaFJ_sbUR54RE9QdMT0sfRStVWhZc-ZejNve3uyqBJ8IUxU0';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePersisted(state) {
  try {
    const data = {};
    PERSIST_KEYS.forEach(k => { data[k] = state[k]; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage indisponível (modo privado, quota cheia) — ignora
  }
}

const DEFAULT_STATE = {
    stage: 'login',
    auth: { email: DEFAULT_EMAIL, passHash: DEFAULT_PASS_HASH, mustChangePassword: true },
    loginEmailInput: DEFAULT_EMAIL,
    loginSenhaInput: '',
    novaSenhaInput: '',
    confirmarSenhaInput: '',
    notif: null,
    lembrete: true,
    tab: 'semana',
    weekOffset: 0,
    dia: 'segunda',
    sheet: null,
    transitado: {},
    toast: null,
    sincronizar: true,
    done: {},
    tempos: {},
    rascunho: { semana: 0, dia: 'segunda', hora: '09:00', rep: 'nunca', ate: 12, resp: '', nota: '', titulo: '', roleId: '', quad: 'inu', nome: '', cor: 'var(--color-accent-700)', horizonte: '' },
    msCriadoEm: null,
    msUltimaEdicaoEm: null,
    ms: { missao: '', visao: '', valores: '', dimensoes: '', papeis: '', principios: '' },
    renov: { fisico: '', mental: '', espiritual: '', social: '' },
    roles: [],
    longos: [],
    curtos: [],
    acts: [],
};

class App extends React.Component {
  DIAS = [
    { k: 'domingo', l: 'D', nome: 'Domingo' },
    { k: 'segunda', l: 'S', nome: 'Segunda' },
    { k: 'terca', l: 'T', nome: 'Terça' },
    { k: 'quarta', l: 'Q', nome: 'Quarta' },
    { k: 'quinta', l: 'Q', nome: 'Quinta' },
    { k: 'sexta', l: 'S', nome: 'Sexta' },
    { k: 'sabado', l: 'S', nome: 'Sábado' },
  ];
  UTEIS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta'];
  HORAS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','Noite'];
  MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  CORES = ['var(--color-accent-900)','var(--color-accent-700)','var(--color-accent-500)','var(--color-accent-400)','var(--color-neutral-600)'];
  REPS = [{ v: 'nunca', r: 'Nunca' }, { v: 'semanal', r: 'Semanal' }, { v: 'quinzenal', r: 'Quinzenal' }, { v: 'uteis', r: 'Dias úteis' }];

  constructor(props) {
    super(props);
    this.state = { ...DEFAULT_STATE, ...loadPersisted() };
  }

  uid() { return 'x' + Math.random().toString(36).slice(2, 8); }
  flash(msg) { clearTimeout(this._t); this.setState({ toast: msg }); this._t = setTimeout(() => this.setState({ toast: null }), 2200); }
  componentDidMount() { this.sincronizarPush(); }
  componentDidUpdate() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => { savePersisted(this.state); this.sincronizarPush(); }, 300);
  }
  componentWillUnmount() {
    clearTimeout(this._t); clearTimeout(this._n); clearTimeout(this._saveT);
    savePersisted(this.state);
  }

  // --- Notificações push -----------------------------------------------
  // Pede permissão, subscreve o browser (via VAPID) e sincroniza com o
  // backend (/api/subscribe). Sem isto o servidor não tem como saber para
  // onde mandar o aviso nem quando — a app, sozinha no telemóvel, não
  // consegue acordar sozinha para disparar uma notificação.
  async ativarPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      this.flash('Notificações push não são suportadas aqui — no iPhone, precisa de instalar a app (Adicionar ao Ecrã Principal) num iOS 16.4+');
      return;
    }
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') { this.flash('Permissão de notificações negada'); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      await this.sincronizarPush(sub);
    } catch {
      this.flash('Não foi possível ativar as notificações');
    }
  }
  async desativarPush() {
    try {
      if (!('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: null }) }).catch(() => {});
      await sub.unsubscribe();
    } catch { /* melhor esforço — não é crítico se falhar */ }
  }
  // Reenvia a lista do que precisa de aviso (não os dados todos da app) —
  // chamado a cada mudança de estado relevante, para o servidor nunca
  // ficar com uma lista desatualizada de atividades a lembrar.
  async sincronizarPush(subOverride) {
    try {
      if (!('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const sub = subOverride || await reg.pushManager.getSubscription();
      if (!sub) return;
      const settings = {
        lembreteAtivo: this.state.lembrete,
        lembreteDia: 'domingo',
        lembreteHora: '14:00',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        atividades: this.state.acts
          .filter(a => a.notificar && a.tipo === 'agendado' && a.dia && a.hora)
          .map(a => ({ id: a.id, titulo: a.titulo, dia: a.dia, hora: a.hora })),
      };
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), settings }),
      });
    } catch { /* sem rede ou API por publicar — a app continua a funcionar */ }
  }

  semana(offset) {
    const start = new Date(2026, 7, 9 + offset * 7);
    const end = new Date(2026, 7, 15 + offset * 7);
    const f = d => d.getDate() + ' ' + this.MESES[d.getMonth()];
    return {
      num: 34 + offset,
      rotulo: (f(start) + ' – ' + f(end)).toUpperCase(),
      curto: f(start) + '–' + end.getDate(),
      dias: this.DIAS.map((_, i) => new Date(2026, 7, 9 + offset * 7 + i).getDate()),
    };
  }
  repLabel(v) { const r = this.REPS.find(x => x.v === v); return r ? r.r : 'Nunca'; }
  papel(id) { return this.state.roles.find(r => r.id === id) || { nome: '—', abbr: '—', cor: 'var(--color-neutral-500)' }; }
  curto(id) { return this.state.curtos.find(c => c.id === id) || { titulo: '—', longId: '' }; }
  longo(id) { return this.state.longos.find(l => l.id === id) || { titulo: '—', roleId: '' }; }
  papelDaAtividade(a) { return this.papel(this.longo(this.curto(a.curtoId).longId).roleId); }
  nomeDia(k) { const d = this.DIAS.find(x => x.k === k); return d ? d.nome : ''; }

  diasDaOcorrencia(a, wo) {
    if (a.tipo !== 'agendado' || wo < a.semana) return [];
    if (a.rep !== 'nunca' && a.ate != null && wo > a.ate) return [];
    const delta = wo - a.semana;
    if (a.rep === 'nunca') return delta === 0 ? [a.dia] : [];
    if (a.rep === 'quinzenal') return delta % 2 === 0 ? [a.dia] : [];
    if (a.rep === 'uteis') return this.UTEIS.slice();
    return [a.dia];
  }
  ocorrencias(wo) {
    const out = [];
    this.state.acts.forEach(a => this.diasDaOcorrencia(a, wo).forEach(dia => out.push({ a, dia, hora: a.hora, key: a.id + '|' + wo + '|' + dia })));
    return out;
  }
  feito(key) { return !!this.state.done[key]; }
  alternar(key) { this.setState(s => ({ done: { ...s.done, [key]: !s.done[key] } })); }
  feitaAlguma(a) { return Object.keys(this.state.done).some(k => this.state.done[k] && k.split('|')[0] === a.id); }

  // A ocorrência desta atividade que o utilizador está a ver, dada a semana em ecrã.
  ocorrenciaVisivel(a, wo) {
    if (a.tipo !== 'agendado') return { semana: Math.max(a.semana, wo), dia: a.dia || 'x' };
    let w = a.semana;
    if (a.rep === 'semanal' || a.rep === 'uteis') w = Math.max(a.semana, wo);
    else if (a.rep === 'quinzenal') w = a.semana + Math.max(0, Math.ceil((wo - a.semana) / 2)) * 2;
    let dia = a.dia;
    if (a.rep === 'uteis' && this.UTEIS.indexOf(dia) < 0) dia = 'segunda';
    return { semana: w, dia: dia || 'x' };
  }
  chaveVisivel(a, wo) { const o = this.ocorrenciaVisivel(a, wo); return a.id + '|' + o.semana + '|' + o.dia; }

  fimSemana(off) {
    const d = new Date(2026, 7, 15 + off * 7);
    return d.getDate() + ' ' + this.MESES[d.getMonth()];
  }
  notificar(titulo, corpo, acao) {
    clearTimeout(this._n);
    this.setState({ notif: { titulo, corpo, acao: acao || null } });
    this._n = setTimeout(() => this.setState({ notif: null }), 5000);
  }
  fmtMin(m) {
    if (!m) return '0 min';
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    return r ? h + 'h' + String(r).padStart(2, '0') : h + 'h';
  }
  fmtData(ts) { const d = new Date(ts); return d.getDate() + ' ' + this.MESES[d.getMonth()] + ' ' + d.getFullYear(); }
  tempoDe(key) { return this.state.tempos[key] || 0; }
  tempoTotal(a) { return Object.keys(this.state.tempos).reduce((t, k) => k.split('|')[0] === a.id ? t + this.state.tempos[k] : t, 0); }
  registarTempo(key, min) { this.setState(s => ({ tempos: { ...s.tempos, [key]: min } })); }

  setRasc(patch) { this.setState(s => ({ rascunho: { ...s.rascunho, ...patch } })); }
  abrirAtividade(id, key) { this.setState({ sheet: { t: 'acao', id, key } }); }

  renderVals() {
    const s = this.state;
    const wo = s.weekOffset;
    const wk = this.semana(wo);
    const r = s.rascunho;
    const ocs = this.ocorrencias(wo);
    const feitasN = ocs.filter(o => this.feito(o.key)).length;
    const pct = ocs.length ? Math.round((feitasN / ocs.length) * 100) : 0;
    const alvo = s.sheet && s.sheet.id ? s.acts.find(a => a.id === s.sheet.id) : null;

    const sel = on => on
      ? { borda: 'var(--color-accent-900)', fundo: 'var(--color-accent-900)', texto: 'var(--color-bg)' }
      : { borda: 'var(--color-divider)', fundo: 'transparent', texto: 'var(--color-text)' };

    const mapOc = o => {
      const p = this.papelDaAtividade(o.a);
      const f = this.feito(o.key);
      return {
        titulo: o.a.titulo, objetivo: this.curto(o.a.curtoId).titulo,
        abbr: p.abbr, cor: p.cor, hora: o.hora || 'Sem hora',
        feita: f, opacidade: f ? 0.45 : 1, urgente: o.a.q === 'iu',
        repete: o.a.rep !== 'nunca', repLabel: this.repLabel(o.a.rep),
        temTempo: o.a.rep !== 'nunca' && this.tempoDe(o.key) > 0,
        tempo: '⏱ ' + this.fmtMin(this.tempoDe(o.key)),
        toggle: () => this.alternar(o.key),
        open: () => this.abrirAtividade(o.a.id, o.key),
      };
    };

    const doDia = ocs.filter(o => o.dia === s.dia);

    const arvore = s.roles.map(p => {
      const longos = s.longos.filter(L => L.roleId === p.id).map(L => ({
        titulo: L.titulo, horizonte: L.horizonte,
        curtos: s.curtos.filter(C => C.longId === L.id).map(C => {
          const as = s.acts.filter(a => a.curtoId === C.id);
          const fe = as.filter(a => this.feitaAlguma(a)).length;
          return {
            titulo: C.titulo, pct: as.length ? Math.round((fe / as.length) * 100) : 0,
            rotulo: fe + '/' + as.length,
            atividades: as.map(a => {
              const ever = this.feitaAlguma(a);
              const sw = this.semana(a.semana);
              return {
                titulo: a.titulo, feita: ever, opacidade: ever ? 0.45 : 1,
                agendada: a.tipo === 'agendado', delegada: a.tipo === 'delegado', aberta: a.tipo === 'aberto',
                estado: a.tipo === 'agendado'
                  ? this.nomeDia(a.dia).slice(0, 3) + ' ' + a.hora + ' · S' + sw.num
                  : (a.tipo === 'delegado' ? 'Delegado · ' + a.responsavel : ''),
                repete: a.rep !== 'nunca', repLabel: this.repLabel(a.rep),
                temTempo: a.rep !== 'nunca' && this.tempoTotal(a) > 0,
                tempo: this.fmtMin(this.tempoTotal(a)) + ' no total',
                toggle: () => this.alternar(this.chaveVisivel(a, wo)),
                open: () => this.abrirAtividade(a.id, this.chaveVisivel(a, wo)),
              };
            }),
            addAtividade: () => this.setState(st => ({ sheet: { t: 'novaAtividade', curtoId: C.id }, rascunho: { ...st.rascunho, titulo: '' } })),
          };
        }),
        addCurto: () => this.setState(st => ({ sheet: { t: 'novoCurto', longId: L.id }, rascunho: { ...st.rascunho, titulo: '' } })),
      }));
      const nAt = s.acts.filter(a => this.longo(this.curto(a.curtoId).longId).roleId === p.id).length;
      return {
        nome: p.nome, cor: p.cor, longos, vazio: longos.length === 0,
        contagem: longos.length + ' obj · ' + nAt + ' ativ',
        addLongo: () => this.setState(st => ({ sheet: { t: 'novoLongo' }, rascunho: { ...st.rascunho, roleId: p.id, titulo: '' } })),
      };
    });

    const balanco = s.curtos.map(C => {
      const as = s.acts.filter(a => a.curtoId === C.id);
      const fe = as.filter(a => this.feitaAlguma(a)).length;
      const p = this.papel(this.longo(C.longId).roleId);
      return { nome: C.titulo, cor: p.cor, pct: as.length ? Math.round((fe / as.length) * 100) : 0, rotulo: fe + '/' + as.length };
    }).filter(b => b.rotulo !== '0/0');

    const abertas = s.acts.filter(a => a.tipo === 'aberto');
    const cAtiva = 'var(--color-accent-900)';
    const cInativa = 'color-mix(in srgb, var(--color-text) 45%, transparent)';
    const tab = k => ({ cor: s.tab === k ? cAtiva : cInativa, bar: s.tab === k ? 'var(--color-accent)' : 'transparent' });
    const tS = tab('semana'), tO = tab('objetivos'), tP = tab('papeis'), tR = tab('renovar'), tF = tab('fecho');
    const titulos = { acao: 'Atividade', agendar: 'Agendar atividade', delegar: 'Delegar', novaAtividade: 'Nova atividade', novoLongo: 'Objetivo de longo prazo', novoCurto: 'Objetivo de curto prazo', novoPapel: 'Novo papel', slot: 'Escolher atividade' };
    const pendentesOcs = ocs.filter(o => !this.feito(o.key));
    const relNomes = { '-1': 'Semana passada', '0': 'Semana atual', '1': 'Próxima semana' };

    const DIA_MS = 24 * 60 * 60 * 1000;
    const MS_JANELA_INICIAL_DIAS = 3;
    const MS_INTERVALO_EDICAO_DIAS = 30;
    const agora = Date.now();
    const dentroJanelaInicial = s.msCriadoEm != null && (agora - s.msCriadoEm) < MS_JANELA_INICIAL_DIAS * DIA_MS;
    const podeEditarMs = s.msCriadoEm == null
      || dentroJanelaInicial
      || s.msUltimaEdicaoEm == null
      || (agora - s.msUltimaEdicaoEm) >= MS_INTERVALO_EDICAO_DIAS * DIA_MS;

    return {
      semanaNum: wk.num,
      intervalo: wk.rotulo,
      semanaRel: relNomes[String(wo)] || (wo > 0 ? '+' + wo + ' semanas' : wo + ' semanas'),
      proximaSemana: this.semana(wo + 1).rotulo,
      pctFeito: pct,
      resumoSemana: feitasN + '/' + ocs.length + ' atividades',
      nPendentes: ocs.length - feitasN,
      prevWeek: () => this.setState(st => ({ weekOffset: st.weekOffset - 1 })),
      nextWeek: () => this.setState(st => ({ weekOffset: st.weekOffset + 1 })),

      verLogin: s.stage === 'login',
      verTrocarSenha: s.stage === 'trocarSenha',
      loginEmailInput: s.loginEmailInput,
      loginSenhaInput: s.loginSenhaInput,
      setLoginEmailInput: e => { const v = e.target.value; this.setState({ loginEmailInput: v }); },
      setLoginSenhaInput: e => { const v = e.target.value; this.setState({ loginSenhaInput: v }); },
      entrar: async () => {
        const emailOk = s.loginEmailInput.trim().toLowerCase() === s.auth.email.trim().toLowerCase();
        const hash = await hashPassword(s.loginSenhaInput);
        if (!emailOk || hash !== s.auth.passHash) { this.flash('Email ou palavra-passe incorretos'); return; }
        if (s.auth.mustChangePassword) { this.setState({ stage: 'trocarSenha' }); return; }
        const primeiraVez = s.msCriadoEm == null;
        this.setState({ stage: 'app', tab: primeiraVez ? 'missao' : s.tab, loginSenhaInput: '' });
        this.flash('Sessão iniciada neste iPhone');
      },

      novaSenhaInput: s.novaSenhaInput,
      confirmarSenhaInput: s.confirmarSenhaInput,
      setNovaSenhaInput: e => { const v = e.target.value; this.setState({ novaSenhaInput: v }); },
      setConfirmarSenhaInput: e => { const v = e.target.value; this.setState({ confirmarSenhaInput: v }); },
      confirmarTrocaSenha: async () => {
        const nova = s.novaSenhaInput;
        if (nova.length < 4) { this.flash('A palavra-passe precisa de pelo menos 4 caracteres'); return; }
        if (nova !== s.confirmarSenhaInput) { this.flash('As palavras-passe não coincidem'); return; }
        const hash = await hashPassword(nova);
        const primeiraVez = s.msCriadoEm == null;
        this.setState({
          auth: { ...s.auth, passHash: hash, mustChangePassword: false },
          stage: 'app', tab: primeiraVez ? 'missao' : s.tab,
          novaSenhaInput: '', confirmarSenhaInput: '', loginSenhaInput: '',
        });
        this.flash('Palavra-passe alterada');
      },
      cancelarTrocaSenha: () => this.setState({ stage: 'login', novaSenhaInput: '', confirmarSenhaInput: '', loginSenhaInput: '' }),

      temNotif: !!s.notif,
      notifTitulo: s.notif ? s.notif.titulo : '',
      notifCorpo: s.notif ? s.notif.corpo : '',
      abrirNotif: () => { if (s.notif && s.notif.acao) { clearTimeout(this._n); s.notif.acao(); } },
      fecharNotif: e => { e.stopPropagation(); clearTimeout(this._n); this.setState({ notif: null }); },

      verSemana: s.tab === 'semana',
      verObjetivos: s.tab === 'objetivos',
      verPapeis: s.tab === 'papeis',
      verRenovar: s.tab === 'renovar',
      verFecho: s.tab === 'fecho',
      verMissao: s.tab === 'missao',
      irSemana: () => this.setState({ tab: 'semana' }),
      irObjetivos: () => this.setState({ tab: 'objetivos' }),
      irPapeis: () => this.setState({ tab: 'papeis' }),
      irRenovar: () => this.setState({ tab: 'renovar' }),
      irFecho: () => this.setState({ tab: 'fecho' }),
      openMissao: () => this.setState({ tab: 'missao' }),
      fecharMissao: () => { this.setState({ tab: 'semana' }); this.flash('Missão guardada'); },
      tabSemanaCor: tS.cor, tabSemanaBar: tS.bar,
      tabObjCor: tO.cor, tabObjBar: tO.bar,
      tabPapeisCor: tP.cor, tabPapeisBar: tP.bar,
      tabRenovarCor: tR.cor, tabRenovarBar: tR.bar,
      tabFechoCor: tF.cor, tabFechoBar: tF.bar,

      dias: this.DIAS.map((d, i) => {
        const n = ocs.filter(o => o.dia === d.k).length;
        return { l: d.l, num: wk.dias[i], count: n === 0 ? '·' : n, sel: s.dia === d.k, notSel: s.dia !== d.k, pick: () => this.setState({ dia: d.k }) };
      }),
      diaNome: this.nomeDia(s.dia),
      prioridades: doDia.map(mapOc),
      semPrioridades: doDia.length === 0,
      slots: this.HORAS.map(h => {
        const its = doDia.filter(o => o.hora === h).map(mapOc);
        return { hora: h, items: its, vazio: its.length === 0, add: () => this.setState({ sheet: { t: 'slot', hora: h } }) };
      }),
      delegados: s.acts.filter(a => a.tipo === 'delegado' && a.semana === wo).map(a => {
        const p = this.papelDaAtividade(a);
        return { titulo: a.titulo, responsavel: a.responsavel, cor: p.cor, open: () => this.abrirAtividade(a.id, this.chaveVisivel(a, wo)) };
      }),
      temDelegados: s.acts.some(a => a.tipo === 'delegado' && a.semana === wo),
      abertas: abertas.map(a => {
        const p = this.papelDaAtividade(a);
        return { titulo: a.titulo, objetivo: this.curto(a.curtoId).titulo, cor: p.cor, open: () => this.abrirAtividade(a.id, this.chaveVisivel(a, wo)) };
      }),
      temAbertas: abertas.length > 0,

      arvore,
      novoLongo: () => this.setState(st => ({ sheet: { t: 'novoLongo' }, rascunho: { ...st.rascunho, titulo: '' } })),

      papeis: s.roles.map((p, i) => {
        const nL = s.longos.filter(L => L.roleId === p.id).length;
        const nA = s.acts.filter(a => this.longo(this.curto(a.curtoId).longId).roleId === p.id).length;
        return {
          nome: p.nome, abbr: p.abbr, cor: p.cor,
          resumo: nL + (nL === 1 ? ' objetivo' : ' objetivos') + ' · ' + nA + (nA === 1 ? ' atividade' : ' atividades'),
          subir: () => this.setState(st => {
            if (i === 0) return null;
            const rs = st.roles.slice();
            rs.splice(i - 1, 0, rs.splice(i, 1)[0]);
            return { roles: rs };
          }),
          arquivar: () => {
            this.setState(st => {
              const Ls = st.longos.filter(L => L.roleId === p.id).map(L => L.id);
              const Cs = st.curtos.filter(C => Ls.indexOf(C.longId) >= 0).map(C => C.id);
              return {
                roles: st.roles.filter(x => x.id !== p.id),
                longos: st.longos.filter(L => L.roleId !== p.id),
                curtos: st.curtos.filter(C => Ls.indexOf(C.longId) < 0),
                acts: st.acts.filter(a => Cs.indexOf(a.curtoId) < 0),
              };
            });
            this.flash('Papel arquivado');
          },
        };
      }),
      semPapeis: s.roles.length === 0,
      novoPapel: () => this.setState(st => ({ sheet: { t: 'novoPapel' }, rascunho: { ...st.rascunho, nome: '' } })),

      renovacao: [
        { rotulo: 'Físico', valor: s.renov.fisico, dica: 'Exercício, descanso, alimentação', onChange: e => { const v = e.target.value; this.setState(st => ({ renov: { ...st.renov, fisico: v } })); } },
        { rotulo: 'Mental', valor: s.renov.mental, dica: 'Leitura, estudo, escrita', onChange: e => { const v = e.target.value; this.setState(st => ({ renov: { ...st.renov, mental: v } })); } },
        { rotulo: 'Espiritual', valor: s.renov.espiritual, dica: 'Silêncio, missão, natureza', onChange: e => { const v = e.target.value; this.setState(st => ({ renov: { ...st.renov, espiritual: v } })); } },
        { rotulo: 'Social / Emocional', valor: s.renov.social, dica: 'Serviço, relações, escuta', onChange: e => { const v = e.target.value; this.setState(st => ({ renov: { ...st.renov, social: v } })); } },
      ],

      balanco,
      lembrete: s.lembrete,
      lembreteEstado: s.lembrete ? 'Domingo, 14h00 · abre a grelha da semana' : 'Desligado',
      toggleLembrete: () => {
        const on = !s.lembrete;
        this.setState({ lembrete: on });
        if (on) {
          this.notificar('Planeamento semanal', 'Domingo às 14h00 · toque para abrir a grelha e agendar a semana',
            () => this.setState({ tab: 'semana', dia: 'domingo', notif: null }));
          this.ativarPush();
        } else {
          this.desativarPush();
        }
      },
      sair: () => this.setState({ stage: 'login', tab: 'semana', sheet: null, notif: null, loginSenhaInput: '', loginEmailInput: s.auth.email }),
      pendentes: pendentesOcs.map(o => ({
        titulo: o.a.titulo, abbr: this.papelDaAtividade(o.a).abbr,
        soEstatistica: o.a.rep !== 'nunca',
        toggle: () => this.alternar(o.key),
      })),
      tudoFeito: ocs.length > 0 && pendentesOcs.length === 0,
      podeTransitar: !s.transitado[wo] && pendentesOcs.some(o => o.a.rep === 'nunca'),
      transitado: !!s.transitado[wo],
      msgTransitado: pendentesOcs.filter(o => o.a.rep === 'nunca').length + ' atividades pontuais passaram para ' + this.semana(wo + 1).rotulo + '. As recorrentes ficam só na estatística.',
      transitar: () => {
        const mover = pendentesOcs.filter(o => o.a.rep === 'nunca').map(o => o.a.id);
        this.setState(st => ({
          transitado: { ...st.transitado, [wo]: true },
          acts: st.acts.map(a => mover.indexOf(a.id) >= 0 ? { ...a, semana: a.semana + 1 } : a),
        }));
        this.flash('Pendentes transitados');
      },

      msPorCriar: s.msCriadoEm == null,
      msExiste: s.msCriadoEm != null,
      msAberta: podeEditarMs,
      msFechada: s.msCriadoEm != null && !podeEditarMs,
      msEstado: s.msCriadoEm == null
        ? ''
        : (podeEditarMs
          ? (dentroJanelaInicial
            ? 'Janela inicial aberta · editável até ' + this.fmtData(s.msCriadoEm + MS_JANELA_INICIAL_DIAS * DIA_MS)
            : 'Pode editar agora · disponível uma vez por mês')
          : 'Guardada a ' + this.fmtData(s.msUltimaEdicaoEm) + ' · volta a abrir a ' + this.fmtData(s.msUltimaEdicaoEm + MS_INTERVALO_EDICAO_DIAS * DIA_MS)),
      msRodape: s.msCriadoEm == null
        ? 'Depois de guardar, fica aberta 3 dias para ajustar à vontade. A partir daí só pode voltar a editar uma vez por mês.'
        : (dentroJanelaInicial
          ? 'Ainda dentro dos 3 dias iniciais — pode guardar quantas vezes quiser.'
          : 'Fora da janela inicial, só pode voltar a guardar 30 dias depois da última edição.'),
      iniciarMs: () => { this.setState({ msCriadoEm: Date.now() }); this.flash('Escreva os seis blocos e guarde'); },
      blocosMs: [
        { k: 'missao', rotulo: 'Missão', altura: 108, dica: 'Para que existo no trabalho e fora dele' },
        { k: 'visao', rotulo: 'Visão de sucesso', altura: 92, dica: 'Como se parece o sucesso daqui a um ano' },
        { k: 'valores', rotulo: 'Valores principais', altura: 80, dica: 'O que não negoceio' },
        { k: 'dimensoes', rotulo: 'Dimensões de serviço', altura: 92, dica: 'A quem sirvo e como' },
        { k: 'papeis', rotulo: 'Papéis principais', altura: 80, dica: 'As áreas em que invisto tempo' },
        { k: 'principios', rotulo: 'Princípios de vida', altura: 100, dica: 'Regras que sigo mesmo quando custa' },
      ].map(b => ({
        rotulo: b.rotulo, altura: b.altura, dica: b.dica, valor: s.ms[b.k],
        editavel: podeEditarMs, bloqueado: !podeEditarMs,
        temNota: false, nota: '',
        motivo: s.msUltimaEdicaoEm == null ? '' : ('Guardada a ' + this.fmtData(s.msUltimaEdicaoEm) + ' · reabre a ' + this.fmtData(s.msUltimaEdicaoEm + MS_INTERVALO_EDICAO_DIAS * DIA_MS)),
        onChange: e => { const v = e.target.value; this.setState(st => ({ ms: { ...st.ms, [b.k]: v } })); },
      })),
      guardarMs: () => { this.setState({ msUltimaEdicaoEm: Date.now() }); this.flash('Declaração guardada'); },

      sheetAberta: !!s.sheet,
      sheetTitulo: s.sheet ? titulos[s.sheet.t] : '',
      sheetAcao: !!s.sheet && s.sheet.t === 'acao',
      sheetAgendar: !!s.sheet && s.sheet.t === 'agendar',
      sheetDelegar: !!s.sheet && s.sheet.t === 'delegar',
      sheetNovaAtividade: !!s.sheet && s.sheet.t === 'novaAtividade',
      sheetNovoLongo: !!s.sheet && s.sheet.t === 'novoLongo',
      sheetNovoCurto: !!s.sheet && s.sheet.t === 'novoCurto',
      sheetNovoPapel: !!s.sheet && s.sheet.t === 'novoPapel',
      sheetSlot: !!s.sheet && s.sheet.t === 'slot',
      fecharSheet: () => this.setState({ sheet: null }),
      stopClick: e => e.stopPropagation(),

      alvoTitulo: alvo ? alvo.titulo : '',
      alvoObjetivo: alvo ? this.curto(alvo.curtoId).titulo : '',
      alvoEstado: alvo
        ? (alvo.tipo === 'agendado'
          ? this.nomeDia(alvo.dia) + ' · ' + alvo.hora + ' · ' + this.repLabel(alvo.rep)
            + (alvo.rep !== 'nunca' ? (alvo.ate == null ? ' · sem fim' : ' · até ' + this.fimSemana(alvo.ate)) : ' · ' + this.semana(alvo.semana).curto)
          : (alvo.tipo === 'delegado' ? 'Delegado a ' + alvo.responsavel : 'Por agendar'))
        : '',
      alvoRecorrente: !!alvo && alvo.rep !== 'nunca',
      alvoTempoTotal: alvo ? this.fmtMin(this.tempoTotal(alvo)) + ' no total' : '',
      alvoTempoOcorrencia: alvo && s.sheet ? this.fmtMin(this.tempoDe(s.sheet.key)) : '',
      escolhaTempo: [0, 15, 30, 45, 60, 90, 120, 180].map(m => ({
        rotulo: m === 0 ? '—' : (m < 60 ? m + 'm' : this.fmtMin(m)),
        ...sel(!!alvo && !!s.sheet && this.tempoDe(s.sheet.key) === m),
        pick: () => this.registarTempo(s.sheet.key, m),
      })),
      alvoToggleLabel: alvo && s.sheet && this.feito(s.sheet.key) ? 'Reabrir ocorrência' : 'Marcar como concluída',
      alvoToggle: () => { this.alternar(s.sheet.key); this.setState({ sheet: null }); },
      alvoRemover: () => {
        this.setState(st => ({ acts: st.acts.map(a => a.id === alvo.id ? { ...a, tipo: 'aberto', dia: null, hora: null, rep: 'nunca' } : a), sheet: null }));
        this.flash('Atividade volta a por agendar');
      },
      irAgendar: () => this.setState(st => {
        const kw = st.sheet && st.sheet.key ? Number(st.sheet.key.split('|')[1]) : st.weekOffset;
        const base = Math.min(Math.max(isNaN(kw) ? st.weekOffset : kw, st.weekOffset), st.weekOffset + 3);
        return {
          sheet: { t: 'agendar', id: alvo.id },
          rascunho: { ...st.rascunho, semana: base, dia: alvo.dia || st.dia, hora: alvo.hora || '09:00', rep: alvo.rep || 'nunca', ate: alvo.ate === undefined ? base + 11 : alvo.ate, lembrar: !!alvo.notificar },
        };
      }),
      irDelegar: () => this.setState(st => ({ sheet: { t: 'delegar', id: alvo.id }, rascunho: { ...st.rascunho, resp: alvo.responsavel || '', nota: '' } })),

      escolhaSemanas: [0, 1, 2, 3].map(k => {
        const off = wo + k;
        const w = this.semana(off);
        return { rotulo: k === 0 ? 'Esta' : '+' + k + ' sem', datas: w.curto, ...sel(r.semana === off), pick: () => this.setRasc({ semana: off }) };
      }),
      escolhaDias: this.DIAS.map(d => ({ l: d.l, ...sel(r.dia === d.k), pick: () => this.setRasc({ dia: d.k }) })),
      escolhaHoras: this.HORAS.map(h => ({ rotulo: h === 'Noite' ? 'Noite' : h.slice(0, 2) + 'h', ...sel(r.hora === h), pick: () => this.setRasc({ hora: h }) })),
      escolhaRep: this.REPS.map(o => ({ rotulo: o.r, ...sel(r.rep === o.v), pick: () => this.setRasc({ rep: o.v }) })),
      repeteAlgo: r.rep !== 'nunca',
      escolhaAte: [
        { rotulo: '4 semanas', off: r.semana + 3 },
        { rotulo: '8 semanas', off: r.semana + 7 },
        { rotulo: '12 semanas', off: r.semana + 11 },
        { rotulo: 'Sem fim', off: null },
      ].map(o => ({
        rotulo: o.rotulo,
        datas: o.off == null ? 'até cancelar' : 'até ' + this.fimSemana(o.off),
        ...sel(r.ate === o.off),
        pick: () => this.setRasc({ ate: o.off }),
      })),
      sincronizar: s.sincronizar,
      toggleSync: () => this.setState(st => ({ sincronizar: !st.sincronizar })),
      lembrarAtividade: !!r.lembrar,
      toggleLembrarAtividade: () => this.setRasc({ lembrar: !r.lembrar }),
      labelConfirmarAgendar: 'Agendar · ' + this.semana(r.semana).curto,
      confirmarAgendar: () => {
        const id = s.sheet.id;
        this.setState(st => ({
          acts: st.acts.map(a => a.id === id ? { ...a, tipo: 'agendado', semana: r.semana, dia: r.dia, hora: r.hora, rep: r.rep, ate: r.rep === 'nunca' ? null : r.ate, notificar: !!r.lembrar } : a),
          sheet: null, tab: 'semana', weekOffset: r.semana, dia: r.dia,
        }));
        const t = alvo ? alvo.titulo : 'Atividade';
        this.flash('Agendado · ' + this.nomeDia(r.dia) + ' ' + r.hora + (r.rep !== 'nunca' ? ' · ' + this.repLabel(r.rep).toLowerCase() : ''));
        if (s.sincronizar) {
          this.notificar(t, 'Adicionado ao Calendário · ' + this.nomeDia(r.dia) + ', ' + this.semana(r.semana).curto + ' · ' + r.hora
            + (r.rep !== 'nunca' ? ' · repete ' + this.repLabel(r.rep).toLowerCase() + (r.ate == null ? ' sem fim' : ' até ' + this.fimSemana(r.ate)) : ''));
        }
      },
      respDelegar: r.resp,
      setRespDelegar: e => { const v = e.target.value; this.setRasc({ resp: v }); },
      notaDelegar: r.nota,
      setNotaDelegar: e => { const v = e.target.value; this.setRasc({ nota: v }); },
      confirmarDelegar: () => {
        const id = s.sheet.id;
        this.setState(st => ({
          acts: st.acts.map(a => a.id === id ? { ...a, tipo: 'delegado', responsavel: r.resp, notas: r.nota, semana: st.weekOffset, dia: null, hora: null, rep: 'nunca' } : a),
          sheet: null,
        }));
        this.flash('Delegado a ' + r.resp);
      },

      contextoCurto: s.sheet && s.sheet.curtoId ? this.curto(s.sheet.curtoId).titulo : '',
      contextoLongo: s.sheet && s.sheet.longId ? this.longo(s.sheet.longId).titulo : '',
      rascunhoTitulo: r.titulo,
      setRascunhoTitulo: e => { const v = e.target.value; this.setRasc({ titulo: v }); },
      escolhaQuad: [
        { rotulo: 'Q II · importante, não urgente', v: 'inu' },
        { rotulo: 'Q I · importante e urgente', v: 'iu' },
      ].map(o => ({ rotulo: o.rotulo, ...sel(r.quad === o.v), pick: () => this.setRasc({ quad: o.v }) })),
      confirmarNovaAtividade: () => {
        const t = (r.titulo || '').trim();
        if (!t) { this.flash('Escreva a atividade primeiro'); return; }
        const id = this.uid();
        this.setState(st => ({
          acts: st.acts.concat([{ id, curtoId: st.sheet.curtoId, titulo: t, tipo: 'aberto', semana: st.weekOffset, rep: 'nunca', q: r.quad }]),
          sheet: { t: 'agendar', id },
          rascunho: { ...st.rascunho, semana: st.weekOffset, dia: st.dia, hora: '09:00', rep: 'nunca', lembrar: false },
        }));
      },
      confirmarAtividadeAberta: () => {
        const t = (r.titulo || '').trim();
        if (!t) { this.flash('Escreva a atividade primeiro'); return; }
        this.setState(st => ({ acts: st.acts.concat([{ id: this.uid(), curtoId: st.sheet.curtoId, titulo: t, tipo: 'aberto', semana: st.weekOffset, rep: 'nunca', q: r.quad }]), sheet: null }));
        this.flash('Atividade guardada por agendar');
      },

      escolhaPapeis: s.roles.map(p => ({ nome: p.nome, ...sel(r.roleId === p.id), pick: () => this.setRasc({ roleId: p.id }) })),
      escolhaHorizonte: ['Set 2026', 'Dez 2026', '2027'].map(h => ({ rotulo: h, ...sel(r.horizonte === h), pick: () => this.setRasc({ horizonte: h }) })),
      confirmarNovoLongo: () => {
        const t = (r.titulo || '').trim();
        if (!t) { this.flash('Escreva o objetivo primeiro'); return; }
        this.setState(st => ({ longos: st.longos.concat([{ id: this.uid(), roleId: r.roleId, titulo: t, horizonte: r.horizonte }]), sheet: null, tab: 'objetivos' }));
        this.flash('Objetivo de longo prazo criado');
      },
      confirmarNovoCurto: () => {
        const t = (r.titulo || '').trim();
        if (!t) { this.flash('Escreva o objetivo primeiro'); return; }
        this.setState(st => ({ curtos: st.curtos.concat([{ id: this.uid(), longId: st.sheet.longId, titulo: t }]), sheet: null }));
        this.flash('Objetivo de curto prazo criado');
      },

      rascunhoNome: r.nome,
      setRascunhoNome: e => { const v = e.target.value; this.setRasc({ nome: v }); },
      escolhaCores: this.CORES.map(c => ({ cor: c, borda: r.cor === c ? 'var(--color-text)' : 'transparent', pick: () => this.setRasc({ cor: c }) })),
      confirmarNovoPapel: () => {
        const nome = (r.nome || '').trim();
        if (!nome) { this.flash('Dê um nome ao papel'); return; }
        const abbr = nome.split(/\s+/).filter(w => w.length > 2).slice(0, 2).map(w => w[0].toUpperCase()).join('') || nome.slice(0, 2).toUpperCase();
        this.setState(st => ({ roles: st.roles.concat([{ id: this.uid(), nome, abbr, cor: r.cor }]), sheet: null }));
        this.flash('Papel criado');
      },

      slotLegenda: s.sheet && s.sheet.t === 'slot' ? 'Por agendar — ' + this.nomeDia(s.dia) + ', ' + s.sheet.hora + ' · ' + wk.curto : '',
      porAgendar: abertas.map(a => {
        const p = this.papelDaAtividade(a);
        return {
          titulo: a.titulo, objetivo: this.curto(a.curtoId).titulo, abbr: p.abbr, cor: p.cor,
          pick: () => {
            const hora = s.sheet.hora, dia = s.dia;
            this.setState(st => ({ acts: st.acts.map(x => x.id === a.id ? { ...x, tipo: 'agendado', semana: st.weekOffset, dia, hora, rep: 'nunca' } : x), sheet: null }));
            this.flash('Agendado · ' + this.nomeDia(dia) + ' ' + hora);
          },
        };
      }),
      semPorAgendar: abertas.length === 0,

      temToast: !!s.toast,
      toast: s.toast,
    };
  }

  render() {
    const {
      abertas, abrirNotif, alvoEstado, alvoObjetivo, alvoRecorrente, alvoRemover, alvoTempoOcorrencia, alvoTempoTotal,
      alvoTitulo, alvoToggle, alvoToggleLabel, arvore, balanco, blocosMs, confirmarAgendar, confirmarAtividadeAberta,
      confirmarDelegar, confirmarNovaAtividade, confirmarNovoCurto, confirmarNovoLongo, confirmarNovoPapel, contextoCurto, contextoLongo, delegados,
      cancelarTrocaSenha, confirmarTrocaSenha, confirmarSenhaInput, diaNome, dias, entrar, escolhaAte, escolhaCores, escolhaDias, escolhaHoras, escolhaHorizonte,
      escolhaPapeis, escolhaQuad, escolhaRep, escolhaSemanas, escolhaTempo, fecharMissao, fecharNotif, fecharSheet,
      guardarMs, iniciarMs, intervalo, irAgendar, irDelegar, irFecho, irObjetivos, irPapeis,
      irRenovar, irSemana, labelConfirmarAgendar, lembrarAtividade, lembrete, lembreteEstado, loginEmailInput, loginSenhaInput,
      msAberta, msEstado, msExiste, msFechada, msPorCriar, msRodape, msgTransitado,
      nPendentes, nextWeek, notaDelegar, notifCorpo, notifTitulo, novaSenhaInput, novoLongo, novoPapel, openMissao,
      respDelegar, setRespDelegar,
      papeis, pctFeito, pendentes, podeTransitar, porAgendar, prevWeek, prioridades,
      proximaSemana, rascunhoNome, rascunhoTitulo, renovacao, repeteAlgo, resumoSemana, sair, semPapeis,
      semPorAgendar, semPrioridades, semanaNum, semanaRel, setConfirmarSenhaInput, setLoginEmailInput, setLoginSenhaInput,
      setNotaDelegar, setNovaSenhaInput, setRascunhoNome,
      setRascunhoTitulo, sheetAberta, sheetAcao, sheetAgendar, sheetDelegar, sheetNovaAtividade, sheetNovoCurto, sheetNovoLongo,
      sheetNovoPapel, sheetSlot, sheetTitulo, sincronizar, slotLegenda, slots, stopClick,
      tabFechoBar, tabFechoCor, tabObjBar, tabObjCor, tabPapeisBar, tabPapeisCor, tabRenovarBar, tabRenovarCor,
      tabSemanaBar, tabSemanaCor, temAbertas, temDelegados, temNotif, temToast, toast, toggleLembrarAtividade, toggleLembrete,
      toggleSync, transitado, transitar, tudoFeito, verFecho, verLogin, verMissao, verObjetivos,
      verPapeis, verRenovar, verSemana, verTrocarSenha
    } = this.renderVals();

    const screen = (
            <div className="app-screen" style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)' }}>
      
              <div style={{ padding: 'var(--app-header-pt, 56px) 16px 10px', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-divider)', flex: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px' }}>
                  <div style={{ flex: '1', minWidth: '0' }}>
                    <div style={{ font: '600 9.5px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>Semana {semanaNum} · {semanaRel}</div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '27px', lineHeight: '1', letterSpacing: '-.01em' }}>{intervalo}</div>
                  </div>
                  <button className="btn btn-secondary btn-icon" onClick={prevWeek} aria-label="Semana anterior" style={{ height: '32px', width: '32px' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 18l-6-6 6-6"></path></svg>
                  </button>
                  <button className="btn btn-secondary btn-icon" onClick={nextWeek} aria-label="Semana seguinte" style={{ height: '32px', width: '32px' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18l6-6-6-6"></path></svg>
                  </button>
                  <button className="btn btn-secondary btn-icon" onClick={openMissao} aria-label="Missão pessoal" style={{ height: '32px', width: '32px' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"></circle><path d="M15.5 8.5l-2 5-5 2 2-5z"></path></svg>
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '9px' }}>
                  <div style={{ flex: '1', height: '3px', background: 'color-mix(in srgb,var(--color-text) 10%,transparent)', position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '0', top: '0', bottom: '0', background: 'var(--color-accent)', width: `${pctFeito}%` }}></div>
                  </div>
                  <div style={{ font: '600 10px/1 var(--font-heading)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)' }}>{resumoSemana}</div>
                </div>
              </div>
      
              <div className="scr" style={{ flex: '1', overflow: 'auto', backgroundImage: 'linear-gradient(color-mix(in srgb,var(--color-text) 3.5%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--color-text) 3.5%,transparent) 1px,transparent 1px)', backgroundSize: '34px 34px' }}>
      
                {(verSemana) ? (<>
                  <div style={{ padding: '14px 16px 26px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px' }}>
                      {(dias || []).map((d, $index) => (<Frag key={$index}>
                        {(d.sel) ? (<>
                          <button onClick={d.pick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', padding: '8px 0 7px', border: '1px solid var(--color-accent-900)', background: 'var(--color-accent-900)', color: 'var(--color-bg)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                            <span style={{ font: '600 10px/1 var(--font-heading)', letterSpacing: '.1em' }}>{d.l}</span>
                            <span style={{ font: '600 16px/1 var(--font-heading)' }}>{d.num}</span>
                            <span style={{ fontSize: '9px', letterSpacing: '.06em', opacity: '.75' }}>{d.count}</span>
                          </button>
                        </>) : null}
                        {(d.notSel) ? (<>
                          <button onClick={d.pick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', padding: '8px 0 7px', border: '1px solid var(--color-divider)', background: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-body)' }} data-xho="1">
                            <span style={{ font: '600 10px/1 var(--font-heading)', letterSpacing: '.1em', opacity: '.55' }}>{d.l}</span>
                            <span style={{ font: '600 16px/1 var(--font-heading)' }}>{d.num}</span>
                            <span style={{ fontSize: '9px', letterSpacing: '.06em', color: 'var(--color-accent-700)' }}>{d.count}</span>
                          </button>
                        </>) : null}
                      </Frag>))}
                    </div>
      
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '22px 0 8px' }}>
                      <span style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>Prioridades · {diaNome}</span>
                      <span style={{ flex: '1', height: '1px', background: 'var(--color-divider)' }}></span>
                    </div>
      
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {(prioridades || []).map((p, $index) => (<Frag key={$index}>
                        <div className="card" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: '10px', padding: '10px 11px', background: 'var(--color-bg)' }}>
                          <button onClick={p.toggle} aria-label="Concluir" style={{ flex: 'none', width: '20px', height: '20px', marginTop: '1px', border: '1px solid var(--color-accent)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '0' }}>
                            {(p.feita) ? (<>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2"><path d="M4 12.5l5 5L20 6.5"></path></svg>
                            </>) : null}
                          </button>
                          <button onClick={p.open} style={{ flex: '1', minWidth: '0', textAlign: 'left', background: 'transparent', border: '0', padding: '0', cursor: 'pointer', fontFamily: 'var(--font-body)', color: 'inherit' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                              <span style={{ width: '3px', height: '11px', background: `${p.cor}`, display: 'inline-block' }}></span>
                              <span style={{ font: '600 9.5px/1 var(--font-heading)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)' }}>{p.abbr}</span>
                              {(p.urgente) ? (<>
                                <span className="tag tag-outline" style={{ fontSize: '9px', padding: '1px 6px' }}>Urgente</span>
                              </>) : null}
                            </div>
                            <div style={{ fontSize: '13.5px', lineHeight: '1.3', textWrap: 'pretty', opacity: `${p.opacidade}` }}>{p.titulo}</div>
                            <div style={{ fontSize: '10.5px', lineHeight: '1.3', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginTop: '3px' }}>↳ {p.objetivo}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px', fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)' }}>
                              <span>{p.hora}</span>
                              {(p.repete) ? (<>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12a9 9 0 0114.5-7M21 12a9 9 0 01-14.5 7"></path><path d="M17 2v5h-5M7 22v-5h5"></path></svg>
                                  {p.repLabel}
                                </span>
                              </>) : null}
                              {(p.temTempo) ? (<>
                                <span style={{ color: 'var(--color-accent-700)' }}>{p.tempo}</span>
                              </>) : null}
                            </div>
                          </button>
                        </div>
                      </Frag>))}
                      {(semPrioridades) ? (<>
                        <div style={{ padding: '16px', border: '1px dashed color-mix(in srgb,var(--color-text) 20%,transparent)', textAlign: 'center', fontSize: '12px', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)' }}>Nada agendado para {diaNome}.</div>
                      </>) : null}
                    </div>
      
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '24px 0 4px' }}>
                      <span style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>Agenda horária</span>
                      <span style={{ flex: '1', height: '1px', background: 'var(--color-divider)' }}></span>
                    </div>
      
                    <div>
                      {(slots || []).map((s, $index) => (<Frag key={$index}>
                        <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr', gap: '9px', borderTop: '1px solid color-mix(in srgb,var(--color-text) 8%,transparent)', minHeight: '40px', padding: '5px 0' }}>
                          <div style={{ font: '600 10px/1.6 var(--font-heading)', letterSpacing: '.08em', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', paddingTop: '5px' }}>{s.hora}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {(s.items || []).map((it, $index) => (<Frag key={$index}>
                              <button onClick={it.open} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: '7px 9px', border: '1px solid var(--color-divider)', borderLeft: `3px solid ${it.cor}`, background: 'color-mix(in srgb,var(--color-accent) 7%,transparent)', fontFamily: 'var(--font-body)', color: 'inherit' }} data-xho="2">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
                                  <span style={{ font: '600 9px/1 var(--font-heading)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>{it.abbr}</span>
                                  {(it.repete) ? (<>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.8"><path d="M3 12a9 9 0 0114.5-7M21 12a9 9 0 01-14.5 7"></path><path d="M17 2v5h-5M7 22v-5h5"></path></svg>
                                  </>) : null}
                                </div>
                                <div style={{ fontSize: '12.5px', lineHeight: '1.25', textWrap: 'pretty', opacity: `${it.opacidade}` }}>{it.titulo}</div>
                              </button>
                            </Frag>))}
                            {(s.vazio) ? (<>
                              <button onClick={s.add} aria-label="Agendar atividade" style={{ width: '100%', height: '30px', border: '1px dashed color-mix(in srgb,var(--color-text) 14%,transparent)', background: 'transparent', cursor: 'pointer', color: 'color-mix(in srgb,var(--color-text) 35%,transparent)', font: '600 11px var(--font-heading)', letterSpacing: '.1em' }} data-xho="3">+</button>
                            </>) : null}
                          </div>
                        </div>
                      </Frag>))}
                    </div>
      
                    {(temDelegados) ? (<>
                      <div style={{ marginTop: '26px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>Delegado esta semana</span>
                          <span style={{ flex: '1', height: '1px', background: 'var(--color-divider)' }}></span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {(delegados || []).map((dg, $index) => (<Frag key={$index}>
                            <button onClick={dg.open} style={{ display: 'flex', gap: '9px', alignItems: 'center', textAlign: 'left', width: '100%', padding: '9px 10px', border: '1px solid var(--color-divider)', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-body)', color: 'inherit' }} data-xho="4">
                              <span style={{ width: '3px', height: '26px', background: `${dg.cor}`, flex: 'none' }}></span>
                              <span style={{ flex: '1', minWidth: '0' }}>
                                <span style={{ display: 'block', fontSize: '12.5px', lineHeight: '1.25' }}>{dg.titulo}</span>
                                <span style={{ display: 'block', fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginTop: '2px' }}>Responsável · {dg.responsavel}</span>
                              </span>
                            </button>
                          </Frag>))}
                        </div>
                      </div>
                    </>) : null}
      
                    {(temAbertas) ? (<>
                      <div style={{ marginTop: '26px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>Por agendar</span>
                          <span style={{ flex: '1', height: '1px', background: 'var(--color-divider)' }}></span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {(abertas || []).map((ab, $index) => (<Frag key={$index}>
                            <button onClick={ab.open} style={{ display: 'flex', gap: '9px', alignItems: 'center', textAlign: 'left', width: '100%', padding: '9px 10px', border: '1px dashed color-mix(in srgb,var(--color-text) 22%,transparent)', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-body)', color: 'inherit' }} data-xho="5">
                              <span style={{ width: '3px', height: '26px', background: `${ab.cor}`, flex: 'none' }}></span>
                              <span style={{ flex: '1', minWidth: '0' }}>
                                <span style={{ display: 'block', fontSize: '12.5px', lineHeight: '1.25' }}>{ab.titulo}</span>
                                <span style={{ display: 'block', fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginTop: '2px' }}>{ab.objetivo}</span>
                              </span>
                              <span style={{ font: '600 10px/1 var(--font-heading)', letterSpacing: '.1em', color: 'var(--color-accent-700)', flex: 'none' }}>Agendar</span>
                            </button>
                          </Frag>))}
                        </div>
                      </div>
                    </>) : null}
                  </div>
                </>) : null}
      
                {(verObjetivos) ? (<>
                  <div style={{ padding: '16px 16px 26px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', marginBottom: '14px' }}>
                      <p style={{ flex: '1', margin: '0', fontSize: '12px', lineHeight: '1.45', color: 'color-mix(in srgb,var(--color-text) 60%,transparent)', textWrap: 'pretty' }}>Cada papel tem objetivos de longo prazo. Estes partem-se em objetivos de curto prazo, e só destes nascem atividades agendáveis.</p>
                      <button className="btn btn-primary" onClick={novoLongo} style={{ flex: 'none' }}>Objetivo</button>
                    </div>
      
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                      {(arvore || []).map((p, $index) => (<Frag key={$index}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '6px', borderBottom: '1px solid var(--color-divider)' }}>
                            <span style={{ width: '8px', height: '8px', background: `${p.cor}`, flex: 'none' }}></span>
                            <span style={{ font: '600 13px/1 var(--font-heading)', letterSpacing: '.02em', textTransform: 'uppercase', flex: '1', minWidth: '0' }}>{p.nome}</span>
                            <span style={{ font: '600 10px/1 var(--font-heading)', letterSpacing: '.1em', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>{p.contagem}</span>
                          </div>
      
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                            {(p.longos || []).map((L, $index) => (<Frag key={$index}>
                              <div className="blueprint" style={{ padding: '12px' }}>
                                <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
                                  <span style={{ font: '600 9px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>Longo prazo</span>
                                  <span style={{ flex: '1' }}></span>
                                  <span style={{ font: '600 9px/1.4 var(--font-heading)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>{L.horizonte}</span>
                                </div>
                                <div style={{ font: '600 17px/1.15 var(--font-heading)', letterSpacing: '-.005em', textWrap: 'pretty', marginBottom: '10px' }}>{L.titulo}</div>
      
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                  {(L.curtos || []).map((C, $index) => (<Frag key={$index}>
                                    <div style={{ borderLeft: '2px solid color-mix(in srgb,var(--color-text) 14%,transparent)', paddingLeft: '10px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ flex: '1', minWidth: '0', fontSize: '13px', lineHeight: '1.3', textWrap: 'pretty' }}>{C.titulo}</span>
                                        <span style={{ width: '46px', height: '3px', background: 'color-mix(in srgb,var(--color-text) 12%,transparent)', position: 'relative', flex: 'none' }}>
                                          <span style={{ position: 'absolute', inset: '0 auto 0 0', background: 'var(--color-accent)', width: `${C.pct}%` }}></span>
                                        </span>
                                        <span style={{ font: '600 9.5px/1 var(--font-heading)', letterSpacing: '.08em', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', flex: 'none', width: '26px', textAlign: 'right' }}>{C.rotulo}</span>
                                      </div>
      
                                      <div style={{ display: 'flex', flexDirection: 'column', marginTop: '6px' }}>
                                        {(C.atividades || []).map((a, $index) => (<Frag key={$index}>
                                          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '6px 0' }}>
                                            <button onClick={a.toggle} aria-label="Concluir" style={{ flex: 'none', width: '16px', height: '16px', marginTop: '2px', border: '1px solid var(--color-accent)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '0' }}>
                                              {(a.feita) ? (<>
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.4"><path d="M4 12.5l5 5L20 6.5"></path></svg>
                                              </>) : null}
                                            </button>
                                            <button onClick={a.open} style={{ flex: '1', minWidth: '0', textAlign: 'left', background: 'transparent', border: '0', padding: '0', cursor: 'pointer', fontFamily: 'var(--font-body)', color: 'inherit' }}>
                                              <div style={{ fontSize: '12.5px', lineHeight: '1.25', textWrap: 'pretty', opacity: `${a.opacidade}` }}>{a.titulo}</div>
                                              <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
                                                {(a.agendada) ? (<>
                                                  <span className="tag tag-accent" style={{ fontSize: '9.5px' }}>{a.estado}</span>
                                                </>) : null}
                                                {(a.delegada) ? (<>
                                                  <span className="tag tag-neutral" style={{ fontSize: '9.5px' }}>{a.estado}</span>
                                                </>) : null}
                                                {(a.aberta) ? (<>
                                                  <span className="tag tag-outline" style={{ fontSize: '9.5px' }}>Por agendar</span>
                                                </>) : null}
                                                {(a.repete) ? (<>
                                                  <span style={{ fontSize: '9.5px', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>↻ {a.repLabel}</span>
                                                </>) : null}
                                                {(a.temTempo) ? (<>
                                                  <span style={{ fontSize: '9.5px', color: 'var(--color-accent-700)' }}>⏱ {a.tempo}</span>
                                                </>) : null}
                                              </div>
                                            </button>
                                          </div>
                                        </Frag>))}
                                        <button onClick={C.addAtividade} style={{ textAlign: 'left', padding: '6px 0 2px', background: 'transparent', border: '0', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '11.5px', color: 'var(--color-accent-700)' }}>+ Atividade</button>
                                      </div>
                                    </div>
                                  </Frag>))}
                                  <button onClick={L.addCurto} style={{ textAlign: 'left', padding: '6px 0 0', background: 'transparent', border: '0', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '11.5px', color: 'var(--color-accent-700)' }}>+ Objetivo de curto prazo</button>
                                </div>
                              </div>
                            </Frag>))}
                            {(p.vazio) ? (<>
                              <button onClick={p.addLongo} style={{ textAlign: 'left', padding: '12px', background: 'transparent', border: '1px dashed color-mix(in srgb,var(--color-text) 20%,transparent)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--color-accent-700)' }}>+ Objetivo de longo prazo para este papel</button>
                            </>) : null}
                          </div>
                        </div>
                      </Frag>))}
                    </div>
                  </div>
                </>) : null}
      
                {(verPapeis) ? (<>
                  <div style={{ padding: '16px 16px 26px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', marginBottom: '14px' }}>
                      <p style={{ flex: '1', margin: '0', fontSize: '12px', lineHeight: '1.45', color: 'color-mix(in srgb,var(--color-text) 60%,transparent)', textWrap: 'pretty' }}>As áreas em que investe tempo. Livres — edite, reordene ou arquive.</p>
                      <button className="btn btn-primary" onClick={novoPapel} style={{ flex: 'none' }}>Novo papel</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {(papeis || []).map((r, $index) => (<Frag key={$index}>
                        <div className="card blueprint" style={{ flexDirection: 'row', alignItems: 'center', gap: '11px', padding: '12px 11px', background: 'var(--color-bg)' }}>
                          <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
                          <span style={{ width: '26px', height: '26px', background: `${r.cor}`, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 10px var(--font-heading)', letterSpacing: '.06em', color: 'var(--color-bg)' }}>{r.abbr}</span>
                          <span style={{ flex: '1', minWidth: '0' }}>
                            <span style={{ display: 'block', font: '600 15px/1.15 var(--font-heading)', letterSpacing: '.01em' }}>{r.nome}</span>
                            <span style={{ display: 'block', fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginTop: '2px' }}>{r.resumo}</span>
                          </span>
                          <button className="btn btn-secondary btn-icon" onClick={r.subir} aria-label="Subir" style={{ width: '28px', height: '28px', flex: 'none' }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 19V5M5 12l7-7 7 7"></path></svg>
                          </button>
                          <button className="btn btn-secondary btn-icon" onClick={r.arquivar} aria-label="Arquivar" style={{ width: '28px', height: '28px', flex: 'none' }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="4"></rect><path d="M5 8v12h14V8M10 12h4"></path></svg>
                          </button>
                        </div>
                      </Frag>))}
                    </div>
                    {(semPapeis) ? (<>
                      <div style={{ padding: '30px 20px', textAlign: 'center', border: '1px dashed color-mix(in srgb,var(--color-text) 20%,transparent)' }}>
                        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '18px' }}>Sem papéis</div>
                        <p style={{ fontSize: '12px', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)', margin: '5px 0 14px' }}>Comece em branco ou carregue o exemplo Xcento/Magno.</p>
                        <button className="btn btn-primary" onClick={novoPapel}>Criar o primeiro papel</button>
                      </div>
                    </>) : null}
                  </div>
                </>) : null}
      
                {(verRenovar) ? (<>
                  <div style={{ padding: '16px 16px 26px' }}>
                    <p style={{ margin: '0 0 14px', fontSize: '12px', lineHeight: '1.45', color: 'color-mix(in srgb,var(--color-text) 60%,transparent)', textWrap: 'pretty' }}>Afiar a serra: o que renova cada dimensão nesta semana.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {(renovacao || []).map((c, $index) => (<Frag key={$index}>
                        <div className="field">
                          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>
                            <span style={{ width: '14px', height: '1px', background: 'var(--color-accent)' }}></span>{c.rotulo}
                          </label>
                          <textarea className="input" value={c.valor} onChange={c.onChange} placeholder={c.dica} style={{ minHeight: '62px', fontSize: '13px', lineHeight: '1.4', background: 'transparent' }}></textarea>
                        </div>
                      </Frag>))}
                    </div>
                  </div>
                </>) : null}
      
                {(verFecho) ? (<>
                  <div style={{ padding: '16px 16px 26px' }}>
                    <div className="blueprint" style={{ padding: '16px', marginBottom: '18px' }}>
                      <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px' }}>
                        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '52px', lineHeight: '.85', letterSpacing: '-.03em' }}>{pctFeito}<span style={{ fontSize: '22px' }}>%</span></div>
                        <div style={{ flex: '1', paddingBottom: '4px' }}>
                          <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)' }}>Atividades cumpridas</div>
                          <div style={{ fontSize: '13px' }}>{resumoSemana} · {nPendentes} pendentes</div>
                        </div>
                      </div>
                    </div>
      
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px', border: '1px solid var(--color-divider)', marginBottom: '18px', cursor: 'pointer' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" style={{ flex: 'none' }}><path d="M18 8a6 6 0 10-12 0c0 7-2 9-2 9h16s-2-2-2-9"></path><path d="M10.5 21a2 2 0 003 0"></path></svg>
                      <span style={{ flex: '1', minWidth: '0' }}>
                        <span style={{ display: 'block', fontSize: '12.5px', lineHeight: '1.3' }}>Lembrete de planeamento</span>
                        <span style={{ display: 'block', fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginTop: '2px' }}>{lembreteEstado}</span>
                      </span>
                      <input type="checkbox" checked={lembrete} onChange={toggleLembrete} style={{ accentColor: 'var(--color-accent)', width: '16px', height: '16px', flex: 'none' }} />
                    </label>
      
                    <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginBottom: '8px' }}>Progresso dos objetivos de curto prazo</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '20px' }}>
                      {(balanco || []).map((b, $index) => (<Frag key={$index}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                          <span style={{ width: '2px', height: '16px', background: `${b.cor}`, flex: 'none' }}></span>
                          <span style={{ flex: '1', minWidth: '0', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.nome}</span>
                          <span style={{ width: '70px', height: '4px', background: 'color-mix(in srgb,var(--color-text) 10%,transparent)', position: 'relative', flex: 'none' }}>
                            <span style={{ position: 'absolute', inset: '0 auto 0 0', background: 'var(--color-accent)', width: `${b.pct}%` }}></span>
                          </span>
                          <span style={{ font: '600 10px/1 var(--font-heading)', letterSpacing: '.08em', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', width: '28px', textAlign: 'right', flex: 'none' }}>{b.rotulo}</span>
                        </div>
                      </Frag>))}
                    </div>
      
                    <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginBottom: '6px' }}>Pendentes desta semana</div>
                    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '18px' }}>
                      {(pendentes || []).map((p, $index) => (<Frag key={$index}>
                        <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', padding: '9px 0', borderBottom: '1px solid color-mix(in srgb,var(--color-text) 7%,transparent)' }}>
                          <button onClick={p.toggle} aria-label="Concluir" style={{ flex: 'none', width: '18px', height: '18px', marginTop: '1px', border: '1px solid var(--color-accent)', background: 'transparent', cursor: 'pointer', padding: '0' }}></button>
                          <span style={{ flex: '1', minWidth: '0' }}>
                            <span style={{ display: 'block', fontSize: '13px', lineHeight: '1.3', textWrap: 'pretty' }}>{p.titulo}</span>
                            {(p.soEstatistica) ? (<>
                              <span style={{ display: 'block', fontSize: '10px', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginTop: '2px' }}>Recorrente · fica só na estatística</span>
                            </>) : null}
                          </span>
                          <span style={{ font: '600 9.5px/1.6 var(--font-heading)', letterSpacing: '.12em', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', flex: 'none' }}>{p.abbr}</span>
                        </div>
                      </Frag>))}
                      {(tudoFeito) ? (<>
                        <div style={{ padding: '14px 0', fontSize: '12.5px', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)' }}>Nada pendente. Semana fechada.</div>
                      </>) : null}
                    </div>
      
                    {(podeTransitar) ? (<>
                      <button className="btn btn-primary btn-block blueprint" onClick={transitar} style={{ height: '44px' }}>
                        <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
                        Transitar pontuais para {proximaSemana}
                      </button>
                    </>) : null}
                    {(transitado) ? (<>
                      <div style={{ border: '1px solid var(--color-accent)', padding: '12px', fontSize: '12.5px', color: 'var(--color-accent-800)', background: 'color-mix(in srgb,var(--color-accent) 8%,transparent)' }}>{msgTransitado}</div>
                    </>) : null}
                  </div>
                </>) : null}
      
                {(verMissao) ? (<>
                  <div style={{ padding: '18px 16px 26px' }}>
                    <div style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '24px', lineHeight: '1', marginBottom: '4px' }}>Declaração pessoal</div>
                    <p style={{ margin: '0 0 14px', fontSize: '12px', lineHeight: '1.45', color: 'color-mix(in srgb,var(--color-text) 60%,transparent)', textWrap: 'pretty' }}>Seis blocos que sustentam papéis e objetivos. Fica aberta 3 dias para escrever com calma; depois disso, edita-se no máximo uma vez por mês.</p>

                    {(msPorCriar) ? (<>
                      <div style={{ padding: '26px 18px', textAlign: 'center', border: '1px dashed color-mix(in srgb,var(--color-text) 20%,transparent)', marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '18px' }}>Ainda por escrever</div>
                        <p style={{ fontSize: '12px', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)', margin: '5px 0 14px', textWrap: 'pretty' }}>Escreva os seis blocos. Tem 3 dias para ajustar à vontade; depois disso só reabre uma vez por mês.</p>
                        <button className="btn btn-primary" onClick={iniciarMs}>Inserir declaração</button>
                      </div>
                    </>) : null}

                    {(msExiste) ? (<>
                      <div className="blueprint" style={{ padding: '12px', marginBottom: '16px' }}>
                        <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ flex: '1', minWidth: '0' }}>
                            <span style={{ display: 'block', font: '600 9.5px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)' }}>Janela de edição</span>
                            <span style={{ display: 'block', fontSize: '13px', lineHeight: '1.3', textWrap: 'pretty' }}>{msEstado}</span>
                          </span>
                          {(msAberta) ? (<>
                            <span className="tag tag-accent" style={{ flex: 'none' }}>Aberta</span>
                          </>) : null}
                          {(msFechada) ? (<>
                            <span className="tag tag-neutral" style={{ flex: 'none' }}>Bloqueada</span>
                          </>) : null}
                        </div>
                      </div>
      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {(blocosMs || []).map((b, $index) => (<Frag key={$index}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                              <span style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)' }}>{b.rotulo}</span>
                              <span style={{ flex: '1', height: '1px', background: 'var(--color-divider)' }}></span>
                              {(b.temNota) ? (<>
                                <span style={{ font: '600 9px/1.4 var(--font-heading)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>{b.nota}</span>
                              </>) : null}
                            </div>
                            {(b.editavel) ? (<>
                              <textarea className="input" value={b.valor} onChange={b.onChange} placeholder={b.dica} style={{ minHeight: `${b.altura}px`, fontSize: '13.5px', lineHeight: '1.5', background: 'transparent' }}></textarea>
                            </>) : null}
                            {(b.bloqueado) ? (<>
                              <div style={{ position: 'relative', padding: '11px 12px', border: '1px solid var(--color-divider)', background: 'color-mix(in srgb,var(--color-text) 3%,transparent)' }}>
                                <div style={{ fontSize: '13.5px', lineHeight: '1.5', whiteSpace: 'pre-wrap', textWrap: 'pretty', opacity: '.75' }}>{b.valor}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '8px', fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="10" width="16" height="10"></rect><path d="M8 10V7a4 4 0 018 0v3"></path></svg>
                                  {b.motivo}
                                </div>
                              </div>
                            </>) : null}
                          </div>
                        </Frag>))}
                      </div>
      
                      <div style={{ marginTop: '18px' }}>
                        {(msAberta) ? (<>
                          <button className="btn btn-primary btn-block" onClick={guardarMs} style={{ height: '44px' }}>Guardar declaração</button>
                        </>) : null}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                          <span style={{ fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', flex: '1', textWrap: 'pretty' }}>{msRodape}</span>
                          <button className="btn btn-secondary" onClick={fecharMissao}>Voltar</button>
                        </div>
                        <div style={{ marginTop: '22px', paddingTop: '14px', borderTop: '1px solid var(--color-divider)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ flex: '1', minWidth: '0', fontSize: '11px', lineHeight: '1.4', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', textWrap: 'pretty' }}>Sessão iniciada neste iPhone. Terminar obriga a novo login no próximo arranque.</span>
                          <button className="btn btn-secondary" onClick={sair} style={{ flex: 'none' }}>Terminar sessão</button>
                        </div>
                      </div>
                    </>) : null}
                  </div>
                </>) : null}
              </div>
      
              <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderTop: '1px solid var(--color-divider)', background: 'var(--color-bg)', paddingBottom: 'var(--app-tabbar-pb, 26px)' }}>
                <button onClick={irSemana} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '9px 0 7px', background: 'transparent', border: '0', borderTop: `2px solid ${tabSemanaBar}`, cursor: 'pointer', color: `${tabSemanaCor}`, fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="16"></rect><path d="M3 10h18M8 3v4M16 3v4M12 10v11"></path></svg>Semana
                </button>
                <button onClick={irObjetivos} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '9px 0 7px', background: 'transparent', border: '0', borderTop: `2px solid ${tabObjBar}`, cursor: 'pointer', color: `${tabObjCor}`, fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3.5"></circle></svg>Objetivos
                </button>
                <button onClick={irPapeis} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '9px 0 7px', background: 'transparent', border: '0', borderTop: `2px solid ${tabPapeisBar}`, cursor: 'pointer', color: `${tabPapeisCor}`, fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="7" height="7"></rect><rect x="14" y="4" width="7" height="7"></rect><rect x="3" y="15" width="7" height="5"></rect><rect x="14" y="15" width="7" height="5"></rect></svg>Papéis
                </button>
                <button onClick={irRenovar} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '9px 0 7px', background: 'transparent', border: '0', borderTop: `2px solid ${tabRenovarBar}`, cursor: 'pointer', color: `${tabRenovarCor}`, fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12a9 9 0 0114.5-7M21 12a9 9 0 01-14.5 7"></path><path d="M17 2v5h-5M7 22v-5h5"></path></svg>Renovar
                </button>
                <button onClick={irFecho} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '9px 0 7px', background: 'transparent', border: '0', borderTop: `2px solid ${tabFechoBar}`, cursor: 'pointer', color: `${tabFechoCor}`, fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 5h16v16H4z"></path><path d="M8 11l3 3 5-6"></path></svg>Fecho
                </button>
              </div>
      
              {(sheetAberta) ? (<>
                <div onClick={fecharSheet} style={{ position: 'absolute', inset: '0', zIndex: '90', background: 'color-mix(in srgb,var(--color-neutral-900) 45%,transparent)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <div onClick={stopClick} style={{ background: 'var(--color-bg)', borderTop: '1px solid var(--color-accent)', padding: '16px 16px 40px', maxHeight: '680px', overflow: 'auto' }}>
      
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                      <div style={{ flex: '1', font: '600 13px/1.2 var(--font-heading)', letterSpacing: '.14em', textTransform: 'uppercase' }}>{sheetTitulo}</div>
                      <button className="btn btn-secondary btn-icon" onClick={fecharSheet} aria-label="Fechar" style={{ width: '28px', height: '28px' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 6l12 12M18 6L6 18"></path></svg>
                      </button>
                    </div>
      
                    {(sheetAcao) ? (<>
                      <div>
                        <div style={{ fontSize: '15px', lineHeight: '1.3', textWrap: 'pretty', marginBottom: '3px' }}>{alvoTitulo}</div>
                        <div style={{ fontSize: '11px', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '3px' }}>↳ {alvoObjetivo}</div>
                        <div style={{ fontSize: '11px', color: 'var(--color-accent-700)', marginBottom: '14px' }}>{alvoEstado}</div>
                        {(alvoRecorrente) ? (<>
                          <div style={{ border: '1px solid var(--color-divider)', padding: '11px', marginBottom: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                              <span style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)' }}>Tempo gasto</span>
                              <span style={{ flex: '1' }}></span>
                              <span style={{ fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)' }}>{alvoTempoTotal}</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '4px' }}>
                              {(escolhaTempo || []).map((t, $index) => (<Frag key={$index}>
                                <button onClick={t.pick} style={{ padding: '9px 0', border: `1px solid ${t.borda}`, background: `${t.fundo}`, color: `${t.texto}`, cursor: 'pointer', font: '600 11px var(--font-heading)', letterSpacing: '.04em' }}>{t.rotulo}</button>
                              </Frag>))}
                            </div>
                            <div style={{ fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginTop: '7px' }}>Registado nesta ocorrência: {alvoTempoOcorrencia}</div>
                          </div>
                        </>) : null}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                          <button className="btn btn-primary" onClick={irAgendar} style={{ height: '42px' }}>Agendar</button>
                          <button className="btn btn-secondary" onClick={irDelegar} style={{ height: '42px' }}>Delegar</button>
                        </div>
                        <button className="btn btn-secondary btn-block" onClick={alvoToggle}>{alvoToggleLabel}</button>
                        <button className="btn btn-ghost btn-block" onClick={alvoRemover}>Remover do plano</button>
                      </div>
                    </>) : null}
      
                    {(sheetAgendar) ? (<>
                      <div>
                        <div style={{ fontSize: '14px', lineHeight: '1.3', marginBottom: '12px', textWrap: 'pretty' }}>{alvoTitulo}</div>
                        <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>Semana</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '4px', marginBottom: '14px' }}>
                          {(escolhaSemanas || []).map((w, $index) => (<Frag key={$index}>
                            <button onClick={w.pick} style={{ padding: '9px 2px', border: `1px solid ${w.borda}`, background: `${w.fundo}`, color: `${w.texto}`, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '10.5px', lineHeight: '1.2' }}>
                              <span style={{ display: 'block', font: '600 11px var(--font-heading)', letterSpacing: '.06em' }}>{w.rotulo}</span>
                              <span style={{ display: 'block', opacity: '.7', fontSize: '9.5px', marginTop: '2px' }}>{w.datas}</span>
                            </button>
                          </Frag>))}
                        </div>
                        <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>Dia</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px', marginBottom: '14px' }}>
                          {(escolhaDias || []).map((d, $index) => (<Frag key={$index}>
                            <button onClick={d.pick} style={{ padding: '9px 0', border: `1px solid ${d.borda}`, background: `${d.fundo}`, color: `${d.texto}`, cursor: 'pointer', font: '600 12px var(--font-heading)', letterSpacing: '.06em' }}>{d.l}</button>
                          </Frag>))}
                        </div>
                        <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>Hora</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '4px', marginBottom: '14px' }}>
                          {(escolhaHoras || []).map((h, $index) => (<Frag key={$index}>
                            <button onClick={h.pick} style={{ padding: '8px 0', border: `1px solid ${h.borda}`, background: `${h.fundo}`, color: `${h.texto}`, cursor: 'pointer', font: '600 11px var(--font-heading)', letterSpacing: '.04em' }}>{h.rotulo}</button>
                          </Frag>))}
                        </div>
                        <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>Repetição</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '4px', marginBottom: '14px' }}>
                          {(escolhaRep || []).map((r, $index) => (<Frag key={$index}>
                            <button onClick={r.pick} style={{ padding: '9px 0', border: `1px solid ${r.borda}`, background: `${r.fundo}`, color: `${r.texto}`, cursor: 'pointer', font: '600 11px var(--font-heading)', letterSpacing: '.06em' }}>{r.rotulo}</button>
                          </Frag>))}
                        </div>
                        {(repeteAlgo) ? (<>
                          <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>Repete até</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '4px', marginBottom: '14px' }}>
                            {(escolhaAte || []).map((t, $index) => (<Frag key={$index}>
                              <button onClick={t.pick} style={{ padding: '9px 6px', border: `1px solid ${t.borda}`, background: `${t.fundo}`, color: `${t.texto}`, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '11px', lineHeight: '1.2', textAlign: 'left' }}>
                                <span style={{ display: 'block', font: '600 11px var(--font-heading)', letterSpacing: '.06em' }}>{t.rotulo}</span>
                                <span style={{ display: 'block', opacity: '.7', fontSize: '9.5px', marginTop: '2px' }}>{t.datas}</span>
                              </button>
                            </Frag>))}
                          </div>
                        </>) : null}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '11px', border: '1px solid var(--color-divider)', marginBottom: '12px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={sincronizar} onChange={toggleSync} style={{ accentColor: 'var(--color-accent)', width: '16px', height: '16px' }} />
                          <span style={{ fontSize: '12.5px', flex: '1' }}>Enviar para o calendário e notificar</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '11px', border: '1px solid var(--color-divider)', marginBottom: '12px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={lembrarAtividade} onChange={toggleLembrarAtividade} style={{ accentColor: 'var(--color-accent)', width: '16px', height: '16px' }} />
                          <span style={{ fontSize: '12.5px', flex: '1' }}>Notificar-me antes desta atividade (push, mesmo com a app fechada)</span>
                        </label>
                        <button className="btn btn-primary btn-block" onClick={confirmarAgendar} style={{ height: '44px' }}>{labelConfirmarAgendar}</button>
                      </div>
                    </>) : null}
      
                    {(sheetDelegar) ? (<>
                      <div>
                        <div style={{ fontSize: '14px', lineHeight: '1.3', marginBottom: '12px', textWrap: 'pretty' }}>{alvoTitulo}</div>
                        <div className="field" style={{ marginBottom: '12px' }}>
                          <label>Responsável</label>
                          <input className="input" value={respDelegar} onChange={setRespDelegar} placeholder="Nome de quem vai executar" style={{ background: 'transparent' }} />
                        </div>
                        <div className="field" style={{ marginBottom: '12px' }}>
                          <label>Notas para quem executa</label>
                          <textarea className="input" value={notaDelegar} onChange={setNotaDelegar} placeholder="Contexto, prazo, critério de aceitação" style={{ minHeight: '70px', fontSize: '13px', background: 'transparent' }}></textarea>
                        </div>
                        <button className="btn btn-primary btn-block" onClick={confirmarDelegar} style={{ height: '44px' }}>Delegar</button>
                      </div>
                    </>) : null}
      
                    {(sheetNovaAtividade) ? (<>
                      <div>
                        <div style={{ fontSize: '11.5px', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)', marginBottom: '10px' }}>Objetivo de curto prazo · {contextoCurto}</div>
                        <div className="field" style={{ marginBottom: '12px' }}>
                          <label>Atividade</label>
                          <input className="input" value={rascunhoTitulo} onChange={setRascunhoTitulo} placeholder="Ação concreta, com verbo" style={{ background: 'transparent' }} />
                        </div>
                        <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>Quadrante</div>
                        <div style={{ display: 'flex', gap: '5px', marginBottom: '14px' }}>
                          {(escolhaQuad || []).map((q, $index) => (<Frag key={$index}>
                            <button onClick={q.pick} style={{ flex: '1', padding: '11px 8px', border: `1px solid ${q.borda}`, background: `${q.fundo}`, color: `${q.texto}`, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '11.5px', lineHeight: '1.25', textAlign: 'left' }}>{q.rotulo}</button>
                          </Frag>))}
                        </div>
                        <button className="btn btn-primary btn-block" onClick={confirmarNovaAtividade} style={{ height: '44px' }}>Adicionar e agendar</button>
                        <button className="btn btn-secondary btn-block" onClick={confirmarAtividadeAberta}>Guardar por agendar</button>
                      </div>
                    </>) : null}
      
                    {(sheetNovoLongo) ? (<>
                      <div>
                        <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>Papel</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
                          {(escolhaPapeis || []).map((r, $index) => (<Frag key={$index}>
                            <button onClick={r.pick} style={{ padding: '8px 11px', border: `1px solid ${r.borda}`, background: `${r.fundo}`, color: `${r.texto}`, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '12px' }}>{r.nome}</button>
                          </Frag>))}
                        </div>
                        <div className="field" style={{ marginBottom: '12px' }}>
                          <label>Objetivo de longo prazo</label>
                          <input className="input" value={rascunhoTitulo} onChange={setRascunhoTitulo} placeholder="Resultado a atingir em meses" style={{ background: 'transparent' }} />
                        </div>
                        <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>Horizonte</div>
                        <div style={{ display: 'flex', gap: '5px', marginBottom: '14px' }}>
                          {(escolhaHorizonte || []).map((h, $index) => (<Frag key={$index}>
                            <button onClick={h.pick} style={{ flex: '1', padding: '10px 0', border: `1px solid ${h.borda}`, background: `${h.fundo}`, color: `${h.texto}`, cursor: 'pointer', font: '600 11px var(--font-heading)', letterSpacing: '.06em' }}>{h.rotulo}</button>
                          </Frag>))}
                        </div>
                        <button className="btn btn-primary btn-block" onClick={confirmarNovoLongo} style={{ height: '44px' }}>Criar objetivo</button>
                      </div>
                    </>) : null}
      
                    {(sheetNovoCurto) ? (<>
                      <div>
                        <div style={{ fontSize: '11.5px', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)', marginBottom: '10px' }}>Longo prazo · {contextoLongo}</div>
                        <div className="field" style={{ marginBottom: '14px' }}>
                          <label>Objetivo de curto prazo</label>
                          <input className="input" value={rascunhoTitulo} onChange={setRascunhoTitulo} placeholder="Um passo mensurável nas próximas semanas" style={{ background: 'transparent' }} />
                        </div>
                        <button className="btn btn-primary btn-block" onClick={confirmarNovoCurto} style={{ height: '44px' }}>Criar objetivo</button>
                      </div>
                    </>) : null}
      
                    {(sheetNovoPapel) ? (<>
                      <div>
                        <div className="field" style={{ marginBottom: '12px' }}>
                          <label>Nome do papel</label>
                          <input className="input" value={rascunhoNome} onChange={setRascunhoNome} placeholder="ex.: Coordenação de Equipa" style={{ background: 'transparent' }} />
                        </div>
                        <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '6px' }}>Identificação</div>
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                          {(escolhaCores || []).map((c, $index) => (<Frag key={$index}>
                            <button onClick={c.pick} aria-label="Cor" style={{ flex: '1', height: '40px', background: `${c.cor}`, border: `2px solid ${c.borda}`, cursor: 'pointer' }}></button>
                          </Frag>))}
                        </div>
                        <button className="btn btn-primary btn-block" onClick={confirmarNovoPapel} style={{ height: '44px' }}>Criar papel</button>
                      </div>
                    </>) : null}
      
                    {(sheetSlot) ? (<>
                      <div>
                        <div style={{ fontSize: '12.5px', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)', marginBottom: '10px' }}>{slotLegenda}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          {(porAgendar || []).map((m, $index) => (<Frag key={$index}>
                            <button onClick={m.pick} style={{ display: 'flex', gap: '9px', alignItems: 'center', textAlign: 'left', padding: '11px', border: '1px solid var(--color-divider)', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-body)', color: 'inherit' }} data-xho="6">
                              <span style={{ width: '3px', height: '30px', background: `${m.cor}`, flex: 'none' }}></span>
                              <span style={{ flex: '1', minWidth: '0' }}>
                                <span style={{ display: 'block', font: '600 9.5px/1 var(--font-heading)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 50%,transparent)', marginBottom: '3px' }}>{m.abbr}</span>
                                <span style={{ display: 'block', fontSize: '13px', lineHeight: '1.25' }}>{m.titulo}</span>
                                <span style={{ display: 'block', fontSize: '10.5px', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginTop: '2px' }}>{m.objetivo}</span>
                              </span>
                            </button>
                          </Frag>))}
                          {(semPorAgendar) ? (<>
                            <div style={{ padding: '16px', border: '1px dashed color-mix(in srgb,var(--color-text) 20%,transparent)', fontSize: '12.5px', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)', textAlign: 'center' }}>Nada por agendar. Crie uma atividade num objetivo de curto prazo.</div>
                          </>) : null}
                        </div>
                      </div>
                    </>) : null}
                  </div>
                </div>
              </>) : null}
      
              {(temToast) ? (<>
                <div style={{ position: 'absolute', left: '16px', right: '16px', bottom: '96px', zIndex: '95', background: 'var(--color-accent-900)', color: 'var(--color-bg)', padding: '11px 13px', fontSize: '12.5px', letterSpacing: '.01em' }}>{toast}</div>
              </>) : null}
      
              {(temNotif) ? (<>
                <div onClick={abrirNotif} style={{ position: 'absolute', left: '12px', right: '12px', top: '56px', zIndex: '98', background: 'color-mix(in srgb,var(--color-bg) 88%,var(--color-accent))', border: '1px solid var(--color-accent)', boxShadow: 'var(--shadow-md)', padding: '11px 12px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5"><rect x="3" y="5" width="18" height="16"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>
                    <span style={{ font: '600 9.5px/1 var(--font-heading)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--color-accent-700)', flex: '1' }}>Calendário · agora</span>
                    <button onClick={fecharNotif} aria-label="Dispensar" style={{ background: 'transparent', border: '0', cursor: 'pointer', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', padding: '0' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 6l12 12M18 6L6 18"></path></svg>
                    </button>
                  </div>
                  <div style={{ font: '600 13.5px/1.2 var(--font-heading)', letterSpacing: '.01em' }}>{notifTitulo}</div>
                  <div style={{ fontSize: '12px', lineHeight: '1.35', color: 'color-mix(in srgb,var(--color-text) 65%,transparent)', marginTop: '2px', textWrap: 'pretty' }}>{notifCorpo}</div>
                </div>
              </>) : null}
      
              {(verLogin) ? (<>
                <div style={{ position: 'absolute', inset: '0', zIndex: '120', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', padding: '96px 28px 40px' }}>
                  <div style={{ flex: 'none' }}>
                    <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>Quadrante II</div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '40px', lineHeight: '.98', letterSpacing: '-.02em', marginTop: '2px' }}>Agenda<br />semanal</div>
                    <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)', margin: '12px 0 0', textWrap: 'pretty' }}>Primeiro arranque: inicie sessão uma vez. Depois, a app abre ao toque.</p>
                  </div>
                  <div style={{ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '12px' }}>
                    <div className="field">
                      <label>Email</label>
                      <input className="input" value={loginEmailInput} onChange={setLoginEmailInput} style={{ height: '44px', background: 'transparent' }} />
                    </div>
                    <div className="field">
                      <label>Palavra-passe</label>
                      <input className="input" type="password" value={loginSenhaInput} onChange={setLoginSenhaInput} style={{ height: '44px', background: 'transparent' }} />
                    </div>
                    <button className="btn btn-primary btn-block blueprint" onClick={entrar} style={{ height: '48px', marginTop: '6px' }}>
                      <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
                      Entrar
                    </button>
                  </div>
                  <div style={{ flex: 'none', fontSize: '11px', lineHeight: '1.5', color: 'color-mix(in srgb,var(--color-text) 40%,transparent)', textWrap: 'pretty' }}>Sessão guardada neste iPhone. Só volta a pedir credenciais se terminar sessão.</div>
                </div>
              </>) : null}

              {(verTrocarSenha) ? (<>
                <div style={{ position: 'absolute', inset: '0', zIndex: '125', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', padding: '96px 28px 40px' }}>
                  <div style={{ flex: 'none' }}>
                    <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>Primeiro acesso</div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '28px', lineHeight: '1.05', letterSpacing: '-.01em', marginTop: '2px' }}>Escolha uma palavra-passe</div>
                    <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'color-mix(in srgb,var(--color-text) 55%,transparent)', margin: '12px 0 0', textWrap: 'pretty' }}>Por segurança, tem de trocar a palavra-passe inicial antes de continuar. Mínimo 4 caracteres.</p>
                  </div>
                  <div style={{ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '12px' }}>
                    <div className="field">
                      <label>Nova palavra-passe</label>
                      <input className="input" type="password" value={novaSenhaInput} onChange={setNovaSenhaInput} style={{ height: '44px', background: 'transparent' }} />
                    </div>
                    <div className="field">
                      <label>Confirmar palavra-passe</label>
                      <input className="input" type="password" value={confirmarSenhaInput} onChange={setConfirmarSenhaInput} style={{ height: '44px', background: 'transparent' }} />
                    </div>
                    <button className="btn btn-primary btn-block blueprint" onClick={confirmarTrocaSenha} style={{ height: '48px', marginTop: '6px' }}>
                      <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
                      Guardar e entrar
                    </button>
                    <button className="btn btn-ghost btn-block" onClick={cancelarTrocaSenha}>Voltar ao login</button>
                  </div>
                </div>
              </>) : null}
            </div>
    );

    return (
      <Frag>
        <div className="app-mobile-shell">{screen}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '56px', alignItems: 'flex-start', padding: '48px 40px 64px', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', minHeight: '100vh', boxSizing: 'border-box' }} className="app-desktop-shell">
      
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', flex: 'none' }}>
          <div>
            <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)' }}>Protótipo interativo · PWA · v2</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: '600', fontSize: '34px', lineHeight: '1.05', letterSpacing: '-.015em' }}>Papéis → objetivos → atividades</div>
          </div>
      
          <IOSDevice>{screen}</IOSDevice>
        </div>
      
        <div style={{ flex: '1 1 360px', minWidth: '0', maxWidth: '430px', display: 'flex', flexDirection: 'column', gap: '26px', paddingTop: '6px' }}>
          <div>
            <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginBottom: '8px' }}>Correção ao modelo</div>
            <p style={{ fontSize: '14px', lineHeight: '1.5', margin: '0 0 10px', textWrap: 'pretty' }}>A v1 agendava metas. Esta versão agenda <strong>atividades</strong>, e a cadeia completa é visível na app: <strong>papel → objetivo de longo prazo → objetivos de curto prazo → atividades</strong>. Cada bloco na agenda mostra a que objetivo pertence, para que nada entre na semana sem origem.</p>
            <p style={{ fontSize: '14px', lineHeight: '1.5', margin: '0', textWrap: 'pretty' }}>O separador <em>Objetivos</em> é essa árvore. As barras nos objetivos de curto prazo medem atividades concluídas — é assim que o progresso sobe do dia para o objetivo.</p>
          </div>
      
          <div>
            <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginBottom: '8px' }}>Recorrência e semanas futuras</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: '10px', fontSize: '13.5px', lineHeight: '1.45' }}>
                <span style={{ font: '600 12px/1.5 var(--font-heading)', color: 'var(--color-accent-700)' }}>01</span>
                <span><strong>A folha de agendamento começa pela semana.</strong> Quatro semanas à frente, com datas reais; depois dia, hora e repetição. Agendar para daqui a três semanas custa dois toques.</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: '10px', fontSize: '13.5px', lineHeight: '1.45' }}>
                <span style={{ font: '600 12px/1.5 var(--font-heading)', color: 'var(--color-accent-700)' }}>02</span>
                <span><strong>Recorrência: nunca, semanal, quinzenal, dias úteis.</strong> Uma atividade recorrente reaparece em todas as semanas seguintes e é concluída por ocorrência — marcar segunda não marca a segunda seguinte.</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: '10px', fontSize: '13.5px', lineHeight: '1.45' }}>
                <span style={{ font: '600 12px/1.5 var(--font-heading)', color: 'var(--color-accent-700)' }}>03</span>
                <span><strong>“Por agendar” é um estado legítimo.</strong> Atividades nascem no objetivo e podem esperar; ficam listadas no fim da semana e no seletor do <em>+</em> de cada hora.</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: '10px', fontSize: '13.5px', lineHeight: '1.45' }}>
                <span style={{ font: '600 12px/1.5 var(--font-heading)', color: 'var(--color-accent-700)' }}>05</span>
                <span><strong>A recorrência termina numa data.</strong> 4, 8 ou 12 semanas — ou sem fim, para hábitos. A data de fim aparece na folha de agendamento e no estado da atividade.</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: '10px', fontSize: '13.5px', lineHeight: '1.45' }}>
                <span style={{ font: '600 12px/1.5 var(--font-heading)', color: 'var(--color-accent-700)' }}>04</span>
                <span><strong>O fecho conta ocorrências da semana</strong>, não objetivos — os objetivos movem-se ao ritmo das atividades que os alimentam.</span>
              </div>
            </div>
          </div>
      
          <div>
            <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginBottom: '8px' }}>Experimente</div>
            <ul style={{ margin: '0', paddingLeft: '17px', fontSize: '13.5px', lineHeight: '1.6' }}>
              <li>Avance uma semana com a seta: as recorrentes continuam lá, as pontuais não.</li>
              <li>Objetivos → <strong>+ Atividade</strong> num curto prazo → agendar para <em>+2 sem</em>.</li>
              <li>Abra uma atividade recorrente e mude a repetição para <em>Dias úteis</em>.</li>
              <li>Conclua atividades e veja subir a barra do objetivo de curto prazo.</li>
            </ul>
          </div>
      
          <div>
            <div style={{ font: '600 10px/1.4 var(--font-heading)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'color-mix(in srgb,var(--color-text) 45%,transparent)', marginBottom: '8px' }}>Por decidir consigo</div>
            <ul style={{ margin: '0', paddingLeft: '17px', fontSize: '13.5px', lineHeight: '1.6', color: 'color-mix(in srgb,var(--color-text) 72%,transparent)' }}>
              <li>O lembrete de domingo deve abrir direto no fecho de semana ou na grelha?</li>
              <li>Notificação também no sábado da janela da declaração — mesma hora?</li>
            </ul>
            <p style={{ fontSize: '13px', lineHeight: '1.5', margin: '12px 0 0', color: 'color-mix(in srgb,var(--color-text) 60%,transparent)' }}>Desenhado só para iPhone 16 Pro (402 × 874 pt). A v1 continua em <em>Agenda Semanal.dc.html</em>.</p>
          </div>
        </div>
      </div>
      </Frag>
    );
  }
}

export default App;
