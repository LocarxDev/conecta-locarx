// Descrição em texto dos componentes de tela do chat do site (para a IA lembrar o que o cliente está vendo e para a equipe ler no CRM).
export function descreverUi(ui) {
  if (!Array.isArray(ui) || !ui.length) return '';
  return ui.map((u) => {
    if (u.tipo === 'lojas') return `[na tela: cartões das lojas — ${(u.lojas || []).map((l) => l.nome).join(', ')}]`;
    if (u.tipo === 'cidades') return '[na tela: busca de cidade]';
    if (u.tipo === 'datas') return '[na tela: calendário para escolher retirada e devolução]';
    if (u.tipo === 'cadastro') return '[na tela: formulário de nome e WhatsApp com código de confirmação]';
    if (u.tipo === 'carros') return `[na tela: cartões dos carros — ${(u.grupos || []).map((g) => `${g.letra} ${g.nome} (fleet_id ${g.fleetId})`).join('; ')}]`;
    if (u.tipo === 'botoes') return `[na tela: botões — ${(u.opcoes || []).join(' | ')}]`;
    return '';
  }).filter(Boolean).join(' ');
}
