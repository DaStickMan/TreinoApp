// exportar.js — geração de CSV a partir dos dados locais.
// Funções puras (recebem dados, retornam string) para facilitar teste.

const Exportar = {
  // Escapa um campo CSV (aspas duplas, vírgula, quebra de linha).
  csvCampo(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  },

  linha(campos) { return campos.map((c) => this.csvCampo(c)).join(','); },

  fmtData(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  // CSV de treinos: uma linha por SÉRIE registrada.
  // sessions: [{id, faseId, faseNome, rir, treinoTipo, treinoNome, finishedAt, startedAt, status}]
  // sets: [{sessionId, exercicioNome, bloco, serie, valor, tipoMedida}]
  treinosCSV(sessions, sets) {
    const byId = {};
    sessions.forEach((s) => { byId[s.id] = s; });
    const header = ['data', 'fase', 'fase_nome', 'rir', 'treino', 'treino_nome', 'bloco', 'exercicio', 'serie', 'valor', 'unidade'];
    const linhas = [this.linha(header)];
    // ordena por data da sessão, depois exercício/série
    const ordenados = sets.slice().sort((a, b) => {
      const sa = byId[a.sessionId] || {}; const sb = byId[b.sessionId] || {};
      const ta = sa.finishedAt || sa.startedAt || 0;
      const tb = sb.finishedAt || sb.startedAt || 0;
      if (ta !== tb) return ta - tb;
      if (a.exercicioNome !== b.exercicioNome) return String(a.exercicioNome).localeCompare(String(b.exercicioNome));
      return a.serie - b.serie;
    });
    ordenados.forEach((x) => {
      const s = byId[x.sessionId] || {};
      // só exporta séries de sessões concluídas e com valor preenchido
      if (s.status !== 'concluida') return;
      if (x.valor == null) return;
      const un = x.tipoMedida === 'segundos' ? 's' : 'reps';
      linhas.push(this.linha([
        this.fmtData(s.finishedAt || s.startedAt),
        s.faseId, s.faseNome, s.rir,
        s.treinoTipo, s.treinoNome,
        x.bloco, x.exercicioNome, x.serie, x.valor, un,
      ]));
    });
    return linhas.join('\n');
  },

  // CSV de testes: uma linha por ITEM de cada teste realizado.
  // resultados: { [testeId]: {testeId, faseDe, fasePara, ts, itens:[{ordem,nome,aprovado}], entradas, todosAprovados} }
  // planoTestes: array de testes do plano (para pegar critérios/protocolo).
  testesCSV(resultados, planoTestes) {
    const header = ['data', 'teste_id', 'fase_de', 'fase_para', 'item', 'exercicio', 'criterio', 'valor_registrado', 'aprovado', 'todos_aprovados'];
    const linhas = [this.linha(header)];
    const testeById = {};
    (planoTestes || []).forEach((t) => { testeById[t.id] = t; });

    Object.values(resultados || {}).forEach((r) => {
      const teste = testeById[r.testeId] || { itens: [] };
      r.itens.forEach((it) => {
        const def = (teste.itens || []).find((x) => x.ordem === it.ordem) || {};
        const entrada = (r.entradas || {})[it.ordem] || {};
        const valorReg = entrada.valor != null ? entrada.valor
          : (entrada.aprovadoManual != null ? (entrada.aprovadoManual ? 'aprovado(manual)' : 'reprovado(manual)') : '');
        linhas.push(this.linha([
          this.fmtData(r.ts),
          r.testeId, r.faseDe, r.fasePara,
          it.ordem, it.nome,
          def.criterioTexto || '',
          valorReg,
          it.aprovado ? 'sim' : 'nao',
          r.todosAprovados ? 'sim' : 'nao',
        ]));
      });
    });
    return linhas.join('\n');
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = Exportar;
if (typeof window !== 'undefined') window.Exportar = Exportar;
