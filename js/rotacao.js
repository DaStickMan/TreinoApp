// rotacao.js — lógica pura da rotação PPL contínua e da fase atual.
// Sem dependência de DOM/DB para ser testável isoladamente.
//
// Estado relevante (persistido pelo DB):
//   faseAtual   : id da fase (1..4)
//   rotacaoIndex: 0=A, 1=B, 2=C — aponta o PRÓXIMO treino a fazer.
//
// Regra de falta: faltar um dia NÃO altera nada. O "próximo treino" só avança
// quando uma sessão é concluída. Assim a rotação nunca pula um treino.

const Rotacao = {
  // Retorna o objeto treino (A/B/C) do plano para uma fase e índice.
  treinoPorIndice(plano, faseId, index) {
    const fase = plano.fases.find((f) => f.id === faseId);
    if (!fase) return null;
    const tipo = plano.meta.rotacao[index % plano.meta.rotacao.length]; // 'A'|'B'|'C'
    return fase.treinos.find((t) => t.tipo === tipo) || null;
  },

  // Índice seguinte na rotação (0->1->2->0...).
  proximoIndice(plano, index) {
    const n = plano.meta.rotacao.length;
    return (index + 1) % n;
  },

  // Tipo (A/B/C) a partir do índice.
  tipoPorIndice(plano, index) {
    return plano.meta.rotacao[index % plano.meta.rotacao.length];
  },

  // Índice a partir do tipo (para realocação manual).
  indicePorTipo(plano, tipo) {
    return plano.meta.rotacao.indexOf(tipo);
  },

  // Conta exercícios de um treino (todos os blocos).
  contarExercicios(treino) {
    if (!treino) return 0;
    return treino.blocos.reduce((acc, b) => acc + b.exercicios.length, 0);
  },
};

// Exporta tanto para browser (window) quanto para Node (testes).
if (typeof module !== 'undefined' && module.exports) module.exports = Rotacao;
if (typeof window !== 'undefined') window.Rotacao = Rotacao;
