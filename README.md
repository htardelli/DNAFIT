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
| Avisar que paguei e saber que ele recebeu | **Financeiro → Informar pagamento** — ele confirma em um aviso sobre a tela inicial |
| Achar um exercício sem digitar o nome inteiro | Toque na **🔍** dentro do campo *Exercício* — busca, favoritos e grupos |
| Registrar o treino **enquanto treino** | **Agenda → Treinar agora** — modo treino, uma série por toque |
| Saber quanto levantei da última vez | Aparece sozinho no modo treino: *última: 55 kg × 10 · 28/08* |
| Acompanhar peso e medidas | **Progresso → Corpo** — peso, IMC, meta, ritmo real e gráfico |

---

## Corrida (treino aeróbico)

Os treinos que vêm do seu **treinador de corrida** entram como modalidade
**Aeróbico** — ele não tem conta no app, então quem cola a prescrição é você.

1. Marque o dia na agenda como **Aeróbico** (em *Dias do mês* ou em *+ Aula*).
   Pode marcar um dia que **já tem treino com o personal ou sozinho** — correr de
   manhã e treinar ao meio-dia são duas coisas no mesmo dia, e uma não apaga a
   outra. O ponto azul no canto do dia avisa que já há outra aula ali.
2. Escolha o **tipo**: a lista muda para o vocabulário de corrida — *Caminhada,
   Longo, Intervalado, Tiros, Ritmo, Progressivo, Regenerativo, Subida,
   Prova/teste*.
3. Cole o texto do treinador exatamente como ele manda — *"6km / 2km trote
   aquecendo; 2x 1km progressivo a cada 250m; 2km de trote, desaquecendo."*
   Não há série nem carga aqui: corrida não tem essa forma, e o app não finge que tem.
4. Na hora de correr, **Treinar agora** mostra a prescrição em tela cheia.
5. Ao concluir, informe **distância** e **tempo**. O app calcula o **ritmo** (min/km).

Em **Progresso → Corrida** você vê o volume do ano, o tempo total, o ritmo médio,
o seu melhor ritmo e a lista treino a treino. O gráfico do mês cruza **km em
barras** com **ritmo em linha** — e o eixo do ritmo é invertido de propósito,
porque em corrida um número menor é melhor.

Corrida **não entra no valor pago ao personal** — é outro profissional.

**Caminhada é um treino aeróbico como outro qualquer:** marque o dia como
Aeróbico, tipo *Caminhada*, e registre distância e tempo ao concluir. Se preferir
tratá-la como exercício de uma sessão de musculação, os exercícios
**Caminhada na esteira** e **Caminhada na rua** continuam na biblioteca, em
**Treinos → Biblioteca → Músculo → Cardio** (ou em *Aparelho*: Máquina e Livre).

## Com o personal ou sozinho

Ao marcar os dias, você diz **como** vai treinar. São duas agendas independentes no
mesmo mês — marcar os dias de uma nunca apaga os da outra.

Na tela você reconhece cada um de longe: **personal é um círculo azul com P**,
**individual é um quadrado verde com I**. No calendário, a barrinha do dia é
**lisa** para o personal e **listrada** para o individual — a cor da barra continua
sendo a do *status* (agendada, feita, falta).

| | **Com o personal** | **Sozinho** |
|---|---|---|
| Campos que aparecem | professor, pacote e valor | nenhum dos três — treino sozinho não tem professor, não consome pacote e não custa |
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
4. **No dia**, você abre o app e o treino de hoje já está no topo. **Treinar agora**
   abre o modo treino (veja abaixo).
5. Depois da aula, qualquer um dos dois marca **Realizada** (ou falta/cancelada) —
   o botão *Concluir treino*, no fim do modo treino, faz isso.
6. O **Financeiro** fecha o mês sozinho: previsto × consolidado, no ano inteiro.

Refazer os dias do mês é seguro: aula **já realizada, com falta, cancelada ou com treino
montado nunca é apagada** — ela aparece travada (amarela) na grade e o app avisa quantas
foram mantidas.

---

## Modo treino — a tela para usar na academia

No topo da Agenda fica o **treino de hoje**. Um toque em **Treinar agora** abre a
tela cheia: um exercício por vez, botões grandes, nada de calendário.

- **Carga e repetições já vêm preenchidas.** A carga é a que você usou da última vez
  naquele exercício; as repetições são as que o personal prescreveu. Se o peso for o
  mesmo de sempre, **o único toque da série é o ✓**.
- Precisa mudar? **−** e **+** ajustam de 2,5 em 2,5 kg (metade de uma anilha de 5).
  Para um salto maior, toque no número: abre uma **régua** de rolagem — sem teclado,
  sem zoom, com uma mão só.
- Marcou a série? O **descanso começa sozinho**, com o tempo que está na prescrição.
  Vibra e apita quando zera.
- No fim, **Concluir treino** marca a aula como feita. A confirmação vem junto de
  três perguntas rápidas: **nível de energia**, **nível de fadiga** (1 a 5) e
  **percepção de esforço** (1 a 10, com rótulo — de *Muito leve* a *Exaustão
  máxima*), mais um espaço para escrever como foi. Todos opcionais, e todos
  corrigíveis depois dentro da aula. O mesmo acontece ao marcar ✅ na lista.
  Como sempre, dar o treino por feito **não pode ser desfeito**.
- **Treino individual já feito continua editável por você.** O treino é seu: se
  esqueceu de listar um exercício, ou fez diferente do planejado, corrija depois —
  o registro precisa bater com o que realmente aconteceu. O que não muda mais é o
  que a aula *foi*: data, horário e status. Em aula com o personal, o treino
  continua sendo dele: você ajusta carga, observações e o que foi feito.
- **Treino futuro não é registrável.** Os botões ficam travados até o horário chegar —
  a mesma regra que já valia para o status.

## Levar um treino da biblioteca para um dia

Em **Treinos → Modelos**, cada modelo tem **Usar em um dia**. Ele lista as próximas
aulas agendadas e você escolhe uma:

- se o dia for **individual**, o modelo é **aplicado na hora**;
- se for **com o personal**, ele vira **sugestão**. O personal abre a aula, vê
  *"Sugestão do aluno: Treino A"* e decide se aplica. Você pede o que quer treinar
  sem passar por cima de quem você contratou — e pode **retirar** o pedido quando
  quiser.

Aplicar um modelo substitui os exercícios daquele dia; se já houver treino montado,
o app pergunta antes.

## Progresso → Corpo

Registre o peso quando quiser (**Registrar peso**) e o app mostra:

- peso atual e a variação desde a última pesagem;
- **IMC** — precisa da sua altura em *Ajustes*;
- **meta** e quanto falta — a meta também fica em *Ajustes*;
- **ritmo real**: quantos quilos por semana, calculado pela reta dos seus pontos
  dos últimos 90 dias. Ele **só aparece com 3 pesagens em pelo menos 2 semanas** —
  antes disso não é previsão, é chute, e o app prefere dizer que não sabe;
- previsão de quando você bate a meta, **mantendo esse ritmo**.

Só você (aluno) registra medidas. O personal vê.

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

## Transferir uma aula paga para outro dia

Imprevisto de trabalho não devolve dinheiro — mas também não precisa queimar a
aula. Você remarca, e o personal aprova no app.

1. Abra a aula e toque em **Transferir** (no rodapé, entre *Excluir* e *Cancelar*).
   Escolha a data nova — pode ser em **outro mês** — e escreva o motivo.
2. A aula original fica no dia dela, em **laranja**, com o aviso de que há um
   pedido aguardando. A aula nova aparece no dia escolhido, em **roxo**, como
   **crédito**.
3. Na próxima vez que o **personal** abrir o app, o pedido aparece **por cima da
   tela inicial**, com os dois dias, o motivo e o valor. Ele *Aprova* ou *Recusa*.
4. **Aprovado:** a original muda para o status **Transferida** e o treino passa a
   ser registrado no dia novo — é lá que você marca *Realizada*.
   **Recusado:** o crédito é apagado, a aula volta ao normal e você pode propor
   outro dia.

### As regras, sem letra miúda

- **Uma transferência por aula.** Só a **aprovação** gasta essa chance. Se ele
  recusar, você pode propor outro dia — não seria justo você perder a aula por uma
  decisão dele.
- **Precisa da aprovação dele.** Você pede; só ele aprova. Enquanto o pedido está
  pendente, a data e o status da aula ficam travados (cancele o pedido para mexer).
- **O dinheiro não se move.** O valor continua no mês em que a aula foi agendada:
  setembro continua com os R$ 90, e outubro recebe a aula como **crédito, valendo
  R$ 0**. É assim que a mesma aula não é cobrada duas vezes.
- **Transferida não é perdida.** No Financeiro ela sai do bolo *Perdido* e aparece
  na coluna **Transf.** — você não faltou, você remarcou.
- **Só aula com o personal, só se estiver agendada.** Treino sozinho e aeróbico não
  custam nada: para esses, **mude a data direto**, inclusive para outro mês — não
  há o que transferir onde não há dinheiro. E um crédito não é transferido de
  novo — ele já é o resultado de uma transferência.
- **Desfazer:** apagar a aula-crédito devolve a original ao estado **agendada**,
  como se o pedido nunca tivesse existido.

*Exemplo real:* as aulas de 29 e 30/09 não deram por causa de viagem. Você as
transfere para 21 e 22/10. Setembro continua pago e mostra 2 aulas transferidas;
outubro ganha 2 créditos sem custo; a frequência conta o treino no dia em que ele
de fato aconteceu.

## Informar pagamento

O dinheiro anda por fora do app — o que o app faz é registrar **as duas pontas**,
para que ninguém precise lembrar de cabeça no mês seguinte.

1. Você paga e abre **Financeiro → Informar pagamento** (valor, data e o mês a
   que se refere; o valor já vem preenchido com o que falta pagar). Se quiser
   registrar como pagou — Pix, dinheiro, parcela —, escreva na observação.
2. Da próxima vez que o **personal** abrir o app, um aviso aparece **por cima da
   tela inicial**, com o valor em destaque e dois botões: *Confirmo que recebi* e
   *Ainda não*. Enquanto ele não confirmar, o aviso volta toda vez que ele abrir.
3. Confirmado, **você** recebe o aviso de confirmação na sua próxima abertura.

Regras: **só você informa** (quem paga é você) e **só ele confirma** (confirmar é
atestar que o dinheiro chegou). Enquanto não confirmado, você pode cancelar o
aviso — errou o valor, apaga e refaz. Depois de confirmado, o registro é dos dois
e fica.

## Professores e locais

Em **Ajustes → Professores e locais** você monta a lista que aparece nos campos
**Professor** e **Local** ao marcar as aulas. Os dois perfis podem cadastrar, e há
um atalho *"+ Cadastrar novo…"* dentro do próprio campo. Remover uma opção não
altera as aulas já marcadas.

## Senhas: criar acesso e resetar

Em **Ajustes → Acessos**:

- **+ Novo acesso** — preencha nome e e-mail e **deixe a senha em branco**: o app
  sorteia uma provisória e mostra **uma vez**, com botão de copiar. Repasse para a
  pessoa.
- **Resetar senha** — em qualquer linha da lista. Você pode digitar uma senha ou
  deixar em branco para o app sortear. Também é mostrada uma vez só.

Quem recebe uma senha provisória **é obrigado a trocá-la no primeiro acesso**: ao
entrar, o app abre uma tela que não dá para fechar e só libera depois da troca.
Não adianta contornar pela tela — o servidor recusa todas as telas do app até lá.

Enquanto a pessoa não escolheu a senha dela, a lista de acessos mostra a etiqueta
**senha provisória** ao lado dela.

Duas consequências boas: **você nunca fica sabendo a senha definitiva de ninguém**,
e resetar a senha de alguém **derruba o acesso dele na hora**, mesmo que esteja com
o app aberto.

## Sair do aplicativo

**Ajustes → Minha conta → Sair do aplicativo.** No computador o botão também está
no rodapé da barra lateral.

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
  · `transferida` (remarcada para outro dia, com aprovação do personal).
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
    **Perdido** = faltas **+ cancelamentos** · **Transferido** = remarcadas para outro dia.
  - **Transferência não é perda nem devolução:** o valor fica no mês de origem e a
    aula reaparece no mês de destino como crédito de R$ 0.
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
