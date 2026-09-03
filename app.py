"""FITPLAN — controle de aulas com o personal trainer.

Aplicação independente (backend FastAPI + SQLite + SPA em HTML/JS puro).
Não compartilha código, banco ou login com o PLANGEST.

Módulos:
  • Agenda      — calendário de aulas, status e recorrência
  • Treinos     — biblioteca de exercícios e modelos de treino (A/B/C…)
  • Frequência  — aderência, volume, evolução de carga
  • Planos      — pacotes contratados e saldo de aulas
"""
import os
import re
import calendar as _cal
from datetime import date, datetime, timedelta
from typing import Optional, List

import aiosqlite
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from db import DB_PATH, get_db, init_db, obter_secret_key

# ── Config ────────────────────────────────────────────────────────────────────
# A chave de assinatura NÃO tem valor padrão no código: é sorteada no primeiro start
# e guardada no banco (ou vem de FITPLAN_SECRET_KEY). Sem isso, um app publicado com
# a chave que está no repositório aceitaria tokens forjados por qualquer um.
SECRET_KEY = ""
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = int(os.environ.get("FITPLAN_TOKEN_HORAS", "720"))  # 30 dias (uso em celular)

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login")

STATUS_VALIDOS = ("agendada", "realizada", "falta", "cancelada")

# Bloqueio de força bruta no login. App exposto na internet com 2 usuários: sem isso,
# uma senha fraca cai em minutos. Em memória — reinício do container zera, o que é
# aceitável para o tamanho do problema.
LOGIN_MAX_TENTATIVAS = 5
LOGIN_BLOQUEIO_MIN = 10
_tentativas: dict = {}


def _login_bloqueado(chave: str) -> int:
    """Segundos restantes de bloqueio (0 = liberado)."""
    reg = _tentativas.get(chave)
    if not reg or not reg.get("ate"):
        return 0
    falta = (reg["ate"] - datetime.utcnow()).total_seconds()
    if falta <= 0:
        _tentativas.pop(chave, None)
        return 0
    return int(falta)


def _login_falhou(chave: str):
    reg = _tentativas.setdefault(chave, {"n": 0, "ate": None})
    reg["n"] += 1
    if reg["n"] >= LOGIN_MAX_TENTATIVAS:
        reg["ate"] = datetime.utcnow() + timedelta(minutes=LOGIN_BLOQUEIO_MIN)
        reg["n"] = 0
# Acordo com o personal: o valor pago NUNCA é devolvido. Ou a aula é remarcada
# dentro do mês, ou o valor se perde. Logo toda aula na agenda consome o pacote e
# entra no valor do mês — nenhum status devolve dinheiro.
STATUS_CONSOME = STATUS_VALIDOS

# Como a aula acontece. Define quem monta o treino e se ela é cobrada.
MODALIDADES = ("com_personal", "sozinho")

# Numa aula COM O PERSONAL, o treino é prescrição do professor: o aluno só lê.
# Ele continua dono do registro do dia — pode remarcar, dizer se aconteceu e
# lançar o feedback. Estes são os campos que ele pode mexer nessas aulas.
CAMPOS_ALUNO_EM_AULA_DO_PERSONAL = {"data", "hora", "status", "obs", "pse", "valor", "modalidade"}


def _pode_montar_treino(user, aula) -> bool:
    """O personal monta qualquer treino. O aluno monta só o que treina sozinho."""
    if user["role"] == "personal":
        return True
    return (aula["modalidade"] or "com_personal") == "sozinho"


def _hash(pw: str) -> str:
    return _pwd.hash(pw)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global SECRET_KEY
    await init_db(_hash)
    SECRET_KEY = await obter_secret_key()
    if not SECRET_KEY:
        raise RuntimeError("Não foi possível obter a chave de assinatura dos tokens")
    yield


app = FastAPI(title="FITPLAN", lifespan=lifespan)


# ── Auth ──────────────────────────────────────────────────────────────────────
def _create_token(data: dict) -> str:
    exp = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({**data, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: str = Depends(_oauth2),
                           db: aiosqlite.Connection = Depends(get_db)):
    exc = HTTPException(401, "Token inválido ou expirado", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        uid = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise exc
    row = await (await db.execute("SELECT * FROM usuarios WHERE id=? AND ativo=1", (uid,))).fetchone()
    if not row:
        raise exc
    return dict(row)


async def require_dono(user=Depends(get_current_user)):
    """Só o aluno (dono da conta) gerencia usuários."""
    if user["role"] != "aluno":
        raise HTTPException(403, "Ação restrita ao dono da conta")
    return user


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    nome: str
    role: str


@app.post("/auth/login", response_model=LoginOut)
async def login(request: Request, form: OAuth2PasswordRequestForm = Depends(),
                db: aiosqlite.Connection = Depends(get_db)):
    email = form.username.lower().strip()
    chave = f"{email}|{request.client.host if request.client else '?'}"
    espera = _login_bloqueado(chave)
    if espera:
        raise HTTPException(429, f"Muitas tentativas. Tente novamente em {espera // 60 + 1} min.")

    row = await (await db.execute("SELECT * FROM usuarios WHERE email=?", (email,))).fetchone()
    if not row or not _pwd.verify(form.password, row["senha_hash"]):
        _login_falhou(chave)
        raise HTTPException(401, "E-mail ou senha incorretos")
    if not row["ativo"]:
        raise HTTPException(403, "Usuário inativo")
    _tentativas.pop(chave, None)
    return LoginOut(access_token=_create_token({"sub": str(row["id"]), "role": row["role"]}),
                    nome=row["nome"], role=row["role"])


SENHA_PADRAO = os.environ.get("FITPLAN_ADMIN_SENHA", "fitplan123")


@app.get("/auth/me")
async def me(user=Depends(get_current_user)):
    # Sinaliza se a conta ainda usa a senha inicial — o app publicado avisa na tela
    try:
        padrao = _pwd.verify(SENHA_PADRAO, user["senha_hash"])
    except Exception:
        padrao = False
    return {"id": user["id"], "nome": user["nome"], "email": user["email"],
            "role": user["role"], "senha_padrao": padrao}


class SenhaIn(BaseModel):
    senha_atual: str
    nova_senha: str


@app.post("/auth/senha")
async def trocar_senha(body: SenhaIn, user=Depends(get_current_user),
                       db: aiosqlite.Connection = Depends(get_db)):
    if not _pwd.verify(body.senha_atual, user["senha_hash"]):
        raise HTTPException(400, "Senha atual incorreta")
    if len(body.nova_senha) < 8:
        raise HTTPException(400, "A nova senha deve ter no mínimo 8 caracteres")
    await db.execute("UPDATE usuarios SET senha_hash=? WHERE id=?", (_hash(body.nova_senha), user["id"]))
    await db.commit()
    return {"msg": "Senha alterada"}


class UsuarioIn(BaseModel):
    nome: str
    email: str
    senha: str
    role: str = "personal"


class UsuarioUpdate(BaseModel):
    nome: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    ativo: Optional[bool] = None
    nova_senha: Optional[str] = None


@app.get("/api/usuarios")
async def listar_usuarios(user=Depends(require_dono), db: aiosqlite.Connection = Depends(get_db)):
    cur = await db.execute("SELECT id, nome, email, role, ativo, criado_em FROM usuarios ORDER BY id")
    return [dict(r) for r in await cur.fetchall()]


@app.post("/api/usuarios", status_code=201)
async def criar_usuario(body: UsuarioIn, user=Depends(require_dono),
                        db: aiosqlite.Connection = Depends(get_db)):
    if body.role not in ("aluno", "personal"):
        raise HTTPException(400, "Perfil deve ser 'aluno' ou 'personal'")
    if len(body.senha) < 8:
        raise HTTPException(400, "A senha deve ter no mínimo 8 caracteres")
    email = body.email.lower().strip()
    if await (await db.execute("SELECT id FROM usuarios WHERE email=?", (email,))).fetchone():
        raise HTTPException(400, "E-mail já cadastrado")
    cur = await db.execute(
        "INSERT INTO usuarios (nome, email, senha_hash, role) VALUES (?,?,?,?)",
        (body.nome.strip(), email, _hash(body.senha), body.role))
    await db.commit()
    return {"id": cur.lastrowid}


@app.patch("/api/usuarios/{uid}")
async def editar_usuario(uid: int, body: UsuarioUpdate, user=Depends(require_dono),
                         db: aiosqlite.Connection = Depends(get_db)):
    alvo = await (await db.execute("SELECT * FROM usuarios WHERE id=?", (uid,))).fetchone()
    if not alvo:
        raise HTTPException(404, "Usuário não encontrado")
    sets, params = [], []
    if body.nome:
        sets.append("nome=?"); params.append(body.nome.strip())
    if body.email:
        email = body.email.lower().strip()
        if await (await db.execute("SELECT id FROM usuarios WHERE email=? AND id<>?", (email, uid))).fetchone():
            raise HTTPException(400, "E-mail já cadastrado")
        sets.append("email=?"); params.append(email)
    if body.role:
        if body.role not in ("aluno", "personal"):
            raise HTTPException(400, "Perfil inválido")
        sets.append("role=?"); params.append(body.role)
    if body.ativo is not None:
        sets.append("ativo=?"); params.append(1 if body.ativo else 0)
    if body.nova_senha:
        if len(body.nova_senha) < 8:
            raise HTTPException(400, "A senha deve ter no mínimo 8 caracteres")
        sets.append("senha_hash=?"); params.append(_hash(body.nova_senha))
    # Trava de segurança: nunca deixar a conta sem um dono ativo
    if (body.role and body.role != "aluno") or body.ativo is False:
        n = (await (await db.execute(
            "SELECT COUNT(*) FROM usuarios WHERE role='aluno' AND ativo=1 AND id<>?", (uid,))).fetchone())[0]
        if alvo["role"] == "aluno" and n == 0:
            raise HTTPException(400, "Não é possível remover o único dono da conta")
    if not sets:
        raise HTTPException(400, "Nada para atualizar")
    params.append(uid)
    await db.execute(f"UPDATE usuarios SET {', '.join(sets)} WHERE id=?", params)
    await db.commit()
    return {"msg": "Usuário atualizado"}


@app.delete("/api/usuarios/{uid}", status_code=204)
async def remover_usuario(uid: int, user=Depends(require_dono),
                          db: aiosqlite.Connection = Depends(get_db)):
    if uid == user["id"]:
        raise HTTPException(400, "Você não pode remover a própria conta")
    await db.execute("DELETE FROM usuarios WHERE id=?", (uid,))
    await db.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────
def _d(row) -> dict:
    return dict(row) if row is not None else None


def _hoje() -> date:
    return date.today()


def _parse_data(s: str) -> str:
    """Aceita 'YYYY-MM-DD' ou 'DD/MM/YYYY' e devolve sempre ISO."""
    s = (s or "").strip()
    if not s:
        raise HTTPException(400, "Data obrigatória")
    if "/" in s:
        d, m, a = s.split("/")
        return f"{int(a):04d}-{int(m):02d}-{int(d):02d}"
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        raise HTTPException(400, f"Data inválida: {s}")


def _mes_range(mes: Optional[str]) -> tuple:
    """'YYYY-MM' → (primeiro_dia_iso, ultimo_dia_iso). Sem argumento, mês corrente."""
    if mes:
        try:
            ano, m = int(mes[:4]), int(mes[5:7])
        except (ValueError, IndexError):
            raise HTTPException(400, "Mês inválido (use YYYY-MM)")
    else:
        hoje = _hoje()
        ano, m = hoje.year, hoje.month
    ult = _cal.monthrange(ano, m)[1]
    return date(ano, m, 1).isoformat(), date(ano, m, ult).isoformat()


_RE_NUM = re.compile(r"\d+(?:[.,]\d+)?")


def _reps_num(rep) -> float:
    """'12'→12 · '8-10'→9 (média) · '30s'→0 (tempo não entra no volume de carga)."""
    if rep is None:
        return 0.0
    t = str(rep).strip().lower()
    if not t or "s" in t or "min" in t or ":" in t:
        return 0.0
    nums = [float(x.replace(",", ".")) for x in _RE_NUM.findall(t)]
    if not nums:
        return 0.0
    return sum(nums[:2]) / len(nums[:2])


def _volume(series, repeticoes, carga) -> float:
    """Volume de carga (kg) = séries × repetições × carga."""
    return float(series or 0) * _reps_num(repeticoes) * float(carga or 0)


def _semana_ini(d: date) -> date:
    """Segunda-feira da semana da data."""
    return d - timedelta(days=d.weekday())


# ── Configuração e valor da hora-aula ─────────────────────────────────────────
async def _config(db) -> dict:
    cur = await db.execute("SELECT chave, valor FROM config")
    return {r["chave"]: r["valor"] for r in await cur.fetchall()}


async def _valor_hora(db, dia: Optional[str] = None) -> float:
    """Valor da hora-aula vigente: o do pacote que cobre a data (quando informado)
    tem prioridade sobre o valor geral da configuração."""
    dia = dia or _hoje().isoformat()
    row = await (await db.execute("""
        SELECT valor_hora FROM planos
         WHERE ativo=1 AND valor_hora IS NOT NULL AND valor_hora > 0
           AND (inicio IS NULL OR inicio <= ?) AND (fim IS NULL OR fim >= ?)
      ORDER BY COALESCE(inicio,'') DESC LIMIT 1
    """, (dia, dia))).fetchone()
    if row:
        return float(row["valor_hora"])
    cfg = await _config(db)
    try:
        return float(cfg.get("valor_hora") or 0)
    except ValueError:
        return 0.0


# ── Feriados nacionais ────────────────────────────────────────────────────────
# Calculados, não consultados: os fixos por data e os móveis a partir da Páscoa.
# Sem rede, sem chave de API, sem cadastro para manter — e funciona para
# qualquer ano, inclusive os futuros que o usuário for planejar.

def _pascoa(ano: int) -> date:
    """Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano)."""
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = ((h + l - 7 * m + 114) % 31) + 1
    return date(ano, mes, dia)


# (mês, dia, nome) — feriados nacionais de data fixa
_FERIADOS_FIXOS = [
    (1, 1, "Confraternização Universal"),
    (4, 21, "Tiradentes"),
    (5, 1, "Dia do Trabalho"),
    (9, 7, "Independência do Brasil"),
    (10, 12, "Nossa Senhora Aparecida"),
    (11, 2, "Finados"),
    (11, 15, "Proclamação da República"),
    (12, 25, "Natal"),
]


def _feriados(ano: int) -> dict:
    """{'YYYY-MM-DD': {'nome': ..., 'tipo': 'feriado'|'facultativo'}}

    'feriado'     = feriado nacional (lei federal), o comércio e a academia param.
    'facultativo' = ponto facultativo nacional (Carnaval, Cinzas, Corpus Christi):
                    não é feriado por lei, mas na prática quase tudo fecha — o que
                    importa para planejar treino.
    """
    out = {}
    for mes, dia, nome in _FERIADOS_FIXOS:
        out[date(ano, mes, dia).isoformat()] = {"nome": nome, "tipo": "feriado"}
    # Consciência Negra virou feriado nacional pela Lei 14.759/2023
    if ano >= 2024:
        out[date(ano, 11, 20).isoformat()] = {"nome": "Consciência Negra", "tipo": "feriado"}

    p = _pascoa(ano)
    moveis = [
        (p - timedelta(days=48), "Carnaval", "facultativo"),
        (p - timedelta(days=47), "Carnaval", "facultativo"),
        (p - timedelta(days=46), "Quarta-feira de Cinzas", "facultativo"),
        (p - timedelta(days=2),  "Sexta-feira Santa", "feriado"),
        (p,                      "Páscoa", "facultativo"),
        (p + timedelta(days=60), "Corpus Christi", "facultativo"),
    ]
    for d, nome, tipo in moveis:
        out.setdefault(d.isoformat(), {"nome": nome, "tipo": tipo})
    return out


@app.get("/api/feriados")
async def listar_feriados(ano: Optional[int] = None, user=Depends(get_current_user)):
    """Feriados do ano, para o calendário destacar na hora de planejar o mês."""
    ano = ano or _hoje().year
    if not (1900 <= ano <= 2200):
        raise HTTPException(400, "Ano fora do intervalo suportado")
    return {"ano": ano, "feriados": _feriados(ano)}


# ── Schemas ───────────────────────────────────────────────────────────────────
class AulaIn(BaseModel):
    data: str
    hora: Optional[str] = None
    duracao_min: Optional[int] = 60
    tipo: Optional[str] = None
    foco: Optional[str] = None
    local: Optional[str] = None
    professor: Optional[str] = None
    status: Optional[str] = "agendada"
    modalidade: Optional[str] = "com_personal"
    plano_id: Optional[int] = None
    modelo_id: Optional[int] = None
    descricao: Optional[str] = None
    obs: Optional[str] = None
    pse: Optional[int] = None
    valor: Optional[float] = None    # None → usa o valor da hora-aula vigente
    # Recorrência: repete a aula por N semanas nos dias da semana escolhidos
    # (0=segunda … 6=domingo). Vazio = usa o dia da semana da própria data.
    repetir_semanas: Optional[int] = 0
    dias_semana: Optional[List[int]] = None


class AulaUpdate(BaseModel):
    data: Optional[str] = None
    hora: Optional[str] = None
    duracao_min: Optional[int] = None
    tipo: Optional[str] = None
    foco: Optional[str] = None
    local: Optional[str] = None
    professor: Optional[str] = None
    status: Optional[str] = None
    modalidade: Optional[str] = None
    plano_id: Optional[int] = None
    modelo_id: Optional[int] = None
    descricao: Optional[str] = None
    obs: Optional[str] = None
    pse: Optional[int] = None
    valor: Optional[float] = None


class DiasDoMesIn(BaseModel):
    """O aluno marca os dias do mês em que fará aula; o personal preenche o treino depois."""
    mes: str                       # 'YYYY-MM'
    dias: List[int]                # dias do mês (1..31)
    hora: Optional[str] = None
    duracao_min: Optional[int] = 60
    professor: Optional[str] = None
    local: Optional[str] = None
    valor: Optional[float] = None  # None → valor da hora-aula vigente
    modalidade: Optional[str] = "com_personal"
    plano_id: Optional[int] = None


class ConfigIn(BaseModel):
    valor_hora: Optional[float] = None
    hora_padrao: Optional[str] = None
    duracao_padrao: Optional[int] = None
    professor_padrao: Optional[str] = None
    local_padrao: Optional[str] = None


class ItemIn(BaseModel):
    exercicio_id: Optional[int] = None
    nome: Optional[str] = None
    ordem: Optional[int] = None   # None → usa a posição na lista
    series: Optional[int] = None
    repeticoes: Optional[str] = None
    carga: Optional[float] = None
    descanso_seg: Optional[int] = None
    feito: Optional[bool] = False
    obs: Optional[str] = None


class ExercicioIn(BaseModel):
    nome: str
    grupo: Optional[str] = None
    equipamento: Optional[str] = None
    descricao: Optional[str] = None
    video_url: Optional[str] = None
    ativo: Optional[bool] = True


class ModeloIn(BaseModel):
    nome: str
    tipo: Optional[str] = None
    foco: Optional[str] = None
    obs: Optional[str] = None
    ativo: Optional[bool] = True
    itens: Optional[List[ItemIn]] = None


class PlanoIn(BaseModel):
    nome: str
    inicio: Optional[str] = None
    fim: Optional[str] = None
    aulas_contratadas: Optional[int] = 0
    valor: Optional[float] = 0
    valor_hora: Optional[float] = None
    freq_semanal: Optional[int] = 0
    professor: Optional[str] = None
    obs: Optional[str] = None
    ativo: Optional[bool] = True


@app.get("/api/config")
async def obter_config(user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    cfg = await _config(db)
    return {
        "valor_hora": float(cfg.get("valor_hora") or 0),
        "valor_hora_vigente": await _valor_hora(db),
        "hora_padrao": cfg.get("hora_padrao") or "",
        "duracao_padrao": int(cfg.get("duracao_padrao") or 60),
        "professor_padrao": cfg.get("professor_padrao") or "",
        "local_padrao": cfg.get("local_padrao") or "",
        "pode_editar": user["role"] == "aluno",
    }


@app.put("/api/config")
async def salvar_config(body: ConfigIn, user=Depends(require_dono),
                        db: aiosqlite.Connection = Depends(get_db)):
    """Só o dono mexe no preço — o personal enxerga, mas não altera."""
    for chave, valor in body.dict(exclude_unset=True).items():
        if valor is None:
            continue
        await db.execute("INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)",
                         (chave, str(valor)))
    await db.commit()
    return await obter_config(user, db)


# ── Aulas ─────────────────────────────────────────────────────────────────────
async def _itens_da_aula(db, aula_id: int) -> list:
    cur = await db.execute(
        "SELECT * FROM aula_exercicios WHERE aula_id=? ORDER BY ordem, id", (aula_id,))
    return [dict(r) for r in await cur.fetchall()]


@app.get("/api/aulas")
async def listar_aulas(ini: Optional[str] = None, fim: Optional[str] = None,
                       status: Optional[str] = None, mes: Optional[str] = None,
                       user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    # Sem período explícito (ou com 'mes'), a janela é o mês — usada pelo calendário
    if mes:
        ini, fim = _mes_range(mes)
    elif not ini or not fim:
        m_ini, m_fim = _mes_range(None)
        ini, fim = ini or m_ini, fim or m_fim
    sql = "SELECT * FROM aulas WHERE data BETWEEN ? AND ?"
    params = [_parse_data(ini), _parse_data(fim)]
    if status:
        sql += " AND status=?"; params.append(status)
    sql += " ORDER BY data, COALESCE(hora,'99:99')"
    cur = await db.execute(sql, params)
    aulas = [dict(r) for r in await cur.fetchall()]
    # Quantidade de exercícios por aula (para o resumo no calendário/lista)
    if aulas:
        ph = ",".join("?" * len(aulas))
        cur = await db.execute(
            f"SELECT aula_id, COUNT(*) n FROM aula_exercicios WHERE aula_id IN ({ph}) GROUP BY aula_id",
            [a["id"] for a in aulas])
        cont = {r["aula_id"]: r["n"] for r in await cur.fetchall()}
        for a in aulas:
            a["qtd_exercicios"] = cont.get(a["id"], 0)
    return aulas


@app.get("/api/aulas/{aid}")
async def obter_aula(aid: int, user=Depends(get_current_user),
                     db: aiosqlite.Connection = Depends(get_db)):
    row = await (await db.execute("SELECT * FROM aulas WHERE id=?", (aid,))).fetchone()
    if not row:
        raise HTTPException(404, "Aula não encontrada")
    aula = dict(row)
    aula["exercicios"] = await _itens_da_aula(db, aid)
    return aula


async def _copiar_modelo(db, aula_id: int, modelo_id: int) -> int:
    """Copia os itens do modelo para a aula (snapshot: editar a aula não mexe no modelo)."""
    cur = await db.execute(
        "SELECT * FROM modelo_itens WHERE modelo_id=? ORDER BY ordem, id", (modelo_id,))
    itens = [dict(r) for r in await cur.fetchall()]
    for i, it in enumerate(itens):
        await db.execute("""
            INSERT INTO aula_exercicios
                (aula_id, exercicio_id, nome, ordem, series, repeticoes, carga, descanso_seg, obs)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (aula_id, it["exercicio_id"], it["nome"], it["ordem"] or i,
              it["series"], it["repeticoes"], it["carga"], it["descanso_seg"], it["obs"]))
    return len(itens)


@app.post("/api/aulas", status_code=201)
async def criar_aula(body: AulaIn, user=Depends(get_current_user),
                     db: aiosqlite.Connection = Depends(get_db)):
    if body.status and body.status not in STATUS_VALIDOS:
        raise HTTPException(400, f"Status deve ser um de: {', '.join(STATUS_VALIDOS)}")
    modalidade = body.modalidade or "com_personal"
    if modalidade not in MODALIDADES:
        raise HTTPException(400, f"Modalidade deve ser um de: {', '.join(MODALIDADES)}")
    d0 = date.fromisoformat(_parse_data(body.data))

    # Datas a criar: a própria + a recorrência semanal, se pedida
    datas = [d0]
    semanas = max(0, int(body.repetir_semanas or 0))
    if semanas:
        dias = sorted(set(body.dias_semana or [d0.weekday()]))
        for s in range(semanas + 1):           # semana 0 = a da própria data
            base = _semana_ini(d0) + timedelta(weeks=s)
            for wd in dias:
                d = base + timedelta(days=wd)
                if d > d0 and d not in datas:  # nunca cria no passado da data base
                    datas.append(d)
        datas = sorted(datas)

    criadas, ignoradas = [], 0
    for d in datas:
        # Não duplica aula no mesmo dia e horário
        dup = await (await db.execute(
            "SELECT id FROM aulas WHERE data=? AND COALESCE(hora,'')=?",
            (d.isoformat(), body.hora or ""))).fetchone()
        if dup:
            ignoradas += 1
            continue
        # Treino sozinho não envolve o personal, então não entra na conta do mês
        if body.valor is not None:
            valor = body.valor
        elif modalidade == "sozinho":
            valor = 0
        else:
            valor = await _valor_hora(db, d.isoformat())
        cur = await db.execute("""
            INSERT INTO aulas (data, hora, duracao_min, tipo, foco, local, professor,
                               status, modalidade, plano_id, modelo_id, descricao, obs, pse,
                               valor, atualizado_em)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        """, (d.isoformat(), body.hora, body.duracao_min or 60, body.tipo, body.foco,
              body.local, body.professor, body.status or "agendada", modalidade, body.plano_id,
              body.modelo_id, body.descricao, body.obs, body.pse, valor))
        aid = cur.lastrowid
        if body.modelo_id:
            await _copiar_modelo(db, aid, body.modelo_id)
        criadas.append(aid)
    await db.commit()
    if not criadas:
        raise HTTPException(409, "Já existe aula nesse dia e horário")
    return {"ids": criadas, "criadas": len(criadas), "ignoradas": ignoradas}


@app.post("/api/aulas/mes")
async def definir_dias_do_mes(body: DiasDoMesIn, user=Depends(get_current_user),
                              db: aiosqlite.Connection = Depends(get_db)):
    """Define de uma vez os dias do mês em que haverá aula.

    Cria as aulas que faltam e remove as que saíram da seleção — mas só as que ainda
    estão 'agendada' E sem treino montado. Aula já realizada, com falta, cancelada ou
    com exercícios prescritos pelo personal nunca é apagada por aqui; ela sai da lista
    de removidas e é reportada em 'protegidas'.
    """
    ini, fim = _mes_range(body.mes)
    modalidade = body.modalidade or "com_personal"
    if modalidade not in MODALIDADES:
        raise HTTPException(400, f"Modalidade deve ser um de: {', '.join(MODALIDADES)}")
    ano, mes = int(ini[:4]), int(ini[5:7])
    ult = _cal.monthrange(ano, mes)[1]
    dias = sorted({d for d in body.dias if 1 <= d <= ult})
    alvo = {date(ano, mes, d).isoformat() for d in dias}

    cfg = await _config(db)
    hora = body.hora or cfg.get("hora_padrao") or None
    duracao = body.duracao_min or int(cfg.get("duracao_padrao") or 60)
    professor = body.professor if body.professor is not None else (cfg.get("professor_padrao") or None)
    local = body.local if body.local is not None else (cfg.get("local_padrao") or None)

    cur = await db.execute("""
        SELECT a.*, (SELECT COUNT(*) FROM aula_exercicios ae WHERE ae.aula_id = a.id) n_ex
          FROM aulas a WHERE a.data BETWEEN ? AND ?
    """, (ini, fim))
    existentes = [dict(r) for r in await cur.fetchall()]
    # Cada modalidade tem a sua agenda: marcar os dias de treino sozinho não pode
    # apagar as aulas com o personal, e vice-versa.
    minhas, das_outras = {}, {}
    for a in existentes:
        alvo_dict = minhas if (a["modalidade"] or "com_personal") == modalidade else das_outras
        alvo_dict.setdefault(a["data"], []).append(a)

    criadas, removidas, protegidas = 0, 0, []
    for d in sorted(alvo - set(minhas)):
        if body.valor is not None:
            valor = body.valor
        elif modalidade == "sozinho":
            valor = 0            # treino sozinho não é cobrado
        else:
            valor = await _valor_hora(db, d)
        await db.execute("""
            INSERT INTO aulas (data, hora, duracao_min, professor, local, status,
                               modalidade, plano_id, valor, atualizado_em)
            VALUES (?,?,?,?,?, 'agendada', ?,?,?, CURRENT_TIMESTAMP)
        """, (d, hora, duracao, professor, local, modalidade, body.plano_id, valor))
        criadas += 1

    for d, aulas_do_dia in minhas.items():
        if d in alvo:
            continue
        for a in aulas_do_dia:
            if a["status"] != "agendada" or a["n_ex"] > 0:
                protegidas.append({"data": d, "motivo": "treino montado" if a["n_ex"] else a["status"]})
                continue
            await db.execute("DELETE FROM aulas WHERE id=?", (a["id"],))
            removidas += 1
    await db.commit()

    cur = await db.execute(
        "SELECT COUNT(*) n, COALESCE(SUM(COALESCE(valor,0)),0) v FROM aulas "
        "WHERE data BETWEEN ? AND ? AND modalidade=?", (ini, fim, modalidade))
    r = await cur.fetchone()
    return {"mes": body.mes, "modalidade": modalidade, "criadas": criadas, "removidas": removidas,
            "protegidas": protegidas, "outras_modalidades": sorted(das_outras),
            "aulas_no_mes": r["n"], "valor_previsto": round(r["v"], 2)}


@app.patch("/api/aulas/{aid}")
async def editar_aula(aid: int, body: AulaUpdate, user=Depends(get_current_user),
                      db: aiosqlite.Connection = Depends(get_db)):
    atual = await (await db.execute("SELECT * FROM aulas WHERE id=?", (aid,))).fetchone()
    if not atual:
        raise HTTPException(404, "Aula não encontrada")
    data = body.dict(exclude_unset=True)
    if "status" in data and data["status"] not in STATUS_VALIDOS:
        raise HTTPException(400, f"Status deve ser um de: {', '.join(STATUS_VALIDOS)}")
    if "modalidade" in data and data["modalidade"] not in MODALIDADES:
        raise HTTPException(400, f"Modalidade deve ser um de: {', '.join(MODALIDADES)}")
    # Aula com o personal: a prescrição é dele. O aluno remarca, diz se aconteceu e
    # registra o feedback, mas não reescreve o treino.
    if not _pode_montar_treino(user, atual):
        proibidos = set(data) - CAMPOS_ALUNO_EM_AULA_DO_PERSONAL
        if proibidos:
            raise HTTPException(403,
                "Esta aula é com o personal: o treino é prescrição dele. "
                "Você pode remarcar dentro do mês, mudar o status e registrar o feedback. "
                f"Campos bloqueados: {', '.join(sorted(proibidos))}.")
    if "data" in data and data["data"]:
        nova = _parse_data(data["data"])
        # O mês é pago quando as aulas entram na agenda. Remarcar é trocar de dia
        # DENTRO do mês pago; jogar a aula para outro mês moveria dinheiro de um
        # fechamento para outro, então é recusado.
        if nova[:7] != (atual["data"] or "")[:7]:
            raise HTTPException(400,
                f"Remarcação só dentro do mesmo mês. Esta aula é de {atual['data'][5:7]}/{atual['data'][:4]}, "
                f"que já está pago. Para mover para outro mês, exclua esta aula e crie uma nova lá.")
        data["data"] = nova
    trocou_modelo = "modelo_id" in data and data["modelo_id"] and data["modelo_id"] != atual["modelo_id"]
    sets = [f"{k}=?" for k in data]
    params = list(data.values())
    if sets:
        sets.append("atualizado_em=CURRENT_TIMESTAMP")
        params.append(aid)
        await db.execute(f"UPDATE aulas SET {', '.join(sets)} WHERE id=?", params)
    # Trocar o modelo só repopula a lista se a aula ainda não tem exercícios
    if trocou_modelo:
        n = (await (await db.execute(
            "SELECT COUNT(*) FROM aula_exercicios WHERE aula_id=?", (aid,))).fetchone())[0]
        if n == 0:
            await _copiar_modelo(db, aid, data["modelo_id"])
    await db.commit()
    return await obter_aula(aid, user, db)


@app.delete("/api/aulas/{aid}", status_code=204)
async def remover_aula(aid: int, user=Depends(get_current_user),
                       db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM aula_exercicios WHERE aula_id=?", (aid,))
    await db.execute("DELETE FROM aulas WHERE id=?", (aid,))
    await db.commit()


@app.put("/api/aulas/{aid}/exercicios")
async def salvar_exercicios_aula(aid: int, itens: List[ItemIn], user=Depends(get_current_user),
                                 db: aiosqlite.Connection = Depends(get_db)):
    """Substitui a lista inteira de exercícios da aula (mais simples e atômico
    do que sincronizar item a item)."""
    aula = await (await db.execute("SELECT * FROM aulas WHERE id=?", (aid,))).fetchone()
    if not aula:
        raise HTTPException(404, "Aula não encontrada")
    if not _pode_montar_treino(user, aula):
        raise HTTPException(403, "O treino desta aula é montado pelo personal. "
                                 "Marque a aula como 'sozinho' se for treinar por conta.")
    await db.execute("DELETE FROM aula_exercicios WHERE aula_id=?", (aid,))
    for i, it in enumerate(itens):
        nome = (it.nome or "").strip()
        if not nome and it.exercicio_id:
            ex = await (await db.execute("SELECT nome FROM exercicios WHERE id=?", (it.exercicio_id,))).fetchone()
            nome = ex["nome"] if ex else ""
        if not nome:
            continue
        await db.execute("""
            INSERT INTO aula_exercicios
                (aula_id, exercicio_id, nome, ordem, series, repeticoes, carga, descanso_seg, feito, obs)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (aid, it.exercicio_id, nome, it.ordem if it.ordem is not None else i,
              it.series, it.repeticoes, it.carga, it.descanso_seg, 1 if it.feito else 0, it.obs))
    await db.execute("UPDATE aulas SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?", (aid,))
    await db.commit()
    return await _itens_da_aula(db, aid)


@app.post("/api/aulas/{aid}/aplicar-modelo/{mid}")
async def aplicar_modelo(aid: int, mid: int, substituir: bool = True,
                         user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    aula = await (await db.execute("SELECT * FROM aulas WHERE id=?", (aid,))).fetchone()
    if not aula:
        raise HTTPException(404, "Aula não encontrada")
    if not _pode_montar_treino(user, aula):
        raise HTTPException(403, "O treino desta aula é montado pelo personal.")
    mod = await (await db.execute("SELECT * FROM modelos WHERE id=?", (mid,))).fetchone()
    if not mod:
        raise HTTPException(404, "Modelo não encontrado")
    if substituir:
        await db.execute("DELETE FROM aula_exercicios WHERE aula_id=?", (aid,))
    n = await _copiar_modelo(db, aid, mid)
    await db.execute(
        "UPDATE aulas SET modelo_id=?, tipo=COALESCE(NULLIF(tipo,''),?), foco=COALESCE(NULLIF(foco,''),?),"
        " atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
        (mid, mod["tipo"], mod["foco"], aid))
    await db.commit()
    return {"itens": n}


# ── Exercícios ────────────────────────────────────────────────────────────────
@app.get("/api/exercicios")
async def listar_exercicios(grupo: Optional[str] = None, busca: Optional[str] = None,
                            user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    sql, params = "SELECT * FROM exercicios WHERE 1=1", []
    if grupo:
        sql += " AND grupo=?"; params.append(grupo)
    if busca:
        sql += " AND (nome LIKE ? OR descricao LIKE ? OR equipamento LIKE ?)"
        params += [f"%{busca}%"] * 3
    sql += " ORDER BY grupo, nome"
    cur = await db.execute(sql, params)
    return [dict(r) for r in await cur.fetchall()]


@app.post("/api/exercicios", status_code=201)
async def criar_exercicio(body: ExercicioIn, user=Depends(get_current_user),
                          db: aiosqlite.Connection = Depends(get_db)):
    nome = body.nome.strip()
    if not nome:
        raise HTTPException(400, "Nome obrigatório")
    if await (await db.execute("SELECT id FROM exercicios WHERE nome=?", (nome,))).fetchone():
        raise HTTPException(409, "Já existe um exercício com esse nome")
    cur = await db.execute("""
        INSERT INTO exercicios (nome, grupo, equipamento, descricao, video_url, ativo)
        VALUES (?,?,?,?,?,?)
    """, (nome, body.grupo, body.equipamento, body.descricao, body.video_url,
          1 if body.ativo else 0))
    await db.commit()
    return {"id": cur.lastrowid}


@app.patch("/api/exercicios/{eid}")
async def editar_exercicio(eid: int, body: ExercicioIn, user=Depends(get_current_user),
                           db: aiosqlite.Connection = Depends(get_db)):
    if not await (await db.execute("SELECT id FROM exercicios WHERE id=?", (eid,))).fetchone():
        raise HTTPException(404, "Exercício não encontrado")
    dup = await (await db.execute(
        "SELECT id FROM exercicios WHERE nome=? AND id<>?", (body.nome.strip(), eid))).fetchone()
    if dup:
        raise HTTPException(409, "Já existe um exercício com esse nome")
    await db.execute("""
        UPDATE exercicios SET nome=?, grupo=?, equipamento=?, descricao=?, video_url=?, ativo=?
        WHERE id=?
    """, (body.nome.strip(), body.grupo, body.equipamento, body.descricao, body.video_url,
          1 if body.ativo else 0, eid))
    await db.commit()
    return {"msg": "Exercício atualizado"}


@app.delete("/api/exercicios/{eid}", status_code=204)
async def remover_exercicio(eid: int, user=Depends(get_current_user),
                            db: aiosqlite.Connection = Depends(get_db)):
    # O histórico guarda o nome do exercício, então a exclusão não apaga o passado
    await db.execute("DELETE FROM exercicios WHERE id=?", (eid,))
    await db.commit()


# ── Modelos de treino ─────────────────────────────────────────────────────────
@app.get("/api/modelos")
async def listar_modelos(user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    cur = await db.execute("SELECT * FROM modelos ORDER BY ativo DESC, nome")
    modelos = [dict(r) for r in await cur.fetchall()]
    if modelos:
        ph = ",".join("?" * len(modelos))
        cur = await db.execute(
            f"SELECT modelo_id, COUNT(*) n FROM modelo_itens WHERE modelo_id IN ({ph}) GROUP BY modelo_id",
            [m["id"] for m in modelos])
        cont = {r["modelo_id"]: r["n"] for r in await cur.fetchall()}
        for m in modelos:
            m["qtd_exercicios"] = cont.get(m["id"], 0)
    return modelos


@app.get("/api/modelos/{mid}")
async def obter_modelo(mid: int, user=Depends(get_current_user),
                       db: aiosqlite.Connection = Depends(get_db)):
    row = await (await db.execute("SELECT * FROM modelos WHERE id=?", (mid,))).fetchone()
    if not row:
        raise HTTPException(404, "Modelo não encontrado")
    m = dict(row)
    cur = await db.execute("SELECT * FROM modelo_itens WHERE modelo_id=? ORDER BY ordem, id", (mid,))
    m["itens"] = [dict(r) for r in await cur.fetchall()]
    return m


async def _salvar_itens_modelo(db, mid: int, itens: List[ItemIn]):
    await db.execute("DELETE FROM modelo_itens WHERE modelo_id=?", (mid,))
    for i, it in enumerate(itens or []):
        nome = (it.nome or "").strip()
        if not nome and it.exercicio_id:
            ex = await (await db.execute("SELECT nome FROM exercicios WHERE id=?", (it.exercicio_id,))).fetchone()
            nome = ex["nome"] if ex else ""
        if not nome:
            continue
        await db.execute("""
            INSERT INTO modelo_itens (modelo_id, exercicio_id, nome, ordem, series, repeticoes,
                                      carga, descanso_seg, obs)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (mid, it.exercicio_id, nome, it.ordem if it.ordem is not None else i,
              it.series, it.repeticoes, it.carga, it.descanso_seg, it.obs))


@app.post("/api/modelos", status_code=201)
async def criar_modelo(body: ModeloIn, user=Depends(get_current_user),
                       db: aiosqlite.Connection = Depends(get_db)):
    cur = await db.execute(
        "INSERT INTO modelos (nome, tipo, foco, obs, ativo) VALUES (?,?,?,?,?)",
        (body.nome.strip(), body.tipo, body.foco, body.obs, 1 if body.ativo else 0))
    mid = cur.lastrowid
    await _salvar_itens_modelo(db, mid, body.itens)
    await db.commit()
    return {"id": mid}


@app.put("/api/modelos/{mid}")
async def editar_modelo(mid: int, body: ModeloIn, user=Depends(get_current_user),
                        db: aiosqlite.Connection = Depends(get_db)):
    if not await (await db.execute("SELECT id FROM modelos WHERE id=?", (mid,))).fetchone():
        raise HTTPException(404, "Modelo não encontrado")
    await db.execute(
        "UPDATE modelos SET nome=?, tipo=?, foco=?, obs=?, ativo=? WHERE id=?",
        (body.nome.strip(), body.tipo, body.foco, body.obs, 1 if body.ativo else 0, mid))
    if body.itens is not None:
        await _salvar_itens_modelo(db, mid, body.itens)
    await db.commit()
    return await obter_modelo(mid, user, db)


@app.delete("/api/modelos/{mid}", status_code=204)
async def remover_modelo(mid: int, user=Depends(get_current_user),
                         db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM modelo_itens WHERE modelo_id=?", (mid,))
    await db.execute("DELETE FROM modelos WHERE id=?", (mid,))
    await db.commit()


# ── Planos (pacotes de aula) ──────────────────────────────────────────────────
async def _saldo_plano(db, p: dict) -> dict:
    """Consumo do pacote = aulas realizadas + faltas dentro da vigência."""
    sql = "SELECT status, COUNT(*) n FROM aulas WHERE (plano_id=? OR (? IS NOT NULL AND ? IS NOT NULL AND plano_id IS NULL AND data BETWEEN ? AND ?)) GROUP BY status"
    cur = await db.execute(sql, (p["id"], p["inicio"], p["fim"], p["inicio"], p["fim"]))
    por_status = {r["status"]: r["n"] for r in await cur.fetchall()}
    usadas = sum(por_status.get(s, 0) for s in STATUS_CONSOME)
    p = dict(p)
    p["realizadas"] = por_status.get("realizada", 0)
    p["faltas"] = por_status.get("falta", 0)
    p["canceladas"] = por_status.get("cancelada", 0)
    p["agendadas"] = por_status.get("agendada", 0)
    p["usadas"] = usadas
    p["saldo"] = max((p["aulas_contratadas"] or 0) - usadas, 0)
    p["valor_aula"] = round((p["valor"] or 0) / p["aulas_contratadas"], 2) if p["aulas_contratadas"] else None
    return p


@app.get("/api/planos")
async def listar_planos(user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    cur = await db.execute("SELECT * FROM planos ORDER BY ativo DESC, COALESCE(inicio,'') DESC, id DESC")
    return [await _saldo_plano(db, dict(r)) for r in await cur.fetchall()]


@app.post("/api/planos", status_code=201)
async def criar_plano(body: PlanoIn, user=Depends(get_current_user),
                      db: aiosqlite.Connection = Depends(get_db)):
    cur = await db.execute("""
        INSERT INTO planos (nome, inicio, fim, aulas_contratadas, valor, valor_hora,
                            freq_semanal, professor, obs, ativo)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    """, (body.nome.strip(), _parse_data(body.inicio) if body.inicio else None,
          _parse_data(body.fim) if body.fim else None, body.aulas_contratadas or 0,
          body.valor or 0, body.valor_hora, body.freq_semanal or 0, body.professor, body.obs,
          1 if body.ativo else 0))
    await db.commit()
    return {"id": cur.lastrowid}


@app.put("/api/planos/{pid}")
async def editar_plano(pid: int, body: PlanoIn, user=Depends(get_current_user),
                       db: aiosqlite.Connection = Depends(get_db)):
    if not await (await db.execute("SELECT id FROM planos WHERE id=?", (pid,))).fetchone():
        raise HTTPException(404, "Plano não encontrado")
    await db.execute("""
        UPDATE planos SET nome=?, inicio=?, fim=?, aulas_contratadas=?, valor=?, valor_hora=?,
                          freq_semanal=?, professor=?, obs=?, ativo=? WHERE id=?
    """, (body.nome.strip(), _parse_data(body.inicio) if body.inicio else None,
          _parse_data(body.fim) if body.fim else None, body.aulas_contratadas or 0,
          body.valor or 0, body.valor_hora, body.freq_semanal or 0, body.professor, body.obs,
          1 if body.ativo else 0, pid))
    await db.commit()
    return {"msg": "Plano atualizado"}


@app.delete("/api/planos/{pid}", status_code=204)
async def remover_plano(pid: int, user=Depends(get_current_user),
                        db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM planos WHERE id=?", (pid,))
    await db.commit()


# ── Resumo (KPIs do mês) ──────────────────────────────────────────────────────
@app.get("/api/resumo")
async def resumo(mes: Optional[str] = None, user=Depends(get_current_user),
                 db: aiosqlite.Connection = Depends(get_db)):
    ini, fim = _mes_range(mes)
    hoje = _hoje().isoformat()

    cur = await db.execute(
        "SELECT status, COUNT(*) n FROM aulas WHERE data BETWEEN ? AND ? GROUP BY status", (ini, fim))
    st = {r["status"]: r["n"] for r in await cur.fetchall()}
    realizadas = st.get("realizada", 0)
    faltas = st.get("falta", 0)
    canceladas = st.get("cancelada", 0)
    agendadas = st.get("agendada", 0)

    # Aderência = realizadas ÷ (aulas que já deveriam ter acontecido).
    # Cancelamentos com aviso não entram na conta; agendadas no passado, sim.
    pendentes_passado = (await (await db.execute(
        "SELECT COUNT(*) FROM aulas WHERE status='agendada' AND data BETWEEN ? AND ? AND data < ?",
        (ini, fim, hoje))).fetchone())[0]
    base = realizadas + faltas + pendentes_passado
    aderencia = round(100.0 * realizadas / base, 1) if base else None

    # Plano ativo (o mais recente que cobre o mês) → meta e saldo
    plano = await (await db.execute("""
        SELECT * FROM planos WHERE ativo=1
          AND (inicio IS NULL OR inicio <= ?) AND (fim IS NULL OR fim >= ?)
        ORDER BY COALESCE(inicio,'') DESC LIMIT 1
    """, (fim, ini))).fetchone()
    plano = await _saldo_plano(db, dict(plano)) if plano else None

    # Meta do mês: nº de semanas do mês × frequência semanal do plano
    meta_mes = None
    if plano and plano.get("freq_semanal"):
        dias = (date.fromisoformat(fim) - date.fromisoformat(ini)).days + 1
        meta_mes = round(plano["freq_semanal"] * dias / 7)

    # Volume de carga (kg) das aulas realizadas no mês
    cur = await db.execute("""
        SELECT ae.series, ae.repeticoes, ae.carga
          FROM aula_exercicios ae JOIN aulas a ON a.id = ae.aula_id
         WHERE a.status='realizada' AND a.data BETWEEN ? AND ?
    """, (ini, fim))
    volume = sum(_volume(r["series"], r["repeticoes"], r["carga"]) for r in await cur.fetchall())

    # Próxima aula agendada (a partir de hoje)
    prox = await (await db.execute(
        "SELECT * FROM aulas WHERE status='agendada' AND data >= ? ORDER BY data, COALESCE(hora,'99:99') LIMIT 1",
        (hoje,))).fetchone()

    # Sequência: semanas consecutivas (terminando na semana passada) batendo a meta semanal
    sequencia = 0
    if plano and plano.get("freq_semanal"):
        alvo = plano["freq_semanal"]
        cur = await db.execute(
            "SELECT data FROM aulas WHERE status='realizada' AND data >= ?",
            ((_hoje() - timedelta(weeks=53)).isoformat(),))
        por_semana = {}
        for r in await cur.fetchall():
            k = _semana_ini(date.fromisoformat(r["data"])).isoformat()
            por_semana[k] = por_semana.get(k, 0) + 1
        s = _semana_ini(_hoje()) - timedelta(weeks=1)
        while por_semana.get(s.isoformat(), 0) >= alvo and sequencia < 53:
            sequencia += 1
            s -= timedelta(weeks=1)

    # Financeiro — modelo PRÉ-PAGO e SEM DEVOLUÇÃO: o aluno paga o mês quando as
    # aulas entram na agenda. Depois disso, nenhum status tira dinheiro do mês —
    # a aula vira treino, é remarcada dentro do mês, ou o valor se perde.
    # Treino sozinho não envolve o personal: fica fora da conta do mês.
    cur = await db.execute("""
        SELECT status, COUNT(*) n, COALESCE(SUM(COALESCE(valor,0)),0) v
          FROM aulas WHERE data BETWEEN ? AND ? AND modalidade='com_personal'
      GROUP BY status
    """, (ini, fim))
    fin = {r["status"]: {"n": r["n"], "v": r["v"]} for r in await cur.fetchall()}
    def _v(*sts):
        return round(sum(fin.get(x, {}).get("v", 0) for x in sts), 2)
    def _n(*sts):
        return sum(fin.get(x, {}).get("n", 0) for x in sts)
    valor_mes = _v(*STATUS_VALIDOS)

    # Aulas sem treino montado — a fila de trabalho do personal
    sem_treino = (await (await db.execute("""
        SELECT COUNT(*) FROM aulas a
         WHERE a.data BETWEEN ? AND ? AND a.status IN ('agendada','realizada')
           AND a.modalidade = 'com_personal'
           AND NOT EXISTS (SELECT 1 FROM aula_exercicios ae WHERE ae.aula_id = a.id)
    """, (ini, fim))).fetchone())[0]

    # Quantas aulas do mês são de cada tipo
    cur = await db.execute("""
        SELECT COALESCE(NULLIF(modalidade,''),'com_personal') m, COUNT(*) n
          FROM aulas WHERE data BETWEEN ? AND ? GROUP BY m
    """, (ini, fim))
    por_modalidade = {r["m"]: r["n"] for r in await cur.fetchall()}

    return {
        "mes": ini[:7], "inicio": ini, "fim": fim,
        "realizadas": realizadas, "faltas": faltas, "canceladas": canceladas,
        "agendadas": agendadas, "total": realizadas + faltas + canceladas + agendadas,
        "aderencia": aderencia, "meta_mes": meta_mes,
        "volume_kg": round(volume, 1),
        "sequencia_semanas": sequencia,
        "sem_treino": sem_treino,
        "com_personal": por_modalidade.get("com_personal", 0),
        "sozinho": por_modalidade.get("sozinho", 0),
        "proxima": _d(prox), "plano": plano,
        "financeiro": {
            "valor_hora": await _valor_hora(db, ini),
            "aulas_pagas": _n(*STATUS_VALIDOS),
            "valor_mes": valor_mes,                  # pago pelo aluno / recebido pelo personal
            "treinado": _v("realizada"),             # do valor pago, o que virou treino
            "a_treinar": _v("agendada"),             # pago, ainda por acontecer
            "perdido": _v("falta", "cancelada"),     # pago e não treinado — não volta
            "aulas_perdidas": _n("falta", "cancelada"),
        },
    }


@app.get("/api/financeiro")
async def financeiro(ano: Optional[int] = None, user=Depends(get_current_user),
                     db: aiosqlite.Connection = Depends(get_db)):
    """Fechamento mês a mês (pré-pago, sem devolução): o valor do mês é TUDO que
    entrou na agenda — o aluno paga, o personal recebe, é o mesmo número."""
    ano = ano or _hoje().year
    ini, fim = date(ano, 1, 1).isoformat(), date(ano, 12, 31).isoformat()
    meses = [{"mes": m, "aulas": 0, "valor": 0.0, "treinado": 0.0, "a_treinar": 0.0,
              "perdido": 0.0, "realizadas": 0, "perdidas": 0, "agendadas": 0}
             for m in range(1, 13)]
    cur = await db.execute("""
        SELECT CAST(substr(data,6,2) AS INTEGER) m, status,
               COUNT(*) n, COALESCE(SUM(COALESCE(valor,0)),0) v
          FROM aulas WHERE data BETWEEN ? AND ? AND modalidade='com_personal'
      GROUP BY m, status
    """, (ini, fim))
    for r in await cur.fetchall():
        if not (1 <= r["m"] <= 12):
            continue
        alvo = meses[r["m"] - 1]
        alvo["aulas"] += r["n"]
        alvo["valor"] += r["v"]
        if r["status"] == "realizada":
            alvo["realizadas"] = r["n"]; alvo["treinado"] += r["v"]
        elif r["status"] == "agendada":
            alvo["agendadas"] = r["n"]; alvo["a_treinar"] += r["v"]
        else:   # falta ou cancelada — pago e não treinado
            alvo["perdidas"] += r["n"]; alvo["perdido"] += r["v"]
    for m in meses:
        for k in ("valor", "treinado", "a_treinar", "perdido"):
            m[k] = round(m[k], 2)
    return {
        "ano": ano, "meses": meses,
        "total_valor": round(sum(m["valor"] for m in meses), 2),
        "total_treinado": round(sum(m["treinado"] for m in meses), 2),
        "total_perdido": round(sum(m["perdido"] for m in meses), 2),
        "valor_hora": await _valor_hora(db),
    }


# ── Frequência (análises) ─────────────────────────────────────────────────────
@app.get("/api/frequencia")
async def frequencia(ano: Optional[int] = None, user=Depends(get_current_user),
                     db: aiosqlite.Connection = Depends(get_db)):
    ano = ano or _hoje().year
    ini, fim = date(ano, 1, 1).isoformat(), date(ano, 12, 31).isoformat()

    # Por mês (12 posições, sempre completas para o gráfico)
    mensal = [{"mes": m, "realizadas": 0, "faltas": 0, "canceladas": 0, "agendadas": 0}
              for m in range(1, 13)]
    cur = await db.execute("""
        SELECT CAST(substr(data,6,2) AS INTEGER) m, status, COUNT(*) n
          FROM aulas WHERE data BETWEEN ? AND ? GROUP BY m, status
    """, (ini, fim))
    _mapa = {"realizada": "realizadas", "falta": "faltas",
             "cancelada": "canceladas", "agendada": "agendadas"}
    for r in await cur.fetchall():
        chave = _mapa.get(r["status"])
        if chave and 1 <= r["m"] <= 12:
            mensal[r["m"] - 1][chave] = r["n"]

    # Últimas 12 semanas (realizadas por semana)
    s0 = _semana_ini(_hoje()) - timedelta(weeks=11)
    semanal = [{"semana": (s0 + timedelta(weeks=i)).isoformat(), "realizadas": 0} for i in range(12)]
    idx = {s["semana"]: s for s in semanal}
    cur = await db.execute(
        "SELECT data FROM aulas WHERE status='realizada' AND data >= ?", (s0.isoformat(),))
    for r in await cur.fetchall():
        k = _semana_ini(date.fromisoformat(r["data"])).isoformat()
        if k in idx:
            idx[k]["realizadas"] += 1

    # Volume e séries por grupo muscular (aulas realizadas no ano)
    cur = await db.execute("""
        SELECT COALESCE(e.grupo, 'Sem grupo') grupo, ae.series, ae.repeticoes, ae.carga
          FROM aula_exercicios ae
          JOIN aulas a ON a.id = ae.aula_id
     LEFT JOIN exercicios e ON e.id = ae.exercicio_id
                            OR (ae.exercicio_id IS NULL AND e.nome = ae.nome)
         WHERE a.status='realizada' AND a.data BETWEEN ? AND ?
    """, (ini, fim))
    grupos = {}
    for r in await cur.fetchall():
        g = grupos.setdefault(r["grupo"], {"grupo": r["grupo"], "series": 0, "volume": 0.0})
        g["series"] += int(r["series"] or 0)
        g["volume"] += _volume(r["series"], r["repeticoes"], r["carga"])
    por_grupo = sorted(grupos.values(), key=lambda x: -x["series"])
    for g in por_grupo:
        g["volume"] = round(g["volume"], 1)

    # Aulas realizadas por tipo de treino
    cur = await db.execute("""
        SELECT COALESCE(NULLIF(tipo,''),'Sem tipo') tipo, COUNT(*) n
          FROM aulas WHERE status='realizada' AND data BETWEEN ? AND ?
      GROUP BY tipo ORDER BY n DESC
    """, (ini, fim))
    por_tipo = [dict(r) for r in await cur.fetchall()]

    # Anos com dados (para o seletor)
    cur = await db.execute("SELECT DISTINCT substr(data,1,4) a FROM aulas ORDER BY a DESC")
    anos = [int(r["a"]) for r in await cur.fetchall()]
    if ano not in anos:
        anos.append(ano); anos.sort(reverse=True)

    return {"ano": ano, "mensal": mensal, "semanal": semanal,
            "por_grupo": por_grupo, "por_tipo": por_tipo, "anos": anos}


@app.get("/api/evolucao")
async def evolucao(exercicio: Optional[str] = Query(None, description="Nome do exercício"),
                   user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    """Evolução de carga: por aula realizada, a maior carga registrada no exercício.
    Sem argumento, devolve só a lista de exercícios já treinados."""
    cur = await db.execute("""
        SELECT DISTINCT ae.nome FROM aula_exercicios ae
          JOIN aulas a ON a.id = ae.aula_id
         WHERE a.status='realizada' AND ae.carga IS NOT NULL AND ae.carga > 0
      ORDER BY ae.nome
    """)
    nomes = [r["nome"] for r in await cur.fetchall()]
    serie = []
    if exercicio:
        cur = await db.execute("""
            SELECT a.data, MAX(ae.carga) carga, MAX(ae.series) series, MAX(ae.repeticoes) repeticoes
              FROM aula_exercicios ae JOIN aulas a ON a.id = ae.aula_id
             WHERE a.status='realizada' AND ae.nome=?
          GROUP BY a.data ORDER BY a.data
        """, (exercicio,))
        serie = [dict(r) for r in await cur.fetchall()]
    return {"exercicios": nomes, "serie": serie}


# ── Static / SPA ──────────────────────────────────────────────────────────────
_static = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=_static), name="static")


@app.get("/health")
async def health():
    return {"ok": True, "db": DB_PATH}


@app.get("/")
async def index():
    return FileResponse(os.path.join(_static, "index.html"))
