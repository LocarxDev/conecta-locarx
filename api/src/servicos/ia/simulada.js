// IA SIMULADA — só para testes no computador (IA_SIMULADA=1, nunca em produção).
// Imita o comportamento do assistente usando as mesmas ferramentas, sem chamar Anthropic/OpenAI.
export async function simularIa({ historico, ferramentas }) {
  const usadas = [];
  const usar = async (nome, args) => { usadas.push(nome); const f = ferramentas.find((x) => x.nome === nome); return f ? f.executar(args) : 'sem ferramenta'; };
  const ultima = [...historico].reverse().find((h) => h.papel === 'cliente')?.texto || '';
  const t = ultima.toLowerCase();
  // anota informações e etiquetas como a IA de verdade faria
  if (/\bsuv\b/.test(t) && ferramentas.some((f) => f.nome === 'salvar_informacoes')) await usar('salvar_informacoes', { informacoes: { carro_desejado: 'SUV', motivo: /uber|99/.test(t) ? 'aplicativo' : undefined } });
  if (/\buber\b|\b99\b/.test(t) && ferramentas.some((f) => f.nome === 'aplicar_etiqueta')) await usar('aplicar_etiqueta', { etiquetas: ['Aplicativo'] });
  let texto;
  const dadosCliente = { nome: 'Ana Paula Souza', cpf: '529.982.247-25', email: 'ana@exemplo.com' };
  if (/fechar/.test(t) && ferramentas.some((f) => f.nome === 'criar_reserva')) {
    const d = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), e = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await usar('calcular_preco', { fleet_id: 102, data_retirada: d, hora_retirada: '10:00', data_devolucao: e, hora_devolucao: '10:00', protecoes: ['PROTECAO_X'] });
    const r = await usar('criar_reserva', { ...dadosCliente, cliente_confirmou: true });  // a IA tenta pular a confirmação: o sistema devolve o resumo
    texto = String(r).includes('Resumo') ? String(r).split('\n\n').slice(1).join('\n\n') + '\n\nPosso confirmar a reserva?' : String(r);
  } else if (/confirmo/.test(t) && ferramentas.some((f) => f.nome === 'criar_reserva')) {
    const r = await usar('criar_reserva', { ...dadosCliente, cliente_confirmou: true });
    if (r?.reserva_criada) { await usar('chamar_atendente', { motivo: 'reserva criada' }); texto = `Reserva feita! Código ${r.codigo}. Total ${r.total}, pagamento na loja.`; }
    else texto = String(r).slice(0, 300);
  } else if (!t.includes('?') && /reserv|carro|alugar/.test(t) && ferramentas.some((f) => f.nome === 'consultar_disponibilidade')) {
    const d = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), e = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const r = await usar('consultar_disponibilidade', { data_retirada: d, hora_retirada: '10:00', data_devolucao: e, hora_devolucao: '10:00' }).catch((x) => x.message);
    texto = typeof r === 'string' ? r : r.texto_para_cliente;
  } else if (t.includes('?') || /cau[cç][aã]o|document|cnh|idade|km|quilometr/.test(t)) {
    const r = await usar('buscar_informacoes', { pergunta: ultima });
    if (String(r).startsWith('Nada encontrado')) {
      await usar('chamar_atendente', { motivo: 'informação não encontrada', sem_resposta: true, pergunta: ultima });
      texto = 'Vou confirmar essa informação com um atendente da loja, só um instante.';
    } else texto = 'Pelas nossas regras: ' + String(r).replace(/^### .*\n/, '').slice(0, 300);
  } else {
    texto = 'Olá! Sou o assistente virtual da LocarX. Posso ajudar com reservas e dúvidas sobre a locação.';
  }
  return { texto, uso: { entrada: 100, saida: 30 }, usadas };
}
