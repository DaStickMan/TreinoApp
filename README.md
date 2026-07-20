# Treino Calistenia — PWA (16 semanas)

App pessoal, **100% gratuito e offline**, para acompanhar o plano de calistenia de 16 semanas.
Sem contas, sem servidor: seus dados ficam **só no seu aparelho** (IndexedDB).

## O que o app faz
- Mostra o **treino do dia** da rotação PPL contínua (A→B→C), com realocação manual se você faltar.
- **Registra reps série por série** (salvamento imediato — não perde progresso ao trocar de app).
- **Timer de descanso** por exercício (com vibração/beep ao fim).
- **Dia de teste guiado** ao fim de cada fase: você preenche e o app avalia se passou.
- **Histórico**: sessões, evolução por exercício (mini-gráfico) e resumo por fase.
- **Backup** (.json) e **exportar resultados** (.csv para Sheets/Excel).

## Estrutura
```
app/
├── index.html          casca + navegação
├── manifest.json       metadados do PWA
├── sw.js               service worker (offline)
├── css/styles.css
├── js/
│   ├── db.js           IndexedDB (salvamento imediato)
│   ├── rotacao.js      lógica da rotação PPL
│   ├── teste.js        avaliação dos dias de teste
│   ├── exportar.js     geração de CSV
│   └── app.js          telas e ligação
├── data/plano.json     o plano completo (fases, treinos, testes)
└── icons/              ícones do app
```

## Como usar no Android (grátis)

Você precisa servir a pasta `app/` por **HTTPS** (PWA exige HTTPS, exceto em `localhost`).
Opções gratuitas — escolha uma:

### Opção A — GitHub Pages (recomendado, grátis)
1. Crie um repositório no GitHub e envie o conteúdo da pasta `app/` para a raiz dele.
2. Em **Settings → Pages**, selecione a branch (ex.: `main`) e pasta `/root`. Salve.
3. Em ~1 min o GitHub te dá uma URL `https://SEU_USUARIO.github.io/SEU_REPO/`.
4. Abra essa URL no **Chrome do Android**.

### Opção B — Netlify / Cloudflare Pages (grátis)
- Arraste a pasta `app/` no painel do Netlify (netlify.com) ou conecte o repo no Cloudflare Pages.
- Ele gera uma URL HTTPS automaticamente.

### Instalar como app
1. Abra a URL no **Chrome** do Android.
2. Menu (⋮) → **"Adicionar à tela inicial"** / **"Instalar app"**.
3. O ícone aparece na tela inicial; abre em tela cheia, sem barra do navegador.
4. Depois de abrir **uma vez com internet**, o app funciona **offline** (praça sem sinal).

## Sobre não perder dados
- Trocar de app, background, reiniciar o celular: **mantém** os dados.
- "Limpar cache" do navegador: **mantém** os dados (só re-baixa o app).
- "Limpar dados do site" ou desinstalar: **apaga** — por isso use **Backup (.json)** de tempos em tempos (aba Dados) e guarde no Google Drive.

## Atualizar o plano
Edite `data/plano.json` e **incremente `CACHE_VERSION`** em `sw.js` (ex.: `treino-v6` → `treino-v7`) para o app buscar a nova versão.
