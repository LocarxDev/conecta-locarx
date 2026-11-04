// v14.8.4 — termo importado de um Word: limpeza do HTML e conversão de um .docx real
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limparHtml, docxParaTermo } from '../src/servicos/termos-docx.js';

test('limparHtml mantém formatação de texto e remove o resto', () => {
  const sujo = '<h1 class="x">Título</h1><p style="color:red" onclick="alert(1)">Oi <strong>forte</strong> <a href="http://x">link</a> <img src="x.png"> <script>alert(1)</script></p><ul><li>um</li></ul><div>bloco</div>';
  const limpo = limparHtml(sujo);
  assert.equal(limpo, '<h2>Título</h2><p>Oi <strong>forte</strong> link  alert(1)</p><ul><li>um</li></ul>bloco');
  assert.ok(!/<script|onclick|href|<img|<div/.test(limpo));
});

test('limparHtml escapa texto solto e sinais de menor', () => {
  assert.equal(limparHtml('a < b & c'), 'a &lt; b &amp; c');
  assert.equal(limparHtml('<p>x &amp; y &nbsp; z</p>'), '<p>x &amp; y &nbsp; z</p>');
});

test('docxParaTermo converte um .docx de verdade (gerado na hora)', async () => {
  // um .docx mínimo montado à mão (zip com document.xml) para não depender de arquivo externo
  const { default: JSZip } = await import('jszip').catch(() => ({ default: null }));
  if (!JSZip) return; // sem jszip no ambiente: pula (o mammoth traz o próprio leitor de zip)
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>TERMO DE USO</w:t></w:r></w:p><w:p><w:r><w:t>Cláusula primeira: </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>o acesso é pessoal</w:t></w:r><w:r><w:t> e intransferível.</w:t></w:r></w:p></w:body></w:document>');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const r = await docxParaTermo(buffer);
  assert.ok(/<strong>o acesso é pessoal<\/strong>/.test(r.html), r.html);
  assert.ok(/TERMO DE USO/.test(r.html) && /Cláusula primeira/.test(r.texto));
});
