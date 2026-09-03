// FITPLAN — SPA (vanilla JS). Aplicação independente do PLANGEST.

// ── Estado ────────────────────────────────────────────────────────────────────
let _user = null;
let _mesRef = new Date();              // mês exibido no calendário
let _aulas = [], _exercicios = [], _modelos = [], _planos = [];
let _cfg = {};                          // valor da hora-aula e padrões da agenda
let _dmSel = new Set();                 // dias marcados no modal "dias do mês"
let _dmTravados = {};                   // dia → motivo (aula que não pode ser desmarcada)
let _dmMod = 'com_personal';            // modalidade sendo editada no modal
let _feriados = {};                     // 'YYYY-MM-DD' → {nome, tipo}
let _feriadosAno = null;                // ano já carregado (evita rebuscar)
let _dmOutras = {};                     // dia → modalidade, para os dias da outra agenda
let _chMensal, _chSemanal, _chGrupo, _chEvol;

const Auth = {
  get token() { return localStorage.getItem('fp_token'); },
  get nome()  { return localStorage.getItem('fp_nome'); },
  get role()  { return localStorage.getItem('fp_role'); },
  save(t, n, r) { localStorage.setItem('fp_token', t); localStorage.setItem('fp_nome', n); localStorage.setItem('fp_role', r); },
  clear() { ['fp_token','fp_nome','fp_role'].forEach(k => localStorage.removeItem(k)); },
  ok() { return !!this.token; }
};

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, url, body) {
  const h = { 'Content-Type': 'application/json' };
  if (Auth.token) h['Authorization'] = 'Bearer ' + Auth.token;
  const res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { Auth.clear(); mostrarLogin(); throw new Error('Sessão expirada'); }
  if (!res.ok) {
    const e = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof e.detail === 'string' ? e.detail : 'Erro na requisição');
  }
  return res.status === 204 ? null : res.json();
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtN(n, d = 0) { return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtR(n) { return 'R$ ' + fmtN(n, 2); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtData(s) { if (!s) return '—'; const [a,m,d] = s.slice(0,10).split('-'); return `${d}/${m}/${a}`; }
function fmtDataCurta(s) { if (!s) return '—'; const [a,m,d] = s.slice(0,10).split('-'); return `${d}/${m}/${a.slice(2)}`; }
function diaSemana(s) {
  const D = ['dom','seg','ter','qua','qui','sex','sáb'];
  return D[new Date(s + 'T12:00:00').getDay()];
}
function toast(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + tipo;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function abrirModal(id) { document.getElementById(id).classList.add('open'); }
function fecharModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => { if (e.target.classList.contains('modal-bg')) e.target.classList.remove('open'); });
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function num(id) { const v = val(id); return v === '' ? null : Number(v); }
function setVal(id, v) { document.getElementById(id).value = (v === null || v === undefined) ? '' : v; }

// ── Login ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const email = val('log-email'), senha = document.getElementById('log-senha').value;
  const erro = document.getElementById('log-erro');
  erro.style.display = 'none';
  if (!email || !senha) return;
  try {
    const body = new URLSearchParams({ username: email, password: senha });
    const res = await fetch('/auth/login', { method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro no login');
    Auth.save(data.access_token, data.nome, data.role);
    await iniciar();
  } catch (e) {
    erro.textContent = e.message; erro.style.display = '';
  }
}

function sair() { Auth.clear(); location.reload(); }

function mostrarLogin() {
  document.getElementById('auth').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

// ── Navegação ─────────────────────────────────────────────────────────────────
const TITULOS = { agenda:'Agenda', treinos:'Treinos', frequencia:'Frequência', financeiro:'Financeiro', config:'Configurações' };

function nav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');
  document.getElementById('page-title').textContent = TITULOS[page];
  fecharMenu();
  if (page === 'agenda') loadAgenda();
  if (page === 'treinos') { loadExercicios(); loadModelos(); }
  if (page === 'frequencia') loadFrequencia();
  if (page === 'financeiro') { loadFinanceiro(); loadPlanos(); }
  if (page === 'config') { loadConfig(); loadUsuarios(); }
}

function abrirMenu() { document.getElementById('sidebar').classList.add('open'); document.getElementById('overlay').classList.add('show'); }
function fecharMenu() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('show'); }

function toggleTema() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
  localStorage.setItem('fp_tema', dark ? 'light' : 'dark');
  document.getElementById('btn-tema').textContent = dark ? '🌙' : '☀️';
}

// ── Início ────────────────────────────────────────────────────────────────────
async function iniciar() {
  try { _user = await api('GET', '/auth/me'); }
  catch (e) { mostrarLogin(); return; }
  document.getElementById('auth').style.display = 'none';
  document.getElementById('app').style.display = '';
  document.getElementById('side-user').textContent = `${_user.nome} · ${_user.role === 'aluno' ? 'Aluno' : 'Personal'}`;
  // App publicado na internet: senha inicial ainda em uso é o risco nº 1
  document.getElementById('aviso-senha').style.display = _user.senha_padrao ? '' : 'none';
  document.getElementById('card-usuarios').style.display = _user.role === 'aluno' ? '' : 'none';
  await Promise.all([carregarExercicios(), carregarModelos(), carregarPlanos(), carregarConfig()]);
  loadAgenda();
}

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('fp_tema') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('btn-tema').textContent = '☀️';
  }
  // datalist compartilhado pelos campos de exercício
  const dl = document.createElement('datalist'); dl.id = 'dl-ex';
  document.body.appendChild(dl);
  if (Auth.ok()) iniciar(); else mostrarLogin();
});

// ── Caches de apoio ───────────────────────────────────────────────────────────
async function carregarExercicios() {
  _exercicios = await api('GET', '/api/exercicios');
  document.getElementById('dl-ex').innerHTML = _exercicios.map(e => `<option value="${esc(e.nome)}">`).join('');
  const grupos = [...new Set(_exercicios.map(e => e.grupo).filter(Boolean))].sort();
  const sel = document.getElementById('f-grupo');
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todos os grupos</option>' + grupos.map(g => `<option>${esc(g)}</option>`).join('');
  sel.value = atual;
}

async function carregarModelos() {
  _modelos = await api('GET', '/api/modelos');
  const opts = '<option value="">—</option>' + _modelos.filter(m => m.ativo)
    .map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join('');
  document.getElementById('a-modelo').innerHTML = opts;
  document.getElementById('a-aplicar-modelo').innerHTML =
    '<option value="">Aplicar modelo…</option>' + _modelos.filter(m => m.ativo)
      .map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join('');
}

async function carregarPlanos() {
  _planos = await api('GET', '/api/planos');
  document.getElementById('a-plano').innerHTML = '<option value="">—</option>' +
    _planos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
}

async function carregarConfig() {
  _cfg = await api('GET', '/api/config');
}

function loadConfig() {
  setVal('cfg-valor', _cfg.valor_hora || '');
  setVal('cfg-hora', _cfg.hora_padrao || '');
  setVal('cfg-duracao', _cfg.duracao_padrao || 60);
  setVal('cfg-prof', _cfg.professor_padrao || '');
  setVal('cfg-local', _cfg.local_padrao || '');
  // O personal enxerga o valor (é o que ele recebe), mas quem define o preço é o dono
  const dono = !!_cfg.pode_editar;
  ['cfg-valor','cfg-hora','cfg-duracao','cfg-prof','cfg-local'].forEach(i => document.getElementById(i).disabled = !dono);
  document.getElementById('cfg-btn').style.display = dono ? '' : 'none';
  document.getElementById('cfg-aviso').textContent = dono ? '' : 'Somente o aluno (dono) altera estes valores';
}

async function salvarConfig() {
  try {
    _cfg = await api('PUT', '/api/config', {
      valor_hora: num('cfg-valor') || 0,
      hora_padrao: val('cfg-hora') || null,
      duracao_padrao: num('cfg-duracao') || 60,
      professor_padrao: val('cfg-prof'),
      local_padrao: val('cfg-local')
    });
    toast('Configuração salva');
  } catch (e) { toast(e.message, 'err'); }
}

// ══════════════════════════════ AGENDA ═══════════════════════════════════════
function mesRefStr() { return `${_mesRef.getFullYear()}-${String(_mesRef.getMonth()+1).padStart(2,'0')}`; }

// Feriados do ano, para o calendário destacar no planejamento do mês
async function carregarFeriados(ano) {
  if (_feriadosAno === ano) return;
  try {
    const d = await api('GET', `/api/feriados?ano=${ano}`);
    _feriados = d.feriados || {};
    _feriadosAno = ano;
  } catch (e) { _feriados = {}; }
}

function feriadoDe(iso) { return _feriados[iso] || null; }

async function loadAgenda() {
  const mes = mesRefStr();
  await carregarFeriados(_mesRef.getFullYear());
  document.getElementById('cal-mes').textContent =
    _mesRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
  try {
    const [resumo, aulas] = await Promise.all([
      api('GET', `/api/resumo?mes=${mes}`),
      api('GET', `/api/aulas?mes=${mes}`)
    ]);
    _aulas = aulas;
    renderKpis(resumo);
    renderCal();
    renderLista();
  } catch (e) { toast(e.message, 'err'); }
}

function mudarMes(delta) { _mesRef = new Date(_mesRef.getFullYear(), _mesRef.getMonth() + delta, 1); loadAgenda(); }
function irHoje() { _mesRef = new Date(); loadAgenda(); }

function renderKpis(r) {
  const p = r.plano;
  const px = r.proxima;
  const cards = [
    { l: 'Aulas realizadas', v: r.realizadas,
      s: `${r.com_personal || 0} com o personal · ${r.sozinho || 0} sozinho` },
    { l: 'Frequência', v: r.aderencia === null ? '—' : r.aderencia + '%',
      s: 'realizadas ÷ aulas previstas' },
    { l: 'Sequência', v: r.sequencia_semanas,
      s: r.sequencia_semanas === 1 ? 'semana seguida na meta' : 'semanas seguidas na meta' },
    { l: 'Volume do mês', v: fmtN(r.volume_kg),
      s: 'kg · séries × reps × carga' },
    { l: 'Saldo do pacote', v: p ? `${p.saldo}/${p.aulas_contratadas}` : '—',
      s: p ? esc(p.nome) : 'sem pacote ativo' },
    { l: 'Próxima aula', v: px ? fmtData(px.data).slice(0, 5) + (px.hora ? ' ' + px.hora : '') : '—',
      s: px ? `${diaSemana(px.data)} · ${esc(px.tipo || px.foco || 'aula')}` : 'nada agendado', sm: true },
  ];
  // Pré-pago: o mês é pago quando as aulas entram na agenda.
  // Mesmo dinheiro dos dois lados — o aluno paga, o personal recebe.
  const f = r.financeiro || {};
  const dono = !_user || _user.role === 'aluno';
  cards.splice(1, 0, {
    l: dono ? 'Pago no mês' : 'A receber no mês',
    v: fmtR(f.valor_mes || 0), sm: true,
    s: `${f.aulas_pagas || 0} aulas × ${fmtR(f.valor_hora || 0)} · ${fmtR(f.a_treinar || 0)} ainda por treinar`
  });
  if (f.perdido) {
    cards.push({ l: 'Valor perdido', v: fmtR(f.perdido),
                 s: `${f.aulas_perdidas} aula(s) pagas e não treinadas — o valor não volta` });
  }
  if (r.sem_treino) {
    cards.push({ l: 'Sem treino montado', v: r.sem_treino,
                 s: 'aulas esperando o personal' });
  }
  document.getElementById('kpis').innerHTML = cards.map(c => `
    <div class="kpi">
      <div class="kpi-label">${c.l}</div>
      <div class="kpi-value${c.sm ? ' sm' : ''}">${c.v}</div>
      <div class="kpi-sub">${c.s}</div>
    </div>`).join('');
}

// Ícone e rótulo de cada status — a cor continua sendo a mesma do calendário,
// então o ícone acrescenta leitura sem substituir a que já existia.
const ICONE_STATUS = {
  agendada:  { i: '📅', t: 'Agendada' },
  realizada: { i: '✅', t: 'Treino feito' },
  falta:     { i: '❌', t: 'Falta' },
  cancelada: { i: '🚫', t: 'Cancelada' },
};

// O personal monta qualquer treino; o aluno monta só o que treina sozinho.
function podeMontarTreino(modalidade) {
  if (_user && _user.role === 'personal') return true;
  return (modalidade || 'com_personal') === 'sozinho';
}

function rotuloModalidade(m) {
  return (m || 'com_personal') === 'sozinho' ? 'Sozinho' : 'Com o personal';
}

// Aula que ainda espera o personal montar o treino
function semTreino(a) {
  return !a.qtd_exercicios && (a.status === 'agendada' || a.status === 'realizada')
         && (a.modalidade || 'com_personal') === 'com_personal';
}

function renderCal() {
  const ano = _mesRef.getFullYear(), mes = _mesRef.getMonth();
  const primeiro = new Date(ano, mes, 1);
  // Grade começa na segunda-feira
  const offset = (primeiro.getDay() + 6) % 7;
  const inicio = new Date(ano, mes, 1 - offset);
  const hojeIso = iso(new Date());
  const porDia = {};
  _aulas.forEach(a => (porDia[a.data] = porDia[a.data] || []).push(a));

  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    const k = iso(d);
    const fora = d.getMonth() !== mes;
    if (fora && i >= 35) continue;                     // não desenha a 6ª linha vazia
    const chips = (porDia[k] || []).map(a => `
      <div class="chip chip-${a.status}${semTreino(a) ? ' pend' : ''}${(a.modalidade === 'sozinho') ? ' solo' : ''}" onclick="event.stopPropagation();abrirAula(${a.id})"
           title="${esc((a.hora||'') + ' ' + (a.tipo||a.foco||'Aula') + ' · ' + rotuloModalidade(a.modalidade) + (semTreino(a) ? ' — sem treino montado' : ''))}">
        ${a.hora ? `<span class="chip-hora">${a.hora}</span> ` : ''}<span class="chip-txt">${esc(a.tipo || a.foco || 'Aula')}</span>
      </div>`).join('');
    const f = feriadoDe(k);
    const clsF = f ? (f.tipo === 'feriado' ? ' fer' : ' facu') : '';
    html += `<div class="cal-day ${fora ? 'out' : ''} ${k === hojeIso ? 'today' : ''}${clsF}"
                  onclick="novaAula('${k}')" ${f ? `title="${esc(f.nome)}"` : ''}>
               <div class="cal-num">${d.getDate()}</div>
               ${f ? `<div class="cal-fer">${esc(f.nome)}</div>` : ''}${chips}
             </div>`;
  }
  document.getElementById('cal').innerHTML = html;
}

function renderLista() {
  const f = val('f-status');
  const soPend = document.getElementById('f-sem-treino').checked;
  const linhas = _aulas.filter(a => (!f || a.status === f) && (!soPend || semTreino(a)));
  const tb = document.getElementById('lista-aulas');
  if (!linhas.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty">Nenhuma aula com esse filtro. Use "Dias do mês" para montar a agenda.</div></td></tr>';
    return;
  }
  tb.innerHTML = linhas.map(a => {
    const st = ICONE_STATUS[a.status] || { i: '•', t: a.status };
    const solo = a.modalidade === 'sozinho';
    // A linha inteira abre a aula — dispensa um botão e devolve a largura à
    // coluna do treino, que é o conteúdo que interessa.
    const treino = esc(a.tipo || a.foco || a.descricao || '—');
    const nEx = a.qtd_exercicios
      ? `<span class="ex-tag">${a.qtd_exercicios} ex</span>`
      : (semTreino(a) ? '<span class="ex-tag pend" title="sem treino montado">sem treino</span>' : '');
    return `
    <tr class="linha-aula" onclick="abrirAula(${a.id})" title="Abrir a aula">
      <td class="c-quando">
        <b>${fmtDataCurta(a.data)}</b>
        <div class="q-sub"><span class="muted">${diaSemana(a.data)}</span><b>${a.hora || '—'}</b></div>
      </td>
      <td class="c-modo"><span class="modo ${solo ? 'modo-i' : 'modo-p'}"
            title="${solo ? 'Individual — você treina sozinho' : 'Com o personal'}">${solo ? 'I' : 'P'}</span></td>
      <td class="c-treino">${treino}${nEx}</td>
      <td class="c-st"><span class="st b-${a.status}" title="${st.t}">${st.i}</span></td>
      <td class="right c-acoes">
        ${a.status === 'agendada'
          ? `<button class="ic" title="Marcar treino como feito"
                     onclick="event.stopPropagation();marcar(${a.id},'realizada')">✅</button>` : ''}
      </td>
    </tr>`; }).join('');
}

async function marcar(id, status) {
  try {
    await api('PATCH', `/api/aulas/${id}`, { status });
    toast('Aula marcada como ' + status);
    loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Modal de aula ─────────────────────────────────────────────────────────────
function limparAula() {
  ['a-id','a-hora','a-foco','a-local','a-professor','a-pse','a-descricao','a-obs','a-valor'].forEach(i => setVal(i, ''));
  setVal('a-duracao', 60); setVal('a-status', 'agendada'); setVal('a-tipo', '');
  setVal('a-modalidade', 'com_personal');
  setVal('a-plano', ''); setVal('a-modelo', ''); setVal('a-repetir', 0);
  document.querySelectorAll('#a-dias input').forEach(c => c.checked = false);
  document.getElementById('a-ex').innerHTML = '';
  document.getElementById('a-aplicar-modelo').value = '';
}

function novaAula(dataIso) {
  limparAula();
  const planoAtivo = _planos.find(p => p.ativo);
  setVal('a-data', dataIso || iso(new Date()));
  setVal('a-hora', _cfg.hora_padrao || '');
  setVal('a-duracao', _cfg.duracao_padrao || 60);
  setVal('a-professor', _cfg.professor_padrao || '');
  setVal('a-local', _cfg.local_padrao || '');
  setVal('a-valor', _cfg.valor_hora_vigente || _cfg.valor_hora || '');
  if (planoAtivo) { setVal('a-plano', planoAtivo.id); if (planoAtivo.professor) setVal('a-professor', planoAtivo.professor); }
  document.getElementById('m-aula-titulo').textContent = 'Nova aula';
  document.getElementById('a-btn-del').style.display = 'none';
  document.getElementById('a-recorrencia').style.display = '';
  aplicarModoAula();
  abrirModal('m-aula');
}

async function abrirAula(id) {
  try {
    const a = await api('GET', `/api/aulas/${id}`);
    limparAula();
    setVal('a-id', a.id); setVal('a-data', a.data); setVal('a-hora', a.hora || '');
    setVal('a-duracao', a.duracao_min || 60); setVal('a-status', a.status);
    setVal('a-tipo', a.tipo || ''); setVal('a-foco', a.foco || '');
    setVal('a-local', a.local || ''); setVal('a-professor', a.professor || '');
    setVal('a-plano', a.plano_id || ''); setVal('a-modelo', a.modelo_id || '');
    setVal('a-pse', a.pse || ''); setVal('a-descricao', a.descricao || ''); setVal('a-obs', a.obs || '');
    setVal('a-valor', a.valor ?? '');
    setVal('a-modalidade', a.modalidade || 'com_personal');
    (a.exercicios || []).forEach(it => addLinhaEx('a-ex', it));
    document.getElementById('m-aula-titulo').textContent = `Aula de ${fmtData(a.data)}`;
    document.getElementById('a-btn-del').style.display = '';
    document.getElementById('a-recorrencia').style.display = 'none';   // recorrência só na criação
    aplicarModoAula();
    abrirModal('m-aula');
  } catch (e) { toast(e.message, 'err'); }
}

// Ajusta o modal ao que o usuário logado pode fazer nesta aula.
// Aula com o personal, na visão do aluno: o treino é leitura; o que é dele são
// data, status e feedback.
function aplicarModoAula() {
  const pode = podeMontarTreino(val('a-modalidade'));
  // Campos que pertencem ao personal. Ficam travados para o aluno em aula com o
  // personal — o backend também os recusa, e campo editável que não salva é pior
  // do que campo travado.
  ['a-tipo', 'a-foco', 'a-descricao', 'a-modelo', 'a-duracao', 'a-local', 'a-professor', 'a-plano'].forEach(i => {
    const el = document.getElementById(i);
    if (el) el.disabled = !pode;
  });
  document.getElementById('a-ex-acoes').style.display = pode ? '' : 'none';
  document.getElementById('a-ex-aviso').style.display = pode ? 'none' : '';
  // linhas de exercício viram somente leitura (o "feito" continua marcável)
  document.querySelectorAll('#a-ex .ex-row').forEach(row => {
    row.querySelectorAll('input, select').forEach(el => {
      if (!el.classList.contains('ex-feito')) el.disabled = !pode;
    });
    const del = row.querySelector('.ex-del');
    if (del) del.style.display = pode ? '' : 'none';
  });
}

async function salvarAula() {
  const id = val('a-id');
  if (!val('a-data')) return toast('Informe a data', 'err');
  const pode = podeMontarTreino(val('a-modalidade'));
  // Numa aula do personal, o aluno só envia o que é dele — o backend recusa o resto
  const body = pode ? {
    data: val('a-data'), hora: val('a-hora') || null, duracao_min: num('a-duracao') || 60,
    tipo: val('a-tipo') || null, foco: val('a-foco') || null, local: val('a-local') || null,
    professor: val('a-professor') || null, status: val('a-status'),
    modalidade: val('a-modalidade'), plano_id: num('a-plano'), modelo_id: num('a-modelo'),
    descricao: val('a-descricao') || null, obs: val('a-obs') || null, pse: num('a-pse'),
    valor: num('a-valor')
  } : {
    data: val('a-data'), hora: val('a-hora') || null, status: val('a-status'),
    modalidade: val('a-modalidade'), obs: val('a-obs') || null, pse: num('a-pse'),
    valor: num('a-valor')
  };
  try {
    let aulaId = id;
    if (id) {
      await api('PATCH', `/api/aulas/${id}`, body);
    } else {
      body.repetir_semanas = num('a-repetir') || 0;
      body.dias_semana = [...document.querySelectorAll('#a-dias input:checked')].map(c => Number(c.value));
      const r = await api('POST', '/api/aulas', body);
      aulaId = r.ids[0];
      if (r.criadas > 1) toast(`${r.criadas} aulas criadas na agenda`);
      if (r.ignoradas) toast(`${r.ignoradas} data(s) já tinham aula no mesmo horário`, 'warn');
    }
    // Exercícios só são gravados na aula "base" (a recorrência copia o modelo, quando
    // houver) e só por quem pode montar o treino
    if (pode) {
      const itens = coletarEx('a-ex');
      if (itens.length || id) await api('PUT', `/api/aulas/${aulaId}/exercicios`, itens);
    }
    fecharModal('m-aula');
    toast('Aula salva');
    loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

async function excluirAula() {
  const id = val('a-id');
  if (!id || !confirm('Excluir esta aula? Os exercícios registrados nela também são apagados.')) return;
  try {
    await api('DELETE', `/api/aulas/${id}`);
    fecharModal('m-aula'); toast('Aula excluída'); loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

// Aplicar modelo dentro do modal da aula (preenche as linhas sem salvar)
document.addEventListener('change', e => {
  if (e.target.id !== 'a-aplicar-modelo' || !e.target.value) return;
  const mid = Number(e.target.value);
  e.target.value = '';
  api('GET', `/api/modelos/${mid}`).then(m => {
    if (document.getElementById('a-ex').children.length &&
        !confirm('Substituir os exercícios já listados pelos do modelo?')) return;
    document.getElementById('a-ex').innerHTML = '';
    (m.itens || []).forEach(it => addLinhaEx('a-ex', it));
    if (!val('a-tipo') && m.tipo) setVal('a-tipo', m.tipo);
    if (!val('a-foco') && m.foco) setVal('a-foco', m.foco);
    setVal('a-modelo', m.id);
    toast(`Modelo "${m.nome}" aplicado`);
  }).catch(err => toast(err.message, 'err'));
});

// ── Linhas de exercício (usadas na aula e no modelo) ──────────────────────────
function addLinhaEx(containerId, it = {}) {
  const wrap = document.getElementById(containerId);
  const div = document.createElement('div');
  div.className = 'ex-row';
  const comFeito = containerId === 'a-ex';
  div.innerHTML = `
    <input class="ex-nome" list="dl-ex" placeholder="Exercício" value="${esc(it.nome || '')}">
    <input class="ex-series" type="number" min="1" placeholder="Séries" value="${it.series ?? ''}">
    <input class="ex-reps" placeholder="Reps" value="${esc(it.repeticoes || '')}">
    <input class="ex-carga" type="number" step="0.5" placeholder="Carga" value="${it.carga ?? ''}">
    <input class="ex-desc" type="number" step="5" placeholder="Desc." value="${it.descanso_seg ?? ''}">
    <input class="ex-obs" placeholder="Obs" value="${esc(it.obs || '')}">
    <span style="display:flex;align-items:center;gap:4px">
      ${comFeito ? `<input class="ex-feito" type="checkbox" style="width:auto" ${it.feito ? 'checked' : ''} title="Feito">` : ''}
      <button class="ex-del" onclick="this.closest('.ex-row').remove()" title="Remover">✕</button>
    </span>`;
  wrap.appendChild(div);
}

function coletarEx(containerId) {
  return [...document.getElementById(containerId).querySelectorAll('.ex-row')].map((row, i) => {
    const nome = row.querySelector('.ex-nome').value.trim();
    if (!nome) return null;
    const ex = _exercicios.find(e => e.nome.toLowerCase() === nome.toLowerCase());
    const v = c => { const el = row.querySelector(c); const t = el ? el.value.trim() : ''; return t === '' ? null : Number(t); };
    const feito = row.querySelector('.ex-feito');
    return {
      exercicio_id: ex ? ex.id : null, nome, ordem: i,
      series: v('.ex-series'), repeticoes: row.querySelector('.ex-reps').value.trim() || null,
      carga: v('.ex-carga'), descanso_seg: v('.ex-desc'),
      obs: row.querySelector('.ex-obs').value.trim() || null,
      feito: feito ? feito.checked : false
    };
  }).filter(Boolean);
}

// ── Dias de aula do mês (o aluno define; o personal preenche o treino) ────────
async function abrirDiasDoMes(mod) {
  await carregarFeriados(_mesRef.getFullYear());
  _dmMod = mod || 'com_personal';
  document.querySelectorAll('#m-dias .tm-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mod === _dmMod));
  document.getElementById('dm-ajuda').innerHTML = _dmMod === 'com_personal'
    ? 'Marque os dias de aula <b>com o personal</b>. Elas entram como <b>agendadas</b>, prontas para ele montar o treino — e já contam no valor do mês.'
    : 'Marque os dias em que você vai <b>treinar sozinho</b>. Você mesmo monta o treino, e essas aulas <b>não entram no valor pago ao personal</b>.';
  _dmSel = new Set();
  _dmTravados = {};
  _dmOutras = {};
  _aulas.forEach(a => {
    const d = Number(a.data.slice(8, 10));
    const m = a.modalidade || 'com_personal';
    if (m !== _dmMod) { _dmOutras[d] = m; return; }   // agenda da outra modalidade
    _dmSel.add(d);
    // Aula realizada/falta/cancelada ou já com treino montado não pode ser desmarcada aqui
    if (a.status !== 'agendada' || a.qtd_exercicios) {
      _dmTravados[d] = a.status !== 'agendada' ? a.status : 'treino montado';
    }
  });
  document.getElementById('m-dias-titulo').textContent =
    'Dias de aula — ' + _mesRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  setVal('dm-hora', _cfg.hora_padrao || '');
  setVal('dm-duracao', _cfg.duracao_padrao || 60);
  setVal('dm-prof', _cfg.professor_padrao || '');
  setVal('dm-local', _cfg.local_padrao || '');
  setVal('dm-valor', _dmMod === 'sozinho' ? 0 : (_cfg.valor_hora_vigente || _cfg.valor_hora || ''));
  dmGrid(_mesRef.getFullYear(), _mesRef.getMonth());
  abrirModal('m-dias');
}

// Troca a agenda que está sendo editada. Cada modalidade tem a sua: marcar os dias
// de treino sozinho não mexe nas aulas com o personal.
function dmModalidade(mod) { abrirDiasDoMes(mod); }

function dmGrid(ano, mes) {
  const ult = new Date(ano, mes + 1, 0).getDate();
  const offset = (new Date(ano, mes, 1).getDay() + 6) % 7;   // grade começa na segunda
  let html = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(d => `<div class="dm-dow">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) html += '<button class="dm-dia vazio" disabled></button>';
  for (let d = 1; d <= ult; d++) {
    const travado = _dmTravados[d];
    const outra = _dmOutras[d];
    const f = feriadoDe(`${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    let cls = outra ? 'outra' : (travado ? 'travado' : '') + (_dmSel.has(d) ? ' on' : '');
    if (f) cls += f.tipo === 'feriado' ? ' fer' : ' facu';
    const tits = [];
    if (f) tits.push(f.nome);
    if (outra) tits.push(`já tem aula ${rotuloModalidade(outra).toLowerCase()}`);
    else if (travado) tits.push(`${travado} — não pode ser removida aqui`);
    html += `<button class="dm-dia ${cls}" onclick="dmToggle(${d})"
                     ${tits.length ? `title="${esc(tits.join(' · '))}"` : ''}>${d}</button>`;
  }
  document.getElementById('dm-grid').innerHTML = html;
  dmTotal();
}

function dmToggle(d) {
  if (_dmOutras[d]) { toast(`Dia ${d} já tem aula ${rotuloModalidade(_dmOutras[d]).toLowerCase()}`, 'warn'); return; }
  if (_dmTravados[d]) { toast(`Dia ${d}: ${_dmTravados[d]} — abra a aula para alterar`, 'warn'); return; }
  if (_dmSel.has(d)) _dmSel.delete(d); else _dmSel.add(d);
  dmGrid(_mesRef.getFullYear(), _mesRef.getMonth());
}

// Atalho: marca todos os dias do mês que caem nos dias da semana escolhidos
function dmSemana(dows) {
  const ano = _mesRef.getFullYear(), mes = _mesRef.getMonth();
  const ult = new Date(ano, mes + 1, 0).getDate();
  _dmSel = new Set(Object.keys(_dmTravados).map(Number));
  for (let d = 1; d <= ult; d++) {
    if (dows.includes(new Date(ano, mes, d).getDay()) && !_dmOutras[d]) _dmSel.add(d);
  }
  dmGrid(ano, mes);
}

function dmTotal() {
  const n = _dmSel.size;
  const v = num('dm-valor') || 0;
  const dono = !_user || _user.role === 'aluno';
  // dias marcados que caem em feriado — o motivo de eles estarem no calendário
  const ano = _mesRef.getFullYear(), mes = String(_mesRef.getMonth() + 1).padStart(2, '0');
  const nosFeriados = [..._dmSel]
    .map(d => ({ d, f: feriadoDe(`${ano}-${mes}-${String(d).padStart(2, '0')}`) }))
    .filter(x => x.f);
  const alerta = nosFeriados.length
    ? `<div class="dm-alerta">⚠ ${nosFeriados.length} dia(s) em feriado: ${nosFeriados.map(x => `${x.d} (${esc(x.f.nome)})`).join(', ')}</div>`
    : '';
  document.getElementById('dm-resumo').innerHTML = n
    ? (_dmMod === 'sozinho'
        ? `${n} treino${n > 1 ? 's' : ''} sozinho` +
          `<div style="font-weight:600;font-size:12px;opacity:.85">não entra no valor pago ao personal</div>` + alerta
        : `${n} aula${n > 1 ? 's' : ''} × ${fmtR(v)} = <b>${fmtR(n * v)}</b>` +
          `<div style="font-weight:600;font-size:12px;opacity:.85">` +
          (dono ? 'valor do mês — pago ao agendar' : 'valor do mês — recebido no agendamento') +
          `</div>`) + alerta
    : 'Nenhum dia marcado.';
}

async function salvarDiasDoMes() {
  const body = {
    mes: mesRefStr(),
    modalidade: _dmMod,
    dias: [..._dmSel],
    hora: val('dm-hora') || null,
    duracao_min: num('dm-duracao') || 60,
    professor: val('dm-prof'),
    local: val('dm-local'),
    valor: num('dm-valor')
  };
  try {
    const r = await api('POST', '/api/aulas/mes', body);
    fecharModal('m-dias');
    toast(`Agenda do mês salva: ${r.criadas} criada(s), ${r.removidas} removida(s)`);
    if (r.protegidas && r.protegidas.length) {
      toast(`${r.protegidas.length} aula(s) mantida(s): já realizadas ou com treino montado`, 'warn');
    }
    loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

// ══════════════════════════════ TREINOS ══════════════════════════════════════
function tabTreino(t) {
  document.querySelectorAll('#page-treinos .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.getElementById('tab-modelos').style.display = t === 'modelos' ? '' : 'none';
  document.getElementById('tab-exercicios').style.display = t === 'exercicios' ? '' : 'none';
}

async function loadModelos() {
  try { await carregarModelos(); renderModelos(); } catch (e) { toast(e.message, 'err'); }
}

function renderModelos() {
  const tb = document.getElementById('lista-modelos');
  if (!_modelos.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty">Nenhum modelo. Crie o Treino A, B, C… e reaproveite nas aulas.</div></td></tr>';
    return;
  }
  tb.innerHTML = _modelos.map(m => `
    <tr>
      <td><b>${esc(m.nome)}</b>${m.ativo ? '' : ' <span class="muted">(inativo)</span>'}</td>
      <td>${esc(m.tipo || '—')}</td>
      <td>${esc(m.foco || '—')}</td>
      <td class="right">${m.qtd_exercicios || 0}</td>
      <td class="right"><button class="btn btn-sm" onclick="abrirModelo(${m.id})">Abrir</button></td>
    </tr>`).join('');
}

function novoModelo() {
  ['mo-id','mo-nome','mo-foco','mo-obs'].forEach(i => setVal(i, ''));
  setVal('mo-tipo', '');
  document.getElementById('mo-ex').innerHTML = '';
  document.getElementById('m-mod-titulo').textContent = 'Novo modelo';
  document.getElementById('mo-btn-del').style.display = 'none';
  addLinhaEx('mo-ex');
  abrirModal('m-mod');
}

async function abrirModelo(id) {
  try {
    const m = await api('GET', `/api/modelos/${id}`);
    setVal('mo-id', m.id); setVal('mo-nome', m.nome); setVal('mo-tipo', m.tipo || '');
    setVal('mo-foco', m.foco || ''); setVal('mo-obs', m.obs || '');
    document.getElementById('mo-ex').innerHTML = '';
    (m.itens || []).forEach(it => addLinhaEx('mo-ex', it));
    document.getElementById('m-mod-titulo').textContent = m.nome;
    document.getElementById('mo-btn-del').style.display = '';
    abrirModal('m-mod');
  } catch (e) { toast(e.message, 'err'); }
}

async function salvarModelo() {
  if (!val('mo-nome')) return toast('Informe o nome do modelo', 'err');
  const body = {
    nome: val('mo-nome'), tipo: val('mo-tipo') || null, foco: val('mo-foco') || null,
    obs: val('mo-obs') || null, ativo: true, itens: coletarEx('mo-ex')
  };
  try {
    const id = val('mo-id');
    if (id) await api('PUT', `/api/modelos/${id}`, body);
    else await api('POST', '/api/modelos', body);
    fecharModal('m-mod'); toast('Modelo salvo'); loadModelos();
  } catch (e) { toast(e.message, 'err'); }
}

async function excluirModelo() {
  const id = val('mo-id');
  if (!id || !confirm('Excluir este modelo? As aulas já montadas com ele não são afetadas.')) return;
  try { await api('DELETE', `/api/modelos/${id}`); fecharModal('m-mod'); toast('Modelo excluído'); loadModelos(); }
  catch (e) { toast(e.message, 'err'); }
}

// ── Exercícios ────────────────────────────────────────────────────────────────
async function loadExercicios() {
  try { await carregarExercicios(); renderExercicios(); } catch (e) { toast(e.message, 'err'); }
}

function renderExercicios() {
  const g = val('f-grupo'), b = val('f-ex-busca').toLowerCase();
  const linhas = _exercicios.filter(e =>
    (!g || e.grupo === g) &&
    (!b || (e.nome + ' ' + (e.equipamento || '') + ' ' + (e.descricao || '')).toLowerCase().includes(b)));
  const tb = document.getElementById('lista-exercicios');
  if (!linhas.length) { tb.innerHTML = '<tr><td colspan="5"><div class="empty">Nenhum exercício encontrado.</div></td></tr>'; return; }
  tb.innerHTML = linhas.map(e => `
    <tr>
      <td><b>${esc(e.nome)}</b>${e.video_url ? ` <a href="${esc(e.video_url)}" target="_blank" rel="noopener">▶</a>` : ''}</td>
      <td>${esc(e.grupo || '—')}</td>
      <td>${esc(e.equipamento || '—')}</td>
      <td class="muted">${esc((e.descricao || '').slice(0, 90))}</td>
      <td class="right"><button class="btn btn-sm" onclick="abrirExercicio(${e.id})">Editar</button></td>
    </tr>`).join('');
}

function novoExercicio() {
  ['e-id','e-nome','e-desc','e-video'].forEach(i => setVal(i, ''));
  setVal('e-grupo', ''); setVal('e-equip', '');
  document.getElementById('m-ex-titulo').textContent = 'Novo exercício';
  abrirModal('m-ex');
}

function abrirExercicio(id) {
  const e = _exercicios.find(x => x.id === id);
  if (!e) return;
  setVal('e-id', e.id); setVal('e-nome', e.nome); setVal('e-grupo', e.grupo || '');
  setVal('e-equip', e.equipamento || ''); setVal('e-desc', e.descricao || ''); setVal('e-video', e.video_url || '');
  document.getElementById('m-ex-titulo').textContent = e.nome;
  abrirModal('m-ex');
}

async function salvarExercicio() {
  if (!val('e-nome')) return toast('Informe o nome', 'err');
  const body = {
    nome: val('e-nome'), grupo: val('e-grupo') || null, equipamento: val('e-equip') || null,
    descricao: val('e-desc') || null, video_url: val('e-video') || null, ativo: true
  };
  try {
    const id = val('e-id');
    if (id) await api('PATCH', `/api/exercicios/${id}`, body);
    else await api('POST', '/api/exercicios', body);
    fecharModal('m-ex'); toast('Exercício salvo'); loadExercicios();
  } catch (e) { toast(e.message, 'err'); }
}

// ══════════════════════════════ FREQUÊNCIA ═══════════════════════════════════
const CORES = { verde: '#16A34A', azul: '#0EA5E9', vermelho: '#DC2626', cinza: '#94A3B8', laranja: '#F97316' };
const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function novoChart(ref, ctxId, config) {
  if (typeof Chart === 'undefined') return null;   // CDN do Chart.js indisponível
  if (ref) ref.destroy();
  return new Chart(document.getElementById(ctxId), config);
}

async function loadFrequencia() {
  if (typeof Chart === 'undefined') {
    toast('Gráficos indisponíveis (sem conexão com o CDN do Chart.js)', 'warn');
    return;
  }
  try {
    const selAno = document.getElementById('f-ano');
    const ano = selAno.value || new Date().getFullYear();
    const d = await api('GET', `/api/frequencia?ano=${ano}`);
    if (!selAno.options.length || selAno.dataset.anos !== d.anos.join(',')) {
      selAno.innerHTML = d.anos.map(a => `<option>${a}</option>`).join('');
      selAno.dataset.anos = d.anos.join(',');
      selAno.value = d.ano;
    }
    const base = { responsive: true, maintainAspectRatio: false,
                   plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } } };

    _chMensal = novoChart(_chMensal, 'ch-mensal', {
      type: 'bar',
      data: { labels: MESES, datasets: [
        { label: 'Realizadas', data: d.mensal.map(m => m.realizadas), backgroundColor: CORES.verde },
        { label: 'Faltas',     data: d.mensal.map(m => m.faltas),     backgroundColor: CORES.vermelho },
        { label: 'Agendadas',  data: d.mensal.map(m => m.agendadas),  backgroundColor: CORES.azul },
        { label: 'Canceladas', data: d.mensal.map(m => m.canceladas), backgroundColor: CORES.cinza },
      ]},
      options: { ...base, scales: { x: { stacked: true }, y: { stacked: true, ticks: { precision: 0 } } } }
    });

    _chSemanal = novoChart(_chSemanal, 'ch-semanal', {
      type: 'line',
      data: { labels: d.semanal.map(s => fmtData(s.semana).slice(0, 5)),
              datasets: [{ label: 'Aulas realizadas', data: d.semanal.map(s => s.realizadas),
                           borderColor: CORES.verde, backgroundColor: 'rgba(22,163,74,.15)',
                           fill: true, tension: .3 }] },
      options: { ...base, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    _chGrupo = novoChart(_chGrupo, 'ch-grupo', {
      type: 'bar',
      data: { labels: d.por_grupo.map(g => g.grupo),
              datasets: [{ label: 'Séries', data: d.por_grupo.map(g => g.series), backgroundColor: CORES.laranja }] },
      options: { ...base, indexAxis: 'y', plugins: { legend: { display: false } } }
    });

    await loadEvolucao(true);
  } catch (e) { toast(e.message, 'err'); }
}

async function loadEvolucao(recarregarLista = false) {
  const sel = document.getElementById('f-evol');
  try {
    if (recarregarLista || !sel.options.length) {
      const d0 = await api('GET', '/api/evolucao');
      sel.innerHTML = '<option value="">Escolha um exercício…</option>' +
        d0.exercicios.map(n => `<option>${esc(n)}</option>`).join('');
    }
    const ex = sel.value;
    const d = ex ? await api('GET', `/api/evolucao?exercicio=${encodeURIComponent(ex)}`) : { serie: [] };
    _chEvol = novoChart(_chEvol, 'ch-evol', {
      type: 'line',
      data: { labels: d.serie.map(p => fmtData(p.data).slice(0, 5)),
              datasets: [{ label: ex ? `Carga máx — ${ex} (kg)` : 'Carga (kg)',
                           data: d.serie.map(p => p.carga), borderColor: CORES.azul,
                           backgroundColor: 'rgba(14,165,233,.15)', fill: true, tension: .25 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });
  } catch (e) { toast(e.message, 'err'); }
}

// ══════════════════════════════ FINANCEIRO ═══════════════════════════════════
async function loadFinanceiro() {
  const sel = document.getElementById('f-fin-ano');
  const ano = sel.value || new Date().getFullYear();
  try {
    const d = await api('GET', `/api/financeiro?ano=${ano}`);
    if (!sel.options.length) {
      const atual = new Date().getFullYear();
      sel.innerHTML = [atual + 1, atual, atual - 1, atual - 2].map(a => `<option>${a}</option>`).join('');
      sel.value = d.ano;
    }
    const dono = !_user || _user.role === 'aluno';
    document.getElementById('fin-hora').textContent = `Hora-aula vigente: ${fmtR(d.valor_hora)}`;
    document.getElementById('fin-kpis').innerHTML = [
      { l: dono ? 'Pago no ano' : 'A receber no ano', v: fmtR(d.total_valor),
        s: 'todas as aulas que entraram na agenda' },
      { l: 'Virou treino', v: fmtR(d.total_treinado), s: 'aulas efetivamente realizadas' },
      { l: 'Valor perdido', v: fmtR(d.total_perdido), s: 'faltas e cancelamentos — não volta' },
    ].map(c => `<div class="kpi"><div class="kpi-label">${c.l}</div>
                  <div class="kpi-value sm">${c.v}</div><div class="kpi-sub">${c.s}</div></div>`).join('');
    document.getElementById('lista-financeiro').innerHTML = d.meses.map((m, i) => m.aulas ? `
      <tr>
        <td><b>${MESES[i]}</b></td>
        <td class="right">${m.aulas}</td>
        <td class="right"><b>${fmtR(m.valor)}</b></td>
        <td class="right">${m.realizadas || '—'}</td>
        <td class="right">${m.agendadas || '—'}</td>
        <td class="right">${m.perdidas ? `<span style="color:var(--danger)">${m.perdidas} · ${fmtR(m.perdido)}</span>` : '—'}</td>
      </tr>` : '').join('') ||
      '<tr><td colspan="6"><div class="empty">Nenhuma aula neste ano.</div></td></tr>';
  } catch (e) { toast(e.message, 'err'); }
}

// ══════════════════════════════ PACOTES ══════════════════════════════════════
async function loadPlanos() {
  try { await carregarPlanos(); await carregarConfig(); renderPlanos(); } catch (e) { toast(e.message, 'err'); }
}

function renderPlanos() {
  const tb = document.getElementById('lista-planos');
  if (!_planos.length) {
    tb.innerHTML = '<tr><td colspan="8"><div class="empty">Nenhum pacote cadastrado — opcional. Sem pacote, o cálculo usa o valor da hora-aula das Configurações.</div></td></tr>';
    return;
  }
  tb.innerHTML = _planos.map(p => `
    <tr>
      <td><b>${esc(p.nome)}</b>${p.ativo ? '' : ' <span class="muted">(encerrado)</span>'}</td>
      <td>${p.inicio ? fmtData(p.inicio) : '—'} → ${p.fim ? fmtData(p.fim) : '—'}</td>
      <td class="right">${p.valor_hora ? fmtR(p.valor_hora) : (p.valor_aula ? fmtR(p.valor_aula) : '—')}</td>
      <td class="right">${p.aulas_contratadas || 0}</td>
      <td class="right">${p.usadas} <span class="muted">(${p.realizadas}R/${p.faltas}F)</span></td>
      <td class="right"><b style="color:${p.saldo === 0 ? 'var(--danger)' : 'var(--primary)'}">${p.saldo}</b></td>
      <td class="right">${p.freq_semanal || '—'}</td>
      <td class="right"><button class="btn btn-sm" onclick="abrirPlano(${p.id})">Editar</button></td>
    </tr>`).join('');
}

function novoPlano() {
  ['p-id','p-nome','p-inicio','p-fim','p-aulas','p-freq','p-valor','p-hora','p-prof','p-obs'].forEach(i => setVal(i, ''));
  document.getElementById('p-ativo').checked = true;
  document.getElementById('m-plano-titulo').textContent = 'Novo pacote';
  document.getElementById('p-btn-del').style.display = 'none';
  abrirModal('m-plano');
}

function abrirPlano(id) {
  const p = _planos.find(x => x.id === id);
  if (!p) return;
  setVal('p-id', p.id); setVal('p-nome', p.nome); setVal('p-inicio', p.inicio || '');
  setVal('p-fim', p.fim || ''); setVal('p-aulas', p.aulas_contratadas || '');
  setVal('p-freq', p.freq_semanal || ''); setVal('p-valor', p.valor || '');
  setVal('p-hora', p.valor_hora ?? '');
  setVal('p-prof', p.professor || ''); setVal('p-obs', p.obs || '');
  document.getElementById('p-ativo').checked = !!p.ativo;
  document.getElementById('m-plano-titulo').textContent = p.nome;
  document.getElementById('p-btn-del').style.display = '';
  abrirModal('m-plano');
}

async function salvarPlano() {
  if (!val('p-nome')) return toast('Informe o nome do pacote', 'err');
  const body = {
    nome: val('p-nome'), inicio: val('p-inicio') || null, fim: val('p-fim') || null,
    aulas_contratadas: num('p-aulas') || 0, valor: num('p-valor') || 0, valor_hora: num('p-hora'),
    freq_semanal: num('p-freq') || 0, professor: val('p-prof') || null,
    obs: val('p-obs') || null, ativo: document.getElementById('p-ativo').checked
  };
  try {
    const id = val('p-id');
    if (id) await api('PUT', `/api/planos/${id}`, body);
    else await api('POST', '/api/planos', body);
    fecharModal('m-plano'); toast('Pacote salvo'); loadPlanos();
  } catch (e) { toast(e.message, 'err'); }
}

async function excluirPlano() {
  const id = val('p-id');
  if (!id || !confirm('Excluir este pacote? As aulas continuam na agenda.')) return;
  try { await api('DELETE', `/api/planos/${id}`); fecharModal('m-plano'); toast('Pacote excluído'); loadPlanos(); }
  catch (e) { toast(e.message, 'err'); }
}

// ══════════════════════════════ CONFIG ═══════════════════════════════════════
async function trocarSenha() {
  const atual = document.getElementById('sn-atual').value;
  const nova = document.getElementById('sn-nova').value;
  if (!atual || !nova) return toast('Preencha as duas senhas', 'err');
  if (nova.length < 8) return toast('A nova senha deve ter no mínimo 8 caracteres', 'err');
  try {
    await api('POST', '/auth/senha', { senha_atual: atual, nova_senha: nova });
    setVal('sn-atual', ''); setVal('sn-nova', '');
    document.getElementById('aviso-senha').style.display = 'none';
    _user.senha_padrao = false;
    toast('Senha alterada');
  } catch (e) { toast(e.message, 'err'); }
}

async function loadUsuarios() {
  if (!_user || _user.role !== 'aluno') return;
  try {
    const us = await api('GET', '/api/usuarios');
    document.getElementById('lista-usuarios').innerHTML = us.map(u => `
      <tr>
        <td><b>${esc(u.nome)}</b></td>
        <td class="muted">${esc(u.email)}</td>
        <td>${u.role === 'aluno' ? 'Aluno (dono)' : 'Personal'}</td>
        <td><span class="badge ${u.ativo ? 'b-realizada' : 'b-cancelada'}">${u.ativo ? 'ativo' : 'inativo'}</span></td>
        <td class="right">
          <button class="btn btn-sm" onclick="abrirUsuario(${u.id})">Editar</button>
          ${u.id !== _user.id ? `<button class="btn btn-sm btn-danger" onclick="removerUsuario(${u.id})">Remover</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (e) { toast(e.message, 'err'); }
}

let _usuariosCache = [];
function novoUsuario() {
  ['u-id','u-nome','u-email','u-senha'].forEach(i => setVal(i, ''));
  setVal('u-role', 'personal');
  document.getElementById('m-user-titulo').textContent = 'Novo acesso';
  abrirModal('m-user');
}

async function abrirUsuario(id) {
  try {
    _usuariosCache = await api('GET', '/api/usuarios');
    const u = _usuariosCache.find(x => x.id === id);
    if (!u) return;
    setVal('u-id', u.id); setVal('u-nome', u.nome); setVal('u-email', u.email);
    setVal('u-role', u.role); setVal('u-senha', '');
    document.getElementById('m-user-titulo').textContent = u.nome;
    abrirModal('m-user');
  } catch (e) { toast(e.message, 'err'); }
}

async function salvarUsuario() {
  const id = val('u-id');
  const nome = val('u-nome'), email = val('u-email'), role = val('u-role');
  const senha = document.getElementById('u-senha').value;
  if (!nome || !email) return toast('Nome e e-mail são obrigatórios', 'err');
  try {
    if (id) {
      const body = { nome, email, role };
      if (senha) body.nova_senha = senha;
      await api('PATCH', `/api/usuarios/${id}`, body);
    } else {
      if (senha.length < 8) return toast('A senha deve ter no mínimo 8 caracteres', 'err');
      await api('POST', '/api/usuarios', { nome, email, senha, role });
    }
    fecharModal('m-user'); toast('Acesso salvo'); loadUsuarios();
  } catch (e) { toast(e.message, 'err'); }
}

async function removerUsuario(id) {
  if (!confirm('Remover este acesso?')) return;
  try { await api('DELETE', `/api/usuarios/${id}`); toast('Acesso removido'); loadUsuarios(); }
  catch (e) { toast(e.message, 'err'); }
}
