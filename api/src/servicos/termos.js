// Termos do Conecta LocarX: Termo de adesão (gestores de loja), Termo de uso e Termo de privacidade (gestores e atendentes).
// A administração publica versões; cada pessoa precisa aceitar a versão vigente de cada termo do seu perfil no primeiro
// acesso (e de novo quando sair uma versão nova). O aceite fica registrado com nome, e-mail, loja, versão, data/hora,
// endereço IP, navegador e a assinatura (hash) do texto aceito.
import { createHash } from 'node:crypto';

export const TIPOS = {
  adesao: { perfis: ['dono'], nome: 'Termo de adesão (gestores de loja)', ordem: 1 },
  uso: { perfis: ['dono', 'atendente'], nome: 'Termo de uso', ordem: 2 },
  privacidade: { perfis: ['dono', 'atendente'], nome: 'Termo de privacidade', ordem: 3 },
};
export const tiposDoPerfil = (perfil) => Object.entries(TIPOS).filter(([, t]) => t.perfis.includes(perfil)).map(([tipo]) => tipo);
export const hashTexto = (texto) => createHash('sha256').update(String(texto)).digest('hex');

// subselect usado nas consultas de sessão/login (alias `u` = usuarios): quantos termos a pessoa ainda precisa aceitar (0 para admin/matriz)
export const SQL_TERMOS_PENDENTES = `(SELECT count(*)::int FROM termos t
   WHERE t.tipo = ANY (CASE u.perfil WHEN 'dono' THEN ARRAY['adesao', 'uso', 'privacidade'] WHEN 'atendente' THEN ARRAY['uso', 'privacidade'] ELSE ARRAY[]::text[] END)
     AND t.versao = (SELECT max(x.versao) FROM termos x WHERE x.tipo = t.tipo)
     AND NOT EXISTS (SELECT 1 FROM aceites_termos a WHERE a.usuario_id = u.id AND a.termo_id = t.id))`;

/** Versão vigente de cada tipo (a de maior número), na ordem adesão → uso → privacidade. */
export async function vigentes(c) {
  const rows = (await c.query(`SELECT DISTINCT ON (tipo) * FROM termos ORDER BY tipo, versao DESC`)).rows;
  return rows.sort((a, b) => (TIPOS[a.tipo]?.ordem || 9) - (TIPOS[b.tipo]?.ordem || 9));
}

/** Termos que este usuário ainda precisa aceitar (perfil base do cadastro). */
export async function pendentesDe(c, usuario) {
  const tipos = tiposDoPerfil(usuario.perfil_base || usuario.perfil);
  if (!tipos.length) return [];
  const rows = (await c.query(
    `SELECT t.* FROM termos t WHERE t.tipo = ANY($2) AND t.versao = (SELECT max(x.versao) FROM termos x WHERE x.tipo = t.tipo)
       AND NOT EXISTS (SELECT 1 FROM aceites_termos a WHERE a.usuario_id = $1 AND a.termo_id = t.id)`, [usuario.id, tipos])).rows;
  return rows.sort((a, b) => (TIPOS[a.tipo]?.ordem || 9) - (TIPOS[b.tipo]?.ordem || 9));
}

export const termoPublico = (t) => ({ id: t.id, tipo: t.tipo, nome: TIPOS[t.tipo]?.nome || t.tipo, versao: t.versao, titulo: t.titulo, texto: t.texto, formato: t.formato || 'texto', publicadoEm: t.publicado_em, hash: hashTexto(t.texto) });

const REGISTRO = `Registro do aceite. Ao aceitar este termo, o sistema grava: nome, e-mail e perfil de acesso, loja vinculada, versão do termo, data e hora, endereço IP e identificação do navegador/dispositivo, além da assinatura digital (hash) do texto aceito. Esse registro é mantido como prova do aceite pelo tempo exigido em lei.`;

// Textos iniciais (rascunho para a administração revisar em Padrões do CRM → Termos de uso). Não substituem revisão jurídica.
export const TEXTO_INICIAL = {
  adesao: {
    titulo: 'Termo de adesão ao Conecta LocarX — gestores de loja',
    texto: `TERMO DE ADESÃO AO CONECTA LOCARX — GESTORES DE LOJA

1. Objeto. Este termo formaliza a adesão da loja franqueada ("Loja"), representada pelo gestor que aceita, ao Conecta LocarX ("Conecta"): sistema de atendimento, assistente virtual e CRM disponibilizado pela LocarX Aluguel de Carros à sua rede e desenvolvido e operado pela Auniti Tecnologia.

2. Quem adere. O gestor declara ter poderes para representar a Loja e adere em nome dela e dos usuários que cadastrar (gestores e atendentes), respondendo pelo uso que a equipe fizer do sistema.

3. Plano e módulos. O Conecta é fornecido conforme o plano e os módulos liberados pela administração da rede para a Loja (atendimento, assistente virtual, funil, cotação e reserva pela equipe, pagamentos, relatórios, Instagram, entre outros). Módulos podem ser incluídos, alterados ou retirados pela rede.

4. Canais da Loja. A conexão do WhatsApp, do Instagram e do chat do site é feita com contas da própria Loja, que responde pelo uso desses canais conforme as políticas das respectivas plataformas, inclusive quanto a mensagens automáticas e ao direito do cliente de deixar de recebê-las.

5. Assistente virtual e portal LocarX. A assistente virtual atende em nome da Loja com base nas regras da rede e nas orientações cadastradas pela Loja. Preços, disponibilidade e reservas vêm do portal LocarX pela API oficial; a Loja é responsável por manter a filial, as tabelas e os dados do portal corretos e por acompanhar os atendimentos, assumindo-os quando necessário.

6. Pagamentos. Quando habilitado, o recebimento de Pix pelo WhatsApp é feito pela conta da rede (com repasse) ou pela conta própria da Loja no provedor de pagamentos, conforme liberado pela administração. A Loja é responsável pelos dados da própria conta e pela conferência dos repasses.

7. Acessos. O acesso é pessoal e intransferível. A Loja mantém as senhas em sigilo, desativa acessos de quem deixar a equipe e usa a autenticação em duas etapas quando exigida.

8. Confidencialidade. Tabelas, regras, relatórios, base de conhecimento e demais informações comerciais da rede são confidenciais e não podem ser copiadas ou divulgadas fora da Loja.

9. Disponibilidade. A LocarX e a Auniti empregam esforços razoáveis para manter o serviço disponível e seguro, com manutenções e atualizações periódicas, sem garantia de funcionamento ininterrupto.

10. Vigência e encerramento. Este termo vale enquanto durar o vínculo da Loja com a rede. O acesso pode ser suspenso ou encerrado pela administração em caso de descumprimento deste termo, do Termo de uso ou do Termo de privacidade.

11. Alterações. Este termo pode ser atualizado; a nova versão é apresentada no próximo acesso e passa a valer a partir do aceite.

12. ${REGISTRO}

Ao clicar em "Li e concordo", o gestor declara que leu, compreendeu e aceita este termo em nome da Loja.`,
  },
  uso: {
    titulo: 'Termo de uso do Conecta LocarX',
    texto: `TERMO DE USO DO CONECTA LOCARX

1. Acesso pessoal. Seu acesso ao Conecta LocarX é pessoal e intransferível. Não compartilhe sua senha nem use o acesso de outra pessoa. Ative a autenticação em duas etapas quando solicitado.

2. Finalidade. O sistema deve ser usado somente para o atendimento, a cotação, a reserva e o relacionamento com clientes da locação de veículos, dentro da loja em que você atua.

3. Conduta no atendimento. Trate os clientes com respeito; siga as orientações da loja e as regras da rede; não prometa condições, valores, descontos ou disponibilidade que não estejam nas regras ou no portal LocarX; não cancele nem altere reservas fora do procedimento da loja.

4. Assistente virtual. A assistente virtual atende em nome da loja. Ao assumir uma conversa, você passa a responder por ela; devolva-a à assistente ou encerre-a quando o atendimento terminar. Não cadastre orientações que contrariem as regras da rede.

5. Conteúdo. É proibido usar o sistema para enviar mensagens ofensivas, spam, conteúdo ilegal ou mensagens a clientes que pediram para não recebê-las.

6. Segurança. Não tente acessar dados de outras lojas, contornar permissões ou extrair informações além do necessário ao seu trabalho. Qualquer incidente ou suspeita de acesso indevido deve ser comunicado ao gestor da loja.

7. Registros. O sistema registra as ações relevantes (login, mensagens enviadas, conversas assumidas, reservas, alterações de cadastro), com data, hora e endereço IP, para segurança, suporte e cumprimento da lei.

8. Descumprimento. O descumprimento deste termo pode levar à suspensão ou ao encerramento do acesso pela loja ou pela administração da rede.

9. Alterações. Este termo pode ser atualizado; a nova versão é apresentada no próximo acesso.

10. ${REGISTRO}

Ao clicar em "Li e concordo", você declara que leu, compreendeu e aceita este termo.`,
  },
  privacidade: {
    titulo: 'Termo de privacidade do Conecta LocarX',
    texto: `TERMO DE PRIVACIDADE DO CONECTA LOCARX

1. Dados dos clientes. No atendimento você terá contato com dados pessoais de clientes: nome, telefone, e-mail, CPF, documentos informados, histórico de conversas, cotações, reservas e pagamentos. Esses dados pertencem à relação do cliente com a LocarX e só podem ser usados para o atendimento e a locação.

2. O que é proibido. Copiar, fotografar, exportar, compartilhar ou usar dados de clientes fora do sistema ou para fins pessoais, inclusive em aplicativos de mensagem pessoais, redes sociais ou listas próprias.

3. Base legal. O tratamento segue a Lei Geral de Proteção de Dados (Lei 13.709/2018): execução do contrato de locação, cumprimento de obrigações legais e interesse legítimo no atendimento e na segurança. A loja, como parte da rede, e a LocarX são responsáveis pelo tratamento; a Auniti Tecnologia atua como operadora do sistema.

4. Seus dados. Seu nome, e-mail, perfil de acesso, registros de uso (data, hora, endereço IP, navegador e ações no sistema) e os aceites de termos são tratados para operar o sistema, garantir a segurança e cumprir a lei, e ficam acessíveis ao gestor da sua loja e à administração da rede.

5. Direitos dos titulares. Clientes e usuários podem pedir acesso, correção, exclusão ou informações sobre seus dados pelos canais da LocarX (política de privacidade e página de exclusão de dados do Conecta). Pedidos de clientes recebidos no atendimento devem ser encaminhados ao gestor da loja.

6. Guarda e retenção. Conversas, reservas e registros ficam guardados pelo tempo necessário ao atendimento e às obrigações legais, com controle de acesso por loja e perfil.

7. Incidentes. Suspeita de vazamento, acesso indevido ou perda de dados deve ser comunicada imediatamente ao gestor da loja e à administração da rede.

8. Alterações. Este termo pode ser atualizado; a nova versão é apresentada no próximo acesso.

9. ${REGISTRO}

Ao clicar em "Li e concordo", você declara que leu, compreendeu e aceita este termo.`,
  },
};

/** Garante que exista uma versão de cada termo (textos iniciais) — roda no boot. */
export async function semearTermos(c) {
  for (const [tipo, t] of Object.entries(TEXTO_INICIAL)) {
    await c.query(`INSERT INTO termos (tipo, versao, titulo, texto) SELECT $1, 1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM termos WHERE tipo = $1)`, [tipo, t.titulo, t.texto]);
  }
}
