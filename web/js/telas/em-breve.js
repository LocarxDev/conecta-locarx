// Módulos que ainda vão ser construídos: mostra o que cada um vai fazer e em qual etapa entra.
import { html, render, icone } from '../util.js';

const MODULOS = {
  conversas: { titulo: 'Conversas', icone: 'conversas', etapa: 2, itens: ['Todas as conversas do WhatsApp da loja numa caixa só, em tempo real', 'Assumir a conversa do assistente com um clique', 'Respostas rápidas e notas internas da equipe'] },
  clientes: { titulo: 'Clientes', icone: 'clientes', etapa: 5, itens: ['Ficha criada automaticamente pela conversa', 'Histórico de conversas e reservas de cada cliente', 'Etiquetas, busca e exportação para planilha'] },
  funil: { titulo: 'Funil de vendas', icone: 'funil', etapa: 5, itens: ['Novo contato → Em cotação → Reserva criada → Retirada → Concluído', 'O assistente move o cliente pelas etapas sozinho', 'Motivo de perda registrado'] },
  reservas: { titulo: 'Reservas', icone: 'reservas', etapa: 4, itens: ['Cotação e reserva pelo WhatsApp direto no portal LocarX', 'Lista das reservas da loja com a situação do portal', 'Lembretes automáticos de retirada e devolução'] },
  assistente: { titulo: 'Assistente virtual', icone: 'assistente', etapa: 3, itens: ['Nome, saudação, horário e regras da loja', 'Base de conhecimento com as informações da loja', 'Conversa de teste antes de colocar no ar'] },
  relatorios: { titulo: 'Relatórios', icone: 'relatorios', etapa: 6, itens: ['Conversas, conversão e reservas por período', 'Tempo de resposta da equipe', 'Perguntas que o assistente não soube responder'] },
  'base-rede': { titulo: 'Base da rede', icone: 'assistente', etapa: 3, itens: ['Informações gerais da LocarX usadas por todos os assistentes', 'Aprovação de conteúdo antes de valer', 'Modelo padrão do assistente para lojas novas'] },
  'relatorios-rede': { titulo: 'Relatórios da rede', icone: 'relatorios', etapa: 6, itens: ['Ranking das lojas por conversão e reservas', 'Situação do WhatsApp e do assistente de cada loja', 'Indicadores de toda a rede'] },
};

export function montar(alvo, ctx) {
  const m = MODULOS[ctx.params[0]];
  if (!m) return ctx.navegar('inicio');
  render(alvo, html`
    <section class="painel em-breve">
      <img class="x-grande" src="/assets/icone-192.png" alt="" width="56" height="56">
      <div class="titulos"><span class="selo marca">Etapa ${m.etapa} de 6</span></div>
      <h1>${m.titulo}</h1>
      <p>Esta área entra na etapa ${m.etapa} do Conecta. O que ela vai fazer:</p>
      <ul>${m.itens.map((i) => html`<li>${i}</li>`)}</ul>
      <a class="btn btn-contorno" href="#/inicio">${icone('voltar')}Voltar para o início</a>
    </section>`);
}
