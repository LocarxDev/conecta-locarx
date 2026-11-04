// v14.8.4 — Termo importado de um Word (.docx): converte para HTML (mammoth) e deixa só o que é formatação de texto.
import mammoth from 'mammoth';

const TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'sup', 'sub']);

/** Mantém só as tags da lista, sem nenhum atributo; o resto vira texto (escapado). Nada de script, link, imagem ou estilo. */
export function limparHtml(entrada) {
  const s = String(entrada || '');
  let saida = '';
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+|</g;
  let m;
  while ((m = re.exec(s))) {
    const trecho = m[0];
    if (trecho[0] !== '<') { saida += trecho.replace(/&(?!(amp|lt|gt|quot|#39|#x27|nbsp|#\d+);)/g, '&amp;'); continue; }
    if (trecho === '<') { saida += '&lt;'; continue; }
    const tag = m[1].toLowerCase();
    if (!TAGS.has(tag)) continue;                      // tag fora da lista some (o conteúdo fica)
    saida += trecho.startsWith('</') ? `</${tag}>` : (tag === 'br' ? '<br>' : `<${tag}>`);
  }
  // h1 do documento vira h2 (o título do termo já é o h1 da tela); remove parágrafos vazios repetidos
  return saida.replace(/<(\/?)h1>/g, '<$1h2>').replace(/(<p>\s*<\/p>\s*){2,}/g, '<p></p>').trim();
}

/** Converte um .docx (Buffer) em { html, texto } prontos para virar um termo. */
export async function docxParaTermo(buffer) {
  const r = await mammoth.convertToHtml({ buffer }, {
    styleMap: ['p[style-name="Title"] => h2:fresh', 'p[style-name="Heading 1"] => h2:fresh', 'p[style-name="Heading 2"] => h3:fresh', 'p[style-name="Heading 3"] => h4:fresh', 'b => strong', 'i => em', 'u => u'],
    convertImage: mammoth.images.imgElement(() => ({ src: '' })),   // imagens são descartadas na limpeza
  });
  const html = limparHtml(r.value);
  const texto = (await mammoth.extractRawText({ buffer })).value.replace(/\n{3,}/g, '\n\n').trim();
  if (texto.length < 20) throw Object.assign(new Error('O documento parece vazio. Confira se é o arquivo certo.'), { status: 422 });
  return { html, texto, avisos: (r.messages || []).map((x) => x.message).slice(0, 5) };
}
