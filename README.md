# FITPLAN — Controle de aulas com o personal

Aplicação **independente** para você e seu personal acompanharem juntos: o calendário
das aulas, a quantidade de aulas do pacote, a frequência (aderência) e o tipo/descrição
dos exercícios de cada treino.

> Não faz parte do PLANGEST. Banco, login, porta e deploy são próprios — nada dos dados
> comerciais é acessível aqui, e vice-versa. O único ponto em comum é o repositório.

---

## O que o app resolve

| Sua necessidade | Onde está |
|---|---|
| Marcar os dias do mês em que farei aula | **Agenda → Dias do mês** — grade do mês, você clica nos dias e salva tudo de uma vez |
| Valor da hora-aula | **Configurações** (valor geral) ou **Financeiro → Pacote** (valor daquele período) |
| Quanto vou pagar / quanto o personal recebe | Calculado sozinho: KPI **A pagar/A receber no mês** + **Financeiro** (fechamento mês a mês) |
| Quantidade de aulas | KPIs da Agenda e, se usar pacote fechado, o **saldo** em Financeiro |
| Frequência | **Agenda** (aderência e sequência) e **Frequência** (gráficos por mês/semana) |
| Tipo de exercício | **Treinos** — biblioteca por grupo muscular e equipamento; tipo da aula (Força, Hipertrofia, HIIT…) |
| Descrição dos exercícios | **Treinos** (execução de cada exercício) e, na aula, séries/reps/carga/descanso/observação |

---

## Com o personal ou sozinho

Ao marcar os dias, você diz **como** vai treinar. São duas agendas independentes no
mesmo mês — marcar os dias de uma nunca apaga os da outra.

| | **Com o personal** | **Sozinho** |
|---|---|---|
| Quem monta o treino | o personal | você |
| Você pode editar o treino | não, só acompanha | sim |
| O que é seu na aula | status (realizada/falta/cancelada), remarcação e o feedback em Observações | tudo |
| Entra no valor pago | **sim** | **não** |

Na aula do personal, o app trava para você os campos que são prescrição dele (tipo,
foco, descrição, modelo, duração, local, professor) e libera o que é seu. Isso vale
também na API — não é só a tela que esconde.

---

## O fluxo do mês (é assim que o app foi desenhado)

1. **Você (aluno)** abre **Agenda → Dias do mês**, escolhe **Com o personal** ou
   **Sozinho**, clica nos dias (ou usa os atalhos *Seg/Qua/Sex*, *Ter/Qui*, *Seg a Sex*)
   e vê **na hora** quanto vai custar: `13 aulas × R$ 90,00 = R$ 1.170,00`. Salva.
   Repita trocando a modalidade para montar os dois tipos no mesmo mês.
2. As aulas entram na agenda como **agendadas**, sem treino — e aparecem no KPI
   **"Sem treino montado"** e no filtro *só sem treino*.
3. **O personal** abre cada dia (ou aplica um **modelo** Treino A/B/C) e prescreve os exercícios.
4. Depois da aula, qualquer um dos dois marca **Realizada** (ou falta/cancelada).
5. O **Financeiro** fecha o mês sozinho: previsto × consolidado, no ano inteiro.

Refazer os dias do mês é seguro: aula **já realizada, com falta, cancelada ou com treino
montado nunca é apagada** — ela aparece travada (amarela) na grade e o app avisa quantas
foram mantidas.

---

## Como rodar no seu PC (Windows)

```bat
cd fitplan
pip install -r requirements.txt
iniciar_fitplan.bat
```
Abre em <http://localhost:8090> (na rede local, `http://SEU_IP:8090` — dá para usar do celular
na academia, com o PC ligado).

**Primeiro acesso:** `htardelli@gmail.com` / `fitplan123` → troque a senha em
**Configurações** antes de qualquer outra coisa. Enquanto a senha inicial estiver em uso,
o app mostra um aviso no topo de todas as telas.

## Como publicar no Railway (acesso pelo celular, de qualquer lugar)

1. No projeto do Railway, **+ New → GitHub Repo → `htardelli/planges`** (um **novo serviço**,
   não mexa no serviço do PLANGEST).
2. Settings → **Root Directory** = `fitplan`. É isso que separa os dois apps; sem isso o
   Railway sobe o PLANGEST de novo.
3. Settings → **Branch** = `claude/aulas-control-app-a0wprp` (ou `main`, depois do merge).
4. Settings → **Volumes** → adicionar volume em **`/data`**. Sem volume, o banco é apagado
   a cada deploy — você perde agenda, treinos e histórico financeiro.
5. Variables (nenhuma é obrigatória, mas estas valem a pena):

| Variável | Para quê |
|---|---|
| `FITPLAN_ADMIN_EMAIL` / `FITPLAN_ADMIN_SENHA` | dono criado no **primeiro start**. Padrão `htardelli@gmail.com` / `fitplan123`. Defina uma senha forte aqui e você já sobe sem senha padrão |
| `FITPLAN_TOKEN_HORAS` | validade do login (padrão 720 h = 30 dias, para não relogar toda hora no celular) |
| `FITPLAN_SECRET_KEY` | opcional. Se não vier, o app **sorteia uma chave no primeiro start e guarda no banco** — não existe chave padrão no código |
| `FITPLAN_DATA_DIR` | pasta do banco, se quiser forçar outro caminho |

6. Settings → **Networking → Generate Domain** para ter o endereço público (HTTPS).
7. Abra o endereço, entre, **troque a senha** e crie o acesso do personal em
   **Configurações → Acessos**.

### O que protege o app exposto na internet

- Chave de assinatura dos tokens **sorteada no primeiro start** e guardada no banco
  (nunca uma chave padrão que esteja no código-fonte).
- **Bloqueio por tentativas:** 5 senhas erradas → 10 minutos bloqueado (por e-mail + IP).
- Senha mínima de **8 caracteres** e aviso permanente enquanto a senha inicial estiver em uso.
- Toda rota `/api/*` exige token; o personal não acessa a gestão de acessos nem altera o preço.

> Só há dois usuários e nenhum dado sensível de terceiros, mas o endereço é público:
> use uma senha que você não use em mais nada.

---

## Perfis de acesso

| Perfil | Pode |
|---|---|
| **Aluno** (dono) | tudo, inclusive criar/remover acessos |
| **Personal** | agenda, treinos, exercícios, planos e frequência — **não** mexe nos acessos |

Crie o acesso do personal em **Configurações → Acessos → + Novo acesso**.

---

## Feriados

O calendário e a grade de "Dias do mês" destacam os feriados em **roxo**:

- **preenchido** = feriado nacional (lei federal);
- **borda tracejada** = ponto facultativo nacional (Carnaval, Quarta-feira de Cinzas,
  Corpus Christi) — não é feriado por lei, mas na prática a academia fecha.

Ao marcar os dias, se algum cair em feriado o app avisa no rodapé: *"⚠ 3 dia(s) em
feriado: 16 (Carnaval), 17 (Carnaval), 18 (Quarta-feira de Cinzas)"*. Ele **não impede**
— se você treina no feriado, é só marcar.

As datas são **calculadas**, não consultadas em serviço externo: os fixos por data e os
móveis a partir da Páscoa (algoritmo de Meeus). Funciona sem internet e para qualquer
ano futuro que você for planejar.

> **Só feriados nacionais.** Os estaduais e municipais não entram — em Fortaleza ficam
> de fora, por exemplo, a Data Magna do Ceará (25/03) e Nossa Senhora da Assunção
> (15/08). Dá para acrescentar se fizer diferença na sua agenda.

---

## Conceitos que o app usa (para os números fazerem sentido)

- **Status da aula:** `agendada` · `realizada` · `falta` (perdeu sem avisar) · `cancelada` (cancelada com aviso).
- **Consome aula do pacote:** `realizada` e `falta`. `cancelada` não consome.
- **Frequência (aderência)** = realizadas ÷ (realizadas + faltas + agendadas que já passaram).
  Canceladas ficam fora da conta de propósito — senão um cancelamento do professor derruba sua nota.
- **Sequência** = semanas consecutivas (encerradas) em que você bateu a meta semanal do pacote.
- **Volume de carga (kg)** = séries × repetições × carga, somado nas aulas realizadas.
  Reps em tempo ("30s") não entram no volume — só o que tem repetição contável.
- **Dinheiro — pré-pago e sem devolução:** o mês é pago **quando as aulas entram na
  agenda**, antes de treinar. Marcar os dias já fecha o valor do mês.
  - **Valor do mês** = **todas** as aulas do mês. É o que o aluno transfere.
  - **Virou treino** = realizadas · **A treinar** = agendadas ·
    **Perdido** = faltas **+ cancelamentos**.
  - **Nenhum status devolve dinheiro.** Mudar o status não altera o valor do mês —
    só muda o destino do que já foi pago.
  - É o mesmo número para os dois lados: **"Pago no mês"** (aluno) ou
    **"A receber no mês"** (personal), conforme quem está logado.
  - Cada aula guarda o **valor da hora-aula do dia em que foi criada** (snapshot).
    Reajuste vale só para as aulas novas — mês fechado não se reescreve.
- **Treino feito não se desfaz.** Marcar como **feita** pede confirmação e é definitivo.
  Depois disso, a aula só aceita o registro do que aconteceu: **percepção de esforço**,
  **observações** e, em cada exercício, **carga usada**, observação e o que foi **feito**.
  Data, hora, status, modalidade e valor ficam congelados, e a aula não pode ser excluída.
  - A trava vale para aula que de fato aconteceu. Uma marcada como feita num horário
    que ainda não chegou é dado inconsistente e continua corrigível.
  - **Correção automática:** a cada start, toda aula futura marcada como **feita** ou
    como **falta** volta para **agendada** — nenhuma das duas é possível antes do
    horário. É idempotente e só toca no que é impossível, funcionando como
    guarda-corpo contra dado antigo.
- **Prescrição × execução.** Nome, séries, repetições e descanso são prescrição (do
  personal, nas aulas com ele). Carga usada, observação e "feito" são execução — quem
  treinou registra, mesmo numa aula do personal.
- **Só dá para finalizar o que já passou.** Uma aula só aceita **realizada** ou **falta**
  depois do seu horário — antes disso, os status possíveis são **agendada** ou
  **cancelada**. Aula sem horário conta a partir do início do dia. A regra vale também
  ao criar a aula e ao mudar a data: empurrar para o futuro uma aula já marcada como
  feita é recusado.
- **Fuso:** o app trabalha em **UTC-3** (Fortaleza), não no fuso do servidor. Ajuste pela
  variável `FITPLAN_UTC_OFFSET` se você mudar de fuso.
- **Já sabe que não vai? Remarque.** Não existe faltar a algo que ainda não aconteceu.
  Na lista, as aulas futuras têm o botão **📅**, que abre a aula direto no campo da data.
  Remarcar preserva o valor já pago; cancelar é o último caso, e o valor não volta.
- **Remarcação só dentro do mesmo mês** — e é a única forma de não perder o valor.
  Precisou trocar um dia? Abra a aula e mude a data para outro dia **do mesmo mês**. Mover para outro mês é recusado pelo sistema:
  aquele mês já foi pago, e a aula não pode migrar de fechamento. Se precisar mesmo,
  exclua a aula e crie uma nova no mês de destino — aí ela entra no valor daquele mês.
- **Quem define o preço:** só o aluno (dono). O personal **vê** o valor, mas não altera.
- **Prioridade do valor:** pacote vigente com `R$/hora` preenchido > valor geral das Configurações.
- **Modelo de treino** (Treino A/B/C) é um **molde**: ao aplicar numa aula, os exercícios são
  *copiados*. Editar a aula depois não altera o modelo, e vice-versa — o histórico não se
  reescreve quando o professor muda a prescrição.

---

## Arquivos

```
fitplan/
├── app.py                # API FastAPI (auth, aulas, treinos, planos, frequência)
├── db.py                 # schema SQLite + biblioteca inicial de exercícios
├── requirements.txt
├── railway.toml          # deploy do serviço próprio
├── iniciar_fitplan.bat   # atalho local (Windows)
└── static/
    ├── index.html        # SPA
    ├── css/style.css
    └── js/app.js
```

Banco: `fitplan.db` (no Railway, em `/data`).
