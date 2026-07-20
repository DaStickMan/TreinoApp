// teste.js — lógica pura de avaliação dos dias de teste (transição de fase).
// Sem DOM/DB para ser testável isoladamente.

const TesteLogica = {
  // Avalia um item numérico com base no critério do plano.
  // itens 'manual' não têm avaliação automática (o usuário marca aprovado/reprovado).
  avaliarItem(item, entrada) {
    // entrada: { valor?: number, aprovadoManual?: boolean }
    if (item.tipoMedida === 'manual') {
      return entrada && entrada.aprovadoManual === true;
    }
    if (entrada == null || entrada.valor == null || entrada.valor === '') return false;
    const v = Number(entrada.valor);
    if (Number.isNaN(v)) return false;
    switch (item.criterio) {
      case '>=': return v >= item.criterioValor;
      case '>': return v > item.criterioValor;
      case '<=': return v <= item.criterioValor;
      case '<': return v < item.criterioValor;
      case '==': return v === item.criterioValor;
      default: return false;
    }
  },

  // Avalia o teste inteiro. Retorna { itens:[{ordem,nome,aprovado}], todosAprovados, reprovados }.
  avaliar(teste, entradas) {
    // entradas: { [ordem]: { valor?, aprovadoManual? } }
    const itens = teste.itens.map((it) => ({
      ordem: it.ordem,
      nome: it.nome,
      aprovado: this.avaliarItem(it, entradas[it.ordem]),
    }));
    const reprovados = itens.filter((i) => !i.aprovado).map((i) => i.nome);
    return { itens, todosAprovados: reprovados.length === 0, reprovados };
  },

  // Decide o resultado da transição de fase conforme as regras do plano.
  // Fase 3 -> 4 SEMPRE avança (deload obrigatório), mesmo reprovando.
  // Demais: só avança se todos aprovados.
  decidirTransicao(teste, avaliacao) {
    if (teste.faseDe === 3) {
      return { avancar: true, motivo: 'deload_obrigatorio', foco: avaliacao.reprovados };
    }
    if (teste.fasePara == null) {
      // teste final: não há próxima fase; apenas registra.
      return { avancar: false, motivo: 'ciclo_final', foco: avaliacao.reprovados };
    }
    if (avaliacao.todosAprovados) {
      return { avancar: true, motivo: 'aprovado', foco: [] };
    }
    return { avancar: false, motivo: 'reprovado', foco: avaliacao.reprovados };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = TesteLogica;
if (typeof window !== 'undefined') window.TesteLogica = TesteLogica;
