# HANDOFF — FITPLAN

Documento de referência do projeto: o que o sistema é, em que estado está, o que
não pode ser tocado e o que ficou em aberto. Escrito para uma sessão do Claude
Code que pegue o trabalho daqui — em especial uma rodando **na máquina do
usuário**, já que o Claude Code na web tem o proxy de saída bloqueando
`railway.app` e por isso nunca conseguiu testar o app publicado de fora.

---

## 1. O que é o sistema

**FITPLAN** — controle de aulas de personal trainer, usado por duas pessoas: o
**aluno** (Herbet, dono da conta) e o **personal** (professor).

Fluxo desenhado:

1. O aluno abre **Agenda → Dias do mês**, escolhe **com o personal** ou **sozinho**,
   marca os dias e vê na hora quanto vai custar (`N aulas × valor da hora-aula`).
   As duas modalidades são agendas independentes no mesmo mês.
2. As aulas entram como `agendada`, **sem treino**.
3. O personal abre cada dia e prescreve os exercícios (ou aplica um modelo A/B/C).
   Nas aulas com ele, o aluno só lê a prescrição.
4. Depois do horário, marcam `realizada` (com confirmação — **não se desfaz**),
   `falta` ou `cancelada`. Antes do horário nenhuma das duas primeiras é possível:
   quem já sabe que não vai, **remarca** para outro dia do mesmo mês.
5. A página **Financeiro** fecha o mês. **Pré-pago e sem devolução:** o valor é
   definido no agendamento e nenhum status o altera — só redistribui entre
   treinado, a treinar e perdido.

Aplicação **independente** do PLANGEST (o sistema de sell-out farmacêutico que
vive na raiz deste mesmo repositório). Banco, login e deploy próprios; nenhum
código compartilhado.

---

## 2. Estado atual — 05/09/2026

### Código

| Item | Valor |
|---|---|
| Repositório | `htardelli/planges` (privado) |
| Branch | `claude/aulas-control-app-a0wprp` |
| Último commit | `HEAD` |
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
| Volume | montado em **`/data`** (nome do volume: `d100-challenge-volume`, herdado) |
| Domínio | **https://dna-academia.up.railway.app** |
| Porta | 8080 (injetada pelo Railway via `PORT`) |
| Deploy | verde, automático a cada push na branch |

### Já resolvido

- [x] Serviço criado, apontado para `fitplan/` e renomeado para `fitplan`.
- [x] Volume em `/data` — o log do start confirma `[DB] FITPLAN em: /data/fitplan.db`.
- [x] Domínio público gerado; app usado pelo Chrome e pelo iPhone.
- [x] Auto-deploy pelo GitHub funcionando (push na branch → republica sozinho).
- [x] **Persistência comprovada na prática:** foram mais de vinte deploys desde que o
      usuário criou as aulas de setembro, e os dados seguem lá.

### Pendente — ações do usuário

| # | O quê | Onde | Urgência |
|---|---|---|---|
| 1 | **Trocar a senha inicial** | app → Configurações → Minha senha | **Alta** — a faixa amarela ainda aparece, então a senha é `fitplan123` num endereço público |
| 2 | Criar o acesso do personal | app → Configurações → Acessos | Alta — sem isso ele não monta os treinos |
| 3 | `Healthcheck Path` = `/health` | Railway → Settings → Deploy | Média |
| 4 | Backups do volume | Railway → aba **Backups** | Média |
| 5 | Conferir o valor da hora-aula | app → Configurações | Baixa — se estiver zerado, aulas novas nascem sem valor |

### Decisões em aberto (perguntar antes de implementar)

- **Feriados de Fortaleza** — 25/03 (Data Magna do Ceará) e 15/08 (N. Sra. da
  Assunção). Hoje só entram os nacionais.
- **Cancelamento deve pesar na frequência?** Hoje não pesa: a métrica mede
  disciplina de treino, não dinheiro.
- **Treino sozinho deve ter valor?** Hoje nasce R$ 0 e fica fora do financeiro.
- **Registro de pagamento** — o app diz quanto é devido, não o que foi pago. Sem
  isso, desmarcar um dia já pago derruba o valor do mês sem o sistema saber.
- **Multi-aluno** — o sistema assume um aluno; incluir a esposa é mudança de
  estrutura.

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
5. O app está **em uso real**. Antes de qualquer push, rodar as verificações da
   seção 4 e testar localmente com `FITPLAN_DATA_DIR` apontando para um banco
   descartável — nunca contra o banco de produção.

---

## 4. Como verificar uma mudança

### A. Localmente, antes do push

```bash
cd fitplan
FITPLAN_DATA_DIR=/tmp/fitplan-teste python -m uvicorn app:app --port 8090
```

Cobrir o que a mudança toca, e sempre estes invariantes:

| Verificação | Esperado |
|---|---|
| `GET /health` | `{"ok":true,...}` |
| `POST /api/aulas/mes` com duas modalidades no mesmo mês | uma agenda não apaga a outra |
| `PATCH` status `realizada` numa aula futura | **400** |
| `PATCH` data para outro mês | **400** |
| `PATCH` qualquer campo fora de `obs`/`pse` numa aula já realizada e passada | **400** |
| Aluno: `PUT /api/aulas/{id}/exercicios` numa aula `com_personal` | **403** |
| Aluno: `PATCH /api/aulas/{aid}/exercicios/{eid}` (execução) | **200** |
| Personal: `GET /api/usuarios` e `PUT /api/config` | **403** |
| 6 logins errados seguidos | **429** |
| Layout a 390px | sem rolagem lateral; nenhum campo abaixo de 16px |

### B. No app publicado, depois do deploy

O push republica sozinho em ~2 min. Conferir em
`https://dna-academia.up.railway.app`:

1. `/health` responde `{"ok":true,"db":"/data/fitplan.db"}` — se o caminho não for
   `/data/`, o volume não montou.
2. O log de Deploy não traz erro de migração.
3. Uma aula existente continua lá (persistência).

**Limpe todo dado de teste** que criar no ambiente publicado.

---

## 5. Referência técnica

### Stack

Python 3.11 · FastAPI · SQLite (aiosqlite) · JWT (`python-jose`) · bcrypt
(`passlib`) · SPA em HTML/CSS/JS puro · Chart.js 4.4 via CDN · fonte **Ruda**
auto-hospedada em `static/fonts` (variável: um arquivo por subset cobre 400–900).

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
    ├── fonts/            # Ruda (variável, latin + latin-ext) servida pelo app
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
| GET | `/api/aulas/hoje` | treino de hoje (ou o próximo agendado), já com exercícios |
| PUT | `/api/aulas/{id}/exercicios` | substitui a lista de exercícios |
| PATCH | `/api/aulas/{aid}/exercicios/{eid}/series/{ordem}` | registra UMA série (carga, reps, feito) |
| POST | `/api/aulas/{id}/aplicar-modelo/{mid}` | copia um modelo para a aula |
| POST | `/api/aulas/{id}/usar-modelo/{mid}` | aplica **ou** sugere, conforme quem manda no treino do dia |
| DELETE | `/api/aulas/{id}/sugestao` | retira a sugestão pendente |
| GET/POST/PATCH/DELETE | `/api/exercicios*` | biblioteca |
| GET | `/api/exercicios/catalogo` | contagem por grupo muscular e por equipamento |
| POST | `/api/exercicios/{id}/favorito` | alterna favorito |
| GET/POST/DELETE | `/api/medidas*` | medidas corporais — **escrita só o dono** |
| GET | `/api/corpo` | peso, IMC, meta, ritmo e série do gráfico |
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
- **`realizada` é irreversível** (quando a aula já começou): `PATCH /api/aulas/{id}`
  aceita apenas `obs` e `pse`; qualquer outro campo devolve **400**. Excluir a aula
  também some da interface.
- **Execução separada da prescrição:** `PATCH /api/aulas/{aid}/exercicios/{eid}` aceita
  `feito`, `carga` e `obs` e é liberado para os dois perfis — inclusive para o aluno numa
  aula com o personal, onde o `PUT` da lista continua **403**.
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
- **Correção automática no start** (`_corrigir_aulas_futuras`): toda aula futura
  marcada como `realizada` ou `falta` volta para `agendada`. Idempotente e restrita
  ao que é impossível; roda a cada start como guarda-corpo contra dado antigo.
- **Feriados calculados, não consultados** (`_feriados`): os fixos por data e os
  móveis a partir da Páscoa (Meeus). Distingue feriado nacional de ponto
  facultativo (Carnaval, Cinzas, Corpus Christi). Consciência Negra a partir de
  2024. Só nacionais — estaduais e municipais ficam de fora.

### Interface

- SPA de página única com **sidebar no desktop** e **barra de navegação inferior no
  celular** — as duas compartilham o mesmo `data-page`, e `nav()` acende ambas.
- Temas claro e escuro por **tokens CSS**; o escuro é quase preto puxando para o
  verde, com texto escuro sobre o acento (`--on-primary`).
- Cuidados de celular que precisam ser preservados em qualquer mudança de CSS:
  - todo campo com **16px ou mais** — abaixo disso o iOS dá zoom na página e não
    desfaz;
  - `appearance: none` nos campos `date`/`time`, que no Safari ignoram a largura
    do container;
  - `min-width: 0` nas células do grid de formulário, senão os mesmos campos
    estouram a coluna;
  - a tabela de aulas cabe exatamente na largura de 390px — mexer em colunas exige
    remedir.
- Ícones: status usa 📅 ✅ ❌ 🚫; ações usam ✅ (concluir) e 🔁 (remarcar). **Nenhum
  ícone de ação pode repetir o ícone de status da mesma linha.**
- No celular a barra lateral é `display: none` **e o botão de menu também** — logo,
  tudo que existir só na sidebar fica inalcançável no telefone. Foi assim que o
  "Sair" ficou inacessível até virar um cartão em Ajustes. Antes de pôr qualquer
  ação só na lateral, confira se ela tem caminho no celular.
- O painel do mês usa **`S/D`** (não "sem dados"): a coluna da direita é estreita e
  alinhada, e texto longo desalinha as quatro barras.
- **Modalidade tem convenção única no app inteiro:** personal = **azul e redondo**,
  individual = **verde e quadrado**. Cor sozinha não basta (daltonismo, olhada de
  relance no meio da série) — a forma carrega a mesma informação. No calendário a
  cor já é do *status*, então a modalidade entra como **listra diagonal** = individual.
  Cuidado: no celular o chip vira barrinha com `border-left-width: 0`, o que apagava
  a borda tracejada que antes era a única marca de modalidade lá.
- **Barra inferior × barra de endereços do Safari.** Esconder a barra de endereços
  ao rolar muda a altura visível **sem mover** o que está em `position: fixed` —
  sobra uma fresta entre a barra do app e a do navegador, com o conteúdo da página
  aparecendo por ela. Duas defesas, ambas necessárias:
  `ajustarBarraInferior()` desloca a barra pela diferença que a **VisualViewport**
  informa (funciona nos dois sentidos: barra alta demais e barra escondida sob a do
  navegador), e `.tabbar::after` pinta 160px de fundo abaixo dela para o caso de o JS
  não rodar. Não remova nenhuma das duas achando que a outra basta.

### Modo treino (a tela da academia)

Overlay de tela cheia (`#modo-treino`, `z-index: 120`), um exercício por vez.

- **Carga e repetições já chegam preenchidas**: carga vem da *última carga*
  registrada naquele exercício (ou da prescrição, se não houver histórico);
  repetições vêm da prescrição. No caso comum — mesmo peso da última vez — o
  único toque da série é o ✓. Isso é o ponto do desenho, não um detalhe: cada
  toque a mais é um toque que não acontece com o celular na mão, suado, em pé.
- Marcar a série **congela na série o que está na tela** (a sugestão vira registro).
- O ✓ e os botões ± ficam **desabilitados enquanto o treino não começou** — mesma
  regra do status da aula, aplicada também no backend (HTTP 400).
- Descanso: começa sozinho ao marcar a série, usa `descanso_seg` da prescrição,
  vibra e apita no zero (`navigator.vibrate` + `AudioContext`, sem arquivo externo).
- `Concluir treino` marca a aula como `realizada` — com a mesma confirmação
  irreversível de sempre, e informando quantos exercícios ficaram sem marcar.

**Os modais estão em `z-index: 200`, ACIMA do modo treino.** Se alguém baixar esse
valor, a régua de carga abre atrás da tela cheia e trava a série no meio — foi um
defeito real, encontrado em teste antes do deploy.

### Régua de valores

Seletor por rolagem (`#m-regua`) no lugar do teclado numérico: campo numérico no
celular abre teclado, o iOS dá zoom e o alvo fica menor. A fita é um **gradiente
com traços posicionados por JS**, não elementos — 600 posições sem 600 nós no DOM.
A escala é montada com recuo de `metadeDaLargura` em cada ponta; é isso que faz o
valor escolhido parar exatamente sob a agulha. Se mexer na largura da caixa,
`rgMontar()` precisa rodar de novo.

### Prescrição × execução × séries

Três camadas que não se misturam:

| Camada | Onde mora | Quem mexe |
|---|---|---|
| Prescrição | `aula_exercicios` (nome, séries, repetições, descanso) | personal (ou o aluno em aula `sozinho`) |
| Execução por série | `aula_series` (carga, repetições, feito) | quem treinou, os dois perfis |
| Resumo do item | `aula_exercicios.carga` / `.feito` | **derivado** — `_sincronizar_item()` |

`carga` do item = **maior carga executada**; `feito` = todas as séries marcadas.
É isso que mantém `/api/evolucao`, o volume do mês e as telas antigas funcionando
sem saberem que séries existem. Ponto de atenção conhecido: marcar `feito` pelo
modal antigo da aula **não** marca as séries; o inverso funciona.

`PUT /api/aulas/{id}/exercicios` substitui a lista inteira, mas **preserva as séries
já registradas**, casando por nome do exercício. Sem isso, o personal ajustar o
treino depois da aula — ou o aluno acrescentar um exercício no meio do treino —
apagaria as cargas recém-lançadas. Quem mexer nessa rota tem de manter esse resgate.
As séries nascem preguiçosamente (`_garantir_series`) na primeira leitura da aula;
subir de 3 para 6 séries reabre o exercício que estava concluído.

### Sugestão de modelo

`aulas.sugestao_modelo_id` é o modelo que o **aluno pediu** para uma aula do
personal. Fica separado de `modelo_id`, que é a prescrição de fato: **pedido não
é prescrição**. `POST /api/aulas/{id}/usar-modelo/{mid}` decide sozinho:

- quem **pode montar** aquele treino (aula `sozinho`, ou usuário `personal`) →
  o modelo é **aplicado**, substituindo os exercícios do dia;
- o aluno numa aula **com o personal** → vira **sugestão**, e o personal decide.

Aplicar um modelo (por qualquer caminho) **limpa a sugestão** — deixá-la faria o
personal reencontrar um pedido que ele já atendeu. Aula encerrada (realizada,
falta ou cancelada) recusa as duas ações.

### Segurança já implementada

- Chave de assinatura dos tokens sorteada no 1º start e guardada no banco
  (não existe chave padrão no código).
- Bloqueio de força bruta: 5 erros por e-mail+IP → 10 min (HTTP 429), em memória.
- Senha mínima de 8 caracteres.
- Aviso na interface enquanto a senha inicial estiver em uso (`senha_padrao`).
- Toda rota `/api/*` exige token.

### Ainda não existe (candidatos a próximo passo, se o usuário pedir)

- Registro de **pagamento** ("pago em tal data") — hoje só há "devido".
- **Sem foto de progresso** e sem histórico de medidas na tela (o banco guarda
  cintura/quadril/peito/braço/coxa; a tela só mostra o peso).
- **Backup** dentro do app. O Railway oferece backup do volume na aba *Backups*,
  que resolve o essencial e ainda não foi ativado.
- Multi-aluno: o sistema assume **um** aluno.
- Feriados estaduais e municipais.
- Nenhuma suíte de testes automatizados: a verificação é a da seção 4.
