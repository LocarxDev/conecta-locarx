// Comprovante de pagamento em PDF (uma página A5), enviado ao cliente pelo WhatsApp depois da confirmação do Pix.
// Dados mínimos: loja, código do pagamento, reserva, nome do cliente e CPF só com o final, valor, data, período.
// Sem o identificador do provedor: esse fica no CRM.
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reais, dataBr, rotuloGrupo } from '../locarx/cotacao.js';

const VERMELHO = '#d7261e';
const PRETO = '#1a1a1a';
const CINZA = '#6b6b6b';
const CINZA_CLARO = '#e6e6e6';
const FUNDO = '#f6f6f6';
const VERDE = '#1f8a4c';
const VERDE_SUAVE = '#e6f4ec';
const LOGO = (() => { try { return readFileSync(fileURLToPath(new URL('../../recursos/logo-locarx.png', import.meta.url))); } catch { return null; } })();

const fmtData = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: 'long', year: 'numeric' });
const fmtHora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' });

/**
 * @param {object} o { lojaNome, codigo, valor, pagaEm, devMode, cliente: { nome, cpfFinal }, cotacao, reservaCodigo, comprovanteUrl }
 * @returns {Promise<Buffer>}
 */
export function gerarComprovantePdf(o) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 0, info: { Title: `Comprovante de pagamento ${o.codigo || ''}`, Author: 'Conecta LocarX' } });
    const partes = [];
    doc.on('data', (b) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const W = doc.page.width, H = doc.page.height, M = 32, largura = W - 2 * M;
    const pagaEm = o.pagaEm || new Date().toISOString();
    const rg = o.cotacao ? rotuloGrupo({ grupo: o.cotacao.grupo }, 1) : null;

    // ---- cabeçalho: logo + título à direita + faixa vermelha
    if (LOGO) doc.image(LOGO, M, 26, { height: 34 });
    else doc.font('Helvetica-Bold').fontSize(20).fillColor(PRETO).text('Locar', M, 30, { continued: true }).fillColor(VERMELHO).text('X');
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PRETO).text('COMPROVANTE DE PAGAMENTO', M, 30, { width: largura, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(CINZA).text(o.lojaNome || 'LocarX', M, 46, { width: largura, align: 'right' });
    doc.rect(M, 72, largura, 2).fill(VERMELHO);

    // ---- bloco do valor
    let y = 90;
    doc.roundedRect(M, y, largura, 92, 8).fill(FUNDO);
    doc.font('Helvetica').fontSize(9).fillColor(CINZA).text('VALOR PAGO', M + 18, y + 16);
    doc.font('Helvetica-Bold').fontSize(28).fillColor(PRETO).text(reais(o.valor), M + 18, y + 30);
    doc.font('Helvetica').fontSize(9).fillColor(CINZA).text(`Pix · ${fmtData(pagaEm)} às ${fmtHora(pagaEm)}`, M + 18, y + 66);
    // selo PAGO
    const sw = 64, sh = 22, sx = M + largura - 18 - sw, sy = y + 16;
    doc.roundedRect(sx, sy, sw, sh, 11).fill(VERDE_SUAVE);
    doc.save().moveTo(sx + 14, sy + 11).lineTo(sx + 18, sy + 15).lineTo(sx + 25, sy + 7).lineWidth(1.8).strokeColor(VERDE).stroke().restore();   // ✓ desenhado (a fonte padrão não tem o glifo)
    doc.font('Helvetica-Bold').fontSize(9).fillColor(VERDE).text('PAGO', sx + 26, sy + 6, { width: sw - 26, align: 'left' });
    // código do pagamento em destaque
    doc.font('Helvetica').fontSize(8).fillColor(CINZA).text('CÓDIGO DO PAGAMENTO', sx - 60, y + 48, { width: sw + 60, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(VERMELHO).text(o.codigo || '—', sx - 60, y + 60, { width: sw + 60, align: 'right' });
    y += 92 + 22;

    // ---- duas colunas: reserva | cliente
    const col = (titulo, linhas, x, w) => {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(VERMELHO).text(titulo.toUpperCase(), x, y, { characterSpacing: 0.6 });
      let yy = y + 16;
      for (const [rotulo, valor] of linhas) {
        if (valor == null || valor === '') continue;
        doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(rotulo, x, yy);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(PRETO).text(String(valor), x, yy + 10, { width: w });
        yy += 30;
      }
      return yy;
    };
    const w2 = (largura - 16) / 2;
    const prot = o.cotacao ? (o.cotacao.nomesProtecoes?.length ? o.cotacao.nomesProtecoes : o.cotacao.protecoes) : null;
    const fim1 = col('Reserva', [
      ['Código da reserva', o.reservaCodigo || 'em processamento pela loja'],
      ['Grupo', rg ? `${rg.letra} – ${rg.nome}` : null],
      ['Retirada', o.cotacao ? dataBr(o.cotacao.retirada) : null],
      ['Devolução', o.cotacao ? dataBr(o.cotacao.devolucao) : null],
      ['Proteção', prot?.length ? prot.join(', ') : null],
    ], M, w2);
    const fim2 = col('Cliente', [
      ['Nome', o.cliente?.nome],
      ['CPF', o.cliente?.cpfFinal ? `***.***.***-${o.cliente.cpfFinal}` : null],
      ['Forma de pagamento', 'Pix (AbacatePay)'],
      ['Recebido por', 'Rede LocarX'],
    ], M + w2 + 16, w2);
    y = Math.max(fim1, fim2) + 6;

    // ---- rodapé
    doc.moveTo(M, y).lineTo(M + largura, y).lineWidth(0.8).strokeColor(CINZA_CLARO).stroke();
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(
      'O valor acima foi recebido pela rede LocarX e abate integralmente o total da locação informado na reserva. Na retirada, apresente CNH válida e o cartão de crédito do condutor para a caução. Guarde o código do pagamento para qualquer conferência na loja.',
      M, y, { width: largura, lineGap: 1.5 });
    if (o.comprovanteUrl) { doc.moveDown(0.6); doc.fillColor(CINZA).text('Comprovante do provedor: ', { continued: true }).fillColor(VERMELHO).text(o.comprovanteUrl, { link: o.comprovanteUrl }); }

    if (o.devMode) {
      doc.roundedRect(M, H - 70, largura, 24, 6).fill('#fdecec');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(VERMELHO).text('AMBIENTE DE TESTE — nenhum valor real foi cobrado', M, H - 63, { width: largura, align: 'center' });
    }
    doc.font('Helvetica').fontSize(7.5).fillColor(CINZA).text(`Emitido pelo Conecta LocarX · atendimento por WhatsApp da loja · ${fmtData(new Date().toISOString())}`, M, H - 36, { width: largura, align: 'center' });
    doc.end();
  });
}
