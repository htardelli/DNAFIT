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

## 2. Estado atual — 05/10/2026

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
- **Recusa de transferência devolve a chance?** Implementei **sim**: só a
  aprovação consome a única transferência da aula. Punir o aluno por uma decisão
  do personal deixaria a aula presa num dia que já se sabe inviável — mas é regra
  de negócio dele, não minha. Confirmar.
- **Prazo para transferir?** Hoje não existe: dá para remarcar até uma aula de
  mês fechado, desde que esteja `agendada`. Se ele quiser exigir aviso com
  antecedência (24h, por exemplo), é uma validação na rota `transferir`.

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
| GET/POST/DELETE | `/api/pagamentos*` | Pix informado (**só o dono informa**) |
| GET | `/api/pagamentos/avisos` | o que precisa aparecer por cima da tela inicial |
| POST | `/api/pagamentos/{id}/confirmar` | recebimento — **só o personal** |
| POST | `/api/pagamentos/{id}/visto` | o aluno deu ciência da confirmação |
| GET/POST/DELETE | `/api/cadastros*` | professores e locais — **os dois perfis** |
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
  - em treino **sozinho**, `Professor`, `Pacote` e `valor` ficam ocultos — os três só
    existem no acordo com o personal. E, ao salvar, vão **nulos**: campo escondido
    que continua enviando o valor antigo é como o dado fica inconsistente sem
    ninguém ver. Vale no modal da aula e em *Dias do mês*;
  - na tela de **marcar** aula (`novaAula`), `status`, `PSE` e `valor` ficam ocultos:
    aula nova nasce agendada, PSE só existe depois do treino e o valor vem da
    configuração vigente. Eles voltam ao **editar** — e o PSE só depois que a aula
    começou. O valor continua sendo enviado na criação: é ele que fecha o mês;
  - a tabela de aulas cabe exatamente na largura de 390px — mexer em colunas exige
    remedir.
- **`<datalist>` não serve como biblioteca no celular.** O campo do exercício tem
  `list="dl-ex"`, que no computador abre uma lista navegável e no Safari do iPhone
  vira só três sugestões na barra do teclado — sem seta, sem rolagem. Por isso
  existe o botão 🔍 dentro do campo, que abre `#m-escolher-ex` (busca, ⭐ e grupos)
  e escreve o nome escolhido. O datalist fica como conveniência de desktop; o
  seletor é o caminho de verdade. Nome fora da biblioteca continua permitido —
  quem prescreve não pode ficar preso ao cadastro.
- **Um dia comporta mais de uma modalidade.** Em *Dias do mês*, dia que já tem
  aula de outra modalidade continua **marcável** — correr de manhã e treinar ao
  meio-dia é rotina, não conflito. O backend nunca impediu (cada modalidade tem a
  sua agenda e o lote só apaga aulas da própria); o bloqueio era só de interface
  e impedia programar corrida nos dias em que já havia treino. A marca `tem-outra`
  é um ponto no canto do dia — informação, nunca estado que substitua o `on`.
- **"Tem treino montado" depende da modalidade:** musculação conta exercícios,
  corrida tem a prescrição em `descricao`. Contar só exercícios fazia o cartão de
  hoje nunca oferecer "Treinar agora" num dia de corrida.
- **Tabela larga no celular esconde ação.** A lista de Acessos era `<table>` com
  cinco colunas e três botões: 508px dentro de 360px. O botão "Resetar senha"
  caía fora da tela, alcançável só arrastando a tabela de lado — na prática,
  invisível. Virou lista de cartões. Antes de pôr ação numa tabela, meça:
  `tabela.scrollWidth > wrapper.clientWidth` a 390px já é o aviso.
- **Empilhamento de modais:** com o mesmo `z-index`, vence quem vem depois no
  HTML — e `#m-aula` vem depois de quase todos. Modal que abre DE DENTRO de outro
  precisa de z-index próprio: `#m-escolher-ex` e `#m-regua` em 220, `#m-pix-aviso`
  em 240, modo treino em 120, demais modais em 200. Já quebrou duas vezes (régua
  atrás do modo treino, seletor atrás da aula) — confira ao criar modal novo.
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

**Depois de `realizada`, quem MONTA o treino ainda pode corrigi-lo.** Num treino
individual o aluno é autor e executor: o que ele fez pode não ser o que estava
escrito antes, e o registro tem de bater com a realidade. Liberados para o autor:
a lista de exercícios, `tipo`, `foco`, `descricao`, `modelo_id`
(`CAMPOS_APOS_REALIZADA_AUTOR`). Congelado para todo mundo, sempre: `data`,
`hora`, `status`, `modalidade`, `valor` — é isso que o "feito não se desfaz"
protege. Quem só executou (o aluno numa aula do personal) continua limitado a
`obs`, `pse` e à execução de cada exercício.

`aplicar-modelo` é recusado em aula concluída: ele troca a lista inteira e, ao
contrário do `PUT` de exercícios, **não resgata as séries já lançadas** — apagaria
as cargas registradas. Na tela, o seletor "Aplicar modelo…" some quando a aula
está concluída, e "+ Exercício" fica.

⚠️ `aplicarModoAula()` e `salvarAula()` calculam `pode` **cada uma por sua conta**.
As duas precisam concordar: quando só a tela liberou, o formulário parecia
editável e o salvamento descartava a edição em silêncio (foi um defeito real,
pego em teste de interface — o teste de API sozinho não o encontraria).

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

### Pagamento (informado × recebido)

Na interface tudo se chama **pagamento**, não "Pix": o meio pode mudar (dinheiro,
transferência, parcela) e quem registra escreve na observação. No código e nos
comentários "Pix" aparece porque é o meio real de hoje; a coluna do banco é
`data_pix` e ficou assim para não migrar dado em uso.


O dinheiro anda **por fora** do sistema; o app registra as duas pontas do combinado.

| Ponta | Quem faz | Por quê |
|---|---|---|
| "Paguei" | **só o `aluno`** | quem paga é ele |
| "Recebi" | **só o `personal`** | confirmar é atestar que o dinheiro chegou; deixar o aluno confirmar o próprio Pix transformaria o registro num bilhete dele para ele mesmo |

Enquanto faltar a confirmação, o pagamento é **pendente** e volta a aparecer em
destaque toda vez que o personal abre o app. Confirmado, o aluno recebe o aviso
uma vez (`visto_aluno`) e ele para de aparecer. O aluno pode **apagar** um aviso
ainda não confirmado (erro de digitação); depois de confirmado, o registro é dos
dois e não sai.

O aviso vive em `#m-pix-aviso`, **por cima da tela inicial**, chamado por
`verificarAvisosPix()` no `iniciar()`. Isso é deliberado: é a única coisa no app
que a outra pessoa está esperando, e um cartão no meio da página seria rolado e
esquecido — que é exatamente como nasce o "eu avisei" / "eu não vi" no mês seguinte.

### Base de professores e locais

`cadastros (tipo, nome)` alimenta os `<select>` de **Professor** e **Local**.
Campo livre gerava "Academia", "academia" e "Academia " como três lugares
diferentes. **Os dois perfis** cadastram (é lista de apoio, não controle de
acesso — por isso não passa por `require_dono`); remover **desativa** em vez de
apagar, porque as aulas guardam o nome em texto e sumir com a opção não pode
reescrever o passado. `preencherCad()` mantém como opção o valor de uma aula
antiga que já não esteja na base.

**Contas de usuário continuam só com o dono.** Pedido de "o personal cadastrar um
aluno" não foi implementado: `aluno` é o papel de DONO da conta, então um personal
que criasse um aluno criaria um segundo dono — escalada de privilégio num sistema
que assume um aluno só. Isso só faz sentido junto com multi-aluno, que não existe.

### Três modalidades, três formas de treino

`MODALIDADES = ("com_personal", "sozinho", "aerobico")`. A modalidade decide
**quem prescreve**, **se custa** e **qual a forma do treino**:

| | com_personal | sozinho | aerobico |
|---|---|---|---|
| Quem monta | o personal | o aluno | outro treinador, fora do app |
| Forma | série × reps × carga | idem | **texto corrido** em `descricao` |
| Registro | carga por série | idem | `distancia_km` + `tempo_min` |
| Entra no valor do mês | **sim** | não | não |

`MODALIDADES_PROPRIAS = ("sozinho", "aerobico")` é o que o aluno pode montar e o
que não custa — use essa constante em vez de comparar com `"sozinho"` solto.

**Por que aeróbico não virou só um `tipo`:** a prescrição de corrida chega pronta
("2km trote aquecendo; 2x 1km progressivo a cada 250m…") e não tem série,
repetição nem carga. Espremê-la em linhas de exercício inventaria uma estrutura
que o treino não tem, e o registro (distância, tempo, ritmo) não caberia em lugar
nenhum. Por isso o modal da aula troca o bloco de exercícios (`#a-ex-bloco`) pelo
bloco de corrida (`#a-aer-bloco`), e o modo treino tem uma tela própria
(`tmRenderAerobico`) que mostra a prescrição e nada mais — não há série para
marcar nem descanso para contar.

Ritmo é derivado, nunca gravado: `_pace()` no backend e `paceStr()` no front, em
**min/km no formato 5:42** — é assim que corredor lê. No gráfico mensal o eixo do
ritmo é **invertido**: ritmo menor é melhor, e sem inverter a melhora apareceria
como queda.

`/api/aerobico` só conta treinos **realizados com distância registrada** — ponto
sem ritmo é ruído. Os realizados sem distância aparecem como `sem_registro`, com
aviso na tela: pendência escondida é o que faz o gráfico mentir.

**O `tipo` de treino muda com a modalidade** (`TIPOS_TREINO` no front,
`preencherTipos()`): musculação lista Força/Hipertrofia/…, corrida lista
Caminhada/Longo/Intervalado/Tiros/Ritmo/Progressivo/Regenerativo/Subida/Prova. Corrida não
se classifica em "Hipertrofia" e musculação não se classifica em "Intervalado" —
lista única obrigaria a rolar por sete opções erradas. O valor já escolhido é
mantido como opção mesmo fora do conjunto: trocar de modalidade não pode apagá-lo
em silêncio. No banco `tipo` continua texto livre; a restrição é só de interface.
No modal de **modelo** não há modalidade, então os dois conjuntos aparecem em
`<optgroup>` separados.

⚠️ Numa aula **aeróbica o bloco de exercícios não existe** — a prescrição é texto.
Isso deixa os exercícios da biblioteca (Caminhada na rua, Corrida na esteira…)
inalcançáveis *dentro dessa modalidade*; eles seguem disponíveis em aulas
`sozinho`/`com_personal` e na aba Biblioteca. Foi a primeira coisa que o usuário
estranhou ("não acho mais os treinos de caminhada"), e a resposta foi o tipo
**Caminhada** na lista de corrida — não trazer linhas de série para uma tela onde
elas não fazem sentido.

⚠️ Ao mexer em `aplicarModoAula()`, cuidado com a ordem: o bloco da modalidade
roda **antes** de `const pode` existir. Usar `pode` ali dá *"Cannot access before
initialization"* e o modal simplesmente não abre.

### Conclusão do treino (energia · fadiga · esforço)

Marcar como feita — pelo ✅ da lista ou pelo *Concluir treino* do modo treino —
abre `#m-concluir`, que **substitui o `confirm()` do navegador**: mantém a
confirmação de irreversibilidade e aproveita o único momento em que a resposta
sobre o corpo é confiável. Perguntar depois é perguntar à memória. Foi por não
perguntar em lugar nenhum que a linha "Esforço médio" do painel vivia em `S/D`.

Campos: `energia` e `fadiga` (1–5) e `pse` (1–10), **todos opcionais** — exigir
resposta numa tela usada depois de todo treino cria o hábito de responder
qualquer coisa. Ficam também no modal da aula, junto do PSE, para correção
posterior; aparecem só quando o treino já começou.

**As escalas de 1 a 5 são simétricas em torno de "Normal" e monotônicas**
(Muito baixa · Baixa · Normal · Alta · Muito alta). O pedido original trazia
"baixa, média, normal, alta, acima da média", que tem dois pares de quase
sinônimos: daqui a três meses ninguém lembra se marcou "média" ou "normal", e o
dado deixa de se comparar com ele mesmo. O PSE segue a **Borg CR10** — o número
continua 1–10 (é o que histórico e painel usam) e cada um ganhou rótulo, para a
pergunta ser respondível em pé, suado.

`energia`/`fadiga` entram em `CAMPOS_APOS_REALIZADA` e em
`CAMPOS_ALUNO_EM_AULA_DO_PERSONAL`: é feedback do aluno, vale em qualquer
modalidade e depois da aula fechada.

### Teste de fumaça (`smoke`)

Existe um teste que **abre toda página e todo modal** e falha em qualquer erro de
execução. Ele nasceu porque o mesmo defeito passou duas vezes: uma `const` usada
antes da declaração dentro da própria função (TDZ). `node --check` aceita — a
sintaxe é válida —, o olho não vê, e o modal simplesmente não abre. Só executar
pega. Rode-o depois de qualquer mudança em `aplicarModoAula`, `abrirDiasDoMes` ou
em qualquer função que monte tela.

### Data "no futuro" tolera um dia

`_valida_nao_futuro()` recusa datas acima de **hoje + 1**, não acima de hoje. O
calendário do aparelho segue o fuso dele; o app raciocina em UTC-3. Com o celular
em outro fuso (viagem, aparelho desconfigurado), "hoje" na tela pode ser um dia à
frente de `_hoje()`, e registrar um pagamento ou uma pesagem que acabou de
acontecer devolvia HTTP 400. Um dia à frente é desencontro de relógio; dois já é
engano de digitação. Vale para `/api/pagamentos` e `/api/medidas`.

### Senha provisória e troca obrigatória

Senha que **outra pessoa** escolheu é sempre provisória. Vale para os três
caminhos: criar acesso, `nova_senha` no PATCH do usuário e
`POST /api/usuarios/{id}/resetar-senha`. Todos marcam
`usuarios.deve_trocar_senha = 1`.

Com a marca ligada, `get_current_user` responde **HTTP 423** em tudo que não
esteja em `ROTAS_LIVRES_SENHA_PENDENTE` (`/auth/me` e `/auth/senha`). O bloqueio
é no servidor, não só na tela: um modal fechável daria a impressão de escapar
para uma tela que não responderia nada. Como a função já carregava a linha do
usuário do banco a cada requisição, a checagem **não custa consulta extra** — e,
por ler o banco, um reset vale na hora, inclusive para quem está com a sessão
aberta (o front trata o 423 reabrindo o modal).

`/auth/senha` limpa a marca e exige que a nova senha seja **diferente** da atual
— senão "trocar" viraria confirmar a provisória.

A senha provisória é devolvida **uma vez** na resposta, para o dono repassar.
Nunca é gravada em texto puro (só o hash) e não vai para log. Quem perder o valor
pede outro reset. Alfabeto sem `0/O/1/l/I`: ela é ditada por WhatsApp ou lida em
voz alta, e caractere ambíguo vira chamado de "não entro".

### Cartão de hoje: três estados, não um

`/api/aulas/hoje` escolhia a **primeira aula do dia por horário**, qualquer que
fosse o status, e `carregarHoje()` desenhava sempre o mesmo cartão. Quem
finalizava o treino via o mesmo botão verde *Treinar agora* e ficava sem saber se
o registro tinha entrado. O usuário relatou exatamente assim: *"finalizei o treino
e ele continua na tela"*.

Agora:

1. **Pendente** — cartão normal, *Treinar agora* + *Ver treino*. A query ordena
   `(status='agendada') DESC`: quem treinou às 7h e tem outra às 19h vê a das 19h,
   não a da manhã já encerrada.
2. **Encerrada** — `.hoje-card.feito` (faixa verde à esquerda), tarja com o status
   (✅ Treino feito), o fechamento (`energia 4/5 · fadiga 2/5 · esforço 6/10`, mais
   km e minutos em corrida) e a linha **Próximo: qua 07/10 às 12:45 · Costas**.
   Ações: *Ver o que foi feito* e *Ver o próximo*. Nenhum botão de ação pendente.
3. **Sem aula hoje** — a próxima agendada, como antes.

A rota ganhou `proxima` (a próxima `agendada`, hoje ou depois, excluindo a do
cartão), calculada **só** quando a aula do cartão já está encerrada: fora disso é
consulta à toa.

Teste: `thoje.py` — agendada oferece treinar; depois de finalizar pela leitura o
cartão muda de estado, some o *Treinar agora*, aparecem o fechamento e a próxima
aula; e uma segunda aula pendente no mesmo dia assume o cartão.

### Ver treino: checklist, não cadastro

O cartão de hoje tinha dois botões: *Treinar agora* (modo treino) e *Ver treino*,
que chamava `abrirAula()` — o **formulário de cadastro**: data, hora, duração,
modalidade, status, tipo, foco, local, professor, pacote, modelo, valor,
descrição, observações, PSE, energia, fadiga, e só então os exercícios. Quem abre
o app na academia quer ler o que vai fazer.

`verTreino(id)` (`#m-ver-treino`) é só leitura: cabeçalho com dia, hora,
modalidade, professor, local, duração e status; um cartão por exercício com
`séries × reps`, carga, descanso e observação; o que já foi feito aparece riscado
com ✓. Corrida mostra a prescrição em texto, mais distância e tempo registrados.

**Checklist.** Cada linha é um `<label>` inteiro, não um quadradinho: o alvo de
toque é a linha, porque errar 20px com a mão suada é o que faz alguém desistir de
marcar e perder o registro. `vtMarcar()` faz `PATCH .../exercicios/{eid}
{feito}` na hora — não existe "salvar" — atualiza `_vtAula` em memória, redesenha
e chama `loadAgenda()` para o cartão de hoje acompanhar. Se o PATCH falhar,
`vtRender()` roda de novo e o check volta: a tela nunca mostra o que o banco não
aceitou. Marcar é **execução**, então vale também na aula do personal; `vtPodeMarcar`
exige `ja_comecou` e status fora de cancelada/transferida — riscar exercício de um
treino de amanhã é dado inconsistente.

**Finalizar.** Com tudo marcado, *Finalizar aula* vira o botão verde e substitui
*Treinar agora*. Com parte marcada, aparece discreto ao lado: treino cortado pelo
relógio é rotina, e obrigar a passar pelo modo treino só para encerrar faria a
aula ficar "agendada" para sempre. **Com nada marcado não aparece** — finalizar é
irreversível e ali ele ainda não disse que treinou. `vtFinalizar()` cai no mesmo
`abrirConclusao()` do modo treino (energia · fadiga · esforço), com o mesmo aviso
de "você marcou X de Y" quando ficou gente para trás. Duas portas, um fluxo só.

Rodapé: **Abrir aula** (o formulário, para quem realmente quer editar),
**Fechar**, e *Treinar agora* ou *Finalizar aula*. `vtTreinar()` e `vtFinalizar()`
fecham a leitura **antes** de abrir o que vem depois: o modo treino fica em
z-index 120, abaixo dos modais (200), e `#m-concluir` vem antes de `#m-ver-treino`
no HTML, então com z-index empatado abriria atrás. Mesma armadilha da escada de
empilhamento, duas vezes no mesmo botão.

`abrirConclusao()` procura a aula em `_aulas`, em `_tm.aula` e agora em `_vtAula`
— aberta pela leitura, ela pode não estar no mês carregado. E `confirmarConclusao()`
zera `_vtAula` depois de gravar, senão a leitura reabriria com o estado velho.

A lista e o calendário continuam abrindo o formulário — ali o gesto é gerenciar a
agenda, não ler o treino do dia. Se ele pedir leitura ali também, `verTreino` já
serve: é só trocar a chamada.

Teste: `tvertreino.py` — 14 asserções. Que **nenhum campo de cadastro** existe na
leitura (`input:not([type=checkbox]), select, textarea` = 0 — o check de feito é
execução, não cadastro); que marcar **grava no banco** e desmarcar volta; que o
contador anda; que sem nada marcado não há *Finalizar*; que com parte marcada há;
que com tudo marcado ele vira o principal e *Treinar agora* some; que finalizar
abre a conclusão com a leitura fechada e grava `realizada` com energia, fadiga e
PSE; e que uma aula já realizada não oferece finalizar de novo. O setup monta o
cenário real pela API (o aluno marca o dia, o personal prescreve) e apaga a aula
no fim — ela nasce paga e poluía o financeiro de outubro.

### Transferência de aula paga (remarcar para outro dia)

Única exceção sancionada ao "pré-pago, sem devolução". A transferência move o
**direito de treinar**, nunca o dinheiro.

Duas linhas na tabela `aulas`, ligadas pelos dois lados:

| campo | na origem | no crédito |
|---|---|---|
| `transferida_para` | id do crédito | `NULL` |
| `credito_de` | `NULL` | id da origem |
| `transf_status` | `pendente` \| `aprovada` \| `recusada` | igual à origem |
| `transf_motivo` | o que o aluno escreveu (ou a recusa do personal) | `NULL` |
| `valor` | **continua o valor pago** | **nasce 0** |
| `status` | `agendada` → `transferida` na aprovação | `agendada` |

**Invariante do dinheiro:** o valor fica no mês em que a aula foi agendada. A
origem guarda o `valor`; o crédito nasce com `valor 0`. Sem isso a mesma aula
seria cobrada duas vezes — em setembro, onde foi paga, e em outubro, onde foi
treinada. É por isso também que `transferida` **saiu do balde `perdido`** em
`/api/resumo` e `/api/financeiro`: transferência não é perda, é a aula em outro
dia. Os dois relatórios ganharam `transferido`, `aulas_transferidas` e
`creditos_recebidos` (e, por mês, `transferido`/`transferidas`/`creditos`).

**Uma vez por aula — mas só a aprovação consome a cota.** `transf_status`
`pendente` ou `aprovada` bloqueia novo pedido; `recusada` libera. Recusa que
queimasse a aula puniria o aluno por uma decisão do personal, e a aula ficaria
presa num dia que ele já disse que não dá. *Decisão minha, confirmar com o
usuário.*

Rotas (todas em `app.py`):

| rota | quem | efeito |
|---|---|---|
| `POST /api/aulas/{id}/transferir` | **aluno** | cria o crédito e marca os dois lados como `pendente` |
| `GET /api/transferencias` | ambos | pedidos pendentes, com origem e destino no mesmo objeto |
| `POST /api/aulas/{id}/transferencia/aprovar` | **só personal** | origem vira `transferida`, os dois lados `aprovada` |
| `POST /api/aulas/{id}/transferencia/recusar` | **só personal** | apaga o crédito, limpa `transferida_para`, grava `recusada` + motivo |
| `POST /api/aulas/{id}/transferencia/cancelar` | **aluno** | desiste do pedido e restaura a origem para `agendada` |

O aluno pedir e o personal aprovar é o ponto todo da regra do usuário. Daí o
403 quando o aluno chama `aprovar` na própria aula: sem isso, "precisa da
aprovação do personal" seria decoração.

Guardas (as que já foram quebradas uma vez, e por isso estão testadas):

- `CAMPOS_SO_TRANSFERENCIA` — PATCH não escreve campo de transferência. Hoje o
  modelo `AulaUpdate` nem declara esses campos (o Pydantic já os descarta), mas a
  guarda fica: quem um dia adicionar o campo ao modelo não abre o caminho sem ver.
- `status="transferida"` à mão → 400. Esse status vem da aprovação, não da tela.
- Pedido `pendente` → PATCH de `data` ou `status` → 400. Cancele o pedido antes.
- Origem `transferida` → PATCH de `status` → 400, com a mensagem apontando o dia
  de destino. O treino se registra no crédito.
- Crédito nunca é transferido de novo, nem a aula já `aprovada`.
- DELETE recusa apagar origem transferida ou com pedido pendente. Apagar o
  **crédito** restaura a origem para `agendada` com os campos limpos — é o
  caminho de saída quando os dois lados concordam em desfazer.

**Onde o personal encontra o pedido — três lugares, de propósito.** O aviso sobre
a tela inicial (`verificarTransferencias()`) tem um botão **Depois**, e só rodava
no start do app: dispensado, o pedido sumia até ele recarregar — enquanto isso a
aula do aluno fica com data e status travados. Por isso existe o **trilho**
(`#transf-trilho`, `renderTrilhoTransf`) no topo da Agenda, refeito a cada
`loadAgenda()` via `verificarTransferencias(false)` — o `false` atualiza o trilho
**sem** reabrir o aviso que ele já dispensou. E a própria aula mostra o pedido com
**Aprovar/Recusar**. Antes ela mostrava ao personal o aviso escrito para o aluno,
com o botão *Cancelar pedido*: ele desistiria em nome do aluno achando que estava
recusando, e o aluno veria o pedido evaporar sem resposta. `renderTransferencia`
agora ramifica por `_user.role`.

**Cor do crédito.** Nasceu usando `--fer` (roxo), que já era a cor do feriado: no
calendário, um dia de feriado e um dia com crédito ficavam iguais, e o crédito em
si era um ponto de 5px na barra — invisível na grade do celular, onde a barra tem
9px e nenhum texto. Agora existe `--cred` (#BE185D, magenta), que não colide com
feriado (roxo), agendada (azul), falta (vermelho) nem transferida (laranja), e não
lê como perda. No celular a barra do crédito é **cor cheia e mais alta** (13px
contra 9px) — altura e cor são os dois únicos sinais que sobrevivem ali. No
desktop entra um selo **"C"** *antes* do texto: o chip corta pela direita com
ellipsis, então rótulo no fim virava "CRÉ…" justamente no dia cheio. A legenda e a
etiqueta da lista repetem o mesmo "C" para o olho ligar uma coisa na outra.

**Na lista.** A linha transferida só tinha o ícone 🔄 na coluna de status —
parecia uma aula como as outras, e o treino dela nem aconteceu ali. Agora: data e
nome **riscados**, linha a 62% de opacidade, faixa laranja à esquerda, etiqueta
*transferida* e **→ 23/10/26 17:33**, o dia de destino. A contagem de exercícios
sai da linha: o treino não é dali. A linha de crédito ganha o espelho disso —
faixa magenta e **de 25/09/26**. `/api/aulas` resolve as duas pontas em **uma**
consulta extra (`transferida_para` e `credito_de` juntos num `IN`), devolvendo
`destino` e `origem`; por linha seriam N consultas.

Teste: `tcredito.py` cria um crédito **em 12/10, que é feriado**, e compara as cores
computadas do chip, do dia de feriado e de uma aula comum, no celular e no desktop.

Na tela: `renderTransferencia(a)` cobre os quatro estados (pendente, transferida,
crédito, recusada) e `podeTransferir(a)` decide o botão — só aluno, só
`com_personal`, só `agendada`, nunca um crédito, nunca com pedido vivo.
`verificarTransferencias()` sobe o aviso prioritário **para o personal**, no
mesmo lugar do aviso de Pix. Cores: `.b-transferida` laranja (*warn*) na origem,
`.b-credito` roxo (*fer*) no destino — a cor diferente em cada ponta foi pedido
explícito, para o mês não parecer ter duas aulas iguais.

**Mudar a data × transferir.** PATCH de `data` continua preso ao mês — mas só
para aula que **custa dinheiro**. A regra existe por causa do fechamento do mês;
aula que nasce R$ 0 (sozinho, aeróbico) muda de data livremente, inclusive para
outro mês. A mensagem de recusa aponta o botão **Transferir** e diz explicitamente
para **não excluir e recriar** — o conselho antigo ("exclua e crie lá") tirava a
aula do mês pago e cobrava o destino, ou seja, mandava o usuário pagar duas vezes.

**Empilhamento.** `#m-transferir` abre de dentro de `#m-aula`: sem z-index próprio,
ele herda 200, e com empate vence quem vem depois no HTML — `#m-aula`. O modal
*aparecia*, mas o `#a-ex-aviso` da aula interceptava o toque em "Pedir
transferência". Entrou na escada (220), junto com `#m-transf-aviso` em 240.
O teste não pegou porque chamava `pedirTransferencia()` por `evaluate`; agora
`ttransf.py` **clica de verdade** nos dois botões. É a mesma armadilha do item 4
desta seção: função chamada direto não prova que o botão é alcançável.

Teste: `ttransf.py` (fluxo na tela, 390px, com cliques reais) e `apitransf.sh`
(as 20 regras pela API). Ambos limpam pedidos pendentes antes de rodar — pedido
órfão de execução anterior fazia o personal aprovar o pedido errado e o teste
acusava defeito inexistente. `guia.py` (screenshots) apaga a própria aula no fim,
senão deixava R$ 90 em outubro e o teste financeiro acusava dinheiro no crédito.

### Segurança já implementada

- Chave de assinatura dos tokens sorteada no 1º start e guardada no banco
  (não existe chave padrão no código).
- Bloqueio de força bruta: 5 erros por e-mail+IP → 10 min (HTTP 429), em memória.
- Senha mínima de 8 caracteres.
- Aviso na interface enquanto a senha inicial estiver em uso (`senha_padrao`).
- Toda rota `/api/*` exige token.

### Decidido: não construir notificação fora do app

O app não avisa o personal por push, e-mail ou WhatsApp — nem para pedido de
transferência, nem para aviso de pagamento. Ele descobre ao abrir o app, nos
três pontos de entrada acima.

**O usuário decidiu assim em 05/10/2026**, com estas palavras: *"Avisarei que
coloquei no sistema pelo zap"*. Os dois já se falam por WhatsApp; o aviso é a
mensagem que ele manda, e o papel do app é guardar quem pediu, quando, por quê e
quem aprovou — que é o que some da memória depois de um mês.

Não proponha push, e-mail ou integração de mensagem de novo sem ele pedir. Cada
um traz canal externo, credencial e custo para resolver algo que hoje custa uma
mensagem no celular.

### Ainda não existe (candidatos a próximo passo, se o usuário pedir)

- **Comprovante anexado** ao Pix (hoje só valor, data e observação em texto).
- **Cardio no volume do mês**: `volume_kg` multiplica séries × reps × carga. Com
  os exercícios de corrida na biblioteca, se alguém digitar minutos no campo de
  carga, minutos entram na conta como quilos. A convenção do app é deixar a carga
  em branco e anotar tempo/distância na observação — mas nada impede o contrário.
- **Sem foto de progresso** e sem histórico de medidas na tela (o banco guarda
  cintura/quadril/peito/braço/coxa; a tela só mostra o peso).
- **Backup** dentro do app. O Railway oferece backup do volume na aba *Backups*,
  que resolve o essencial e ainda não foi ativado.
- Multi-aluno: o sistema assume **um** aluno.
- Feriados estaduais e municipais.
- Nenhuma suíte de testes automatizados: a verificação é a da seção 4.
