# Atlas Organizer — correção 2.2.1

Corrige a ação **Hoje**: mantém a visualização atual e, na vista anual, desloca o calendário para mostrar a data atual. O botão passa a atualizar também o rótulo da data.

## Publicação no GitHub Pages

1. Faça backup das atividades locais e confirme a última sincronização com o Google Drive.
2. No repositório `Alavario/atlas-organizer`, na raiz da branch `main`, substitua **app.js**, **index.html** e **sw.js** pelos arquivos deste pacote.
3. Faça *Commit changes* e aguarde a publicação em **Actions**.
4. Recarregue o aplicativo; feche e reabra se estiver instalado como PWA. Não use *Limpar dados do site*.

Não é necessário atualizar Cloudflare Worker, Google Drive, Google Agenda ou D1.

## Teste rápido

Na visualização Ano, abra outro ano ou volte ao topo; clique em Hoje e confirme que o mês e a data de hoje aparecem na tela. Repita em Dia, Semana, Mês, Trimestre e Semestre para verificar o período correto.
