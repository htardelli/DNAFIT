# HANDOFF — finalizar a publicação do FITPLAN

Documento de passagem para uma sessão do Claude Code rodando **na máquina do
usuário** (rede sem restrição, navegador disponível, CLI do Railway instalável).

A sessão anterior rodou no Claude Code na web, cujo proxy de saída **bloqueia
`railway.app`** — por isso a verificação do app publicado não pôde ser feita lá.
Essa é a única razão deste handoff.

---

## 1. O que é o sistema

**FITPLAN** — controle de aulas de personal trainer, usado por duas pessoas: o
**aluno** (Herbet, dono da conta) e o **personal** (professor).

Fluxo desenhado:

1. O aluno marca no calendário os dias do mês em que fará aula (**Agenda → Dias do mês**)
   e vê na hora quanto vai custar (`N aulas × valor da hora-aula`).
2. As aulas entram como `agendada`, **sem treino**.
3. O personal abre cada dia e prescreve os exercícios (ou aplica um modelo A/B/C).
4. Depois da aula, marcam `realizada` / `falta` / `cancelada`.
5. A página **Financeiro** fecha o mês. **Pré-pago:** o valor do mês é definido no
   agendamento; mudar o status depois só redistribui (treinado / a treinar / perdido).

Aplicação **independente** do PLANGEST (o sistema de sell-out farmacêutico que
vive na raiz deste mesmo repositório). Banco, login e deploy próprios; nenhum
código compartilhado.

---

## 2. Estado atual — verificado em 02/09/2026

### Código

| Item | Valor |
|---|---|
| Repositório | `htardelli/planges` (privado) |
| Branch | `claude/aulas-control-app-a0wprp` |
| Último commit | `db0cbe5` — "FITPLAN: modelo pre-pago e remarcacao restrita ao mes" |
| Pasta do app | `fitplan/` |

### Railway

| Item | Valor |
|---|---|
| Projeto | **FIT_DNA** — `2fefe5cd-54a5-4062-96a7-48760fa4e2f3` |
| Ambiente | `production` — `bf58e74f-fdc2-48e6-ad9e-1dbf4a191181` |
| Serviço | **`fitplan`** |
| Source Repo | `htardelli/planges` |
| Root Directory | `fitplan` |
| Branch | `claude/aulas-control-app-a0wprp` |
| Volume | montado em **`/data`** |
| Domínio | **https://dna-academia.up.railway.app** |
| Porta | 8080 (injetada pelo Railway via `PORT`) |
| Último deploy | verde |

Log do start confirmando que o volume pegou:

```
Mounting volume on: /var/lib/containers/railwayapp/bind-mounts/.../vol_j54pxyy4a8b4ojnf
Starting Container
[DB] FITPLAN em: /data/fitplan.db
[DB] Biblioteca inicial: 38 exercícios
[DB] Usuário dono criado: htardelli@gmail.com (troque a senha no primeiro acesso)
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8080
```

### Já resolvido pelo usuário

- [x] Serviço renomeado para `fitplan`; domínio gerado e app acessado pelo Chrome.
- [x] Auto-deploy pelo GitHub funcionando (push na branch → republica sozinho).

### O que ficou pendente

- [ ] Confirmar se a variável `FITPLAN_ADMIN_SENHA` foi criada. Se não foi, a senha do
      dono é `fitplan123` e o app mostra uma faixa amarela de aviso.
- [ ] Persistência do volume não comprovada por teste explícito (o log confirma o mount).
- [ ] `Healthcheck Path` = `/health` não configurado.
- [ ] Acesso do personal ainda não criado.
- [ ] Backups do volume (a aba **Backups** do serviço permite agendar) não configurados.

---

## 3. Regras invioláveis

1. **Nunca** fazer push na branch `main` de `htardelli/planges`. Ela é o PLANGEST
   em produção, com deploy automático. Todo trabalho do FITPLAN vai na branch
   `claude/aulas-control-app-a0wprp`.
2. **Não tocar** no repositório `htardelli/d100-challenge` nem no projeto **D100**
   do Railway. São outro trabalho do usuário, já publicado.
3. **Não** desabilitar verificação TLS nem contornar proxy.
4. **Não** escrever senhas, tokens ou a `FITPLAN_SECRET_KEY` em commits, logs ou
   no chat. Se precisar de uma senha, peça ao usuário digitá-la no painel do
   Railway ou passe por variável de ambiente local.
5. Antes de qualquer push, rodar as verificações da seção 6.

---

## 4. Tarefas a executar

### A. Verificação funcional do app publicado

Base: `https://dna-academia.up.railway.app`

1. **Health**
   ```bash
   curl -s https://dna-academia.up.railway.app/health
   # esperado: {"ok":true,"db":"/data/fitplan.db"}
   ```
   Se `db` não for `/data/fitplan.db`, o volume não está montado — pare e reporte.

2. **Login e senha padrão**
   ```bash
   curl -s -X POST https://dna-academia.up.railway.app/auth/login \
     -d "username=htardelli@gmail.com&password=<SENHA>"
   ```
   Com o token, `GET /auth/me` devolve `senha_padrao: true|false`.
   Se vier `true`, avise o usuário: a senha ainda é a inicial e precisa ser trocada
   em **Configurações → Minha senha** (mínimo 8 caracteres).

3. **Configuração de preço** — `GET /api/config` deve trazer `valor_hora`.
   Se estiver `0`, peça ao usuário o valor real da hora-aula e grave via
   `PUT /api/config` (ou peça que ele preencha na tela de Configurações).

4. **Ciclo completo de uma aula**, via API ou navegador:
   - `POST /api/aulas/mes` com `{"mes":"2026-09","dias":[2,4,6]}` → cria 3 aulas
   - `GET /api/resumo?mes=2026-09` → confere `financeiro.valor_mes` = 3 × valor_hora
   - `PUT /api/aulas/{id}/exercicios` → grava exercícios
   - `PATCH /api/aulas/{id}` com `{"status":"realizada"}` → `valor_mes` **não muda**;
     migra de `a_treinar` para `treinado`
   - `PATCH /api/aulas/{id}` com uma `data` de outro mês → deve devolver **400**
   - `DELETE` das aulas de teste ao final — **não deixar lixo no banco**

5. **Isolamento do perfil `personal`** — criar um usuário de teste com
   `POST /api/usuarios` (role `personal`), logar com ele e confirmar:
   - `GET /api/usuarios` → **403**
   - `PUT /api/config` → **403**
   - `GET /api/aulas` → **200**
   Depois **apagar o usuário de teste**.

6. **Força bruta** — 6 tentativas de login com senha errada; a 6ª deve devolver
   **429**. Use um e-mail inexistente para não bloquear a conta real.

### B. Teste de persistência (o mais importante)

Com dados de teste no ar:

1. `Deployments → ⋮ → Redeploy` no Railway (ou `railway redeploy`).
2. Esperar subir.
3. `GET /api/aulas?mes=2026-09` — **as aulas têm que continuar lá**.

Se sumirem, o volume não está guardando de verdade: confira o mount path
(`/data`, exatamente) e reporte antes de o usuário começar a usar para valer.

### C. Ajustes finais no Railway

Preferir a CLI (`npm i -g @railway/cli`, `railway login`, `railway link` no
projeto FIT_DNA). Se algum passo não existir na CLI, instruir o usuário com o
caminho exato de cliques.

1. **Renomear o serviço** de `d100-challenge` para `fitplan`.
2. **Healthcheck Path** = `/health` (Settings → Deploy).
3. Confirmar a variável `FITPLAN_ADMIN_SENHA`. Se faltar, pedir ao usuário que
   defina no painel — **não invente uma senha nem escreva a dele em lugar nenhum**.
4. Opcional, se o usuário quiser economizar crédito: **App Sleeping**.

### D. Criar o acesso do personal

Pelo app: **Configurações → Acessos → + Novo acesso**, perfil **Personal**.
Peça ao usuário o nome, e-mail e senha do professor — não escolha por ele.

### E. Relatório final

Entregar ao usuário:
- resultado item a item das seções A e B;
- o que foi ajustado em C;
- qualquer risco encontrado;
- confirmação de que os dados de teste foram removidos.

---

## 5. Referência técnica

### Stack

Python 3.11 · FastAPI · SQLite (aiosqlite) · JWT (`python-jose`) · bcrypt
(`passlib`) · SPA em HTML/CSS/JS puro · Chart.js 4.4 via CDN.

### Arquivos

```
fitplan/
├── app.py                # API: auth, aulas, treinos, modelos, planos, financeiro
├── db.py                 # schema, migrações idempotentes, seeds
├── requirements.txt      # 7 pacotes
├── railway.toml          # startCommand lê $PORT
├── iniciar_fitplan.bat   # atalho local (Windows)
├── README.md             # manual do usuário
├── HANDOFF.md            # este documento
└── static/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

### Rodar localmente

```bash
cd fitplan
pip install -r requirements.txt
FITPLAN_DATA_DIR=/tmp/fitplan-teste python -m uvicorn app:app --port 8090
```

`FITPLAN_DATA_DIR` isola o banco de teste. Sem ela, o `.db` nasce na pasta do
projeto (já está no `.gitignore`).

### Variáveis de ambiente

| Variável | Padrão | Observação |
|---|---|---|
| `FITPLAN_ADMIN_EMAIL` | `htardelli@gmail.com` | dono, criado no 1º start com banco vazio |
| `FITPLAN_ADMIN_SENHA` | `fitplan123` | idem — trocar em produção |
| `FITPLAN_ADMIN_NOME` | `Tardelli` | |
| `FITPLAN_TOKEN_HORAS` | `720` | 30 dias, para não relogar no celular |
| `FITPLAN_SECRET_KEY` | — | **não definir**: sorteada no 1º start e guardada no banco |
| `FITPLAN_UTC_OFFSET` | `-3` | fuso do usuário; o contêiner roda em UTC |
| `FITPLAN_DATA_DIR` | — | força a pasta do banco |

### Endpoints

| Método | Rota | Papel |
|---|---|---|
| POST | `/auth/login` | e-mail + senha → JWT |
| GET | `/auth/me` | inclui `senha_padrao` |
| POST | `/auth/senha` | troca a própria senha |
| GET/POST/PATCH/DELETE | `/api/usuarios*` | **só o dono** |
| GET/PUT | `/api/config` | leitura livre; escrita **só o dono** |
| GET/POST/PATCH/DELETE | `/api/aulas*` | agenda |
| POST | `/api/aulas/mes` | marca os dias do mês em lote |
| PUT | `/api/aulas/{id}/exercicios` | substitui a lista de exercícios |
| POST | `/api/aulas/{id}/aplicar-modelo/{mid}` | copia um modelo para a aula |
| GET/POST/PATCH/DELETE | `/api/exercicios*` | biblioteca |
| GET/POST/PUT/DELETE | `/api/modelos*` | treinos A/B/C |
| GET/POST/PUT/DELETE | `/api/planos*` | pacotes |
| GET | `/api/resumo?mes=` | KPIs do mês + bloco financeiro |
| GET | `/api/frequencia?ano=` | séries para os gráficos |
| GET | `/api/evolucao?exercicio=` | carga máxima por data |
| GET | `/api/financeiro?ano=` | fechamento mês a mês |
| GET | `/api/feriados?ano=` | feriados nacionais calculados (fixos + móveis pela Páscoa) |
| GET | `/health` | healthcheck |

### Perfis

- **`aluno`** — dono: tudo, inclusive gestão de acessos e definição do preço.
- **`personal`** — professor: agenda, treinos, exercícios, planos, frequência.
  Bloqueado no **backend** (não só na tela) em `/api/usuarios*` e `PUT /api/config`.

### Regras de negócio

- Status: `agendada` · `realizada` · `falta` · `cancelada`.
- **Modalidade da aula** (`modalidade`): `com_personal` | `sozinho`.
  - `sozinho` nasce com `valor = 0` e **fica fora** de todo o financeiro
    (`/api/resumo` e `/api/financeiro` filtram por `modalidade='com_personal'`).
  - O aluno só monta o treino de aulas `sozinho`. Em aula `com_personal`,
    `PUT /api/aulas/{id}/exercicios` e `POST .../aplicar-modelo/{mid}` devolvem **403**,
    e `PATCH` aceita dele apenas `data`, `hora`, `status`, `obs`, `pse`, `valor` e
    `modalidade` — qualquer outro campo devolve 403.
  - O personal monta o treino de qualquer aula.
  - `POST /api/aulas/mes` opera **por modalidade**: marcar os dias de uma agenda nunca
    remove aulas da outra (as da outra voltam em `outras_modalidades`).
- **Só o passado pode ser finalizado:** `realizada` e `falta` exigem que o início da
  aula já tenha ocorrido (data + hora; sem hora, o início do dia). Validado na criação,
  na mudança de status e na mudança de data — sempre sobre o **estado final**.
- **Fuso horário:** o app usa `TZ_APP` = UTC-3 (env `FITPLAN_UTC_OFFSET`), nunca a hora
  do contêiner. `_hoje()` e `_agora()` são os únicos pontos de entrada de tempo.
- **Toda** aula na agenda consome o pacote — o valor pago nunca é devolvido.
- **Aderência** = realizadas ÷ (realizadas + faltas + agendadas já vencidas).
  Canceladas ficam fora **desta métrica** (mede disciplina de treino, não dinheiro).
- **Modelo PRÉ-PAGO E SEM DEVOLUÇÃO:** o mês é pago quando as aulas entram na agenda.
  `valor_mes` = **todas** as aulas do mês; `treinado` = realizadas;
  `a_treinar` = agendadas; `perdido` = faltas + canceladas.
  Nenhum status altera `valor_mes` — só redistribui.
- **Remarcação só dentro do mesmo mês:** `PATCH /api/aulas/{id}` com uma `data` de
  outro mês devolve **400**. O mês já está pago; migrar a aula moveria dinheiro entre
  fechamentos.
- Cada aula guarda o **valor da hora-aula do dia em que foi criada** (snapshot):
  reajuste não reescreve mês fechado.
- Prioridade do valor: `valor_hora` do pacote vigente > `valor_hora` da configuração.
- **Volume de carga (kg)** = séries × repetições × carga, só nas realizadas.
  Repetição em tempo ("30s") não entra.
- Modelo de treino é **molde**: ao aplicar, os exercícios são copiados. Editar a
  aula depois não altera o modelo.
- Redefinir os dias do mês **nunca apaga** aula realizada, com falta, cancelada ou
  já com treino montado — elas voltam em `protegidas` na resposta.

### Segurança já implementada

- Chave de assinatura dos tokens sorteada no 1º start e guardada no banco
  (não existe chave padrão no código).
- Bloqueio de força bruta: 5 erros por e-mail+IP → 10 min (HTTP 429), em memória.
- Senha mínima de 8 caracteres.
- Aviso na interface enquanto a senha inicial estiver em uso (`senha_padrao`).
- Toda rota `/api/*` exige token.

### Ainda não existe (candidatos a próximo passo, se o usuário pedir)

- Registro de **pagamento** ("pago em tal data") — hoje só há "devido".
- **Backup** automático do `fitplan.db`.
- Multi-aluno: o sistema assume **um** aluno.
