# Contador de Público — Supabase + Vercel

Aplicativo para vários celulares contarem entradas e saídas simultaneamente. A Vercel publica o site e executa a API; o Supabase mantém o histórico persistente.

---

## Enviar para o Tomazeli

Tomazeli, segue o contador de público:

**Link pros atiradores:**
https://apoiotgfiemg.vercel.app

**Cada atirador:**
1. Abre o link no celular
2. Seleciona o nome e o portão
3. Aperta +1 ENTRADA ou +1 SAÍDA conforme o movimento
4. Se errar, aperta Desfazer
5. Se ficar sem internet, continua contando — sincroniza sozinho depois

**Painel da diretoria (não mandar pros atiradores):**
https://apoiotgfiemg.vercel.app/?painel

Nele você vê público presente, entradas/saídas, fluxo por hora, movimento por portão, lista da equipe e exportação CSV/JSON.

**Pra adicionar atirador ou portão (PowerShell no PC):**
```powershell
$body = @{ password = 'SUA_SENHA'; action = 'add_person'; name = 'Atdr 120 NOME'; role = 'Atirador' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://apoiotgfiemg.vercel.app/api/admin' -ContentType 'application/json' -Body $body

$body = @{ password = 'SUA_SENHA'; action = 'add_gate'; gate = 'Nome do portão' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://apoiotgfiemg.vercel.app/api/admin' -ContentType 'application/json' -Body $body
```

**Importante:**
- Um celular por fila, pra não contar dobrado
- O dia operacional vira sozinho à meia-noite (horário de Brasília)
- No painel tem exportação CSV e JSON se precisar de relatório
- Qualquer coisa me chama.

---

## Tomazeli envia pros atiradores

> **Link:** https://apoiotgfiemg.vercel.app
>
> **Como usar:**
> 1. Abra o link no celular
> 2. Escolha seu nome e o portão em que vai ficar
> 3. Use +1 ENTRADA ou +1 SAÍDA conforme o movimento
> 4. Registre cada pessoa individualmente com +1
> 5. Se marcar errado, toque em Desfazer imediatamente
> 6. Se a internet cair, continue contando normalmente — os registros sincronizam sozinhos quando voltar
> 7. Ao trocar de posto, use "Trocar posto"
>
> **Atenção:** nunca conte a mesma fila em dois celulares ao mesmo tempo.

---

## Setup técnico (para o deploy)

### 1. Criar o banco no Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Abra **SQL Editor → New query**.
3. Cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql).
4. Clique em **Run**.

### 2. Obter as credenciais

No painel do Supabase, abra **Settings → API Keys** e copie:
- **Project URL**
- Uma chave secreta no formato `sb_secret_...`

Nunca coloque essas chaves em arquivos públicos ou no GitHub.

### 3. Subir o código para o GitHub

```powershell
git add .
git commit -m "Preparar contador para deploy"
git branch -M main
git remote add origin URL_DO_REPOSITORIO
git push -u origin main
```

### 4. Criar o projeto na Vercel

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

6. Clique em **Deploy**.

Depois do deploy, acesse o endereço e faça uma marcação de teste.

### Antes do evento

1. Faça uma contagem completa de teste
2. Exporte o backup JSON
3. Confirme que o painel mostra o dia operacional correto
4. Confirme que o painel voltou a zero no novo dia

---

## Desenvolvimento local

```powershell
npm run dev
```

Acesse `http://localhost:3000`. Os registros locais ficam em `data/actions.jsonl`.

## Testes

```powershell
npm test
```
