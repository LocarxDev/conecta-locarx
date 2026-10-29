// Página de teste do chat: pede a chave de teste uma vez por aba e liga o widget.
(function () {
  'use strict';
  var KEY = 'locarx_chat_chave_teste';
  function ler() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }
  function gravar(v) { try { sessionStorage.setItem(KEY, v); } catch (e) { /* sem armazenamento */ } }
  function ligar(chave) {
    var s = document.createElement('script');
    s.src = 'locarx-chat.js'; s.dataset.manual = '1';
    s.onload = function () { window.LocarxChat.init({ api: '/api/site', chave: chave }); };
    document.body.appendChild(s);
  }
  var caixa = document.getElementById('liberar');
  var chave = ler();
  if (chave) { ligar(chave); return; }
  caixa.hidden = false;
  document.getElementById('form-chave').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = document.getElementById('chave').value.trim();
    if (!v) { document.getElementById('erro-chave').textContent = 'Digite a chave.'; return; }
    gravar(v); caixa.hidden = true; ligar(v);
  });
})();
