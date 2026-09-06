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
from datetime import date, datetime, timedelta, timezone
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

# Fuso do usuário. O contêiner roda em UTC: sem isto, das 21h à meia-noite o
# servidor já está no dia seguinte e "hoje" sai errado — o que contamina a
# próxima aula, a aderência, a sequência e a checagem de aula futura.
# Fortaleza é UTC-3 o ano inteiro (o Brasil não tem mais horário de verão).
try:
    _OFFSET_H = int(os.environ.get("FITPLAN_UTC_OFFSET", "-3"))
except ValueError:
    _OFFSET_H = -3
TZ_APP = timezone(timedelta(hours=_OFFSET_H))
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
# Três naturezas de treino, não duas. A modalidade decide QUEM prescreve, SE
# custa e QUAL a forma do treino:
#   com_personal — prescrição do personal contratado, entra no valor do mês;
#   sozinho      — ele monta, série × carga, fora do valor;
#   aerobico     — corrida prescrita por OUTRO treinador, que não tem conta aqui.
#                  A prescrição chega pronta em texto ("2km trote aquecendo; 2x
#                  1km progressivo…") e o resultado é distância e tempo. Forçar
#                  isso em linhas de série × repetição × carga seria inventar uma
#                  estrutura que o treino não tem.
MODALIDADES = ("com_personal", "sozinho", "aerobico")
MODALIDADES_PROPRIAS = ("sozinho", "aerobico")   # o aluno é quem monta
MODALIDADE_AEROBICA = "aerobico"

# Numa aula COM O PERSONAL, o treino é prescrição do professor: o aluno só lê.
# Ele continua dono do registro do dia — pode remarcar, dizer se aconteceu e
# lançar o feedback. Estes são os campos que ele pode mexer nessas aulas.
CAMPOS_ALUNO_EM_AULA_DO_PERSONAL = {"data", "hora", "status", "obs", "pse", "valor",
                                    "modalidade", "energia", "fadiga",
                                    "distancia_km", "tempo_min"}


def _pode_montar_treino(user, aula) -> bool:
    """O personal monta qualquer treino. O aluno monta só o que treina sozinho."""
    if user["role"] == "personal":
        return True
    return (aula["modalidade"] or "com_personal") in MODALIDADES_PROPRIAS


def _hash(pw: str) -> str:
    return _pwd.hash(pw)


async def _corrigir_aulas_futuras():
    """Devolve para 'agendada' toda aula futura marcada como feita ou como falta.

    Nenhuma das duas é possível numa aula que ainda não começou: não se faz nem
    se falta a algo que não aconteceu. Quem já sabe que não vai, remarca para
    outro dia do mês. Esse estado só existe por dado criado antes da regra.
    Roda a cada start: idempotente e restrita ao que é impossível, funciona como
    guarda-corpo.
    """
    import aiosqlite as _aio
    agora = _agora().strftime("%Y-%m-%d %H:%M")
    async with _aio.connect(DB_PATH) as db:
        cond = "(data || ' ' || COALESCE(NULLIF(hora,''), '00:00')) > ?"
        for status in STATUS_SO_PASSADO:
            cur = await db.execute(
                f"UPDATE aulas SET status='agendada', atualizado_em=CURRENT_TIMESTAMP "
                f"WHERE status=? AND {cond}", (status, agora))
            if cur.rowcount:
                print(f"[FIX] {cur.rowcount} aula(s) futura(s) marcadas como "
                      f"'{status}' voltaram para 'agendada'")
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global SECRET_KEY
    await init_db(_hash)
    SECRET_KEY = await obter_secret_key()
    if not SECRET_KEY:
        raise RuntimeError("Não foi possível obter a chave de assinatura dos tokens")
    await _corrigir_aulas_futuras()
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


def _agora() -> datetime:
    """Agora no fuso do usuário, sem tzinfo (para comparar com datas do banco)."""
    return datetime.now(TZ_APP).replace(tzinfo=None)


def _hoje() -> date:
    return _agora().date()


def _ja_comecou(data_iso: str, hora: Optional[str]) -> bool:
    """A aula já começou? Aula sem horário conta a partir do início do dia."""
    try:
        h, m = (hora or "00:00").split(":")[:2]
        inicio = datetime.fromisoformat(data_iso[:10]).replace(hour=int(h), minute=int(m))
    except (ValueError, TypeError):
        inicio = datetime.fromisoformat(data_iso[:10])
    return inicio <= _agora()


# Treino feito é fato consumado: não se desfaz. Depois de 'realizada', a aula só
# aceita o registro do que aconteceu — esforço percebido, observações e a execução
# dos exercícios (carga usada, o que foi feito).
STATUS_IRREVERSIVEL = "realizada"
CAMPOS_APOS_REALIZADA = {"obs", "pse", "energia", "fadiga", "distancia_km", "tempo_min"}

# Escalas de 1 a 5, iguais para energia e fadiga: simétricas em torno de "Normal"
# e monotônicas. Escala com dois rótulos que significam quase a mesma coisa
# ("média" e "normal", "alta" e "acima da média") produz dado que não se compara
# com ele mesmo — daqui a três meses ele não lembra qual dos dois usou.
NIVEIS_1A5 = 5
# Quem MONTA o treino também pode corrigi-lo depois de feito: num treino
# individual o aluno é autor e executor, e o que ele fez de verdade pode não ser
# o que estava escrito antes. Isso não afeta o que a aula foi (data, horário,
# modalidade, valor, status) — só o que ela conteve.
CAMPOS_APOS_REALIZADA_AUTOR = {"tipo", "foco", "descricao", "modelo_id"}

# Status que afirmam que o horário da aula passou. Não dá para dizer que uma
# aula de amanhã foi feita — nem que houve falta nela.
STATUS_SO_PASSADO = ("realizada", "falta")


def _valida_status_no_tempo(status: Optional[str], data_iso: str, hora: Optional[str]):
    if status in STATUS_SO_PASSADO and not _ja_comecou(data_iso, hora):
        quando = f"{data_iso[8:10]}/{data_iso[5:7]}" + (f" às {hora}" if hora else "")
        raise HTTPException(400,
            f"A aula de {quando} ainda não começou. Só dá para marcar como "
            f"'{status}' depois do horário — antes disso, o status é 'agendada' "
            f"(ou 'cancelada', se você já sabe que não vai).")


def _valida_nao_futuro(data_iso: str, o_que: str):
    """Recusa data no futuro, tolerando UM dia de diferença.

    O calendário do aparelho segue o fuso DELE; o app raciocina em UTC-3. Quem
    abre o app com o telefone em outro fuso (viagem, celular desconfigurado) vê
    "hoje" um dia à frente e tomava um erro ao registrar algo que acabou de
    fazer. Um dia à frente é desencontro de relógio; dois já é engano de digitação.
    """
    if data_iso > (_hoje() + timedelta(days=1)).isoformat():
        raise HTTPException(400, f"{o_que} não pode ser no futuro.")


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
    energia: Optional[int] = None
    fadiga: Optional[int] = None
    distancia_km: Optional[float] = None
    tempo_min: Optional[float] = None
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
    altura_cm: Optional[float] = None
    peso_meta: Optional[float] = None


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
        "altura_cm": float(cfg.get("altura_cm") or 0),
        "peso_meta": float(cfg.get("peso_meta") or 0),
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
MAX_SERIES = 20   # teto de séries por exercício — evita item com ordem absurda


async def _garantir_series(db, item: dict) -> list:
    """Cria as linhas de série que faltam para o exercício (1..n) e devolve todas.

    Nascem vazias: o registro acontece na academia. O n vem da prescrição — se o
    personal subir de 3 para 4 séries, a 4ª aparece sem apagar o que já foi feito.
    """
    n = min(int(item.get("series") or 0), MAX_SERIES)
    cur = await db.execute(
        "SELECT * FROM aula_series WHERE aula_exercicio_id=? ORDER BY ordem", (item["id"],))
    atuais = [dict(r) for r in await cur.fetchall()]
    faltando = [o for o in range(1, max(n, 1) + 1) if o not in {s["ordem"] for s in atuais}]
    if faltando:
        await db.executemany(
            "INSERT OR IGNORE INTO aula_series (aula_exercicio_id, ordem) VALUES (?,?)",
            [(item["id"], o) for o in faltando])
        # Séries novas mudam o "todas feitas": subir de 3 para 4 séries num
        # exercício já concluído tem de reabri-lo, não mantê-lo verde.
        await _sincronizar_item(db, item["id"])
        await db.commit()
        cur = await db.execute(
            "SELECT * FROM aula_series WHERE aula_exercicio_id=? ORDER BY ordem", (item["id"],))
        atuais = [dict(r) for r in await cur.fetchall()]
    return atuais


async def _ultimas_cargas(db, nomes: list, antes_de: str) -> dict:
    """Última carga registrada em cada exercício, em aula realizada ANTERIOR a esta.

    É o número que falta na hora de escolher o peso do dia: "da última vez, 40 kg".
    O app já guardava isso e nunca mostrava.
    """
    nomes = [n for n in {x for x in nomes if x}]
    if not nomes:
        return {}
    ph = ",".join("?" * len(nomes))
    cur = await db.execute(f"""
        SELECT ae.nome, a.data,
               MAX(COALESCE(s.carga, ae.carga)) carga,
               MAX(COALESCE(s.repeticoes, 0))   reps
          FROM aula_exercicios ae
          JOIN aulas a ON a.id = ae.aula_id
     LEFT JOIN aula_series s ON s.aula_exercicio_id = ae.id AND s.feito = 1
         WHERE a.status = 'realizada' AND a.data < ? AND ae.nome IN ({ph})
      GROUP BY ae.nome, a.data
      ORDER BY a.data
    """, [antes_de] + nomes)
    ult = {}
    for r in await cur.fetchall():   # ordem crescente: a última linha de cada nome vence
        if r["carga"]:
            ult[r["nome"]] = {"data": r["data"], "carga": r["carga"],
                              "repeticoes": r["reps"] or None}
    return ult


async def _sincronizar_item(db, eid: int):
    """Reflete as séries no resumo do exercício: carga = maior carga executada,
    feito = todas as séries marcadas.

    Mantém /api/evolucao, o volume do mês e as telas antigas funcionando sem que
    precisem saber que existem séries.
    """
    r = await (await db.execute(
        "SELECT COUNT(*) n, COALESCE(SUM(feito),0) f, MAX(CASE WHEN feito=1 THEN carga END) c "
        "FROM aula_series WHERE aula_exercicio_id=?", (eid,))).fetchone()
    sets, params = [], []
    if r["c"] is not None:
        sets.append("carga=?"); params.append(r["c"])
    if r["n"]:
        sets.append("feito=?"); params.append(1 if r["f"] >= r["n"] else 0)
    if sets:
        params.append(eid)
        await db.execute(f"UPDATE aula_exercicios SET {', '.join(sets)} WHERE id=?", params)


async def _itens_da_aula(db, aula_id: int) -> list:
    cur = await db.execute(
        "SELECT * FROM aula_exercicios WHERE aula_id=? ORDER BY ordem, id", (aula_id,))
    itens = [dict(r) for r in await cur.fetchall()]
    if not itens:
        return itens
    row = await (await db.execute("SELECT data FROM aulas WHERE id=?", (aula_id,))).fetchone()
    ult = await _ultimas_cargas(db, [i["nome"] for i in itens],
                                row["data"] if row else _hoje().isoformat())
    for it in itens:
        it["series_reg"] = await _garantir_series(db, it)
        it["ultima"] = ult.get(it["nome"])
    return itens


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


@app.get("/api/aulas/hoje")
async def aula_de_hoje(user=Depends(get_current_user),
                       db: aiosqlite.Connection = Depends(get_db)):
    """O treino que importa agora: o de hoje; se não houver, o próximo agendado.

    Existe para que abrir o app na academia dê UM toque até a lista de exercícios,
    em vez de calendário → dia → aula.
    """
    hoje = _hoje().isoformat()
    row = await (await db.execute(
        "SELECT * FROM aulas WHERE data=? ORDER BY COALESCE(hora,'99:99') LIMIT 1",
        (hoje,))).fetchone()
    eh_hoje = row is not None
    if not row:
        row = await (await db.execute(
            "SELECT * FROM aulas WHERE data > ? AND status='agendada' "
            "ORDER BY data, COALESCE(hora,'99:99') LIMIT 1", (hoje,))).fetchone()
    if not row:
        return {"aula": None, "eh_hoje": False, "hoje": hoje}
    aula = dict(row)
    aula["exercicios"] = await _itens_da_aula(db, aula["id"])
    aula["pode_montar"] = _pode_montar_treino(user, row)
    aula["ja_comecou"] = _ja_comecou(aula["data"], aula["hora"])
    return {"aula": aula, "eh_hoje": eh_hoje, "hoje": hoje}


@app.get("/api/aulas/{aid}")
async def obter_aula(aid: int, user=Depends(get_current_user),
                     db: aiosqlite.Connection = Depends(get_db)):
    row = await (await db.execute("SELECT * FROM aulas WHERE id=?", (aid,))).fetchone()
    if not row:
        raise HTTPException(404, "Aula não encontrada")
    aula = dict(row)
    aula["exercicios"] = await _itens_da_aula(db, aid)
    aula["pode_montar"] = _pode_montar_treino(user, row)
    aula["ja_comecou"] = _ja_comecou(aula["data"], aula["hora"])
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
    _valida_status_no_tempo(body.status, d0.isoformat(), body.hora)

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
        elif modalidade in MODALIDADES_PROPRIAS:
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
        elif modalidade in MODALIDADES_PROPRIAS:
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
    for campo, teto in (("distancia_km", 500), ("tempo_min", 1440)):
        v = data.get(campo)
        if v is not None and not (0 < float(v) <= teto):
            raise HTTPException(400, f"Valor fora do esperado em {campo}.")
    for campo in ("energia", "fadiga"):
        v = data.get(campo)
        if v is not None and not (1 <= int(v) <= NIVEIS_1A5):
            raise HTTPException(400, f"{campo.capitalize()} deve ficar entre 1 e {NIVEIS_1A5}.")
    if data.get("pse") is not None and not (1 <= int(data["pse"]) <= 10):
        raise HTTPException(400, "Percepção de esforço deve ficar entre 1 e 10.")
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
    # Aula já realizada: só entra o registro do que aconteceu.
    # A trava vale para aula que de fato aconteceu. Uma marcada como feita num
    # horário que ainda não chegou é dado inconsistente — e precisa poder ser
    # corrigida, senão fica presa para sempre.
    if atual["status"] == STATUS_IRREVERSIVEL and _ja_comecou(atual["data"], atual["hora"]):
        liberados = set(CAMPOS_APOS_REALIZADA)
        if _pode_montar_treino(user, atual):
            liberados |= CAMPOS_APOS_REALIZADA_AUTOR
        travados = set(data) - liberados
        if travados:
            extra = (" Como o treino é seu, dá para corrigir também os exercícios, o foco e a descrição."
                     if _pode_montar_treino(user, atual) else "")
            raise HTTPException(400,
                "Este treino já foi dado como feito e isso não se desfaz. "
                "Dá para ajustar a percepção de esforço, as observações e a execução "
                f"dos exercícios.{extra} Campos bloqueados: {', '.join(sorted(travados))}.")

    # Vale o estado final: mudar a data para o futuro numa aula já 'realizada'
    # criaria o mesmo absurdo que marcar 'realizada' numa aula futura.
    _valida_status_no_tempo(
        data.get("status", atual["status"]),
        data.get("data", atual["data"]),
        data["hora"] if "hora" in data else atual["hora"])

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
    # A lista é substituída inteira (mais simples e atômico), mas as séries JÁ
    # REGISTRADAS não podem ir junto: o personal ajustar o treino depois da aula,
    # ou o aluno acrescentar um exercício no meio do treino, apagaria as cargas
    # que ele acabou de lançar. Guardamos por nome e devolvemos ao final.
    cur = await db.execute("""
        SELECT ae.nome, s.ordem, s.carga, s.repeticoes, s.feito
          FROM aula_exercicios ae JOIN aula_series s ON s.aula_exercicio_id = ae.id
         WHERE ae.aula_id = ? AND (s.carga IS NOT NULL OR s.repeticoes IS NOT NULL OR s.feito = 1)
    """, (aid,))
    registradas = {}
    for r in await cur.fetchall():
        registradas.setdefault(r["nome"], []).append(dict(r))

    await db.execute("DELETE FROM aula_exercicios WHERE aula_id=?", (aid,))
    for i, it in enumerate(itens):
        nome = (it.nome or "").strip()
        if not nome and it.exercicio_id:
            ex = await (await db.execute("SELECT nome FROM exercicios WHERE id=?", (it.exercicio_id,))).fetchone()
            nome = ex["nome"] if ex else ""
        if not nome:
            continue
        cur = await db.execute("""
            INSERT INTO aula_exercicios
                (aula_id, exercicio_id, nome, ordem, series, repeticoes, carga, descanso_seg, feito, obs)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (aid, it.exercicio_id, nome, it.ordem if it.ordem is not None else i,
              it.series, it.repeticoes, it.carga, it.descanso_seg, 1 if it.feito else 0, it.obs))
        for sr in registradas.get(nome, []):
            await db.execute("""
                INSERT OR REPLACE INTO aula_series
                    (aula_exercicio_id, ordem, carga, repeticoes, feito) VALUES (?,?,?,?,?)
            """, (cur.lastrowid, sr["ordem"], sr["carga"], sr["repeticoes"], sr["feito"]))
        if registradas.get(nome):
            await _sincronizar_item(db, cur.lastrowid)
    await db.execute("UPDATE aulas SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?", (aid,))
    await db.commit()
    return await _itens_da_aula(db, aid)


class ExecucaoIn(BaseModel):
    """O que de fato aconteceu no exercício — separado da prescrição."""
    feito: Optional[bool] = None
    carga: Optional[float] = None
    obs: Optional[str] = None


@app.patch("/api/aulas/{aid}/exercicios/{eid}")
async def registrar_execucao(aid: int, eid: int, body: ExecucaoIn,
                             user=Depends(get_current_user),
                             db: aiosqlite.Connection = Depends(get_db)):
    """Registra a execução de um exercício: se foi feito, com que carga e como foi.

    Liberado para os dois perfis, inclusive numa aula com o personal: quem treinou
    é quem sabe o que saiu. O que o aluno não pode mexer é na PRESCRIÇÃO — nome,
    séries, repetições e descanso — e isso continua valendo.
    """
    item = await (await db.execute(
        "SELECT ae.* FROM aula_exercicios ae WHERE ae.id=? AND ae.aula_id=?", (eid, aid))).fetchone()
    if not item:
        raise HTTPException(404, "Exercício não encontrado nesta aula")
    data = body.dict(exclude_unset=True)
    if not data:
        return dict(item)
    sets, params = [], []
    for k, v in data.items():
        sets.append(f"{k}=?")
        params.append(1 if (k == "feito" and v) else (0 if k == "feito" else v))
    params.append(eid)
    await db.execute(f"UPDATE aula_exercicios SET {', '.join(sets)} WHERE id=?", params)
    await db.execute("UPDATE aulas SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?", (aid,))
    await db.commit()
    row = await (await db.execute("SELECT * FROM aula_exercicios WHERE id=?", (eid,))).fetchone()
    return dict(row)


class SerieIn(BaseModel):
    """Uma série executada: o peso que saiu, as repetições que saíram, e o check."""
    carga: Optional[float] = None
    repeticoes: Optional[int] = None
    feito: Optional[bool] = None


@app.patch("/api/aulas/{aid}/exercicios/{eid}/series/{ordem}")
async def registrar_serie(aid: int, eid: int, ordem: int, body: SerieIn,
                          user=Depends(get_current_user),
                          db: aiosqlite.Connection = Depends(get_db)):
    """Registra UMA série do exercício — o que se faz com o celular na mão, na academia.

    Liberado para os dois perfis (quem treinou é quem sabe o que saiu), mas nunca
    antes do treino começar: não se executa o que ainda não aconteceu.
    """
    if not (1 <= ordem <= MAX_SERIES):
        raise HTTPException(400, f"Série fora do intervalo (1 a {MAX_SERIES})")
    aula = await (await db.execute("SELECT * FROM aulas WHERE id=?", (aid,))).fetchone()
    if not aula:
        raise HTTPException(404, "Aula não encontrada")
    item = await (await db.execute(
        "SELECT * FROM aula_exercicios WHERE id=? AND aula_id=?", (eid, aid))).fetchone()
    if not item:
        raise HTTPException(404, "Exercício não encontrado nesta aula")
    if not _ja_comecou(aula["data"], aula["hora"]):
        raise HTTPException(400, "Este treino ainda não começou — não dá para registrar "
                                 "séries de um treino futuro.")
    dados = body.dict(exclude_unset=True)
    await db.execute("INSERT OR IGNORE INTO aula_series (aula_exercicio_id, ordem) VALUES (?,?)",
                     (eid, ordem))
    if dados:
        sets, params = [], []
        for k, v in dados.items():
            sets.append(f"{k}=?")
            params.append((1 if v else 0) if k == "feito" else v)
        params += [eid, ordem]
        await db.execute(
            f"UPDATE aula_series SET {', '.join(sets)} WHERE aula_exercicio_id=? AND ordem=?",
            params)
    await _sincronizar_item(db, eid)
    await db.execute("UPDATE aulas SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?", (aid,))
    await db.commit()
    row = await (await db.execute(
        "SELECT * FROM aula_exercicios WHERE id=?", (eid,))).fetchone()
    out = dict(row)
    cur = await db.execute(
        "SELECT * FROM aula_series WHERE aula_exercicio_id=? ORDER BY ordem", (eid,))
    out["series_reg"] = [dict(r) for r in await cur.fetchall()]
    return out


@app.post("/api/aulas/{aid}/usar-modelo/{mid}")
async def usar_modelo(aid: int, mid: int, user=Depends(get_current_user),
                      db: aiosqlite.Connection = Depends(get_db)):
    """Leva um modelo da biblioteca para um dia da agenda.

    O que acontece depende de quem manda no treino daquele dia:
      • treino sozinho (ou usuário personal) → o modelo é APLICADO na hora;
      • aula com o personal, pedida pelo aluno → vira SUGESTÃO, e o personal
        decide. O aluno não passa por cima da prescrição de quem ele contratou,
        mas também não fica sem voz sobre o que quer treinar.
    """
    aula = await (await db.execute("SELECT * FROM aulas WHERE id=?", (aid,))).fetchone()
    if not aula:
        raise HTTPException(404, "Aula não encontrada")
    mod = await (await db.execute("SELECT * FROM modelos WHERE id=?", (mid,))).fetchone()
    if not mod:
        raise HTTPException(404, "Modelo não encontrado")
    if aula["status"] in ("realizada", "falta", "cancelada"):
        raise HTTPException(400, "Esta aula já foi encerrada.")

    if _pode_montar_treino(user, aula):
        await db.execute("DELETE FROM aula_exercicios WHERE aula_id=?", (aid,))
        n = await _copiar_modelo(db, aid, mid)
        await db.execute(
            "UPDATE aulas SET modelo_id=?, sugestao_modelo_id=NULL,"
            " tipo=COALESCE(NULLIF(tipo,''),?), foco=COALESCE(NULLIF(foco,''),?),"
            " atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
            (mid, mod["tipo"], mod["foco"], aid))
        await db.commit()
        return {"acao": "aplicado", "itens": n, "modelo": mod["nome"]}

    await db.execute("UPDATE aulas SET sugestao_modelo_id=?, atualizado_em=CURRENT_TIMESTAMP"
                     " WHERE id=?", (mid, aid))
    await db.commit()
    return {"acao": "sugerido", "modelo": mod["nome"]}


@app.delete("/api/aulas/{aid}/sugestao", status_code=204)
async def limpar_sugestao(aid: int, user=Depends(get_current_user),
                          db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("UPDATE aulas SET sugestao_modelo_id=NULL WHERE id=?", (aid,))
    await db.commit()


@app.post("/api/aulas/{aid}/aplicar-modelo/{mid}")
async def aplicar_modelo(aid: int, mid: int, substituir: bool = True,
                         user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    aula = await (await db.execute("SELECT * FROM aulas WHERE id=?", (aid,))).fetchone()
    if not aula:
        raise HTTPException(404, "Aula não encontrada")
    if not _pode_montar_treino(user, aula):
        raise HTTPException(403, "O treino desta aula é montado pelo personal.")
    # Aplicar um modelo TROCA a lista inteira e, ao contrário do PUT de exercícios,
    # não resgata as séries já lançadas. Numa aula concluída isso apagaria as
    # cargas registradas — corrigir um exercício é uma coisa, varrer o histórico
    # do treino é outra.
    if aula["status"] == STATUS_IRREVERSIVEL and _ja_comecou(aula["data"], aula["hora"]):
        raise HTTPException(400, "Este treino já foi feito: aplicar um modelo agora apagaria "
                                 "as cargas registradas. Ajuste os exercícios um a um.")
    mod = await (await db.execute("SELECT * FROM modelos WHERE id=?", (mid,))).fetchone()
    if not mod:
        raise HTTPException(404, "Modelo não encontrado")
    if substituir:
        await db.execute("DELETE FROM aula_exercicios WHERE aula_id=?", (aid,))
    n = await _copiar_modelo(db, aid, mid)
    # Aplicar o modelo atende a sugestão pendente — deixá-la depois disso só
    # faria o personal ver de novo um pedido que ele já cumpriu.
    await db.execute(
        "UPDATE aulas SET modelo_id=?, sugestao_modelo_id=NULL,"
        " tipo=COALESCE(NULLIF(tipo,''),?), foco=COALESCE(NULLIF(foco,''),?),"
        " atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
        (mid, mod["tipo"], mod["foco"], aid))
    await db.commit()
    return {"itens": n}


# ── Exercícios ────────────────────────────────────────────────────────────────
@app.get("/api/exercicios/catalogo")
async def catalogo_exercicios(user=Depends(get_current_user),
                              db: aiosqlite.Connection = Depends(get_db)):
    """Índice da biblioteca: quantos exercícios por grupo muscular e por equipamento.

    É o que transforma uma lista de 38 nomes numa biblioteca navegável — escolher
    "Peito" e ver 5 opções é mais rápido do que rolar tudo procurando.
    """
    async def _contar(campo):
        cur = await db.execute(f"""
            SELECT COALESCE(NULLIF({campo},''),'Sem classificação') k, COUNT(*) n
              FROM exercicios WHERE ativo=1 GROUP BY k ORDER BY n DESC, k
        """)
        return [{"nome": r["k"], "n": r["n"]} for r in await cur.fetchall()]

    total = (await (await db.execute("SELECT COUNT(*) FROM exercicios WHERE ativo=1")).fetchone())[0]
    favs = (await (await db.execute(
        "SELECT COUNT(*) FROM exercicios WHERE ativo=1 AND COALESCE(favorito,0)=1")).fetchone())[0]
    return {"total": total, "favoritos": favs,
            "grupos": await _contar("grupo"), "equipamentos": await _contar("equipamento")}


@app.get("/api/exercicios")
async def listar_exercicios(grupo: Optional[str] = None, equipamento: Optional[str] = None,
                            busca: Optional[str] = None, favoritos: bool = False,
                            user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    sql, params = "SELECT * FROM exercicios WHERE 1=1", []
    if grupo:
        sql += " AND COALESCE(NULLIF(grupo,''),'Sem classificação')=?"; params.append(grupo)
    if equipamento:
        sql += " AND COALESCE(NULLIF(equipamento,''),'Sem classificação')=?"; params.append(equipamento)
    if favoritos:
        sql += " AND COALESCE(favorito,0)=1"
    if busca:
        sql += " AND (nome LIKE ? OR descricao LIKE ? OR equipamento LIKE ?)"
        params += [f"%{busca}%"] * 3
    sql += " ORDER BY grupo, nome"
    cur = await db.execute(sql, params)
    return [dict(r) for r in await cur.fetchall()]


@app.post("/api/exercicios/{eid}/favorito")
async def alternar_favorito(eid: int, user=Depends(get_current_user),
                            db: aiosqlite.Connection = Depends(get_db)):
    """Favorito é atalho de montagem de treino, não gosto pessoal: os 8 exercícios
    que ele repete sempre ficam a um toque em vez de a uma busca."""
    row = await (await db.execute("SELECT favorito FROM exercicios WHERE id=?", (eid,))).fetchone()
    if not row:
        raise HTTPException(404, "Exercício não encontrado")
    novo = 0 if (row["favorito"] or 0) else 1
    await db.execute("UPDATE exercicios SET favorito=? WHERE id=?", (novo, eid))
    await db.commit()
    return {"id": eid, "favorito": bool(novo)}


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


# ── Pagamentos (Pix informado × recebido) ─────────────────────────────────────
# O dinheiro anda por fora do sistema. O app registra as DUAS pontas do combinado:
# o aluno informa que enviou o Pix, o personal confirma que recebeu. Enquanto uma
# ponta faltar, o pagamento fica pendente e aparece em destaque para os dois — é
# essa pendência visível que evita o "eu mandei" / "não caiu" no mês seguinte.
class PagamentoIn(BaseModel):
    mes: Optional[str] = None       # 'YYYY-MM' — None → mês corrente
    valor: float
    data_pix: Optional[str] = None  # None → hoje
    obs: Optional[str] = None


async def _pagamento(db, pid: int) -> dict:
    row = await (await db.execute("""
        SELECT p.*, ui.nome informou_nome, uc.nome confirmou_nome
          FROM pagamentos p
     LEFT JOIN usuarios ui ON ui.id = p.informado_por
     LEFT JOIN usuarios uc ON uc.id = p.confirmado_por
         WHERE p.id = ?
    """, (pid,))).fetchone()
    if not row:
        raise HTTPException(404, "Pagamento não encontrado")
    d = dict(row)
    d["confirmado"] = bool(d["confirmado_em"])
    return d


@app.get("/api/pagamentos")
async def listar_pagamentos(ano: Optional[int] = None, user=Depends(get_current_user),
                            db: aiosqlite.Connection = Depends(get_db)):
    ano = ano or _hoje().year
    cur = await db.execute("""
        SELECT p.*, ui.nome informou_nome, uc.nome confirmou_nome
          FROM pagamentos p
     LEFT JOIN usuarios ui ON ui.id = p.informado_por
     LEFT JOIN usuarios uc ON uc.id = p.confirmado_por
         WHERE substr(p.mes,1,4) = ?
      ORDER BY p.mes DESC, p.id DESC
    """, (str(ano),))
    itens = []
    for r in await cur.fetchall():
        d = dict(r); d["confirmado"] = bool(d["confirmado_em"]); itens.append(d)
    return itens


@app.get("/api/pagamentos/avisos")
async def avisos_pagamento(user=Depends(get_current_user),
                           db: aiosqlite.Connection = Depends(get_db)):
    """O que precisa aparecer POR CIMA da tela inicial, para este usuário.

    Personal: Pix informado e ainda não confirmado — é ação dele.
    Aluno:    Pix que o personal confirmou e ele ainda não viu — é notícia dele.
    """
    if user["role"] == "personal":
        cur = await db.execute("""
            SELECT p.*, ui.nome informou_nome FROM pagamentos p
         LEFT JOIN usuarios ui ON ui.id = p.informado_por
             WHERE p.confirmado_em IS NULL ORDER BY p.data_pix, p.id
        """)
        return {"tipo": "confirmar", "itens": [dict(r) for r in await cur.fetchall()]}

    cur = await db.execute("""
        SELECT p.*, uc.nome confirmou_nome FROM pagamentos p
     LEFT JOIN usuarios uc ON uc.id = p.confirmado_por
         WHERE p.confirmado_em IS NOT NULL AND p.visto_aluno = 0
      ORDER BY p.confirmado_em
    """)
    return {"tipo": "confirmado", "itens": [dict(r) for r in await cur.fetchall()]}


@app.post("/api/pagamentos", status_code=201)
async def informar_pagamento(body: PagamentoIn, user=Depends(require_dono),
                             db: aiosqlite.Connection = Depends(get_db)):
    """Quem paga é o aluno — só ele informa o Pix."""
    if body.valor is None or body.valor <= 0:
        raise HTTPException(400, "Informe o valor pago.")
    mes = (body.mes or _hoje().strftime("%Y-%m")).strip()
    if not re.fullmatch(r"\d{4}-\d{2}", mes):
        raise HTTPException(400, "Mês inválido (use AAAA-MM).")
    data = _parse_data(body.data_pix) if body.data_pix else _hoje().isoformat()
    _valida_nao_futuro(data, "A data do pagamento")
    cur = await db.execute("""
        INSERT INTO pagamentos (mes, valor, data_pix, obs, informado_por)
        VALUES (?,?,?,?,?)
    """, (mes, round(body.valor, 2), data, (body.obs or "").strip() or None, user["id"]))
    await db.commit()
    return await _pagamento(db, cur.lastrowid)


@app.post("/api/pagamentos/{pid}/confirmar")
async def confirmar_pagamento(pid: int, user=Depends(get_current_user),
                              db: aiosqlite.Connection = Depends(get_db)):
    """Só o personal confirma: confirmar é atestar que o dinheiro CHEGOU, e quem
    sabe disso é quem recebe. Deixar o aluno confirmar o próprio Pix esvaziaria
    o registro — viraria só um bilhete dele para ele mesmo."""
    if user["role"] != "personal":
        raise HTTPException(403, "Só o personal confirma o recebimento do pagamento.")
    p = await _pagamento(db, pid)
    if p["confirmado"]:
        return p
    await db.execute(
        "UPDATE pagamentos SET confirmado_por=?, confirmado_em=CURRENT_TIMESTAMP, visto_aluno=0"
        " WHERE id=?", (user["id"], pid))
    await db.commit()
    return await _pagamento(db, pid)


@app.post("/api/pagamentos/{pid}/visto", status_code=204)
async def marcar_visto(pid: int, user=Depends(require_dono),
                       db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("UPDATE pagamentos SET visto_aluno=1 WHERE id=?", (pid,))
    await db.commit()


@app.delete("/api/pagamentos/{pid}", status_code=204)
async def remover_pagamento(pid: int, user=Depends(require_dono),
                            db: aiosqlite.Connection = Depends(get_db)):
    """O aluno cancela o próprio aviso enquanto ele não foi confirmado — erro de
    digitação acontece. Depois de confirmado, o registro é dos dois: fica."""
    p = await _pagamento(db, pid)
    if p["confirmado"]:
        raise HTTPException(400, "Pagamento já confirmado pelo personal — não dá para apagar.")
    await db.execute("DELETE FROM pagamentos WHERE id=?", (pid,))
    await db.commit()


# ── Cadastros de apoio (professores e locais) ─────────────────────────────────
TIPOS_CADASTRO = ("professor", "local")


class CadastroIn(BaseModel):
    tipo: str
    nome: str


@app.get("/api/cadastros")
async def listar_cadastros(tipo: Optional[str] = None, user=Depends(get_current_user),
                           db: aiosqlite.Connection = Depends(get_db)):
    sql, params = "SELECT * FROM cadastros WHERE ativo=1", []
    if tipo:
        sql += " AND tipo=?"; params.append(tipo)
    sql += " ORDER BY tipo, nome"
    cur = await db.execute(sql, params)
    itens = [dict(r) for r in await cur.fetchall()]
    return {t: [i["nome"] for i in itens if i["tipo"] == t] for t in TIPOS_CADASTRO} \
        if not tipo else itens


@app.post("/api/cadastros", status_code=201)
async def criar_cadastro(body: CadastroIn, user=Depends(get_current_user),
                         db: aiosqlite.Connection = Depends(get_db)):
    """Os dois perfis mantêm a base: o aluno cadastra o professor com quem vai
    treinar, o personal cadastra o local onde atende. É lista de apoio, não
    controle de acesso — por isso não passa por require_dono."""
    tipo = (body.tipo or "").strip().lower()
    nome = (body.nome or "").strip()
    if tipo not in TIPOS_CADASTRO:
        raise HTTPException(400, "Tipo inválido.")
    if not nome:
        raise HTTPException(400, "Informe o nome.")
    existe = await (await db.execute(
        "SELECT id, ativo FROM cadastros WHERE tipo=? AND nome=?", (tipo, nome))).fetchone()
    if existe:
        await db.execute("UPDATE cadastros SET ativo=1 WHERE id=?", (existe["id"],))
        await db.commit()
        return {"id": existe["id"], "tipo": tipo, "nome": nome}
    cur = await db.execute("INSERT INTO cadastros (tipo, nome) VALUES (?,?)", (tipo, nome))
    await db.commit()
    return {"id": cur.lastrowid, "tipo": tipo, "nome": nome}


@app.delete("/api/cadastros/{cid}", status_code=204)
async def remover_cadastro(cid: int, user=Depends(get_current_user),
                           db: aiosqlite.Connection = Depends(get_db)):
    """Desativa em vez de apagar: as aulas antigas guardam o nome em texto, e
    sumir com a opção não deve reescrever o passado."""
    await db.execute("UPDATE cadastros SET ativo=0 WHERE id=?", (cid,))
    await db.commit()


# ── Aeróbico (corrida) ────────────────────────────────────────────────────────
def _pace(dist, tempo) -> Optional[str]:
    """min/km no formato 5:42 — é assim que corredor lê ritmo, não em decimal."""
    if not dist or not tempo or dist <= 0:
        return None
    total = tempo / dist
    m = int(total)
    seg = round((total - m) * 60)
    if seg == 60:
        m, seg = m + 1, 0
    return f"{m}:{seg:02d}"


@app.get("/api/aerobico")
async def aerobico(ano: Optional[int] = None, user=Depends(get_current_user),
                   db: aiosqlite.Connection = Depends(get_db)):
    """Acompanhamento da corrida: volume por mês e ritmo ao longo do tempo.

    Só entram treinos REALIZADOS com distância registrada — sem distância não há
    ritmo, e um ponto sem ritmo no gráfico é ruído, não informação.
    """
    ano = ano or _hoje().year
    ini, fim = date(ano, 1, 1).isoformat(), date(ano, 12, 31).isoformat()

    cur = await db.execute("""
        SELECT data, foco, tipo, distancia_km, tempo_min, pse
          FROM aulas
         WHERE modalidade = ? AND status = 'realizada' AND data BETWEEN ? AND ?
           AND distancia_km IS NOT NULL AND distancia_km > 0
      ORDER BY data
    """, (MODALIDADE_AEROBICA, ini, fim))
    treinos = []
    mensal = [{"mes": m, "km": 0.0, "min": 0.0, "treinos": 0} for m in range(1, 13)]
    for r in await cur.fetchall():
        d = dict(r)
        d["pace"] = _pace(d["distancia_km"], d["tempo_min"])
        treinos.append(d)
        m = int(d["data"][5:7])
        if 1 <= m <= 12:
            alvo = mensal[m - 1]
            alvo["km"] += d["distancia_km"] or 0
            alvo["min"] += d["tempo_min"] or 0
            alvo["treinos"] += 1
    for m in mensal:
        m["km"] = round(m["km"], 1)
        m["min"] = round(m["min"])
        m["pace"] = _pace(m["km"], m["min"])

    com_tempo = [t for t in treinos if t["tempo_min"]]
    total_km = round(sum(t["distancia_km"] or 0 for t in treinos), 1)
    total_min = round(sum(t["tempo_min"] or 0 for t in com_tempo))

    # Quantos treinos aeróbicos ficaram sem distância lançada — a fila de
    # registro pendente, que é o que faz o gráfico mentir se ficar escondida.
    sem_registro = (await (await db.execute("""
        SELECT COUNT(*) FROM aulas
         WHERE modalidade = ? AND status = 'realizada' AND data BETWEEN ? AND ?
           AND (distancia_km IS NULL OR distancia_km <= 0)
    """, (MODALIDADE_AEROBICA, ini, fim))).fetchone())[0]

    return {
        "ano": ano, "mensal": mensal, "treinos": treinos[-40:],
        "total_km": total_km, "total_min": total_min,
        "pace_medio": _pace(round(sum(t["distancia_km"] for t in com_tempo), 2), total_min),
        "melhor_pace": min((t["pace"] for t in com_tempo), default=None,
                           key=lambda p: int(p.split(":")[0]) * 60 + int(p.split(":")[1])),
        "treinos_no_ano": len(treinos), "sem_registro": sem_registro,
    }


# ── Corpo (peso e medidas) ────────────────────────────────────────────────────
class MedidaIn(BaseModel):
    data: Optional[str] = None     # None → hoje
    peso: Optional[float] = None
    cintura: Optional[float] = None
    quadril: Optional[float] = None
    peito: Optional[float] = None
    braco: Optional[float] = None
    coxa: Optional[float] = None
    obs: Optional[str] = None


_CAMPOS_MEDIDA = ("peso", "cintura", "quadril", "peito", "braco", "coxa", "obs")


def _classificar_imc(imc: float) -> str:
    """Faixas da OMS. Descrição, não recomendação — o app não dá conselho de saúde."""
    if imc < 18.5:  return "abaixo do peso"
    if imc < 25:    return "peso normal"
    if imc < 30:    return "sobrepeso"
    if imc < 35:    return "obesidade grau I"
    if imc < 40:    return "obesidade grau II"
    return "obesidade grau III"


@app.get("/api/medidas")
async def listar_medidas(limite: int = 60, user=Depends(get_current_user),
                         db: aiosqlite.Connection = Depends(get_db)):
    cur = await db.execute("SELECT * FROM medidas ORDER BY data DESC LIMIT ?",
                           (max(1, min(limite, 500)),))
    return [dict(r) for r in await cur.fetchall()]


@app.post("/api/medidas", status_code=201)
async def salvar_medida(body: MedidaIn, user=Depends(require_dono),
                        db: aiosqlite.Connection = Depends(get_db)):
    """Uma linha por dia: pesar duas vezes no mesmo dia corrige o registro em vez
    de criar dois pontos no gráfico. Só o dono registra — é o corpo dele."""
    data = _parse_data(body.data) if body.data else _hoje().isoformat()
    _valida_nao_futuro(data, "A data da medida")
    dados = {k: v for k, v in body.dict(exclude_unset=True).items() if k in _CAMPOS_MEDIDA}
    if not dados:
        raise HTTPException(400, "Informe ao menos um valor.")
    await db.execute("INSERT OR IGNORE INTO medidas (data) VALUES (?)", (data,))
    sets = ", ".join(f"{k}=?" for k in dados)
    await db.execute(f"UPDATE medidas SET {sets} WHERE data=?", list(dados.values()) + [data])
    await db.commit()
    row = await (await db.execute("SELECT * FROM medidas WHERE data=?", (data,))).fetchone()
    return dict(row)


@app.delete("/api/medidas/{mid}", status_code=204)
async def remover_medida(mid: int, user=Depends(require_dono),
                         db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM medidas WHERE id=?", (mid,))
    await db.commit()


@app.get("/api/corpo")
async def corpo(user=Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)):
    """Painel de corpo: peso atual, variação, IMC, meta e ritmo REAL.

    O ritmo e a previsão saem de regressão linear sobre os pontos registrados —
    e só aparecem com histórico suficiente. Sem isso, seria adivinhação vestida
    de número, que é exatamente o que o app não deve fazer.
    """
    cfg = await _config(db)
    altura = float(cfg.get("altura_cm") or 0)
    meta = float(cfg.get("peso_meta") or 0)

    cur = await db.execute(
        "SELECT data, peso FROM medidas WHERE peso IS NOT NULL AND peso > 0 ORDER BY data")
    pontos = [{"data": r["data"], "peso": r["peso"]} for r in await cur.fetchall()]

    ultima = await (await db.execute("SELECT * FROM medidas ORDER BY data DESC LIMIT 1")).fetchone()
    atual = pontos[-1]["peso"] if pontos else None
    anterior = pontos[-2]["peso"] if len(pontos) > 1 else None

    imc = texto_imc = None
    if atual and altura > 0:
        imc = round(atual / ((altura / 100) ** 2), 1)
        texto_imc = _classificar_imc(imc)

    # Ritmo: kg por semana pela reta de mínimos quadrados dos últimos 90 dias.
    ritmo = previsao = None
    corte = (_hoje() - timedelta(days=90)).isoformat()
    recentes = [p for p in pontos if p["data"] >= corte]
    if len(recentes) >= 3:
        d0 = date.fromisoformat(recentes[0]["data"])
        xs = [(date.fromisoformat(p["data"]) - d0).days for p in recentes]
        ys = [p["peso"] for p in recentes]
        n, sx, sy = len(xs), sum(xs), sum(ys)
        sxx = sum(x * x for x in xs)
        sxy = sum(x * y for x, y in zip(xs, ys))
        denom = n * sxx - sx * sx
        if denom and (xs[-1] - xs[0]) >= 14:      # precisa de 2 semanas de janela
            inclinacao = (n * sxy - sx * sy) / denom      # kg por dia
            ritmo = round(inclinacao * 7, 2)
            if meta > 0 and atual and ritmo and (meta - atual) / ritmo > 0:
                dias = (meta - atual) / inclinacao
                if 0 < dias <= 730:
                    previsao = (_hoje() + timedelta(days=round(dias))).isoformat()

    return {
        "atual": atual, "anterior": anterior,
        "variacao": round(atual - anterior, 1) if (atual and anterior) else None,
        "primeira": pontos[0]["peso"] if pontos else None,
        "altura_cm": altura or None, "imc": imc, "imc_texto": texto_imc,
        "meta": meta or None,
        "falta_para_meta": round(atual - meta, 1) if (atual and meta) else None,
        "ritmo_kg_semana": ritmo, "previsao_meta": previsao,
        "registros": len(pontos), "serie": pontos[-60:],
        "ultima_medida": dict(ultima) if ultima else None,
    }


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

    # Painel do mês — barras honestas. Nenhum "score" inventado: cada linha é uma
    # razão entre dois números que existem no banco. Sem base, a linha diz "sem dados"
    # em vez de mostrar zero, que pareceria mau desempenho quando é falta de registro.
    pse_media = (await (await db.execute(
        "SELECT AVG(pse) FROM aulas WHERE status='realizada' AND pse IS NOT NULL "
        "AND data BETWEEN ? AND ?", (ini, fim))).fetchone())[0]
    com_carga = (await (await db.execute("""
        SELECT COUNT(DISTINCT a.id) FROM aulas a
          JOIN aula_exercicios ae ON ae.aula_id = a.id
          JOIN aula_series s ON s.aula_exercicio_id = ae.id AND s.feito = 1
         WHERE a.status='realizada' AND a.data BETWEEN ? AND ?
    """, (ini, fim))).fetchone())[0]

    def _linha(rotulo, valor, base, sufixo="", texto=""):
        if not base:
            # "S/D" e não "sem dados": a coluna da direita é estreita e alinhada;
            # texto longo desalinha as quatro barras.
            return {"rotulo": rotulo, "pct": None, "valor": None, "texto": "S/D"}
        pct = max(0, min(100, round(100.0 * valor / base)))
        return {"rotulo": rotulo, "pct": pct,
                "valor": f"{valor:g}/{base:g}{sufixo}" if not texto else texto}

    painel = [
        _linha("Aderência", realizadas, base, texto=(f"{aderencia:g}%" if aderencia is not None else "")),
        _linha("Meta do mês", realizadas, meta_mes or 0),
        _linha("Esforço médio", round(pse_media or 0, 1), 10 if pse_media else 0,
               texto=(f"PSE {pse_media:.1f}" if pse_media else "")),
        _linha("Carga registrada", com_carga, realizadas),
    ]

    # Pix do mês: informado × confirmado. O valor devido continua vindo da agenda;
    # isto é só o rastro de que o dinheiro andou.
    pg = await (await db.execute("""
        SELECT COALESCE(SUM(valor),0) t,
               COALESCE(SUM(CASE WHEN confirmado_em IS NOT NULL THEN valor END),0) c,
               COUNT(*) n,
               SUM(CASE WHEN confirmado_em IS NULL THEN 1 ELSE 0 END) pend
          FROM pagamentos WHERE mes = ?
    """, (ini[:7],))).fetchone()

    return {
        "mes": ini[:7], "inicio": ini, "fim": fim,
        "painel": painel, "pse_media": round(pse_media, 1) if pse_media else None,
        "realizadas": realizadas, "faltas": faltas, "canceladas": canceladas,
        "agendadas": agendadas, "total": realizadas + faltas + canceladas + agendadas,
        "aderencia": aderencia, "meta_mes": meta_mes,
        "volume_kg": round(volume, 1),
        "sequencia_semanas": sequencia,
        "sem_treino": sem_treino,
        "com_personal": por_modalidade.get("com_personal", 0),
        "sozinho": por_modalidade.get("sozinho", 0),
        "aerobico": por_modalidade.get("aerobico", 0),
        "proxima": _d(prox), "plano": plano,
        "financeiro": {
            "valor_hora": await _valor_hora(db, ini),
            "aulas_pagas": _n(*STATUS_VALIDOS),
            "valor_mes": valor_mes,                  # pago pelo aluno / recebido pelo personal
            "treinado": _v("realizada"),             # do valor pago, o que virou treino
            "a_treinar": _v("agendada"),             # pago, ainda por acontecer
            "perdido": _v("falta", "cancelada"),     # pago e não treinado — não volta
            "aulas_perdidas": _n("falta", "cancelada"),
            "pix_informado": round(pg["t"], 2),
            "pix_confirmado": round(pg["c"], 2),
            "pix_pendentes": pg["pend"] or 0,
            "falta_pagar": round(max(valor_mes - pg["t"], 0), 2),
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
        # A carga do dia é a maior série executada; sem séries lançadas, cai no
        # resumo do exercício — assim o histórico antigo continua no gráfico.
        cur = await db.execute("""
            SELECT a.data,
                   MAX(COALESCE(s.carga, ae.carga)) carga,
                   MAX(ae.series) series, MAX(ae.repeticoes) repeticoes
              FROM aula_exercicios ae
              JOIN aulas a ON a.id = ae.aula_id
         LEFT JOIN aula_series s ON s.aula_exercicio_id = ae.id AND s.feito = 1
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
