// FITPLAN — SPA (vanilla JS). Aplicação independente do PLANGEST.

// ── Estado ────────────────────────────────────────────────────────────────────
let _user = null;
let _mesRef = new Date();              // mês exibido no calendário
let _aulas = [], _exercicios = [], _modelos = [], _planos = [];
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
const TITULOS = { agenda:'Agenda', treinos:'Treinos', frequencia:'Frequência', planos:'Planos', config:'Configurações' };

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
  if (page === 'planos') loadPlanos();
  if (page === 'config') loadUsuarios();
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
  document.getElementById('card-usuarios').style.display = _user.role === 'aluno' ? '' : 'none';
  await Promise.all([carregarExercicios(), carregarModelos(), carregarPlanos()]);
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

// ══════════════════════════════ AGENDA ═══════════════════════════════════════
function mesRefStr() { return `${_mesRef.getFullYear()}-${String(_mesRef.getMonth()+1).padStart(2,'0')}`; }

async function loadAgenda() {
  const mes = mesRefStr();
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
      s: (r.meta_mes ? `meta ${r.meta_mes} · ` : '') + `${r.agendadas} agendadas · ${r.faltas} falta(s)` },
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
  document.getElementById('kpis').innerHTML = cards.map(c => `
    <div class="kpi">
      <div class="kpi-label">${c.l}</div>
      <div class="kpi-value${c.sm ? ' sm' : ''}">${c.v}</div>
      <div class="kpi-sub">${c.s}</div>
    </div>`).join('');
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
      <div class="chip chip-${a.status}" onclick="event.stopPropagation();abrirAula(${a.id})"
           title="${esc((a.hora||'') + ' ' + (a.tipo||'') + ' ' + (a.foco||''))}">
        ${a.hora ? `<span class="chip-hora">${a.hora}</span> ` : ''}<span class="chip-txt">${esc(a.tipo || a.foco || 'Aula')}</span>
      </div>`).join('');
    html += `<div class="cal-day ${fora ? 'out' : ''} ${k === hojeIso ? 'today' : ''}" onclick="novaAula('${k}')">
               <div class="cal-num">${d.getDate()}</div>${chips}
             </div>`;
  }
  document.getElementById('cal').innerHTML = html;
}

function renderLista() {
  const f = val('f-status');
  const linhas = _aulas.filter(a => !f || a.status === f);
  const tb = document.getElementById('lista-aulas');
  if (!linhas.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty">Nenhuma aula neste mês. Clique em um dia do calendário para agendar.</div></td></tr>';
    return;
  }
  tb.innerHTML = linhas.map(a => `
    <tr>
      <td><b>${fmtData(a.data)}</b> <span class="muted">${diaSemana(a.data)}</span></td>
      <td>${a.hora || '—'}</td>
      <td>${esc(a.tipo || '—')}</td>
      <td>${esc(a.foco || a.descricao || '—')}</td>
      <td class="right">${a.qtd_exercicios || 0}</td>
      <td><span class="badge b-${a.status}">${a.status}</span></td>
      <td class="right">
        ${a.status === 'agendada' ? `<button class="btn btn-sm btn-primary" onclick="marcar(${a.id},'realizada')">Realizada</button>` : ''}
        <button class="btn btn-sm" onclick="abrirAula(${a.id})">Abrir</button>
      </td>
    </tr>`).join('');
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
  ['a-id','a-hora','a-foco','a-local','a-professor','a-pse','a-descricao','a-obs'].forEach(i => setVal(i, ''));
  setVal('a-duracao', 60); setVal('a-status', 'agendada'); setVal('a-tipo', '');
  setVal('a-plano', ''); setVal('a-modelo', ''); setVal('a-repetir', 0);
  document.querySelectorAll('#a-dias input').forEach(c => c.checked = false);
  document.getElementById('a-ex').innerHTML = '';
  document.getElementById('a-aplicar-modelo').value = '';
}

function novaAula(dataIso) {
  limparAula();
  const planoAtivo = _planos.find(p => p.ativo);
  setVal('a-data', dataIso || iso(new Date()));
  if (planoAtivo) { setVal('a-plano', planoAtivo.id); setVal('a-professor', planoAtivo.professor || ''); }
  document.getElementById('m-aula-titulo').textContent = 'Nova aula';
  document.getElementById('a-btn-del').style.display = 'none';
  document.getElementById('a-recorrencia').style.display = '';
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
    (a.exercicios || []).forEach(it => addLinhaEx('a-ex', it));
    document.getElementById('m-aula-titulo').textContent = `Aula de ${fmtData(a.data)}`;
    document.getElementById('a-btn-del').style.display = '';
    document.getElementById('a-recorrencia').style.display = 'none';   // recorrência só na criação
    abrirModal('m-aula');
  } catch (e) { toast(e.message, 'err'); }
}

async function salvarAula() {
  const id = val('a-id');
  if (!val('a-data')) return toast('Informe a data', 'err');
  const body = {
    data: val('a-data'), hora: val('a-hora') || null, duracao_min: num('a-duracao') || 60,
    tipo: val('a-tipo') || null, foco: val('a-foco') || null, local: val('a-local') || null,
    professor: val('a-professor') || null, status: val('a-status'),
    plano_id: num('a-plano'), modelo_id: num('a-modelo'),
    descricao: val('a-descricao') || null, obs: val('a-obs') || null, pse: num('a-pse')
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
    // Exercícios só são gravados na aula "base" (a recorrência copia o modelo, quando houver)
    const itens = coletarEx('a-ex');
    if (itens.length || id) await api('PUT', `/api/aulas/${aulaId}/exercicios`, itens);
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

// ══════════════════════════════ PLANOS ═══════════════════════════════════════
async function loadPlanos() {
  try { await carregarPlanos(); renderPlanos(); } catch (e) { toast(e.message, 'err'); }
}

function renderPlanos() {
  const tb = document.getElementById('lista-planos');
  if (!_planos.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty">Nenhum pacote cadastrado. Cadastre para acompanhar saldo de aulas e custo por aula.</div></td></tr>';
    return;
  }
  tb.innerHTML = _planos.map(p => `
    <tr>
      <td><b>${esc(p.nome)}</b>${p.ativo ? '' : ' <span class="muted">(encerrado)</span>'}</td>
      <td>${p.inicio ? fmtData(p.inicio) : '—'} → ${p.fim ? fmtData(p.fim) : '—'}</td>
      <td class="right">${p.aulas_contratadas || 0}</td>
      <td class="right">${p.usadas} <span class="muted">(${p.realizadas}R/${p.faltas}F)</span></td>
      <td class="right"><b style="color:${p.saldo === 0 ? 'var(--danger)' : 'var(--primary)'}">${p.saldo}</b></td>
      <td class="right">${p.freq_semanal || '—'}</td>
      <td class="right">${p.valor ? fmtR(p.valor) : '—'}</td>
      <td class="right">${p.valor_aula ? fmtR(p.valor_aula) : '—'}</td>
      <td class="right"><button class="btn btn-sm" onclick="abrirPlano(${p.id})">Editar</button></td>
    </tr>`).join('');
}

function novoPlano() {
  ['p-id','p-nome','p-inicio','p-fim','p-aulas','p-freq','p-valor','p-prof','p-obs'].forEach(i => setVal(i, ''));
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
    aulas_contratadas: num('p-aulas') || 0, valor: num('p-valor') || 0,
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
  try {
    await api('POST', '/auth/senha', { senha_atual: atual, nova_senha: nova });
    setVal('sn-atual', ''); setVal('sn-nova', '');
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
      if (senha.length < 6) return toast('A senha deve ter no mínimo 6 caracteres', 'err');
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
