// Extrai o texto de PDF e Word (.docx) para importar na base de conhecimento.
// O .docx é um arquivo zip: lemos só o word/document.xml, sem executar nada do arquivo.
import { inflateRawSync } from 'node:zlib';
import { PDFParse } from 'pdf-parse';

const LIMITE_DESCOMPACTADO = 20 * 1024 * 1024;

function lerEntradaZip(buf, nomeProcurado) {
  // fim do diretório central
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('Arquivo Word inválido.');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamOrig = buf.readUInt32LE(p + 24);
    const lenNome = buf.readUInt16LE(p + 28), lenExtra = buf.readUInt16LE(p + 30), lenComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + lenNome).toString('utf8');
    if (nome === nomeProcurado) {
      if (tamOrig > LIMITE_DESCOMPACTADO) throw new Error('Documento grande demais.');
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const dados = buf.subarray(ini, ini + tamComp);
      return metodo === 0 ? dados : inflateRawSync(dados, { maxOutputLength: LIMITE_DESCOMPACTADO });
    }
    p += 46 + lenNome + lenExtra + lenComent;
  }
  throw new Error('Não encontrei o texto dentro do arquivo Word.');
}

function textoDoDocx(buf) {
  const xml = lerEntradaZip(buf, 'word/document.xml').toString('utf8');
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function textoDoPdf(buf) {
  const leitor = new PDFParse({ data: buf });
  try { return (await leitor.getText()).text.trim(); } finally { await leitor.destroy?.(); }
}

export async function extrairTexto(buf, tipo) {
  if (tipo === 'pdf') {
    if (buf.subarray(0, 4).toString() !== '%PDF') throw new Error('O arquivo não é um PDF válido.');
    return textoDoPdf(buf);
  }
  if (tipo === 'docx') {
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('O arquivo não é um Word (.docx) válido.');
    return textoDoDocx(buf);
  }
  throw new Error('Tipo de arquivo não suportado.');
}
