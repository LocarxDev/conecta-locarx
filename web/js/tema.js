// Aplica o tema salvo antes da página desenhar, para não piscar branco no modo escuro.
(function () {
  try {
    var t = localStorage.getItem('conecta.tema');
    if (t === 'escuro') document.documentElement.setAttribute('data-theme', 'dark');
    if (t === 'claro') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) { /* navegador bloqueou o armazenamento: segue o tema do sistema */ }
})();
