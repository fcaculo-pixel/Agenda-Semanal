# Agenda Semanal — app

Versão real (Vite) do protótipo que está em `../codigo`. Mesmo `App.jsx` e
`IOSFrame.jsx`, agora como módulos ES normais, com build de produção e
persistência em `localStorage`.

    app/
      src/App.jsx        a aplicação (estado + ecrãs) — export default App
      src/IOSFrame.jsx   moldura do iPhone — export default IOSDevice
      src/app.css        estilos globais e estados :hover
      src/industry.css   design system Industry (tokens + .btn .card .blueprint .tag)
      src/main.jsx       ponto de entrada (createRoot)

## Correr

    npm install
    npm run dev

Build de produção:

    npm run build
    npm run preview

## No iPhone

Há dois ecrãs (ambos no mesmo `App.jsx`, trocados só por CSS — ver
`.app-mobile-shell` / `.app-desktop-shell` em `src/app.css`):

- **< 768px de largura** (telemóvel real, ou a app instalada): ecrã cheio,
  sem a moldura decorativa de iPhone, com padding a respeitar o notch/Dynamic
  Island real (`env(safe-area-inset-*)`, ativado por `viewport-fit=cover`).
- **≥ 768px** (browser de secretária): mantém a demo original, com a moldura
  de iPhone e os painéis de explicação ao lado.

A app é também um **PWA instalável**: tem `manifest.webmanifest`, ícones
(`public/icons/`, gerados por `scripts/generate-icons.mjs`) e service worker
(via `vite-plugin-pwa`), pelo que dá para abrir no Safari do iPhone e
"Adicionar ao Ecrã Principal" — fica com ícone próprio e abre em ecrã cheio,
sem a barra do Safari, e funciona offline depois da primeira visita (o
service worker só regista fora do `npm run dev`; usar `build` + `preview`).

Para testar no iPhone a partir deste computador, ambos têm de estar na
mesma rede Wi-Fi:

    npm run build
    npm run preview:lan

Isto imprime um endereço `http://<ip-da-rede-local>:4173` — abrir esse
endereço no Safari do iPhone, depois usar o botão Partilhar → **Adicionar
ao Ecrã Principal**. Funciona só enquanto este computador estiver ligado e
na mesma rede; para um link permanente (acessível de qualquer lado, sem
depender do PC), é preciso publicar a build num serviço de alojamento
(ex.: Vercel, Netlify) — nesse caso a app fica acessível fora da rede local.

## Login e primeiro acesso

Conta única, guardada em `state.auth` (`email`, `passHash`, `mustChangePassword`):

- Arranque de fábrica: `fcaculo@icloud.com` / `12345`, com `mustChangePassword: true`.
- No primeiro login correto, é obrigatório escolher uma palavra-passe nova
  (mínimo 4 caracteres) antes de entrar — ecrã "Escolha uma palavra-passe".
- A palavra-passe nunca fica em texto simples: é comparada por hash
  (SHA-256 + sal fixo, `hashPassword()`, `AUTH_SALT`) guardado no
  `localStorage` do telemóvel.
- **Isto não é segurança a sério** — é só um bloqueio de ecrã. Não há
  servidor a validar nada; alguém com acesso às ferramentas de programador
  do telemóvel consegue contornar. Para segurança real seria preciso um
  backend a validar o login.
- Logo após trocar a palavra-passe (ou no primeiro login, se já não precisar
  de a trocar), se a Declaração pessoal ainda não existir, a app abre
  automaticamente nesse ecrã.

## Declaração pessoal (Missão)

Substitui o ciclo bimestral de demonstração por datas reais
(`msCriadoEm`, `msUltimaEdicaoEm`, ambos timestamps):

- Ao guardar pela primeira vez, fica **3 dias** completamente editável
  (pode guardar quantas vezes quiser).
- Passados os 3 dias, só pode voltar a guardar **uma vez a cada 30 dias**
  a partir da última edição.
- As datas mostradas (`fmtData()`) são calculadas a partir desses
  timestamps — nada está fixo no calendário como no protótipo original.

## Dados de exemplo

O `DEFAULT_STATE` já não tem papéis/objetivos/atividades fictícios — arrays
e objetos começam vazios (`roles`, `longos`, `curtos`, `acts`, `ms`, `renov`,
etc.). A app já foi desenhada para suportar este estado vazio (mensagens
"sem papéis" / "nada agendado"), por isso um utilizador novo começa mesmo do
zero e constrói os seus próprios papéis, objetivos e atividades pelos ecrãs
"+ Papel" / "+ Objetivo" / "+ Atividade".

## Notificações push (precisa de configuração no Vercel)

Duas fontes de aviso, ambas via Web Push real (chegam ao iPhone mesmo com
a app fechada, desde que instalada — "Adicionar ao Ecrã Principal" —
em iOS 16.4+):

- **Lembrete semanal**: toggle "Lembrete de planeamento" no ecrã Fecho —
  dispara domingo às 14h00 (hora do próprio telemóvel, detetada
  automaticamente).
- **Por atividade**: checkbox "Notificar-me antes desta atividade" na
  folha de agendar — avisa ~15 min antes da hora marcada.

Arquitetura: `src/sw.js` (service worker customizado, com `push` e
`notificationclick`) + `api/subscribe.js` (guarda a subscrição e a lista
do que precisa de aviso) + `api/send-reminders.js` (envia os pushes) +
`api/_kv.js` (guarda subscrição/definições/marcas de "já enviado" como
pequenos ficheiros JSON no **Vercel Blob** — loja privada
`agenda-semanal-kv`, ligada ao projeto). **Nada disto funciona só com
`npm run dev`** — só corre publicado no Vercel.

Já está tudo configurado no projeto (`fcpp/agenda-semanal`):

- Loja Blob `agenda-semanal-kv` criada e ligada (injeta
  `BLOB_READ_WRITE_TOKEN` sozinha).
- `VAPID_PRIVATE_KEY` e `CRON_SECRET` guardadas como env vars secretas
  (Production/Preview/Development) — os valores não ficam em lado nenhum
  do código nem deste README. Se for preciso ver ou trocar, `vercel env
  ls` / `vercel env add … --value "…" --sensitive --force`.
- A chave pública VAPID (não é secreta) está hardcoded em `src/App.jsx` e
  em `api/send-reminders.js` — as duas têm de ser sempre a mesma. Se um
  dia gerar um par de chaves novo (`web-push`'s `generateVAPIDKeys()`),
  atualize as duas.

**Sem cron do Vercel**: o plano gratuito (Hobby) só permite cron **uma
vez por dia**, o que não chega para avisos de 15 em 15 minutos — por
isso o projeto não tem `vercel.json`. Em vez disso, um workflow do
**GitHub Actions** (`.github/workflows/send-reminders.yml`) chama o
endpoint a cada 15 min. Para ativar:

1. Publicar este repositório no GitHub (idealmente **público** — Actions
   é gratuito e ilimitado em repositórios públicos; em privados o plano
   grátis tem só 2000 min/mês, e correr a cada 15 min gasta ~2880/mês).
2. Em *Settings → Secrets and variables → Actions* do repositório,
   adicionar um secret `CRON_SECRET` com o mesmo valor que está no
   Vercel (`vercel env ls` não mostra o valor — se precisar dele outra
   vez, `vercel env add CRON_SECRET … --force` para o substituir por um
   novo, e atualizar os dois lados).
3. O workflow começa a correr sozinho a partir do primeiro push; também
   dá para disparar à mão em *Actions → Send reminders → Run workflow*.

## Persistência

`App.jsx` guarda o estado em `localStorage` sob a chave `agenda-semanal:v1`
(ver `PERSIST_KEYS`, `loadPersisted`, `savePersisted`). Fica guardado tudo o
que é dado — papéis, objetivos, atividades, concluídas, tempos, sessão — e
não o que é UI efémera (sheet aberta, toast, notificação). A escrita é
debounced (300ms) em `componentDidUpdate`.

Para recomeçar do zero, apagar a chave no DevTools:
`localStorage.removeItem('agenda-semanal:v1')`.

## Estrutura do App.jsx

Ver a explicação detalhada em `../codigo/README.md` (recorrência, chaves de
ocorrência, `renderVals()` vs `render()`) — mantém-se igual, só mudou o
transporte (import/export em vez de scripts globais).
