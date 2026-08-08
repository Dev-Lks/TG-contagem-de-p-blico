# Contador de Público — Supabase + Vercel

Aplicativo para vários celulares contarem entradas e saídas simultaneamente. A Vercel publica o site e executa a API; o Supabase mantém o histórico persistente.

## O que já está pronto

- registro por atirador, portão e sentido;
- botões `+1`, `+5`, `+10` e desfazer auditável;
- fila offline no celular com reenvio automático;
- IDs únicos, permitindo repetir uma solicitação sem duplicar a contagem;
- painel consolidado e estimativa visual separada;
- modo de simulação local, com fluxo por hora, pico e portão mais movimentado;
- lista inicial de monitores/atiradores, com inclusão de novas pessoas pelo próprio painel;
- exportação CSV e backup JSON;
- atualização incremental para reduzir o tráfego durante o evento;
- chave elevada do Supabase somente no backend da Vercel.

## 1. Criar o banco no Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Abra **SQL Editor → New query**.
3. Cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql).
4. Clique em **Run**. As tabelas `counter_actions` e `counter_roster` deverão aparecer em **Table Editor**.

> Se você já executou uma versão anterior do SQL, rode o arquivo atualizado novamente: ele também cria a lista compartilhada da equipe.

## 2. Obter as credenciais

No painel do Supabase, abra **Settings → API Keys** e copie:

- **Project URL**;
- uma chave secreta nova no formato `sb_secret_...`.

Também é possível usar a chave legada `service_role`. Nunca coloque nenhuma dessas chaves em `public/app.js`, no GitHub ou em mensagens. Elas ficam apenas nas variáveis protegidas da Vercel.

## 3. Subir o código para o GitHub

Crie um repositório privado vazio e, nesta pasta, execute:

```powershell
git add .
git commit -m "Preparar contador para Supabase e Vercel"
git branch -M main
git remote add origin URL_DO_REPOSITORIO
git push -u origin main
```

O arquivo `.env` e os registros locais estão ignorados pelo Git.

## 4. Criar o projeto na Vercel

1. Entre em [vercel.com](https://vercel.com) e selecione **Add New → Project**.
2. Importe o repositório do GitHub.
3. Deixe **Framework Preset** como `Other`.
4. Não informe Build Command nem Output Directory.
5. Abra **Environment Variables** e adicione:

| Nome | Valor de exemplo |
|---|---|
| `SUPABASE_URL` | `https://abcdefgh.supabase.co` |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` |
| `EVENT_ID` | `fiemg-2026-08-08` |
| `EVENT_NAME` | `Apoio à FIEMG` |
| `EVENT_GATES` | `Entrada principal,Entrada lateral,Estacionamento` |

Use um `EVENT_ID` novo para cada evento. Isso inicia uma contagem zerada sem apagar o histórico anterior.

6. Clique em **Deploy**.

Depois do deploy, abra o endereço `https://nome-do-projeto.vercel.app`. Confirme no painel que aparece `0 entradas`, faça uma marcação de teste e verifique se uma linha surgiu em `counter_actions` no Supabase.

## 5. Entregar aos responsáveis

Envie o mesmo link da Vercel para todos. A equipe já aparece na lista; o responsável pode adicionar alguém caso necessário. Cada atirador seleciona o próprio nome, portão e movimento. Recomenda-se um celular por fila para evitar contagem duplicada.

Antes do evento:

1. faça uma contagem completa de teste;
2. exporte o backup JSON;
3. altere `EVENT_ID` na Vercel para o identificador oficial;
4. faça um novo deploy;
5. confirme que o painel voltou a zero.

## Desenvolvimento local

O servidor local continua disponível para testar a interface sem Supabase:

```powershell
npm start
```

Acesse `http://localhost:3000`. Os registros locais ficam em `data/actions.jsonl` e não são enviados ao GitHub.

## Testes

```powershell
npm test
```
