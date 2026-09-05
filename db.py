"""FITPLAN — banco de dados (SQLite).

Aplicação INDEPENDENTE: banco, autenticação e deploy próprios.
Não importa nem compartilha nada com o PLANGEST.
"""
import os
import aiosqlite

# Resolve o diretório de dados:
# 1) FITPLAN_DATA_DIR (se você quiser apontar para outro lugar)
# 2) volume do Railway (RAILWAY_VOLUME_MOUNT_PATH → normalmente /data)
# 3) /data, se montado
# 4) pasta local (desenvolvimento no Windows)
_env_dir = os.environ.get("FITPLAN_DATA_DIR")
_vol = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH")
if _env_dir:
    _data_dir = _env_dir
elif _vol:
    _data_dir = _vol
elif os.path.isdir("/data"):
    _data_dir = "/data"
else:
    _data_dir = os.path.dirname(__file__)
try:
    os.makedirs(_data_dir, exist_ok=True)
except Exception as e:
    print(f"[DB] Aviso: não foi possível criar {_data_dir}: {e}")

DB_PATH = os.path.join(_data_dir, "fitplan.db")
print(f"[DB] FITPLAN em: {DB_PATH}")


async def get_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=5000")
        await db.execute("PRAGMA foreign_keys=ON")
        yield db


SCHEMA = """
CREATE TABLE IF NOT EXISTS usuarios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nome       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'aluno',   -- 'aluno' (dono) | 'personal' (professor)
    ativo      INTEGER NOT NULL DEFAULT 1,
    criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pacotes de aula contratados (controle de quantidade e saldo)
-- Configuração geral (chave/valor). Guarda o valor da hora-aula vigente e os
-- padrões usados ao marcar os dias do mês.
CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT
);

CREATE TABLE IF NOT EXISTS planos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    nome              TEXT NOT NULL,
    inicio            DATE,
    fim               DATE,
    aulas_contratadas INTEGER DEFAULT 0,
    valor             REAL DEFAULT 0,       -- valor total do pacote (quando pré-pago)
    valor_hora        REAL,                 -- valor da hora-aula deste período (tem prioridade sobre a config)
    freq_semanal      INTEGER DEFAULT 0,    -- meta de aulas por semana
    professor         TEXT,
    obs               TEXT,
    ativo             INTEGER DEFAULT 1,
    criado_em         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Biblioteca de exercícios (nome, grupo muscular, equipamento, execução)
CREATE TABLE IF NOT EXISTS exercicios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT NOT NULL UNIQUE,
    grupo       TEXT,          -- Peito, Costas, Pernas, Ombro, Braços, Core, Cardio, Mobilidade
    equipamento TEXT,          -- Barra, Halter, Máquina, Cabo, Peso corporal, Elástico, Livre
    descricao   TEXT,          -- como executar
    video_url   TEXT,
    ativo       INTEGER DEFAULT 1,
    criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ex_grupo ON exercicios(grupo);

-- Modelos de treino reutilizáveis (Treino A, B, C…)
CREATE TABLE IF NOT EXISTS modelos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT NOT NULL,
    tipo      TEXT,   -- Força, Hipertrofia, Funcional, HIIT, Cardio, Mobilidade
    foco      TEXT,   -- grupos musculares do dia
    obs       TEXT,
    ativo     INTEGER DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS modelo_itens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    modelo_id    INTEGER NOT NULL,
    exercicio_id INTEGER,
    nome         TEXT,        -- snapshot do nome (sobrevive à exclusão no cadastro)
    ordem        INTEGER DEFAULT 0,
    series       INTEGER,
    repeticoes   TEXT,        -- "12", "8-10", "30s"
    carga        REAL,
    descanso_seg INTEGER,
    obs          TEXT,
    FOREIGN KEY (modelo_id) REFERENCES modelos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mi_modelo ON modelo_itens(modelo_id);

-- Agenda de aulas
CREATE TABLE IF NOT EXISTS aulas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    data          DATE NOT NULL,
    hora          TEXT,                      -- 'HH:MM'
    duracao_min   INTEGER DEFAULT 60,
    tipo          TEXT,                      -- Força, Hipertrofia, Funcional, HIIT, Cardio, Mobilidade, Avaliação
    foco          TEXT,
    local         TEXT,
    professor     TEXT,
    status        TEXT DEFAULT 'agendada',   -- agendada | realizada | falta | cancelada
    modalidade    TEXT DEFAULT 'com_personal', -- com_personal | sozinho
    plano_id      INTEGER,
    modelo_id     INTEGER,
    descricao     TEXT,                      -- descrição do treino do dia
    obs           TEXT,                      -- como foi a aula
    pse           INTEGER,                   -- percepção de esforço (1-10)
    valor         REAL,                      -- valor da hora-aula NO DIA (snapshot: reajuste não reescreve o passado)
    criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP,
    FOREIGN KEY (plano_id)  REFERENCES planos(id)  ON DELETE SET NULL,
    FOREIGN KEY (modelo_id) REFERENCES modelos(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_aula_data   ON aulas(data);
CREATE INDEX IF NOT EXISTS idx_aula_status ON aulas(status);

-- Exercícios prescritos/executados em cada aula
CREATE TABLE IF NOT EXISTS aula_exercicios (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    aula_id      INTEGER NOT NULL,
    exercicio_id INTEGER,
    nome         TEXT,
    ordem        INTEGER DEFAULT 0,
    series       INTEGER,
    repeticoes   TEXT,
    carga        REAL,
    descanso_seg INTEGER,
    feito        INTEGER DEFAULT 0,
    obs          TEXT,
    FOREIGN KEY (aula_id) REFERENCES aulas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ae_aula ON aula_exercicios(aula_id);

-- Execução série a série. A prescrição (séries/repetições/descanso) fica em
-- aula_exercicios; aqui fica o que saiu de fato em cada série: carga, repetições
-- e o "check" na academia. Sem isto não existe histórico de carga confiável —
-- uma linha só por exercício não distingue aquecimento de série pesada.
CREATE TABLE IF NOT EXISTS aula_series (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    aula_exercicio_id INTEGER NOT NULL,
    ordem             INTEGER NOT NULL DEFAULT 1,   -- 1ª, 2ª, 3ª série…
    carga             REAL,
    repeticoes        INTEGER,
    feito             INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (aula_exercicio_id) REFERENCES aula_exercicios(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_as_item_ordem ON aula_series(aula_exercicio_id, ordem);

-- Medidas corporais. Uma linha por dia (a última do dia vence) — peso é o único
-- campo obrigatório; o resto é opcional e entra quando ele medir.
CREATE TABLE IF NOT EXISTS medidas (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    data      DATE NOT NULL UNIQUE,
    peso      REAL,
    cintura   REAL,
    quadril   REAL,
    peito     REAL,
    braco     REAL,
    coxa      REAL,
    obs       TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

# Biblioteca inicial — só é gravada se a tabela estiver vazia (depois é 100% editável)
SEED_EXERCICIOS = [
    ("Supino reto",           "Peito",      "Barra",         "Deitado no banco, desça a barra até a linha do peito e empurre sem travar os cotovelos."),
    ("Supino inclinado",      "Peito",      "Halter",        "Banco a 30-45°. Desça os halteres na linha da clavícula."),
    ("Crucifixo",             "Peito",      "Halter",        "Cotovelos semiflexionados, abra até a linha do ombro."),
    ("Crossover",             "Peito",      "Cabo",          "Puxada dos cabos à frente do corpo, contraindo o peitoral."),
    ("Flexão de braço",       "Peito",      "Peso corporal", "Corpo alinhado, desça até o peito quase tocar o chão."),
    ("Puxada frontal",        "Costas",     "Máquina",       "Puxe a barra até a altura do queixo, escápulas para baixo."),
    ("Remada curvada",        "Costas",     "Barra",         "Tronco a 45°, puxe a barra até o umbigo."),
    ("Remada unilateral",     "Costas",     "Halter",        "Apoio no banco, puxe o halter junto ao tronco."),
    ("Remada baixa",          "Costas",     "Cabo",          "Sentado, puxe o triângulo até o abdômen mantendo o tronco firme."),
    ("Barra fixa",            "Costas",     "Peso corporal", "Pegada pronada, suba até o queixo passar a barra."),
    ("Levantamento terra",    "Costas",     "Barra",         "Coluna neutra, quadril para trás, suba empurrando o chão."),
    ("Agachamento livre",     "Pernas",     "Barra",         "Pés na largura dos ombros, desça até a coxa paralela ao solo."),
    ("Leg press",             "Pernas",     "Máquina",       "Pés na plataforma, desça até 90° sem tirar o quadril do apoio."),
    ("Cadeira extensora",     "Pernas",     "Máquina",       "Estenda os joelhos e segure 1s na contração."),
    ("Mesa flexora",          "Pernas",     "Máquina",       "Flexione os joelhos controlando a volta."),
    ("Afundo",                "Pernas",     "Halter",        "Passada à frente, joelho de trás quase tocando o chão."),
    ("Stiff",                 "Pernas",     "Barra",         "Joelhos semiflexionados, desça a barra rente às pernas."),
    ("Panturrilha em pé",     "Pernas",     "Máquina",       "Elevação máxima do calcanhar, 2s na contração."),
    ("Desenvolvimento",       "Ombro",      "Halter",        "Sentado, empurre os halteres acima da cabeça."),
    ("Elevação lateral",      "Ombro",      "Halter",        "Suba até a linha do ombro, cotovelos levemente flexionados."),
    ("Elevação frontal",      "Ombro",      "Halter",        "Suba à frente até a altura dos olhos."),
    ("Remada alta",           "Ombro",      "Barra",         "Puxe a barra até o peito, cotovelos acima das mãos."),
    ("Rosca direta",          "Braços",     "Barra",         "Cotovelos fixos ao lado do corpo."),
    ("Rosca alternada",       "Braços",     "Halter",        "Alterne os braços com supinação no meio do movimento."),
    ("Tríceps testa",         "Braços",     "Barra",         "Deitado, flexione só os cotovelos."),
    ("Tríceps corda",         "Braços",     "Cabo",          "Estenda os cotovelos abrindo a corda no final."),
    ("Mergulho no banco",     "Braços",     "Peso corporal", "Mãos no banco, desça até 90° de cotovelo."),
    ("Prancha isométrica",    "Core",       "Peso corporal", "Apoio nos antebraços, corpo alinhado, abdômen contraído."),
    ("Abdominal supra",       "Core",       "Peso corporal", "Eleve o tronco contraindo o abdômen, sem puxar o pescoço."),
    ("Prancha lateral",       "Core",       "Peso corporal", "Apoio em um antebraço, quadril elevado e alinhado."),
    ("Elevação de pernas",    "Core",       "Peso corporal", "Deitado, suba as pernas estendidas sem arquear a lombar."),
    ("Esteira",               "Cardio",     "Máquina",       "Corrida ou caminhada inclinada — anote tempo/velocidade na observação."),
    ("Bike",                  "Cardio",     "Máquina",       "Pedalada contínua ou intervalada."),
    ("Corda naval",           "Cardio",     "Livre",         "Ondas alternadas, 20-40s por série."),
    ("Burpee",                "Cardio",     "Peso corporal", "Agachamento, prancha, flexão e salto."),
    ("Alongamento posterior", "Mobilidade", "Peso corporal", "Sentado, alcance os pés mantendo a coluna longa."),
    ("Mobilidade de quadril", "Mobilidade", "Peso corporal", "Rotações e aberturas controladas de quadril."),
    ("Mobilidade torácica",   "Mobilidade", "Peso corporal", "Rotação de tronco em quatro apoios."),
]


DEFAULTS_CONFIG = {
    "valor_hora": "0",        # R$ por aula — base do cálculo do mês
    "hora_padrao": "06:30",
    "duracao_padrao": "60",
    "professor_padrao": "",
    "local_padrao": "",
    "altura_cm": "0",         # usada no IMC e no painel de corpo
    "peso_meta": "0",         # meta de peso — 0 = sem meta definida
}


async def obter_secret_key() -> str:
    """Lê do banco a chave de assinatura (a variável de ambiente, se existir, vence)."""
    import os as _os
    env = _os.environ.get("FITPLAN_SECRET_KEY")
    if env:
        return env
    async with aiosqlite.connect(DB_PATH) as db:
        row = await (await db.execute("SELECT valor FROM config WHERE chave='secret_key'")).fetchone()
        return row[0] if row else ""


async def init_db(hash_fn):
    """Cria o schema, semeia a biblioteca de exercícios e o usuário dono.

    hash_fn: função de hash de senha (injetada pelo app para não duplicar libs aqui).
    """
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)

        # Migrações idempotentes (bancos criados antes destas colunas)
        async def _add_col(tabela, coluna, tipo):
            try:
                await db.execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}")
            except Exception:
                pass   # a coluna já existe
        await _add_col("planos", "valor_hora", "REAL")
        await _add_col("aulas", "valor", "REAL")
        await _add_col("aulas", "modalidade", "TEXT")
        await _add_col("exercicios", "favorito", "INTEGER DEFAULT 0")
        # Modelo que o ALUNO pediu para uma aula do personal. Fica separado de
        # modelo_id (a prescrição de fato) — pedido não é prescrição.
        await _add_col("aulas", "sugestao_modelo_id", "INTEGER")
        # aulas criadas antes desta coluna eram todas com o personal
        await db.execute("UPDATE aulas SET modalidade='com_personal' "
                         "WHERE modalidade IS NULL OR modalidade=''")

        for chave, valor in DEFAULTS_CONFIG.items():
            await db.execute("INSERT OR IGNORE INTO config (chave, valor) VALUES (?,?)", (chave, valor))

        # Chave de assinatura dos tokens de login. Gerada aqui, aleatória, e guardada
        # no banco — assim o app publicado nunca cai numa chave padrão que esteja no
        # código-fonte (qualquer um que lesse o repositório poderia forjar um login).
        import secrets
        await db.execute("INSERT OR IGNORE INTO config (chave, valor) VALUES ('secret_key', ?)",
                         (secrets.token_urlsafe(48),))

        n = (await (await db.execute("SELECT COUNT(*) FROM exercicios")).fetchone())[0]
        if n == 0:
            for nome, grupo, equip, desc in SEED_EXERCICIOS:
                await db.execute(
                    "INSERT OR IGNORE INTO exercicios (nome, grupo, equipamento, descricao) VALUES (?,?,?,?)",
                    (nome, grupo, equip, desc))
            print(f"[DB] Biblioteca inicial: {len(SEED_EXERCICIOS)} exercícios")

        # Usuário dono (aluno). E-mail e senha configuráveis por variável de ambiente.
        n = (await (await db.execute("SELECT COUNT(*) FROM usuarios")).fetchone())[0]
        if n == 0:
            email = os.environ.get("FITPLAN_ADMIN_EMAIL", "htardelli@gmail.com").lower()
            senha = os.environ.get("FITPLAN_ADMIN_SENHA", "fitplan123")
            nome = os.environ.get("FITPLAN_ADMIN_NOME", "Tardelli")
            await db.execute(
                "INSERT INTO usuarios (nome, email, senha_hash, role) VALUES (?,?,?,'aluno')",
                (nome, email, hash_fn(senha)))
            print(f"[DB] Usuário dono criado: {email} (troque a senha no primeiro acesso)")

        await db.commit()
