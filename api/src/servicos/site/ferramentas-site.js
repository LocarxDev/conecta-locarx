// Ferramentas da Lia que só existem no chat do site: mostram componentes na tela do visitante
// (lojas, calendário, cadastro, botões de resposta rápida) e escolhem a loja antes da confirmação do WhatsApp.

export function ferramentasDoSite(ctx) {
  const lista = [{
    nome: 'mostrar_na_tela',
    descricao: 'Mostra um componente na tela do cliente, no chat do site. tipo "lojas": cartões das lojas de uma cidade (informe cidade; sem cidade mostra todas). tipo "datas": calendário e horário para ele escolher retirada e devolução. tipo "cadastro": pede nome e WhatsApp com código de confirmação (OBRIGATÓRIO antes de reservar ou chamar atendente; só existe antes do número ser confirmado). tipo "botoes": até 4 respostas rápidas (informe opcoes). Depois de chamar, escreva só uma frase curta; não repita no texto o que a tela já mostra.',
    parametros: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ctx.preVerificacao ? ['lojas', 'datas', 'cadastro', 'botoes'] : ['datas', 'botoes'] },
        cidade: { type: 'string', description: 'só para tipo "lojas": cidade que o cliente informou' },
        opcoes: { type: 'array', items: { type: 'string' }, description: 'só para tipo "botoes": textos curtos (até 4), cada um é o que o cliente "diria" ao tocar' },
      },
      required: ['tipo'],
    },
    executar: async ({ tipo, cidade, opcoes }) => {
      if (tipo === 'lojas') {
        if (!ctx.preVerificacao) return 'A loja deste atendimento já está definida. Siga com o roteiro.';
        const lojas = await ctx.listarLojas(cidade);
        if (!lojas.length) {
          const cidades = await ctx.listarCidades();
          return `Não há loja com chat nessa cidade. Cidades disponíveis: ${cidades.join(', ') || 'nenhuma'}. Diga isso ao cliente com cordialidade e pergunte se quer uma delas.`;
        }
        ctx.aoMostrar({ tipo: 'lojas', cidade: cidade || null, lojas });
        return { na_tela: true, lojas: lojas.map((l) => l.nome), instrucao: 'Os cartões das lojas já estão na tela. Escreva só uma frase curta pedindo para escolher a loja de retirada. Não liste as lojas no texto.' };
      }
      if (tipo === 'datas') {
        ctx.aoMostrar({ tipo: 'datas' });
        return { na_tela: true, instrucao: 'O calendário já está na tela. Escreva só uma frase curta pedindo para escolher retirada e devolução. Quando o cliente escolher, a mensagem dele traz as datas e horas; use-as.' };
      }
      if (tipo === 'cadastro') {
        if (!ctx.preVerificacao) return 'O número do cliente já foi confirmado. Siga o roteiro (CPF e e-mail no Passo 5).';
        ctx.aoMostrar({ tipo: 'cadastro' });
        return { na_tela: true, instrucao: 'O formulário de nome e WhatsApp já está na tela. Escreva só uma frase curta, tranquilizando: o cliente recebe um código no WhatsApp para confirmar o número e depois seguimos de onde parou.' };
      }
      if (tipo === 'botoes') {
        const itens = (Array.isArray(opcoes) ? opcoes : []).map((x) => String(x || '').trim().slice(0, 40)).filter(Boolean).slice(0, 4);
        if (itens.length < 1) return 'Informe de 1 a 4 opções para os botões.';
        ctx.aoMostrar({ tipo: 'botoes', opcoes: itens });
        return { na_tela: true, instrucao: 'Os botões já estão na tela. Escreva só a pergunta, curta.' };
      }
      return 'Tipo inválido.';
    },
  }];
  if (ctx.preVerificacao) {
    lista.push({
      nome: 'escolher_loja',
      descricao: 'Define a loja em que o cliente quer retirar (use o nome exatamente como aparece nas lojas mostradas). Normalmente o cliente escolhe tocando no cartão; use esta ferramenta só se ele escrever o nome da loja.',
      parametros: { type: 'object', properties: { loja: { type: 'string' } }, required: ['loja'] },
      executar: async ({ loja }) => {
        const r = await ctx.escolherLoja(loja);
        return r.ok ? { ok: true, loja: r.nome, instrucao: 'Loja definida. Siga para as datas (mostrar_na_tela tipo "datas").' } : r.mensagem;
      },
    });
  }
  return lista;
}

// Ferramentas permitidas ANTES do número ser confirmado: só consulta e conversa (nada grava no CRM nem no portal).
export const PERMITIDAS_ANTES = ['buscar_informacoes', 'dados_da_loja', 'descrever_grupo', 'consultar_disponibilidade', 'calcular_preco'];
