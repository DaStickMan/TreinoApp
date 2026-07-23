// app.js — bootstrap do PWA: registro do service worker, navegação por abas,
// carregamento do plano. As telas completas chegam nas próximas etapas.

const App = {
  plano: null,
  view: 'treino',
};

// ---------- utilidades ----------
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------- carregamento do plano ----------
async function loadPlano() {
  const res = await fetch('data/plano.json');
  if (!res.ok) throw new Error('Falha ao carregar plano.json');
  App.plano = await res.json();
  return App.plano;
}

// ---------- navegação por abas ----------
const VIEWS = ['treino', 'historico', 'dados'];

function switchView(name) {
  if (!VIEWS.includes(name)) return;
  App.view = name;
  VIEWS.forEach((v) => {
    $(`#view-${v}`).classList.toggle('hidden', v !== name);
  });
  $all('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  renderView(name);
}

function bindTabs() {
  $all('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
}

// ---------- render (placeholders da Etapa 2) ----------
function renderView(name) {
  if (name === 'treino') renderTreino();
  else if (name === 'historico') renderHistorico();
  else if (name === 'dados') renderDados();
}

function renderTreino() {
  renderTreinoView();
}

// ---------- helpers de estado / plano ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function getFaseAtual() {
  const faseId = await DB.getState('faseAtual', 1);
  return App.plano.fases.find((f) => f.id === faseId) || App.plano.fases[0];
}

async function getRotacaoIndex() {
  return await DB.getState('rotacaoIndex', 0);
}

function unidade(tipoMedida) {
  return tipoMedida === 'segundos' ? 's' : 'reps';
}

// ---------- sessão ativa ----------
// Uma sessão é criada ao registrar a 1ª série. É retomada se o app fechar.
// Chave estável de exercício dentro de um treino: bloco.tipo + '::' + nome.
function exKey(bloco, ex) { return `${bloco.tipo}::${ex.nome}`; }

async function getSessaoAtiva() {
  return await DB.getState('sessaoAtiva', null);
}

// Garante uma sessão ativa para (fase, treino). Se a ativa for de outro treino,
// mantém assim mesmo (o usuário pode ter realocado); o id carrega fase+treino+ts.
async function getOrCreateSessao(fase, treino) {
  let ativa = await getSessaoAtiva();
  if (ativa && ativa.treinoTipo === treino.tipo && ativa.faseId === fase.id) {
    return ativa;
  }
  if (ativa) return ativa; // sessão de outro treino ainda aberta: reaproveita até concluir
  const nova = {
    id: `${treino.tipo}-${Date.now()}`,
    faseId: fase.id,
    faseNome: fase.nome,
    rir: fase.rir,
    treinoTipo: treino.tipo,
    treinoNome: treino.nome,
    startedAt: Date.now(),
    status: 'em_andamento',
  };
  await DB.putSession(nova);
  await DB.setState('sessaoAtiva', nova);
  return nova;
}

// Carrega as séries já registradas da sessão num mapa: { exKey: { serie: valor } }.
async function carregarSetsMapa(sessionId) {
  const sets = await DB.getSetsBySession(sessionId);
  const mapa = {};
  sets.forEach((s) => {
    if (!mapa[s.exKey]) mapa[s.exKey] = {};
    mapa[s.exKey][s.serie] = s;
  });
  return mapa;
}

// ---------- lógica de fase / proximidade do teste ----------
// Retorna { estado: 'longe'|'proximo'|'no_teste', restantes, teste }.
async function statusTeste(fase) {
  const feitos = await DB.getState('treinosNaFase', 0);
  const alvo = fase.treinosParaTeste || 20;
  const teste = App.plano.testes.find((t) => t.id === fase.testeId) || null;
  const restantes = alvo - feitos;
  let estado = 'longe';
  if (restantes <= 0) estado = 'no_teste';
  else if (restantes <= 1) estado = 'proximo'; // último treino antes do teste
  return { estado, restantes, teste, feitos, alvo };
}

// ---------- render: treino do dia ----------
async function renderTreinoView() {
  const el = $('#view-treino');
  const fase = await getFaseAtual();
  const idx = await getRotacaoIndex();
  const treino = Rotacao.treinoPorIndice(App.plano, fase.id, idx);
  const tipoAtual = Rotacao.tipoPorIndice(App.plano, idx);

  setTopbarPhase(`Fase ${fase.id} · RIR ${fase.rir}`);

  if (!treino) {
    el.innerHTML = `<div class="card"><h2>Sem treino</h2><p class="muted">Não foi possível montar o treino do dia.</p></div>`;
    return;
  }

  const totalEx = Rotacao.contarExercicios(treino);
  const sessao = await getOrCreateSessao(fase, treino);
  const setsMapa = await carregarSetsMapa(sessao.id);
  const st = await statusTeste(fase);

  // Banner de proximidade / entrada no teste.
  let banner = '';
  if (st.estado === 'no_teste' && st.teste) {
    banner = `
      <div class="card banner banner-teste">
        <h2>✅ Dia de teste — Fase ${fase.id}</h2>
        <p class="muted">Você completou os ${st.alvo} treinos da fase. O teste substitui o treino normal de hoje.</p>
        <button id="btn-ir-teste" class="btn">Ir para o teste da Fase ${fase.id} →</button>
      </div>`;
  } else if (st.estado === 'proximo' && st.teste) {
    banner = `
      <div class="card banner banner-aviso">
        <h2>⚠️ Teste próximo</h2>
        <p class="muted">Este é o último treino antes do teste da Fase ${fase.id}. Depois de concluí-lo, o dia de teste aparecerá aqui.</p>
      </div>`;
  }

  // Seletor de treino (realocação manual): botões A/B/C.
  const seletor = App.plano.meta.rotacao.map((tp) => {
    const t = fase.treinos.find((x) => x.tipo === tp);
    const ativo = tp === tipoAtual ? ' active' : '';
    return `<button class="chip${ativo}" data-tipo="${tp}">${tp} · ${escapeHtml(t ? t.nome : '')}</button>`;
  }).join('');

  const blocosHtml = treino.blocos.map((bloco) => {
    const exsHtml = bloco.exercicios.map((ex) => {
      const vid = App.plano.videos[ex.video];
      const linkVideo = vid ? `<a class="video-link" href="${vid}" target="_blank" rel="noopener">▶ vídeo</a>` : '';
      const alt = ex.alternativa ? `<div class="ex-alt muted">Sem parede: ${escapeHtml(ex.alternativa)}</div>` : '';
      const key = exKey(bloco, ex);
      const registradas = setsMapa[key] || {};
      const un = unidade(ex.tipoMedida);
      const ehTempo = ex.tipoMedida === 'segundos';
      const btnCrono = ehTempo
        ? `<button class="btn-crono" data-seg="${ex.reps}">⏲ Cronometrar ${ex.reps}s</button>`
        : '';

      // Um input por série prescrita. Placeholder = alvo (reps ou segundos).
      const seriesHtml = Array.from({ length: ex.series }, (_, i) => {
        const serie = i + 1;
        const reg = registradas[serie];
        const val = reg && reg.valor != null ? reg.valor : '';
        const filled = val !== '' ? ' filled' : '';
        return `
          <div class="serie">
            <span class="serie-label">S${serie}</span>
            <input type="number" inputmode="numeric" min="0" class="serie-input${filled}"
              value="${val}" placeholder="${ex.reps}"
              data-key="${escapeHtml(key)}" data-bloco="${bloco.tipo}"
              data-nome="${escapeHtml(ex.nome)}" data-serie="${serie}"
              data-medida="${ex.tipoMedida}">
            <span class="serie-unidade">${un}</span>
          </div>`;
      }).join('');

      return `
        <div class="ex">
          <div class="ex-head">
            <span class="ex-nome">${escapeHtml(ex.nome)}</span>
            ${linkVideo}
          </div>
          <div class="ex-meta muted">${escapeHtml(ex.prescricao)} · descanso ${ex.descanso_s}s</div>
          ${alt}
          <div class="series">${seriesHtml}</div>
          <div class="ex-actions">
            ${btnCrono}
            <button class="btn-rest" data-descanso="${ex.descanso_s}">⏱ Descanso ${ex.descanso_s}s</button>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="card bloco">
        <div class="bloco-head">
          <h2>${escapeHtml(bloco.titulo)}</h2>
          <span class="muted">${bloco.duracao_min} min</span>
        </div>
        ${exsHtml}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="card treino-head">
      <div class="treino-title">
        <h2>Treino ${treino.tipo} · ${escapeHtml(treino.nome)}</h2>
        <span class="muted">${totalEx} exercícios · Fase ${fase.id} (${escapeHtml(fase.nome)}) · RIR ${fase.rir}</span>
      </div>
      <div class="seletor-treino">${seletor}</div>
    </div>
    ${banner}
    ${blocosHtml}
    <button id="btn-concluir" class="btn">Concluir treino ${treino.tipo} → próximo</button>
    <p class="muted center" style="margin-top:10px">Cada série é salva na hora. Faltou um dia? O próximo treino só avança quando você concluir.</p>
  `;

  // Realocação manual.
  $all('.chip', el).forEach((chip) => {
    chip.addEventListener('click', async () => {
      const novoIdx = Rotacao.indicePorTipo(App.plano, chip.dataset.tipo);
      if (novoIdx >= 0) { await DB.setState('rotacaoIndex', novoIdx); renderTreinoView(); }
    });
  });

  // Registro por série: SALVAMENTO IMEDIATO a cada mudança.
  $all('.serie-input', el).forEach((input) => {
    input.addEventListener('change', async () => {
      const raw = input.value.trim();
      const s = await getSessaoAtiva();
      if (!s) return;
      const setRec = {
        sessionId: s.id,
        exKey: input.dataset.key,
        exercicioNome: input.dataset.nome,
        bloco: input.dataset.bloco,
        treinoTipo: s.treinoTipo,
        faseId: s.faseId,
        serie: Number(input.dataset.serie),
        valor: raw === '' ? null : Number(raw),
        tipoMedida: input.dataset.medida,
      };
      // upsert por (sessionId, exKey, serie): busca id existente.
      const existentes = await DB.getSetsBySession(s.id);
      const jaTem = existentes.find((x) => x.exKey === setRec.exKey && x.serie === setRec.serie);
      if (jaTem) setRec.id = jaTem.id;
      await DB.putSet(setRec);
      input.classList.toggle('filled', raw !== '');
    });
  });

  // Timer de descanso por exercício.
  $all('.btn-rest', el).forEach((btn) => {
    btn.addEventListener('click', () => RestTimer.start(Number(btn.dataset.descanso), { label: 'Descanso' }));
  });

  // Cronômetro para exercícios de tempo. Primeiro mostra 5s de preparação,
  // depois inicia a contagem regressiva do exercício.
  $all('.btn-crono', el).forEach((btn) => {
    btn.addEventListener('click', () => RestTimer.start(Number(btn.dataset.seg), { label: 'Exercício', prep: true }));
  });

  // Entrada no dia de teste.
  const btnTeste = $('#btn-ir-teste', el);
  if (btnTeste) btnTeste.addEventListener('click', () => renderTesteView(fase, st.teste));

  // Concluir treino: finaliza a sessão e avança a rotação.
  $('#btn-concluir', el).addEventListener('click', async () => {
    const s = await getSessaoAtiva();
    if (s) {
      const sets = await DB.getSetsBySession(s.id);
      const comValor = sets.filter((x) => x.valor != null).length;
      if (comValor === 0 && !confirm('Nenhuma série registrada. Concluir mesmo assim?')) return;
      await DB.putSession({ ...s, finishedAt: Date.now(), status: 'concluida', totalSeries: comValor });
      await DB.setState('sessaoAtiva', null);
    }
    const atual = await getRotacaoIndex();
    const prox = Rotacao.proximoIndice(App.plano, atual);
    await DB.setState('rotacaoIndex', prox);
    const feitos = (await DB.getState('treinosNaFase', 0)) + 1;
    await DB.setState('treinosNaFase', feitos);
    RestTimer.stop();
    toast(`Treino ${Rotacao.tipoPorIndice(App.plano, atual)} concluído. Próximo: ${Rotacao.tipoPorIndice(App.plano, prox)}.`);
    renderTreinoView();
  });
}

// ---------- render: dia de teste guiado ----------
async function renderTesteView(fase, teste) {
  const el = $('#view-treino');
  const itensHtml = teste.itens.map((it) => {
    const un = it.tipoMedida === 'segundos' ? 's' : (it.tipoMedida === 'reps' ? 'reps' : '');
    let campo;
    if (it.tipoMedida === 'manual') {
      campo = `
        <div class="teste-manual" data-ordem="${it.ordem}">
          <button class="chip manual-btn" data-ordem="${it.ordem}" data-val="1">Aprovado</button>
          <button class="chip manual-btn" data-ordem="${it.ordem}" data-val="0">Reprovado</button>
        </div>`;
    } else {
      campo = `
        <div class="serie">
          <input type="number" inputmode="numeric" min="0" class="teste-input"
            data-ordem="${it.ordem}" placeholder="${it.criterioValor}">
          <span class="serie-unidade">${un}</span>
        </div>`;
    }
    return `
      <div class="card teste-item" data-ordem="${it.ordem}">
        <div class="ex-head"><span class="ex-nome">${it.ordem}. ${escapeHtml(it.nome)}</span></div>
        <div class="ex-meta muted">${escapeHtml(it.protocolo)}</div>
        <div class="ex-alt">Aprovação: ${escapeHtml(it.criterioTexto)}</div>
        <div class="teste-campo">${campo}</div>
        <div class="teste-status muted"></div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="card treino-head">
      <h2>${escapeHtml(teste.nome)}</h2>
      <p class="muted">${escapeHtml(teste.regra)}</p>
      <button id="btn-voltar-treino" class="btn secondary small" style="width:auto;margin-top:8px">← Voltar ao treino</button>
    </div>
    ${itensHtml}
    <button id="btn-avaliar" class="btn">Avaliar resultado</button>
    <div id="teste-resultado"></div>
  `;

  // guarda entradas em memória durante a avaliação
  const entradas = {};

  $all('.manual-btn', el).forEach((btn) => {
    btn.addEventListener('click', () => {
      const ordem = btn.dataset.ordem;
      entradas[ordem] = { aprovadoManual: btn.dataset.val === '1' };
      // destaca seleção
      $all(`.manual-btn[data-ordem="${ordem}"]`, el).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  $('#btn-voltar-treino', el).addEventListener('click', () => renderTreinoView());

  $('#btn-avaliar', el).addEventListener('click', async () => {
    // coleta inputs numéricos
    $all('.teste-input', el).forEach((inp) => {
      const v = inp.value.trim();
      entradas[inp.dataset.ordem] = { valor: v === '' ? null : Number(v) };
    });
    const avaliacao = TesteLogica.avaliar(teste, entradas);
    const decisao = TesteLogica.decidirTransicao(teste, avaliacao);

    // pinta status por item
    avaliacao.itens.forEach((res) => {
      const card = $(`.teste-item[data-ordem="${res.ordem}"]`, el);
      const stEl = $('.teste-status', card);
      stEl.textContent = res.aprovado ? '✔ aprovado' : '✗ não atingido';
      stEl.className = 'teste-status ' + (res.aprovado ? 'ok-text' : 'danger-text');
    });

    // salva resultado
    const resultados = await DB.getState('resultadosTestes', {});
    resultados[teste.id] = {
      testeId: teste.id, faseDe: teste.faseDe, fasePara: teste.fasePara,
      ts: Date.now(), entradas, itens: avaliacao.itens,
      todosAprovados: avaliacao.todosAprovados, reprovados: avaliacao.reprovados,
      decisao,
    };
    await DB.setState('resultadosTestes', resultados);

    // bloco de decisão
    const box = $('#teste-resultado', el);
    let msg = '';
    if (decisao.motivo === 'aprovado') {
      msg = `<div class="card banner banner-teste"><h2>Aprovado! 🎉</h2>
        <p class="muted">Você passou em todos os itens.</p>
        <button id="btn-avancar" class="btn">Avançar para a Fase ${teste.fasePara} →</button></div>`;
    } else if (decisao.motivo === 'deload_obrigatorio') {
      msg = `<div class="card banner banner-aviso"><h2>Avançar para o deload</h2>
        <p class="muted">A Fase 4 (deload) é obrigatória. ${decisao.foco.length ? 'Foco prioritário: ' + decisao.foco.map(escapeHtml).join(', ') + '.' : ''}</p>
        <button id="btn-avancar" class="btn">Avançar para a Fase ${teste.fasePara} →</button></div>`;
    } else if (decisao.motivo === 'ciclo_final') {
      msg = `<div class="card banner banner-teste"><h2>Teste final registrado</h2>
        <p class="muted">Resultados salvos. Use-os para definir o próximo ciclo.</p>
        <button id="btn-voltar2" class="btn secondary">Voltar ao treino</button></div>`;
    } else {
      msg = `<div class="card banner banner-danger"><h2>Ainda não 💪</h2>
        <p class="muted">Itens a melhorar: ${decisao.foco.map(escapeHtml).join(', ')}. Repita a semana da fase focando esses itens e refaça o teste.</p>
        <button id="btn-voltar2" class="btn secondary">Voltar ao treino</button></div>`;
    }
    box.innerHTML = msg;
    box.scrollIntoView({ behavior: 'smooth', block: 'end' });

    const btnAvancar = $('#btn-avancar', box);
    if (btnAvancar) btnAvancar.addEventListener('click', () => avancarFase(teste.fasePara));
    const btnVoltar2 = $('#btn-voltar2', box);
    if (btnVoltar2) btnVoltar2.addEventListener('click', () => renderTreinoView());
  });
}

// Avança para a fase indicada: zera contador de treinos e a rotação segue de onde parou.
async function avancarFase(novaFaseId) {
  await DB.setState('faseAtual', novaFaseId);
  await DB.setState('treinosNaFase', 0);
  await DB.setState('sessaoAtiva', null);
  const fase = App.plano.fases.find((f) => f.id === novaFaseId);
  toast(`Agora na Fase ${novaFaseId}${fase ? ' · ' + fase.nome : ''}.`);
  renderTreinoView();
}

function renderHistorico() {
  renderHistoricoView();
}

// ---------- histórico ----------
const HistState = { aba: 'sessoes', exercicio: null };

function fmtData(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

async function renderHistoricoView() {
  const el = $('#view-historico');
  const abas = [
    ['sessoes', 'Sessões'],
    ['exercicio', 'Por exercício'],
    ['fase', 'Por fase'],
  ].map(([id, label]) => `<button class="chip${HistState.aba === id ? ' active' : ''}" data-aba="${id}">${label}</button>`).join('');

  el.innerHTML = `
    <div class="card"><div class="seletor-treino">${abas}</div></div>
    <div id="hist-conteudo"></div>`;

  $all('.chip', el).forEach((chip) => {
    chip.addEventListener('click', () => { HistState.aba = chip.dataset.aba; renderHistoricoView(); });
  });

  if (HistState.aba === 'sessoes') await renderHistSessoes();
  else if (HistState.aba === 'exercicio') await renderHistExercicio();
  else await renderHistFase();
}

async function renderHistSessoes() {
  const box = $('#hist-conteudo');
  const sessoes = (await DB.getAllSessions()).filter((s) => s.status === 'concluida');
  if (!sessoes.length) {
    box.innerHTML = `<div class="card"><p class="muted">Nenhum treino concluído ainda. Conclua um treino para vê-lo aqui.</p></div>`;
    return;
  }
  box.innerHTML = sessoes.map((s) => `
    <div class="card sessao-card" data-id="${escapeHtml(s.id)}">
      <div class="ex-head">
        <span class="ex-nome">Treino ${s.treinoTipo} · ${escapeHtml(s.treinoNome || '')}</span>
        <span class="muted">${fmtData(s.finishedAt || s.startedAt)}</span>
      </div>
      <div class="ex-meta muted">Fase ${s.faseId}${s.faseNome ? ' (' + escapeHtml(s.faseNome) + ')' : ''} · RIR ${s.rir ?? '—'} · ${s.totalSeries ?? 0} séries</div>
    </div>`).join('');

  $all('.sessao-card', box).forEach((c) => {
    c.addEventListener('click', () => renderSessaoDetalhe(c.dataset.id));
  });
}

async function renderSessaoDetalhe(sessionId) {
  const box = $('#hist-conteudo');
  const s = await DB.getSession(sessionId);
  const sets = await DB.getSetsBySession(sessionId);
  // agrupa por exercício (exKey), ordenando por série
  const grupos = {};
  sets.forEach((x) => {
    if (!grupos[x.exKey]) grupos[x.exKey] = { nome: x.exercicioNome, series: [] };
    grupos[x.exKey].series.push(x);
  });
  const gruposHtml = Object.values(grupos).map((g) => {
    g.series.sort((a, b) => a.serie - b.serie);
    const vals = g.series.map((x) => x.valor != null ? x.valor : '–').join(', ');
    const un = g.series[0] && g.series[0].tipoMedida === 'segundos' ? 's' : 'reps';
    return `<div class="ex"><div class="ex-nome">${escapeHtml(g.nome)}</div><div class="ex-meta muted">${vals} ${un}</div></div>`;
  }).join('') || '<p class="muted">Sem séries registradas.</p>';

  box.innerHTML = `
    <div class="card">
      <button id="btn-voltar-hist" class="btn secondary small" style="width:auto">← Voltar</button>
      <h2 style="margin-top:10px">Treino ${s.treinoTipo} · ${escapeHtml(s.treinoNome || '')}</h2>
      <p class="muted">${fmtData(s.finishedAt || s.startedAt)} · Fase ${s.faseId} · RIR ${s.rir ?? '—'}</p>
    </div>
    <div class="card">${gruposHtml}</div>`;
  $('#btn-voltar-hist', box).addEventListener('click', () => { HistState.aba = 'sessoes'; renderHistoricoView(); });
}

// coleta todos os nomes de exercícios presentes no plano (ordenados).
function todosExerciciosDoPlano() {
  const set = new Set();
  App.plano.fases.forEach((f) => f.treinos.forEach((t) => t.blocos.forEach((b) => b.exercicios.forEach((ex) => set.add(ex.nome)))));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt'));
}

// mini-gráfico SVG de uma série de pontos (sem libs).
function sparkline(pontos, w = 300, h = 80) {
  if (!pontos.length) return '';
  const max = Math.max(...pontos);
  const min = Math.min(...pontos);
  const range = max - min || 1;
  const pad = 6;
  const stepX = pontos.length > 1 ? (w - pad * 2) / (pontos.length - 1) : 0;
  const coords = pontos.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const linha = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ' ' + c[1].toFixed(1)).join(' ');
  const dots = coords.map((c) => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="3" fill="#38bdf8"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <path d="${linha}" fill="none" stroke="#38bdf8" stroke-width="2"/>${dots}</svg>`;
}

async function renderHistExercicio() {
  const box = $('#hist-conteudo');
  const nomes = todosExerciciosDoPlano();
  if (!HistState.exercicio) HistState.exercicio = nomes[0];
  const options = nomes.map((n) => `<option value="${escapeHtml(n)}"${n === HistState.exercicio ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('');

  const sets = (await DB.getSetsByExercicio(HistState.exercicio)).filter((x) => x.valor != null);
  // agrupa por sessão, somando/registrando por data
  const porSessao = {};
  sets.forEach((x) => {
    if (!porSessao[x.sessionId]) porSessao[x.sessionId] = [];
    porSessao[x.sessionId].push(x);
  });
  // ordena sessões pela data (usa o ts do 1º set como aproximação)
  const linhas = Object.entries(porSessao).map(([sid, arr]) => {
    arr.sort((a, b) => a.serie - b.serie);
    const ts = Math.min(...arr.map((a) => a.ts || 0));
    const total = arr.reduce((acc, a) => acc + a.valor, 0);
    const melhor = Math.max(...arr.map((a) => a.valor));
    const un = arr[0].tipoMedida === 'segundos' ? 's' : 'reps';
    return { ts, total, melhor, un, vals: arr.map((a) => a.valor) };
  }).sort((a, b) => a.ts - b.ts);

  let conteudo;
  if (!linhas.length) {
    conteudo = `<div class="card"><p class="muted">Sem registros para "${escapeHtml(HistState.exercicio)}" ainda.</p></div>`;
  } else {
    const un = linhas[0].un;
    const graf = sparkline(linhas.map((l) => l.total));
    const lista = linhas.slice().reverse().map((l) => `
      <div class="ex">
        <div class="ex-head"><span>${fmtData(l.ts)}</span><span class="muted">total ${l.total} ${un}</span></div>
        <div class="ex-meta muted">${l.vals.join(', ')} · melhor ${l.melhor} ${un}</div>
      </div>`).join('');
    conteudo = `
      <div class="card"><h2 style="margin-top:0">Evolução (total por treino)</h2>${graf}
        <p class="muted center">${linhas.length} treino(s) registrados</p></div>
      <div class="card">${lista}</div>`;
  }

  box.innerHTML = `
    <div class="card">
      <label class="muted" for="sel-ex">Exercício</label>
      <select id="sel-ex" class="select">${options}</select>
    </div>
    ${conteudo}`;
  $('#sel-ex', box).addEventListener('change', (e) => { HistState.exercicio = e.target.value; renderHistExercicio(); });
}

async function renderHistFase() {
  const box = $('#hist-conteudo');
  const sessoes = (await DB.getAllSessions()).filter((s) => s.status === 'concluida');
  const resultados = await DB.getState('resultadosTestes', {});
  const faseAtual = await DB.getState('faseAtual', 1);
  const treinosNaFase = await DB.getState('treinosNaFase', 0);

  const cards = App.plano.fases.map((f) => {
    const feitos = sessoes.filter((s) => s.faseId === f.id).length;
    const r = resultados[f.testeId];
    let testeInfo = '<span class="muted">teste não realizado</span>';
    if (r) {
      const okN = r.itens.filter((i) => i.aprovado).length;
      const cor = r.todosAprovados ? 'ok-text' : 'danger-text';
      testeInfo = `<span class="${cor}">teste: ${okN}/${r.itens.length} itens · ${fmtData(r.ts)}</span>`;
    }
    const atual = f.id === faseAtual ? ' ← atual' : '';
    return `<div class="card">
      <div class="ex-head"><span class="ex-nome">Fase ${f.id} · ${escapeHtml(f.nome)}${atual}</span><span class="muted">RIR ${f.rir}</span></div>
      <div class="ex-meta muted">${feitos} treino(s) concluídos${f.id === faseAtual ? ' · ' + treinosNaFase + '/' + (f.treinosParaTeste || 20) + ' até o teste' : ''}</div>
      <div class="ex-alt">${testeInfo}</div>
    </div>`;
  }).join('');
  box.innerHTML = cards;
}

function renderDados() {
  renderDadosView();
}

// ---------- utilitários de download / import ----------
function baixarArquivo(nome, conteudo, mime) {
  const blob = new Blob([conteudo], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function carimboArquivo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function renderDadosView() {
  const el = $('#view-dados');
  const sessoes = (await DB.getAllSessions()).filter((s) => s.status === 'concluida');
  const resultados = await DB.getState('resultadosTestes', {});
  const nTestes = Object.keys(resultados).length;

  el.innerHTML = `
    <div class="card">
      <h2>Backup completo</h2>
      <p class="muted">Salva TUDO (treinos, séries, fase, testes) num arquivo <strong>.json</strong>. Use para trocar de celular ou restaurar. Guarde no Google Drive/e-mail.</p>
      <div class="stack">
        <button id="btn-export-json" class="btn">⬇ Exportar backup (.json)</button>
        <button id="btn-import-json" class="btn secondary">⬆ Importar backup (.json)</button>
        <input id="file-import" type="file" accept="application/json,.json" class="hidden">
      </div>
    </div>

    <div class="card">
      <h2>Exportar resultados (.csv)</h2>
      <p class="muted">Abre no Google Sheets/Excel para analisar sua evolução. Uma linha por série.</p>
      <div class="stack">
        <button id="btn-csv-treinos" class="btn">📊 Treinos — ${sessoes.length} sessão(ões)</button>
        <button id="btn-csv-testes" class="btn">🏆 Testes — ${nTestes} realizado(s)</button>
      </div>
    </div>

    <div class="card">
      <h2>Zona de risco</h2>
      <p class="muted">Apaga TODO o seu progresso deste aparelho. Não dá para desfazer. Faça um backup antes.</p>
      <button id="btn-wipe" class="btn" style="background:var(--danger);color:#fff">🗑 Apagar todos os dados</button>
    </div>

    <p class="muted center">Seus dados ficam só neste aparelho. "Limpar cache" do navegador não apaga; só "limpar dados do site" ou desinstalar.</p>
  `;

  // Backup JSON
  $('#btn-export-json', el).addEventListener('click', async () => {
    const dump = await DB.exportAll();
    baixarArquivo(`treino-backup-${carimboArquivo()}.json`, JSON.stringify(dump, null, 2), 'application/json');
    toast('Backup gerado.');
  });

  $('#btn-import-json', el).addEventListener('click', () => $('#file-import', el).click());
  $('#file-import', el).addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const texto = await file.text();
      const data = JSON.parse(texto);
      if (data.app !== 'treino-calistenia') {
        if (!confirm('Este arquivo não parece um backup deste app. Importar mesmo assim?')) return;
      }
      if (!confirm('Importar vai SUBSTITUIR os dados atuais deste aparelho. Continuar?')) return;
      await DB.importAll(data, { replace: true });
      await DB.setState('sessaoAtiva', null);
      toast('Backup importado com sucesso.');
      renderDadosView();
    } catch (err) {
      console.error(err);
      toast('Falha ao importar: arquivo inválido.');
    } finally {
      e.target.value = '';
    }
  });

  // CSV treinos
  $('#btn-csv-treinos', el).addEventListener('click', async () => {
    const allSessions = await DB.getAllSessions();
    const dump = await DB.exportAll();
    const csv = Exportar.treinosCSV(allSessions, dump.sets);
    baixarArquivo(`treino-treinos-${carimboArquivo()}.csv`, csv, 'text/csv');
    toast('CSV de treinos gerado.');
  });

  // CSV testes
  $('#btn-csv-testes', el).addEventListener('click', async () => {
    const res = await DB.getState('resultadosTestes', {});
    const csv = Exportar.testesCSV(res, App.plano.testes);
    baixarArquivo(`treino-testes-${carimboArquivo()}.csv`, csv, 'text/csv');
    toast('CSV de testes gerado.');
  });

  // Apagar tudo
  $('#btn-wipe', el).addEventListener('click', async () => {
    if (!confirm('APAGAR todos os dados deste aparelho? Isso não pode ser desfeito.')) return;
    if (!confirm('Tem certeza mesmo? Faça um backup antes se não tiver.')) return;
    await DB.wipe();
    await ensureInitialState();
    toast('Todos os dados foram apagados.');
    renderDadosView();
  });
}

function setTopbarPhase(text) {
  $('#topbar-phase').textContent = text || '';
}

// ---------- notificador (Notification API + Service Worker) ----------
// Exibe notificações mesmo quando o app está em background.
const Notifier = {
  _permission: false,
  _timerEndInfo: null, // { endTime, label } para detectar timer perdido

  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') {
      this._permission = true;
      return true;
    }
    if (Notification.permission === 'denied') return false;
    try {
      const result = await Notification.requestPermission();
      this._permission = result === 'granted';
      return this._permission;
    } catch (_) { return false; }
  },

  // Registra o fim esperado do timer para verificação ao voltar de background.
  setTimerEnd(endTime, label) {
    this._timerEndInfo = { endTime, label };
  },

  clearTimerEnd() {
    this._timerEndInfo = null;
  },

  // Chamado quando o usuário volta ao app: se o timer já venceu, notifica.
  // Usa _notified para evitar duplicar com _finish() que roda logo depois.
  checkMissedTimer() {
    const info = this._timerEndInfo;
    if (!info) return;
    if (info._notified) return;
    if (Date.now() >= info.endTime) {
      info._notified = true;
      this.showNotification(
        'Tempo encerrado!',
        info.label ? `${info.label} finalizado.` : 'Timer finalizado.'
      );
    }
  },

  showNotification(title, body) {
    if (!this._permission) return;
    try {
      // Tenta enviar pelo Service Worker (melhor integração com o sistema)
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'TIMER_END',
          title,
          body,
        });
      } else {
        // Fallback: Notification API direta
        const n = new Notification(title, {
          body,
          icon: './icons/icon-192.png',
          vibrate: [300, 100, 300],
        });
        setTimeout(() => n.close(), 8000);
      }
    } catch (_) { /* silencioso */ }
  },
};

// ---------- timer (descanso e exercícios de tempo) ----------
// Usa Date.now() para contar o tempo, garantindo precisão mesmo quando o app
// volta de background ou a tela é desbloqueada (setInterval é congelado pelo
// navegador em segundo plano, mas o relógio do sistema não para).
const RestTimer = {
  remaining: 0,
  interval: null,
  endTime: null,       // timestamp-alvo (Date.now()) para fim da fase atual
  isPrep: false,       // true = fase de preparação (antes do exercício)
  prepNextSeconds: 0,  // duração do exercício após a preparação
  prepNextLabel: '',   // label do exercício após a preparação
  lastBeepSecond: -1,  // controle para não repetir bip no mesmo segundo
  el: null,
  timeEl: null,
  labelEl: null,
  audioCtx: null,

  _refs() {
    this.el = this.el || document.getElementById('rest-timer');
    this.timeEl = this.timeEl || document.getElementById('rest-time');
    this.labelEl = this.labelEl || document.querySelector('#rest-timer .rest-label');
  },
  _fmt(s) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  },
  // Toca um beep (Web Audio). vol 0..1. Reaproveita o AudioContext.
  _beep(freq, dur, vol) {
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square'; // mais audível que senoide
      o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t);
      o.stop(t + dur);
    } catch (_) {}
  },
  _vibrar(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {} },

  _paint() {
    this._refs();
    this.timeEl.textContent = this._fmt(Math.max(0, this.remaining));
    const ending = this.remaining <= 3 && this.remaining > 0;
    this.timeEl.classList.toggle('ending', ending);
    // Destaque visual da fase de preparação
    this.el.classList.toggle('prep', this.isPrep);
    this.labelEl.classList.toggle('prep', this.isPrep);
  },

  // Verifica e dispara beeps/vibração nos segundos 3, 2, 1
  _checkBeep() {
    if (this.remaining >= 1 && this.remaining <= 3 && this.lastBeepSecond !== this.remaining) {
      this.lastBeepSecond = this.remaining;
      this._beep(880, 0.18, 0.5);
      this._vibrar(120);
    }
  },

  // seconds: duração; opts: { label, onEnd, prep }
  //   label — texto exibido durante o timer
  //   onEnd — callback ao finalizar (não usado na transição prep→exercício)
  //   prep  — se true, mostra 5s de "Preparação" antes do timer real
  start(seconds, opts = {}) {
    this._refs();
    clearInterval(this.interval);
    this.interval = null;
    this.onEnd = opts.onEnd || null;
    this.lastBeepSecond = -1;

    if (opts.prep) {
      // Fase de preparação: 5 segundos
      this.isPrep = true;
      this.prepNextSeconds = Math.max(1, seconds | 0);
      this.prepNextLabel = opts.label || 'Exercício';
      this.labelEl.textContent = 'Preparação';
      this.endTime = Date.now() + 5000;
      this.remaining = 5;
    } else {
      this.isPrep = false;
      this.labelEl.textContent = opts.label || 'Descanso';
      this.endTime = Date.now() + Math.max(1, seconds | 0) * 1000;
      this.remaining = Math.max(1, seconds | 0);
      // Registra no Notifier o fim do timer (para notificação em background)
      Notifier.setTimerEnd(this.endTime, opts.label || 'Descanso');
    }

    this.el.classList.remove('hidden');
    // "destrava" o áudio no gesto do usuário (necessário no Android).
    this._beep(0, 0.01, 0.0001);
    this._paint();
    this.interval = setInterval(() => this._tick(), 200);
  },

  // Chamado a cada ~200ms. Recalcula o tempo real com Date.now().
  _tick() {
    const now = Date.now();
    const newRemaining = Math.max(0, Math.ceil((this.endTime - now) / 1000));
    this.remaining = newRemaining;
    this._paint();

    if (newRemaining <= 0) {
      if (this.isPrep) {
        // Preparação terminou → inicia o exercício automaticamente
        this.isPrep = false;
        this.labelEl.textContent = this.prepNextLabel;
        this.endTime = Date.now() + this.prepNextSeconds * 1000;
        this.remaining = this.prepNextSeconds;
        this.lastBeepSecond = -1;
        // Registra o fim real do exercício para notificação
        Notifier.setTimerEnd(this.endTime, this.prepNextLabel);
        this._paint();
        // Bip de transição: mais longo para indicar "começou!"
        this._beep(880, 0.25, 0.6);
        this._vibrar(250);
      } else {
        this._finish();
      }
      return;
    }

    this._checkBeep();
  },

  add(delta) {
    if (!this.interval) return;
    // Durante a preparação, ignora ajustes manuais (não faz sentido adiantar
    // ou atrasar a preparação).
    if (this.isPrep) return;
    const novo = Math.max(1, this.remaining + delta);
    this.remaining = novo;
    this.endTime = Date.now() + novo * 1000;
    this._paint();
  },

  _finish() {
    clearInterval(this.interval);
    this.interval = null;
    this.endTime = null;
    // Marca como notificado antes de _finish rodar (evita duplicar via checkMissedTimer)
    if (Notifier._timerEndInfo) Notifier._timerEndInfo._notified = true;
    Notifier.clearTimerEnd();
    // Notificação: avisa que o tempo acabou (mesmo em background via SW)
    Notifier.showNotification(
      'Tempo encerrado!',
      (this.labelEl ? this.labelEl.textContent + ' finalizado.' : 'Timer finalizado.')
    );
    // beep final: mais grave, mais longo e mais alto.
    this._beep(1320, 0.15, 0.6);
    setTimeout(() => this._beep(660, 0.55, 0.7), 120);
    this._vibrar([300, 100, 300]);
    const cb = this.onEnd; this.onEnd = null;
    toast('Tempo encerrado!');
    if (cb) { try { cb(); } catch (_) {} }
    setTimeout(() => this.stop(), 1200);
  },

  stop() {
    clearInterval(this.interval);
    this.interval = null;
    this.onEnd = null;
    this.endTime = null;
    this.isPrep = false;
    Notifier.clearTimerEnd();
    this._refs();
    if (this.el) this.el.classList.add('hidden');
  },

  bindControls() {
    document.getElementById('rest-minus').addEventListener('click', () => this.add(-15));
    document.getElementById('rest-plus').addEventListener('click', () => this.add(15));
    document.getElementById('rest-stop').addEventListener('click', () => this.stop());
  },
};

// ---------- service worker ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Falha ao registrar SW:', err);
    });
  });
}

// ---------- estado inicial ----------
// Garante que o estado base exista na primeira abertura.
async function ensureInitialState() {
  const fase = await DB.getState('faseAtual', null);
  if (fase === null) {
    await DB.setState('faseAtual', 1);          // começa na Fase 1
    await DB.setState('rotacaoIndex', 0);       // 0=A, 1=B, 2=C
    await DB.setState('treinosNaFase', 0);      // treinos concluídos na fase atual
    await DB.setState('resultadosTestes', {});  // { [testeId]: {...} }
  }
}

// ---------- init ----------
async function init() {
  bindTabs();
  RestTimer.bindControls();
  registerSW();

  // Pede permissão de notificação (não bloqueia o resto se negar)
  Notifier.requestPermission().then((granted) => {
    if (granted) console.log('Notificações permitidas');
  });

  // Monitora volta de background: se o timer venceu enquanto estava fora, notifica
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      Notifier.checkMissedTimer();
    }
  });

  try {
    await DB.ready;
    await DB.requestPersistence();   // reduz risco de despejo dos dados
    await ensureInitialState();
    await loadPlano();
    const faseId = await DB.getState('faseAtual', 1);
    const fase = App.plano.fases.find((f) => f.id === faseId) || App.plano.fases[0];
    setTopbarPhase(`Fase ${fase.id} · RIR ${fase.rir}`);
  } catch (err) {
    toast('Erro ao carregar o plano.');
    console.error(err);
  }
  switchView('treino');
}

window.App = App;
document.addEventListener('DOMContentLoaded', init);
