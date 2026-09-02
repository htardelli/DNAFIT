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
| Calendário dos dias de aula | **Agenda** — calendário mensal + agendamento recorrente (ex.: seg/qua/sex por 8 semanas) |
| Quantidade de aulas | **Planos** — pacote contratado, aulas usadas, **saldo** e custo por aula |
| Frequência | **Agenda** (KPI de aderência e sequência) e **Frequência** (gráficos por mês/semana) |
| Tipo de exercício | **Treinos** — biblioteca por grupo muscular e equipamento; tipo da aula (Força, Hipertrofia, HIIT…) |
| Descrição dos exercícios | **Treinos** (execução de cada exercício) e, na aula, séries/reps/carga/descanso/observação |

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
**Configurações** antes de qualquer outra coisa.

## Como publicar no Railway (acesso pelo celular, de qualquer lugar)

1. Novo **serviço** no mesmo repositório `htardelli/planges`.
2. Settings → **Root Directory** = `fitplan` (é o que separa do PLANGEST; sem isso o Railway
   sobe o app errado).
3. Anexe um **volume** em `/data` — sem volume, o banco é apagado a cada deploy.
4. Variáveis de ambiente:

| Variável | Para quê |
|---|---|
| `FITPLAN_SECRET_KEY` | assina os tokens de login. **Obrigatória em produção** — troque por um valor aleatório longo |
| `FITPLAN_ADMIN_EMAIL` / `FITPLAN_ADMIN_SENHA` | dono criado no primeiro start (padrão: `htardelli@gmail.com` / `fitplan123`) |
| `FITPLAN_TOKEN_HORAS` | validade do login (padrão 720 h = 30 dias, para não relogar toda hora no celular) |
| `FITPLAN_DATA_DIR` | pasta do banco, se quiser forçar outro caminho |

---

## Perfis de acesso

| Perfil | Pode |
|---|---|
| **Aluno** (dono) | tudo, inclusive criar/remover acessos |
| **Personal** | agenda, treinos, exercícios, planos e frequência — **não** mexe nos acessos |

Crie o acesso do personal em **Configurações → Acessos → + Novo acesso**.

---

## Conceitos que o app usa (para os números fazerem sentido)

- **Status da aula:** `agendada` · `realizada` · `falta` (perdeu sem avisar) · `cancelada` (cancelada com aviso).
- **Consome aula do pacote:** `realizada` e `falta`. `cancelada` não consome.
- **Frequência (aderência)** = realizadas ÷ (realizadas + faltas + agendadas que já passaram).
  Canceladas ficam fora da conta de propósito — senão um cancelamento do professor derruba sua nota.
- **Sequência** = semanas consecutivas (encerradas) em que você bateu a meta semanal do pacote.
- **Volume de carga (kg)** = séries × repetições × carga, somado nas aulas realizadas.
  Reps em tempo ("30s") não entram no volume — só o que tem repetição contável.
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
