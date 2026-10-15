# Atlas Organizer

**Versão experimental:** 2.1.0-alpha.1 · GitHub Pages + Google Drive + Cloudflare Worker

Aplicativo web de planejamento pessoal, rotinas recorrentes, acompanhamento de atividades e organização de materiais de estudo. A interface funciona como **PWA** em navegadores compatíveis, com dados locais para uso offline. Opcionalmente, conecta-se à conta Google para armazenar registros e anexos em uma área privada do Google Drive e enviar compromissos ao Google Agenda.

Esta versão aprimora **autenticação, persistência, sincronização e manutenção**, preservando a identidade visual existente. O protótipo alternativo criado em outra ferramenta **não foi incorporado** (não foi disponibilizado neste projeto).

> **Status:** código e testes de unidade preparados; **não publicado nem autorizado em conta Google real** pela entrega. Recomendado iniciar com registros de demonstração e manter backup da versão 2.0.2.

## Sumário

1. [O que o Atlas faz](#o-que-o-atlas-faz)
2. [Arquitetura e armazenamento](#arquitetura-e-armazenamento)
3. [O que mudou na 2.1](#o-que-mudou-na-21)
4. [Arquivos](#arquivos)
5. [Publicação sem instalar Node.js](#publicação-sem-instalar-nodejs)
6. [Configurar Google OAuth](#configurar-google-oauth)
7. [Criar backend no Cloudflare](#criar-backend-no-cloudflare)
8. [Ativar a sessão persistente](#ativar-a-sessão-persistente)
9. [Migração e backups](#migração-e-backups)
10. [Segurança e privacidade](#segurança-e-privacidade)
11. [Falhas frequentes](#falhas-frequentes)
12. [Testes e validação](#testes-e-validação)
13. [Limitações e melhorias futuras](#limitações-e-melhorias-futuras)

## O que o Atlas faz

- **Calendário:** visões dia, semana, mês, trimestre, semestre e ano; disposição domingo–sábado; navegação contínua e gesto elástico configurável de mudança anual; horários solares aproximados.
- **Atividades:** categoria, descrição, prioridade (baixa, normal, alta, máxima), múltiplas datas/horários, duração atravessando dias, links para notas do Acervo e lembretes.
- **Rotinas:** recorrências semanais com horários distintos, vigência de início/fim, recorrências anuais em dias fixos ou por posição no mês, classificação entre passadas/atuais/futuras, edição individual de ocorrências sem alterar a série inteira.
- **Acompanhamento:** estados concluída, não realizada, dispensada/cancelada e pendente; justificativas; avaliações 0–10 com estrelas parciais, desempenho e dificuldade opcionais.
- **Acervo:** gavetas por categoria; anotações, etiquetas, assuntos, anexos, prioridades, avaliações; associação de materiais às atividades.
- **Revisões:** estatísticas e resumos locais automáticos por conteúdo/categoria/prioridade; **não** há integração ativa com IA generativa nesta versão.
- **Temas:** três luminosidades e matizes predefinidas (azul, verde, amarelo, neutro, violeta, laranja e rosa), destaque complementar; acessibilidade, tamanho de texto e redução de movimentos.
- **Integrações:** armazenamento offline, Google Drive privado para registros e anexos, Google Agenda para envio individual de eventos. As notificações vêm do calendário, **não** do aplicativo nativo Relógio.

## Arquitetura e armazenamento

```text
GitHub Pages (site/ — público, gratuito para repositório público elegível)
   │
   ├── Interface HTML/CSS/JS + Service Worker (arquivos públicos)
   ├── IndexedDB (dados, anexos e token de sessão Atlas deste dispositivo)
   │
   └── HTTPS + Authorization: Bearer <sessão Atlas>
            │
            ▼
     Cloudflare Worker (backend/worker.mjs)
       ├── OAuth 2.0 authorization code + PKCE com Google
       ├── Limita acesso a uma conta Google configurada
       ├── Guarda refresh token criptografado (AES-GCM)
       ├── Proxy restrito para a Google Drive API
       └── Cloudflare D1 (somente sessões e credenciais criptografadas)
            │
            ▼
     Google Drive, appDataFolder (privado)
       ├── atlas-organizer-data-v2.json
       └── atlas-attachment-<ID> (arquivos)
```

**Onde cada informação mora:**

| Informação | Onde fica | Se você fechar o navegador? |
|---|---|---|
| Atividades e rotinas locais | IndexedDB + backup de compatibilidade do navegador | Geralmente permanecem (exceto limpeza de dados) |
| Anexos locais | IndexedDB | Permanecem neste dispositivo |
| Cópia sincronizada de registros e anexos | Google Drive `appDataFolder` | Permanece na sua conta Google |
| Client ID para Google Agenda legado | Preferências locais | Permanece no dispositivo |
| Token de sessão Atlas (revogável, ~30 dias renováveis) | IndexedDB no dispositivo | Permanece até expirar ou você desconectar/limpar dados |
| Refresh token, Client Secret, credenciais Google | Cloudflare D1, com refresh/access criptografados usando chave secreta do Worker | **Nunca ficam no JavaScript do site, nem no GitHub** |
| Banco D1 | Sessões, conta autorizada e metadados de autenticação | Não contém os registros de calendário/Acervo |

O Worker funciona sem cookies de terceiros; essa decisão evita bloqueios de cookies entre o domínio `github.io` e o `workers.dev`. Em contrapartida, o navegador armazena um **identificador de sessão com poder de acesso**, que exige cuidados contra scripts maliciosos (ver Segurança).

### Persistência ≠ disponibilidade ilimitada

A sessão local do Atlas expira depois de **30 dias sem atividade** (prazo renovável enquanto usada). Além disso, o Google pode revogar os tokens; contas Google em **OAuth External → Testing** com escopos do Drive normalmente recebem refresh tokens que expiram em **7 dias**, independentemente da duração da sessão Atlas. É uma regra do Google, não uma falha da renovação. Para uso prolongado, avalie o estado **In production**, possíveis avisos de aplicativo não verificado e os requisitos atualizados do Google, antes de modificar o consentimento.

## O que mudou na 2.1

1. Implementação de um **Cloudflare Worker** para autenticação Google no modelo *authorization code* com PKCE e verificação do e-mail autorizado.
2. Tokens de renovação **criptografados** no servidor, usando chave secreta não incluída no repositório.
3. Identificadores de sessão **aleatórios** no dispositivo; o banco D1 armazena apenas seu hash SHA-256.
4. Acesso ao Drive via proxy **restrito a endpoints de arquivos** da Google Drive API, utilizando somente escopo `drive.appdata`.
5. **Retomada automática** da sessão ao reabrir o aplicativo com internet, sem o clique em “Retomar Drive” (se o consentimento Google e a sessão ainda estiverem válidos).
6. Continuidade do **modo antigo**, sem Worker, caso a integração persistente ainda não esteja configurada.
7. Atualização da versão do Service Worker e dos módulos para distribuição offline; interface e cores mantidas.
8. Testes de API simulada, escopo do proxy, OAuth, criptografia, logout, armazenamento e conflitos.

## Arquivos

```text
atlas-organizer/
├── README.md                    documentação completa
├── site/                        publicar o conteúdo desta pasta no GitHub Pages
│   ├── .nojekyll
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── backend-client.js       sessão persistente e proxy cliente
│   ├── drive.js                modelo de dados do Drive e anexos
│   ├── sw.js                   cache offline
│   ├── manifest.webmanifest
│   ├── icon.svg
│   └── README.md               cópia pública da documentação (opcional)
├── backend/
│   ├── worker.mjs              copiar no editor do Cloudflare Worker
│   └── schema.sql              executar no console D1
├── tools/
│   └── gerar-chave.html        gerador LOCAL de chave AES-GCM
└── tests/
    ├── backend.test.mjs
    ├── drive-storage.test.mjs
    └── browser-smoke.py
```

**Nunca envie ao GitHub:** seu token Google, Client Secret, segredo AES, backup pessoal, dados JSON privados ou arquivos confidenciais do Acervo.

## Publicação sem instalar Node.js

### 1. Preserve os registros existentes

Na versão atual do Atlas, exporte os registros em Configurações → **Exportar dados JSON**. Essa exportação não inclui os binários dos anexos. Confirme que sua cópia no Drive está atualizada e guarde os anexos originais. **Não limpe os dados do site** nem desinstale o PWA antes da migração.

### 2. Atualize o GitHub Pages

1. Entre em `https://github.com/Alavario/atlas-organizer` (substitua caso tenha mudado o repositório).
2. Mantenha **Settings → Pages → Deploy from branch → main → /(root)**.
3. Extraia `atlas-site-github-pages-2.1.zip` (fornecido à parte).
4. Envie **os arquivos de dentro** do ZIP diretamente para a raiz do repositório em **Add file → Upload files**, substituindo os existentes. Também haverá um `README.md` completo no pacote.
5. Faça **Commit changes** e aguarde **Actions** finalizar a publicação.
6. Abra `https://alavario.github.io/atlas-organizer/` e atualize forçadamente (`Ctrl + Shift + R`). Se ainda vir a versão anterior, feche as abas e abra novamente; o Service Worker pode precisar de uma segunda atualização.

O GitHub Pages hospeda **somente o frontend**. Ele não executa o Worker, não guarda refresh tokens e não oferece banco de dados privado.

## Configurar Google OAuth

Você já tem um projeto **Atlas Organizer** no Google Cloud. Pode aproveitar o mesmo cliente OAuth **Web application** que utiliza atualmente.

1. Abra [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients).
2. Selecione o cliente OAuth Web existente. Confirme que a **origem JavaScript autorizada** continua `https://alavario.github.io` (sem o caminho `/atlas-organizer/`).
3. **Depois de criar o Worker e saber sua URL exata**, acrescente em **Authorized redirect URIs** este endereço completo:
   `https://NOME-DO-WORKER.SUBDOMINIO.workers.dev/auth/callback`
4. Salve e copie o **Client ID** e o **Client Secret**. Guarde o Client Secret somente como segredo no Worker. **Nunca no GitHub nem nas configurações visíveis do Atlas.**
5. Em **Data access / Scopes**, mantenha autorização para o escopo Google Drive `https://www.googleapis.com/auth/drive.appdata`. O login também usa os escopos básicos `openid` e `email` para confirmar a conta.
6. Em **Audience**, mantenha seu e-mail autorizado como usuário de teste enquanto o projeto estiver em modo de testes. A própria expiração de 7 dias continua se aplicando nesse estado para escopos do Drive.

A integração com **Google Agenda** ainda usa a autorização temporária da interface existente (campos próprios em Configurações). Ela não foi incorporada ao Worker nesta etapa; eventos continuam podendo ser enviados individualmente quando a autorização estiver ativa.

Documentação Google: [Authorization code (Web)](https://developers.google.com/identity/protocols/oauth2/web-server), [appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata), [modo de testes](https://support.google.com/cloud/answer/15549945).

## Criar backend no Cloudflare

Este procedimento é **inteiramente pelo navegador**, sem instalar Node.js. O plano Workers Free inclui acesso ao D1 com cotas gratuitas, sujeito aos limites vigentes; não é necessário comprar um domínio.

### 1. Banco D1

1. Acesse [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Entre em **Storage & databases → D1 SQL Database** (os nomes de menu podem variar).
3. Escolha **Create database**, nomeie `atlas-auth` e conclua.
4. Abra a página do banco, vá ao console SQL e execute o conteúdo de `backend/schema.sql`. Se a interface não aceitar múltiplos comandos, execute cada `CREATE TABLE` e `CREATE INDEX` separadamente.
5. Confirme que foram criadas as tabelas `accounts`, `sessions` e `oauth_states`.

### 2. Criar Worker

1. Acesse **Workers & Pages → Create → Worker** e crie, por exemplo, `atlas-organizer-api`.
2. Abra **Edit Code** e substitua o código de exemplo pelo conteúdo de `backend/worker.mjs`.
3. Faça **Deploy**. Anote a URL HTTPS mostrada, que termina em `workers.dev`.
4. Nas configurações do Worker, abra **Bindings → Add binding → D1 database**. Nomeie a variável de binding exatamente **`DB`** e selecione o banco `atlas-auth`.

### 3. Variáveis e segredos do Worker

Acesse as configurações de **Variables and Secrets** do Worker e cadastre:

| Nome | Tipo sugerido | Valor |
|---|---|---|
| `APP_ORIGIN` | variável | `https://alavario.github.io` (sem barra final) |
| `ALLOWED_EMAIL` | **secret** | e-mail exato da única conta Google autorizada |
| `GOOGLE_CLIENT_ID` | variável ou secret | Client ID OAuth Web existente |
| `GOOGLE_CLIENT_SECRET` | **secret** | Client Secret do Google Cloud |
| `TOKEN_ENCRYPTION_KEY` | **secret** | chave Base64 de **32 bytes aleatórios** |
| `DB` | **binding D1** | selecione `atlas-auth` (não é texto livre) |

Para gerar a chave AES sem instalar programas, abra localmente `tools/gerar-chave.html` no navegador e clique **Gerar chave segura**. Copie o valor de 44 caracteres Base64 para o segredo `TOKEN_ENCRYPTION_KEY`. A chave é gerada apenas localmente, sem tráfego para serviços externos.

**Não altere `TOKEN_ENCRYPTION_KEY` depois de começar a usar**, a menos que esteja preparado para revogar todas as autorizações existentes e conectar as contas novamente. O Worker não pode decifrar tokens com uma chave diferente.

### 4. Registrar o novo redirect URI no Google

Agora que você possui a URL real do Worker, volte às configurações de OAuth no Google Cloud e adicione em **Authorized redirect URIs**:

```
https://SEU-WORKER.SEUSUBDOMINIO.workers.dev/auth/callback
```

**Diferença importante:**
- **Authorized JavaScript origins**: `https://alavario.github.io`
- **Authorized redirect URIs**: `https://SEU-WORKER.SEUSUBDOMINIO.workers.dev/auth/callback`

Ambas devem permanecer corretamente cadastradas. O Google compara o redirect URI **exatamente**, incluindo `https`, nome, caminho e barra.

### 5. Testar o Worker

Abra `https://SEU-WORKER.SEUSUBDOMINIO.workers.dev/health` no navegador. O retorno esperado é similar a:

```json
{"ok":true,"service":"atlas-auth-gateway","version":"2.1.0"}
```

Este teste verifica a publicação do Worker, **não** garante que OAuth, D1 e Drive funcionem. Essas integrações precisam de um teste real adicional.

## Ativar a sessão persistente

1. Abra o Atlas publicado no GitHub Pages.
2. Vá em **Configurações → Conexão Google persistente · backend seguro**.
3. Cole a URL do Worker **sem barra nem caminho final**, por exemplo `https://atlas-organizer-api.seusubdominio.workers.dev`.
4. Clique **Salvar endereço do backend**.
5. Na seção **Google Drive**, clique **Conectar / Retomar Drive**. Uma janela Google deverá abrir. Permita pop-ups para esse site se necessário.
6. Autorize o **mesmo Google** que contém o backup do Atlas. O backend valida seu e-mail configurado em `ALLOWED_EMAIL`.
7. Confira a comparação entre dados locais e do Drive. Quando o Atlas solicitar escolha, **não substitua o banco remoto sem antes conferir e exportar um backup JSON**.
8. Feche a página, reabra e verifique a mensagem de **sessão recuperada automaticamente**. A consulta depende da internet e do consentimento Google ainda válido.

**Nos outros dispositivos:** repita apenas o passo de configurar a URL do Worker e a autorização Google inicial. Cada dispositivo terá sua própria sessão. Na primeira sincronização, você poderá precisar escolher **Carregar cópia do Drive** para recuperar a base já existente.

### O que acontece offline?

As atividades e rotinas continuam em IndexedDB, e o PWA pode abrir seus arquivos em cache após instalação/carregamento prévio. Quando a conexão voltar, o Atlas retoma a sessão e compara as cópias. Se houver diferenças inesperadas, suspende o envio e pede que você decida qual cópia preservar. **Não existe mesclagem automática completa de conflitos entre alterações concorrentes**.

## Migração e backups

- O banco remoto continua sendo `atlas-organizer-data-v2.json` no Drive `appDataFolder`. Esta versão **não renomeia nem recria** automaticamente seus dados; continua lendo os registros da 2.0.2.
- Os anexos já presentes no `appDataFolder` continuam acessíveis. Cópias locais precisam manter os blobs do IndexedDB; arquivos que nunca foram enviados ao Drive exigirão reenviar de seu dispositivo original.
- O backup JSON exportado pelo app **não inclui anexos binários**. Não confunda com um backup integral dos materiais.
- Migração recomendada: faça backup JSON → confira a cópia Drive na versão antiga → publique a 2.1 → conecte o Worker → confira a base remota → teste com atividade fictícia → só então utilize os dados reais.
- Não publique o arquivo de backup, os materiais ou o JSON do Drive no GitHub (o repositório do Pages é público).

## Segurança e privacidade

**Controles implementados**

- Código de autorização com **PKCE S256**, estado OAuth aleatório e consumo único.
- Confirmação de identidade pelo Google (userinfo, e-mail verificado), restringindo ao endereço configurado.
- Refresh/access tokens criptografados **AES-GCM** antes de armazená-los no D1.
- Session token aleatório de alta entropia; no D1 fica apenas o **SHA-256** dele. Logout apaga a sessão do backend e do dispositivo.
- CORS limitado a `APP_ORIGIN`; requisições à API exigem um bearer token válido; o proxy só permite endpoints de **arquivos da Drive API**.
- A API não permite informar livremente destinos de rede nem aceita chamadas ao Gmail, Calendar ou outros serviços via proxy Drive.
- Respostas com `Cache-Control: no-store` e política de conteúdo restrita na janela de callback OAuth.

**Limites e riscos remanescentes**

- A sessão salva no **IndexedDB** é um segredo *bearer*: scripts maliciosos executados na própria origem podem tentar acessá-la. Evite bibliotecas de terceiros não auditadas, extensões desconhecidas e publicação de código de fontes não confiáveis. O site estático não deve conter tokens nem segredos.
- O Gateway é um backend experimental e **não foi submetido a auditoria independente**, *pentest* ou teste com credenciais reais nesta entrega. Não considere a implantação pronta para dados sensíveis antes de verificar o fluxo end-to-end.
- A sessão Atlas renova o prazo de validade quando utilizada, mas revogação Google, limpezas no navegador e expiração de credenciais ainda exigirão novo login.
- A origem GitHub Pages de um repositório usa o mesmo `https://usuario.github.io` de outros projetos Pages dessa conta. Publicar um projeto não confiável sob a mesma origem pode expor sessões IndexedDB. Para maior isolamento, considere um **domínio próprio exclusivo para o Atlas** no futuro.
- `D1` é usado para autenticação, não para a agenda. Quem tiver privilégios administrativos no projeto Cloudflare poderá alterar o backend e precisa ser considerado confiável.
- O Drive client ainda usa verificação de versão **lógica**, não transação atômica entre dispositivos. Evite editar a mesma atividade offline simultaneamente em dois aparelhos; mantenha backups.
- Arquivos enviados à nuvem obedecem às regras do Google Drive e às cotas aplicáveis. O Worker impõe limite por operação de **22 MiB** para uploads e alterações.

### Encerrar a conexão ou revogar permissões

Em Configurações → Google Drive → Desconectar, a versão persistente solicita a revogação do **token de sessão deste dispositivo** no Worker. Para revogar o acesso do Google ao aplicativo, use também [Sua Conta Google → Conexões de terceiros](https://myaccount.google.com/connections) e remova o aplicativo. Isso invalida o refresh token quando o Google processar a revogação. Excluir os dados no Cloudflare D1 também invalida sessões; tenha cuidado para não apagar dados de outro sistema.

## Falhas frequentes

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| GitHub Pages 404 | `index.html` está em subpasta ou Pages aponta para outra branch | Envie arquivos à raiz; Pages `main` + `/(root)` |
| Erro Google `redirect_uri_mismatch` | URI no Google diferente da URL do Worker | Cadastre exatamente `https://worker.workers.dev/auth/callback` |
| Janela Google não abre | Pop-up bloqueado ou execução fora de gesto do usuário | Permita pop-ups e clique novamente em Conectar |
| Backend `not_configured`/HTTP 500 | Secrets/binding D1 ausentes, schema não criado | Verifique `DB`, variáveis, secrets e tabelas |
| Conta não autorizada | E-mail diferente de `ALLOWED_EMAIL` | Autorize a conta correta; não compartilhe a conta |
| Conexão volta a pedir consentimento depois de ~7 dias | OAuth External ainda em Testing | Confira Audience; veja regras do Google para produção |
| `session_expired` | Sessão Atlas expirada/removida | Clique Conectar e autorize novamente |
| `google_reauth_required` | Google expirou/revogou refresh token | Conecte novamente; não exclua seus registros |
| Dados diferentes nos dispositivos | Sincronização pendente, offline ou divergência | Exportar backup; compare cópias antes de substituir |
| Dados aparecem, mas anexo não abre | Anexo não foi enviado pelo dispositivo original | Recupere o arquivo original e refaça o envio |
| Versão antiga mesmo depois de publicar | Service Worker em cache | Aguarde Actions, recarregue, feche/reabra; não limpe IndexedDB |

## Testes e validação

Os arquivos do projeto são independentes de frameworks/bundlers. No ambiente de desenvolvimento que **tem Node.js**, os testes podem ser executados por:

```bash
node --check backend/worker.mjs
node --check site/app.js
node --check site/backend-client.js
node --test tests/backend.test.mjs tests/backend-client.test.mjs tests/drive-storage.test.mjs
```

Os testes simulam:
- fluxo OAuth (state, PKCE, token endpoint, conta autorizada),
- criptografia em repouso e token de sessão não armazenado em texto claro no D1,
- acesso permitido/negado pelo proxy,
- renovação de acesso Google e logout,
- criação, leitura, atualização, anexos, download e conflito do DriveStore.

**Não são testes de integração real** com Google Cloud, Cloudflare e GitHub. O teste de interface com navegador local (`tests/browser-smoke.py`) depende de Playwright e de um ambiente que permita localhost; ele está disponível para execução separada.

## Limitações e melhorias futuras

1. Adicionar testes de integração em um ambiente isolado do Google antes de migrar dados importantes.
2. Sincronização por registro e política de mesclagem mais refinada que o JSON completo.
3. Sessão persistente também para **Google Agenda** e opções avançadas de alarmes em dispositivos compatíveis.
4. Backups versionados e recuperação de anexos com relatório de integridade.
5. Melhorias de segurança: rate limiting, monitoração do Worker, proteção de origem com domínio exclusivo, verificação/auditoria de dependências e estratégia de rotação da chave AES.
6. Integração opcional de IA generativa para resumos, com autorização explícita e política clara de privacidade.
7. Ampliar opções de matiz por seletor contínuo com controle de contraste, depois de receber o feedback visual detalhado.
8. Revisar a interface comparando o protótipo alternativo, quando ele for disponibilizado, **sem descartar funcionalidades existentes**.

### Serviços oficiais

- [GitHub Pages](https://docs.github.com/en/pages)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Google OAuth para aplicativos web](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)

---

**Estado da distribuição:** a interface pode ser publicada como arquivos estáticos no GitHub; a sessão persistente só começa a funcionar **após você criar o Worker, o D1 e autorizar o OAuth corretamente**. Nenhuma chave/credencial foi gerada automaticamente no seu Google Cloud ou Cloudflare por este pacote.
