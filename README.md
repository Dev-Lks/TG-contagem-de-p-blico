# Contador de Público — Supabase + Vercel

Aplicativo para vários celulares contarem entradas e saídas simultaneamente. A Vercel publica o site e executa a API; o Supabase mantém o histórico persistente.

## O que já está pronto

- registro por atirador, portão e sentido;
- botões `+1`, `+5`, `+10` e desfazer auditável;
- fila offline no celular com reenvio automático;
- IDs únicos, permitindo repetir uma solicitação sem duplicar a contagem;
- painel consolidado e estimativa visual separada;
- painel real com fluxo por hora, pico e portão mais movimentado;
- lista inicial de monitores/atiradores; inclusão protegida por senha somente pela API;
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
| `EVENT_ID` | `fiemg` |
| `EVENT_NAME` | `Apoio à FIEMG` |
| `EVENT_GATES` | `Entrada principal,Entrada lateral,Estacionamento` |
| `ADMIN_PASSWORD` | senha forte exclusiva do responsável |

Use um `EVENT_ID` novo para cada evento. O app acrescenta a data automaticamente no horário de Brasília (por exemplo, `fiemg-2026-08-08` e `fiemg-2026-08-09`), portanto hoje e amanhã ficam separados sem ninguém precisar trocar nada.

Para adicionar alguém à equipe ou criar mais um portão, use a API protegida por senha; essas opções não aparecem no celular dos atiradores:

```powershell
$body = @{ password = 'SUA_SENHA'; action = 'add_person'; name = 'Atdr 120 NOME'; role = 'Atirador' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://SEU-APP.vercel.app/api/admin' -ContentType 'application/json' -Body $body

$body = @{ password = 'SUA_SENHA'; action = 'add_gate'; gate = 'Entrada do estacionamento' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://SEU-APP.vercel.app/api/admin' -ContentType 'application/json' -Body $body
```

6. Clique em **Deploy**.

Depois do deploy, abra o endereço `https://nome-do-projeto.vercel.app`. Confirme no painel que aparece `0 entradas`, faça uma marcação de teste e verifique se uma linha surgiu em `counter_actions` no Supabase.

## 5. Entregar aos responsáveis

Envie o mesmo link da Vercel para todos. A equipe já aparece na lista. Cada atirador seleciona o próprio nome e portão; no mesmo celular, ele registra tanto entradas quanto saídas. Recomenda-se um celular por fila para evitar contagem duplicada.

Antes do evento:

1. faça uma contagem completa de teste;
2. exporte o backup JSON;
3. confirme que o painel mostra o dia operacional correto; ele muda sozinho à meia-noite no horário de Brasília;
4. confirme que o painel voltou a zero no novo dia.

## Desenvolvimento local

O servidor local continua disponível para testar a interface sem Supabase:

```powershell
npm run dev
```

Acesse `http://localhost:3000`. Os registros locais ficam em `data/actions.jsonl` e não são enviados ao GitHub.

## Testes

```powershell
npm test
```
