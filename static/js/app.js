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
// 'YYYY-MM' → 'setembro/2026'. Referência de mês é para ler, não para decifrar.
function fmtMes(s) {
  if (!s) return '—';
  const [a, m] = s.split('-');
  const nome = ['janeiro','fevereiro','março','abril','maio','junho','julho',
                'agosto','setembro','outubro','novembro','dezembro'][Number(m) - 1];
  return nome ? `${nome}/${a}` : s;
}
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
const TITULOS = { agenda:'Agenda', treinos:'Treinos', frequencia:'Progresso', financeiro:'Financeiro', config:'Configurações' };

function nav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // sidebar (desktop) e barra inferior (celular) compartilham o mesmo data-page
  document.querySelectorAll('.nav-item, .tabbar-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll(`[data-page="${page}"]`).forEach(n => n.classList.add('active'));
  document.getElementById('page-title').textContent = TITULOS[page];
  // as ações da barra superior pertencem à Agenda; nas outras páginas elas só
  // roubavam largura do título
  const naAgenda = page === 'agenda';
  ['btn-dias', 'btn-nova-aula'].forEach(i => {
    const el = document.getElementById(i);
    if (el) el.style.display = naAgenda ? '' : 'none';
  });
  fecharMenu();
  if (page === 'agenda') loadAgenda();
  if (page === 'treinos') { loadExercicios(); loadModelos(); }
  if (page === 'frequencia') loadFrequencia();
  if (page === 'financeiro') { loadFinanceiro(); loadPlanos(); loadPix(); }
  if (page === 'config') { loadConfig(); loadUsuarios(); renderCadastros(); }
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
  await Promise.all([carregarExercicios(), carregarModelos(), carregarPlanos(),
                     carregarConfig(), carregarCadastros()]);
  loadAgenda();
  // Por cima de tudo: o aviso de pagamento é a única coisa no app que a outra pessoa
  // está esperando de você.
  verificarAvisosPix();
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
  const sel = document.getElementById('f-grupo');   // some quando a biblioteca usa o catálogo
  if (sel) {
    const grupos = [...new Set(_exercicios.map(e => e.grupo).filter(Boolean))].sort();
    const atual = sel.value;
    sel.innerHTML = '<option value="">Todos os grupos</option>' + grupos.map(g => `<option>${esc(g)}</option>`).join('');
    sel.value = atual;
  }
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
  document.getElementById('cfg-usuario').textContent = _user.nome || '';
  document.getElementById('cfg-usuario-sub').textContent =
    `${_user.email || ''} · ${_user.role === 'aluno' ? 'Aluno (dono da conta)' : 'Personal'}`;
  setVal('cfg-valor', _cfg.valor_hora || '');
  setVal('cfg-hora', _cfg.hora_padrao || '');
  setVal('cfg-duracao', _cfg.duracao_padrao || 60);
  setVal('cfg-prof', _cfg.professor_padrao || '');
  setVal('cfg-local', _cfg.local_padrao || '');
  setVal('cfg-altura', _cfg.altura_cm || '');
  setVal('cfg-meta', _cfg.peso_meta || '');
  // O personal enxerga o valor (é o que ele recebe), mas quem define o preço é o dono
  const dono = !!_cfg.pode_editar;
  ['cfg-valor','cfg-hora','cfg-duracao','cfg-prof','cfg-local','cfg-altura','cfg-meta']
    .forEach(i => document.getElementById(i).disabled = !dono);
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
      local_padrao: val('cfg-local'),
      altura_cm: num('cfg-altura') || 0,
      peso_meta: num('cfg-meta') || 0
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
    _resumoMes = resumo;
    renderKpis(resumo);
    renderPainel(resumo);
    renderCal();
    renderLista();
    carregarHoje();
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
    s: `${f.aulas_pagas || 0} ${f.aulas_pagas === 1 ? 'aula' : 'aulas'} × ${fmtR(f.valor_hora || 0)} · ${fmtR(f.a_treinar || 0)} ainda por treinar`
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

// A aula já começou? Só depois disso ela pode ser dada como feita ou como falta.
// Aula sem horário conta a partir do início do dia.
function jaComecou(dataIso, hora) {
  if (!dataIso) return false;
  return new Date(`${dataIso.slice(0, 10)}T${(hora || '00:00')}:00`) <= new Date();
}

// O personal monta qualquer treino; o aluno monta só o que treina sozinho.
function podeMontarTreino(modalidade) {
  if (_user && _user.role === 'personal') return true;
  return podeMontarMod(modalidade);
}

// Letra + cor + forma por modalidade: P azul redondo, I verde quadrado,
// A laranja losango. Cor sozinha falha de relance e para quem enxerga mal cor.
// Tipo de treino por modalidade. Corrida não se classifica em "Hipertrofia" e
// musculação não se classifica em "Intervalado": misturar as duas listas obriga
// a rolar por sete opções erradas para achar a certa.
const TIPOS_TREINO = {
  forca:   ['Força', 'Hipertrofia', 'Funcional', 'HIIT', 'Cardio', 'Mobilidade', 'Avaliação'],
  // Vocabulário de treinador de corrida, na ordem em que costuma prescrever.
  corrida: ['Caminhada', 'Longo', 'Intervalado', 'Tiros', 'Ritmo', 'Progressivo',
            'Regenerativo', 'Subida', 'Prova / teste']
};

// Monta a lista do tipo mantendo o valor atual como opção mesmo que ele não
// pertença ao conjunto — trocar de modalidade não pode apagar o que já estava
// escolhido sem o usuário ver.
function preencherTipos(modalidade, valor) {
  const sel = document.getElementById('a-tipo');
  if (!sel) return;
  const lista = [...TIPOS_TREINO[ehAerobico(modalidade) ? 'corrida' : 'forca']];
  if (valor && !lista.includes(valor)) lista.unshift(valor);
  sel.innerHTML = '<option value="">—</option>' + lista.map(t =>
    `<option${t === valor ? ' selected' : ''}>${esc(t)}</option>`).join('');
  sel.value = valor || '';
}

const MODO_BADGE = {
  com_personal: { l: 'P', cls: 'modo-p', t: 'Com o personal' },
  sozinho:      { l: 'I', cls: 'modo-i', t: 'Individual — você treina sozinho' },
  aerobico:     { l: 'A', cls: 'modo-a', t: 'Aeróbico — corrida prescrita pelo treinador' }
};

const ROTULO_MOD = { com_personal: 'Com o personal', sozinho: 'Sozinho', aerobico: 'Aeróbico' };
function rotuloModalidade(m) { return ROTULO_MOD[m || 'com_personal'] || 'Com o personal'; }
function ehAerobico(m) { return (m || '') === 'aerobico'; }
function podeMontarMod(m) { return ['sozinho', 'aerobico'].includes(m || 'com_personal'); }

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
      <div class="chip chip-${a.status}${semTreino(a) ? ' pend' : ''}${(a.modalidade === 'sozinho') ? ' solo' : ''}${ehAerobico(a.modalidade) ? ' aer' : ''}" onclick="event.stopPropagation();abrirAula(${a.id})"
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
    const mod = MODO_BADGE[a.modalidade || 'com_personal'] || MODO_BADGE.com_personal;
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
      <td class="c-modo"><span class="modo ${mod.cls}" title="${mod.t}"><span>${mod.l}</span></span></td>
      <td class="c-treino">${treino}${nEx}</td>
      <td class="c-st"><span class="st b-${a.status}" title="${st.t}">${st.i}</span></td>
      <td class="right c-acoes">
        ${a.status === 'agendada' && jaComecou(a.data, a.hora)
          ? `<button class="ic" title="Marcar treino como feito"
                     onclick="event.stopPropagation();marcar(${a.id},'realizada')">✅</button>` : ''}
        ${a.status === 'agendada' && !jaComecou(a.data, a.hora)
          ? `<button class="ic" title="Remarcar para outro dia do mês"
                     onclick="event.stopPropagation();abrirAula(${a.id}, true)">🔁</button>` : ''}
      </td>
    </tr>`; }).join('');
}

async function marcar(id, status) {
  // Treino feito é fato consumado. Em vez do confirm() do navegador, abre o
  // modal de conclusão: mesma confirmação, e aproveita o único momento em que
  // energia, fadiga e esforço têm resposta confiável.
  if (status === 'realizada') return abrirConclusao(id);
  try {
    await api('PATCH', `/api/aulas/${id}`, { status });
    toast(status === 'realizada' ? 'Treino registrado como feito' : 'Aula marcada como ' + status);
    loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Modal de aula ─────────────────────────────────────────────────────────────
function limparAula() {
  const sg = document.getElementById('a-aviso-sugestao');
  if (sg) sg.style.display = 'none';
  ['a-id','a-hora','a-foco','a-descricao','a-obs','a-valor',
   'a-aer-texto','a-distancia','a-tempo'].forEach(i => setVal(i, ''));
  document.getElementById('a-pse').innerHTML = opcoesEscala(PSE_ESCALA, '');
  document.getElementById('a-energia').innerHTML = opcoesEscala(NIVEIS, '');
  document.getElementById('a-fadiga').innerHTML = opcoesEscala(NIVEIS, '');
  preencherCad('a-professor', 'professor', ''); preencherCad('a-local', 'local', '');
  setVal('a-duracao', 60); setVal('a-status', 'agendada');
  preencherTipos('com_personal', '');
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
  preencherCad('a-professor', 'professor', _cfg.professor_padrao || '');
  preencherCad('a-local', 'local', _cfg.local_padrao || '');
  // O valor não aparece na hora de marcar (é o da configuração vigente), mas
  // continua sendo enviado: é ele que fecha o mês no Financeiro.
  setVal('a-valor', _cfg.valor_hora_vigente || _cfg.valor_hora || '');
  if (planoAtivo) {
    setVal('a-plano', planoAtivo.id);
    if (planoAtivo.professor) preencherCad('a-professor', 'professor', planoAtivo.professor);
  }
  document.getElementById('m-aula-titulo').textContent = 'Nova aula';
  document.getElementById('a-btn-del').style.display = 'none';
  document.getElementById('a-recorrencia').style.display = '';
  aplicarModoAula();
  abrirModal('m-aula');
}

async function abrirAula(id, remarcar) {
  try {
    const a = await api('GET', `/api/aulas/${id}`);
    limparAula();
    setVal('a-id', a.id); setVal('a-data', a.data); setVal('a-hora', a.hora || '');
    setVal('a-duracao', a.duracao_min || 60); setVal('a-status', a.status);
    preencherTipos(a.modalidade, a.tipo || ''); setVal('a-foco', a.foco || '');
    preencherCad('a-local', 'local', a.local || '');
    preencherCad('a-professor', 'professor', a.professor || '');
    setVal('a-plano', a.plano_id || ''); setVal('a-modelo', a.modelo_id || '');
    document.getElementById('a-pse').innerHTML = opcoesEscala(PSE_ESCALA, a.pse);
    document.getElementById('a-energia').innerHTML = opcoesEscala(NIVEIS, a.energia);
    document.getElementById('a-fadiga').innerHTML = opcoesEscala(NIVEIS, a.fadiga);
    setVal('a-descricao', a.descricao || ''); setVal('a-obs', a.obs || '');
    setVal('a-aer-texto', a.descricao || '');
    setVal('a-distancia', a.distancia_km ?? ''); setVal('a-tempo', a.tempo_min ?? '');
    setVal('a-valor', a.valor ?? '');
    setVal('a-modalidade', a.modalidade || 'com_personal');
    (a.exercicios || []).forEach(it => addLinhaEx('a-ex', it));
    document.getElementById('m-aula-titulo').textContent = `Aula de ${fmtData(a.data)}`;
    document.getElementById('a-btn-del').style.display = '';
    document.getElementById('a-recorrencia').style.display = 'none';   // recorrência só na criação
    aplicarModoAula();
    renderSugestao(a);
    abrirModal('m-aula');
    // veio do botão de remarcar: leva direto ao campo da data
    if (remarcar) setTimeout(() => {
      const d = document.getElementById('a-data');
      d.scrollIntoView({ block: 'center' });
      d.focus();
      try { d.showPicker(); } catch (e) {}
    }, 150);
  } catch (e) { toast(e.message, 'err'); }
}

// Ajusta o modal ao que o usuário logado pode fazer nesta aula.
// Aula com o personal, na visão do aluno: o treino é leitura; o que é dele são
// data, status e feedback.
function aplicarModoAula() {
  // Na hora de MARCAR a aula, três campos não têm resposta possível ainda:
  //   • status  — aula nova nasce agendada; mudar isso é decisão de depois;
  //   • PSE     — só existe quando o treino termina;
  //   • valor   — vem da configuração vigente e é gravado sozinho.
  // Eles voltam ao editar uma aula que já existe, e o PSE só depois que ela começou.
  const novo = !val('a-id');
  const comecou = jaComecou(val('a-data'), val('a-hora'));
  document.getElementById('w-status').style.display = novo ? 'none' : '';
  // Energia, fadiga e esforço acompanham o PSE: só existem depois que o treino
  // aconteceu. Na hora de marcar a aula não há resposta possível.
  ['w-pse', 'w-energia', 'w-fadiga'].forEach(i =>
    document.getElementById(i).style.display = (novo || !comecou) ? 'none' : '');
  // Regra única: treino que não é com o personal contratado não tem professor,
  // não consome pacote e não custa.
  const proprio = podeMontarMod(val('a-modalidade'));
  const aer = ehAerobico(val('a-modalidade'));
  document.getElementById('w-valor').style.display = (novo || proprio) ? 'none' : '';
  document.getElementById('w-professor').style.display = proprio ? 'none' : '';
  document.getElementById('w-plano').style.display = proprio ? 'none' : '';
  // Corrida não tem série × carga: troca o bloco de exercícios pela prescrição
  // em texto, que é a forma em que ela chega do treinador.
  preencherTipos(val('a-modalidade'), val('a-tipo'));
  document.getElementById('a-aer-bloco').style.display = aer ? '' : 'none';
  document.getElementById('a-ex-bloco').style.display = aer ? 'none' : '';
  document.getElementById('a-aer-result').style.display = (novo || !comecou) ? 'none' : '';
  atualizarPace();
  // Aula já feita: só entram esforço, observações e a execução dos exercícios.
  // Só trava se a aula realmente aconteceu — "feita" num horário futuro é dado
  // inconsistente e precisa continuar corrigível.
  const concluida = val('a-status') === 'realizada' && !!val('a-id')
                    && jaComecou(val('a-data'), val('a-hora'));
  // Quem monta o treino continua podendo corrigi-lo DEPOIS de feito: num treino
  // individual o aluno é autor e executor, e o que ele fez pode não ser o que
  // estava escrito antes. O que a aula FOI (data, hora, status, modalidade,
  // valor) segue congelado — é isso que o "feito não se desfaz" protege.
  const pode = podeMontarTreino(val('a-modalidade'));
  // "Realizada" e "Falta" afirmam que o horário passou — indisponíveis antes disso
  const passou = jaComecou(val('a-data'), val('a-hora'));
  const sel = document.getElementById('a-status');
  [...sel.options].forEach(o => {
    const futuro = !passou && (o.value === 'realizada' || o.value === 'falta');
    o.disabled = futuro;
    o.textContent = o.textContent.replace(/ — ainda não começou$/, '') + (futuro ? ' — ainda não começou' : '');
  });
  if (!passou && (sel.value === 'realizada' || sel.value === 'falta')) sel.value = 'agendada';
  document.getElementById('a-aviso-futuro').style.display = (passou || concluida) ? 'none' : '';
  const avisoFeito = document.getElementById('a-aviso-feito');
  avisoFeito.style.display = concluida ? '' : 'none';
  if (concluida) {
    avisoFeito.innerHTML = pode
      ? `<b>Treino feito.</b> A data, o horário e o status não mudam mais.
         Como <b>o treino é seu</b>, você continua podendo corrigir os exercícios,
         as cargas e as observações — para o registro bater com o que realmente aconteceu.`
      : `<b>Treino feito.</b> Isso não se desfaz. O que ainda dá para registrar aqui:
         a <b>percepção de esforço</b>, as <b>observações</b> de como foi, e em cada
         exercício a <b>carga usada</b>, a observação e o que foi <b>feito</b>.`;
  }
  // campos que descrevem QUANDO e COMO a aula foi contratada ficam congelados
  ['a-data', 'a-hora', 'a-status', 'a-modalidade', 'a-valor',
   'a-duracao', 'a-local', 'a-professor', 'a-plano'].forEach(i => {
    const el = document.getElementById(i);
    if (el && concluida) el.disabled = true;
  });
  document.getElementById('a-btn-del').style.display =
    (val('a-id') && !concluida) ? '' : 'none';
  // Campos que pertencem ao personal. Ficam travados para o aluno em aula com o
  // personal — o backend também os recusa, e campo editável que não salva é pior
  // do que campo travado.
  ['a-tipo', 'a-foco', 'a-descricao', 'a-modelo', 'a-duracao', 'a-local', 'a-professor', 'a-plano'].forEach(i => {
    const el = document.getElementById(i);
    if (el) el.disabled = !pode || (concluida && !['a-tipo','a-foco','a-descricao','a-modelo'].includes(i));
  });
  document.getElementById('a-aer-texto').disabled = !pode;
  document.getElementById('a-ex-acoes').style.display = pode ? '' : 'none';
  // "Aplicar modelo" troca a lista inteira e apagaria as cargas já lançadas —
  // some depois de a aula ser concluída. "+ Exercício" continua.
  document.getElementById('a-aplicar-modelo').style.display = concluida ? 'none' : '';
  document.getElementById('a-ex-aviso').style.display = pode ? 'none' : '';
  // linhas de exercício viram somente leitura (o "feito" continua marcável)
  // Prescrição (nome, séries, reps, descanso) x execução (carga, obs, feito).
  // Quem não pode montar o treino ainda registra o que aconteceu.
  document.querySelectorAll('#a-ex .ex-row').forEach(row => {
    row.querySelectorAll('input, select').forEach(el => {
      const execucao = ['ex-feito', 'ex-carga', 'ex-obs'].some(c => el.classList.contains(c));
      el.disabled = execucao ? false : !pode;
    });
    const del = row.querySelector('.ex-del');
    if (del) del.style.display = pode ? '' : 'none';
  });
}

async function salvarAula() {
  const id = val('a-id');
  if (!val('a-data')) return toast('Informe a data', 'err');
  const concluida = val('a-status') === 'realizada' && !!id
                    && jaComecou(val('a-data'), val('a-hora'));
  // Mesma regra de aplicarModoAula: quem MONTA o treino continua podendo
  // corrigi-lo depois de feito. As duas funções precisam concordar — se só a
  // tela liberar, o formulário parece editável e o salvamento descarta a edição.
  const pode = podeMontarTreino(val('a-modalidade'));
  // Aula já feita: só o registro do que aconteceu.
  // Numa aula do personal, o aluno só envia o que é dele — o backend recusa o resto
  // Como o corpo estava ao fim do treino — do aluno, em qualquer modalidade
  const aer = ehAerobico(val('a-modalidade'));
  const feedback = {
    obs: val('a-obs') || null, pse: num('a-pse'),
    energia: num('a-energia'), fadiga: num('a-fadiga')
  };
  if (aer) { feedback.distancia_km = num('a-distancia'); feedback.tempo_min = num('a-tempo'); }
  // A prescrição da corrida mora em descricao — é o mesmo campo, em outra caixa.
  const descricao = aer ? (val('a-aer-texto') || null) : (val('a-descricao') || null);
  const body = concluida ? (pode ? {
    // Autor do treino corrigindo o que de fato foi feito
    ...feedback,
    tipo: val('a-tipo') || null, foco: val('a-foco') || null,
    descricao, modelo_id: num('a-modelo')
  } : { ...feedback }) : pode ? {
    data: val('a-data'), hora: val('a-hora') || null, duracao_min: num('a-duracao') || 60,
    tipo: val('a-tipo') || null, foco: val('a-foco') || null, local: val('a-local') || null,
    // Campos escondidos no modo sozinho vão nulos: campo oculto que continua
    // enviando o valor antigo é como o dado fica inconsistente sem ninguém ver.
    professor: val('a-modalidade') === 'sozinho' ? null : (val('a-professor') || null),
    status: val('a-status'),
    modalidade: val('a-modalidade'),
    plano_id: val('a-modalidade') === 'sozinho' ? null : num('a-plano'),
    modelo_id: num('a-modelo'),
    descricao, valor: num('a-valor'), ...feedback
  } : {
    data: val('a-data'), hora: val('a-hora') || null, status: val('a-status'),
    modalidade: val('a-modalidade'), valor: num('a-valor'), ...feedback
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
    // Exercícios: quem monta o treino grava a lista inteira; quem não monta
    // (aula do personal, ou aula já concluída) registra só a execução de cada item.
    if (pode && !aer) {
      const itens = coletarEx('a-ex');
      if (itens.length || id) await api('PUT', `/api/aulas/${aulaId}/exercicios`, itens);
    } else if (id) {
      await salvarExecucoes(aulaId);
    }
    fecharModal('m-aula');
    toast('Aula salva');
    loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

// Envia só o que aconteceu em cada exercício — sem tocar na prescrição
async function salvarExecucoes(aulaId) {
  const linhas = [...document.querySelectorAll('#a-ex .ex-row')];
  for (const row of linhas) {
    const eid = row.dataset.itemId;
    if (!eid) continue;
    const carga = row.querySelector('.ex-carga').value.trim();
    await api('PATCH', `/api/aulas/${aulaId}/exercicios/${eid}`, {
      feito: !!row.querySelector('.ex-feito')?.checked,
      carga: carga === '' ? null : Number(carga),
      obs: row.querySelector('.ex-obs').value.trim() || null
    });
  }
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
    // via preencherTipos: o tipo do modelo pode não estar na lista da modalidade,
    // e setVal num <select> sem a opção correspondente não grava nada.
    if (!val('a-tipo') && m.tipo) preencherTipos(val('a-modalidade'), m.tipo);
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
  if (it.id) div.dataset.itemId = it.id;
  const comFeito = containerId === 'a-ex';
  div.innerHTML = `
    <span class="ex-busca-wrap">
      <input class="ex-nome" list="dl-ex" placeholder="Exercício" value="${esc(it.nome || '')}">
      <button type="button" class="ex-lupa" title="Escolher na biblioteca"
              onclick="abrirEscolherEx(this)">🔍</button>
    </span>
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
  preencherCad('dm-prof', 'professor', _dmMod === 'sozinho' ? '' : (_cfg.professor_padrao || ''));
  document.getElementById('dm-prof').closest('div').style.display =
    _dmMod === 'sozinho' ? 'none' : '';
  preencherCad('dm-local', 'local', _cfg.local_padrao || '');
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
    professor: _dmMod === 'sozinho' ? null : (val('dm-prof') || null),
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
      <td class="right">
        <button class="btn btn-sm btn-primary" onclick="usarModelo(${m.id})">Usar em um dia</button>
        <button class="btn btn-sm" onclick="abrirModelo(${m.id})">Abrir</button>
      </td>
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
  try {
    await carregarExercicios();
    _cat.dados = await api('GET', '/api/exercicios/catalogo');
    renderExercicios();
  } catch (e) { toast(e.message, 'err'); }
}

// Catálogo: escolher "Peito" e ver 5 opções é mais rápido do que rolar 38 nomes.
// _cat.aba = grupo | equipamento | favoritos | todos; _cat.sel = valor escolhido.
let _cat = { aba: 'grupo', sel: null, dados: null };

function catAba(aba) {
  _cat.aba = aba; _cat.sel = null;
  document.querySelectorAll('[data-cat]').forEach(t => t.classList.toggle('active', t.dataset.cat === aba));
  renderExercicios();
}

function catVoltar() { _cat.sel = null; renderExercicios(); }

function catEscolher(v) { _cat.sel = v; renderExercicios(); }

async function toggleFavorito(id) {
  try {
    await api('POST', `/api/exercicios/${id}/favorito`);
    await carregarExercicios();
    _cat.dados = await api('GET', '/api/exercicios/catalogo');
    renderExercicios();
  } catch (e) { toast(e.message, 'err'); }
}

function renderExercicios() {
  const busca = val('f-ex-busca').toLowerCase();
  const grade = document.getElementById('cat-grade');
  const wrap = document.getElementById('wrap-exercicios');
  const volta = document.getElementById('cat-volta');
  // Buscar atravessa o catálogo: quem digita já sabe o que quer.
  const emLista = busca || _cat.sel || _cat.aba === 'todos' || _cat.aba === 'favoritos';

  if (!emLista) {
    const chave = _cat.aba === 'grupo' ? 'grupos' : 'equipamentos';
    const itens = (_cat.dados && _cat.dados[chave]) || [];
    grade.style.display = ''; wrap.style.display = 'none'; volta.style.display = 'none';
    grade.innerHTML = itens.length ? itens.map(i => `
      <button class="cat-item" onclick="catEscolher('${esc(i.nome).replace(/'/g, "\\'")}')">
        <span><span class="n">${esc(i.nome)}</span>
        <span class="q">${i.n} ${i.n === 1 ? 'exercício' : 'exercícios'}</span></span>
      </button>`).join('') : '<div class="empty">Biblioteca vazia.</div>';
    return;
  }

  grade.style.display = 'none';
  wrap.style.display = '';
  volta.style.display = (_cat.sel && !busca) ? '' : 'none';
  if (_cat.sel) document.getElementById('cat-titulo').textContent = _cat.sel;

  const campo = _cat.aba === 'equipamento' ? 'equipamento' : 'grupo';
  const linhas = _exercicios.filter(e => {
    if (busca) return (e.nome + ' ' + (e.equipamento || '') + ' ' + (e.descricao || '')).toLowerCase().includes(busca);
    if (_cat.aba === 'favoritos') return !!e.favorito;
    if (_cat.sel) return (e[campo] || 'Sem classificação') === _cat.sel;
    return true;
  });
  const tb = document.getElementById('lista-exercicios');
  if (!linhas.length) {
    tb.innerHTML = `<tr><td colspan="6"><div class="empty">${
      _cat.aba === 'favoritos' ? 'Nenhum favorito ainda — marque a ⭐ dos que você repete sempre.'
                               : 'Nenhum exercício encontrado.'}</div></td></tr>`;
    return;
  }
  tb.innerHTML = linhas.map(e => `
    <tr>
      <td><button class="ex-fav" title="Favorito" onclick="toggleFavorito(${e.id})">${e.favorito ? '⭐' : '☆'}</button></td>
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
  loadCorpo();
  loadAerobico();
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

// ══════════════════════════════ RÉGUA ════════════════════════════════════════
// Seletor de valor por rolagem, no lugar do teclado numérico. Motivo prático:
// no celular, campo numérico abre teclado, o iOS dá zoom e o dedo suado erra o
// alvo. Rolar uma fita funciona em pé, com uma mão, e não muda o zoom da página.
let _rg = { min: 0, max: 100, step: 1, tick: 14, valor: 0, casas: 0, onOk: null, t: null };

function rgFmt(v) { return Number(v).toFixed(_rg.casas).replace('.', ','); }
// Nos rótulos da fita, ",0" só polui: 60 lê melhor que 60,0.
function rgFmtRot(v) { return rgFmt(v).replace(/,0$/, ''); }

function reguaAbrir({ titulo, unidade, min, max, step, valor, onOk }) {
  _rg = { min, max, step, tick: 14, valor: valor ?? min, onOk,
          casas: Number.isInteger(step) ? 0 : 1, t: null };
  document.getElementById('rg-titulo').textContent = titulo || 'Valor';
  document.getElementById('rg-unidade').textContent = unidade || '';
  abrirModal('m-regua');
  requestAnimationFrame(() => rgMontar());
}

function rgMontar() {
  const box = document.getElementById('rg-regua');
  const fita = document.getElementById('rg-fita');
  const W = box.clientWidth || 320;
  const n = Math.round((_rg.max - _rg.min) / _rg.step);
  const larg = n * _rg.tick;
  fita.style.width = (larg + W) + 'px';
  // Traço a cada passo; traço alto + número a cada 10 passos.
  let html = `<div class="regua-escala" style="left:${W / 2}px;width:${larg}px">`;
  for (let i = 0; i <= n; i++) {
    const grande = i % 10 === 0;
    html += `<i style="left:${i * _rg.tick}px;${grande ? 'height:36px;top:0;opacity:1' : 'opacity:.35'}"></i>`;
    if (grande) html += `<b style="left:${i * _rg.tick}px">${rgFmtRot(_rg.min + i * _rg.step)}</b>`;
  }
  fita.innerHTML = html + '</div>';
  box.onscroll = rgRolou;
  box.scrollLeft = Math.round((_rg.valor - _rg.min) / _rg.step) * _rg.tick;
  document.getElementById('rg-valor').textContent = rgFmt(_rg.valor);
}

function rgRolou() {
  const box = document.getElementById('rg-regua');
  const i = Math.max(0, Math.min(Math.round((_rg.max - _rg.min) / _rg.step),
                                 Math.round(box.scrollLeft / _rg.tick)));
  _rg.valor = _rg.min + i * _rg.step;
  document.getElementById('rg-valor').textContent = rgFmt(_rg.valor);
  clearTimeout(_rg.t);
  _rg.t = setTimeout(() => box.scrollTo({ left: i * _rg.tick, behavior: 'smooth' }), 140);
}

function rgConfirmar() {
  const fn = _rg.onOk;
  fecharModal('m-regua');
  if (fn) fn(Number(_rg.valor.toFixed(_rg.casas)));
}

// Atalho: liga a régua a um <input> comum (usado no modal de medidas)
function reguaPara(inputId, titulo, unidade, min, max, step) {
  const el = document.getElementById(inputId);
  reguaAbrir({ titulo, unidade, min, max, step,
    valor: Number(el.value) || (min + max) / 2,
    onOk: v => { el.value = v; } });
}

// ══════════════════════════ TREINO DE HOJE (cartão) ══════════════════════════
async function carregarHoje() {
  const box = document.getElementById('hoje-card');
  try {
    const d = await api('GET', '/api/aulas/hoje');
    const a = d.aula;
    if (!a) {
      box.innerHTML = `<div class="hoje-card">
        <div class="et">Agenda</div>
        <h3>Nenhum treino marcado</h3>
        <div class="sub">Marque os dias do mês para o personal montar os treinos.</div>
        <div class="acoes"><button class="btn btn-primary" onclick="abrirDiasDoMes()">Marcar dias do mês</button></div>
      </div>`;
      return;
    }
    const n = (a.exercicios || []).length;
    const feitos = (a.exercicios || []).filter(e => e.feito).length;
    const quando = d.eh_hoje ? 'Hoje' : `${diaSemana(a.data)} ${fmtDataCurta(a.data)}`;
    const titulo = a.foco || a.tipo || (ehAerobico(a.modalidade) ? 'Treino de corrida'
      : a.modalidade === 'sozinho' ? 'Treino individual' : 'Treino com o personal');
    const linhas = [
      a.hora ? `${a.hora}` : null,
      rotuloModalidade(a.modalidade).toLowerCase(),
      n ? `${n} ${n === 1 ? 'exercício' : 'exercícios'}${feitos ? ` · ${feitos} ${feitos === 1 ? 'feito' : 'feitos'}` : ''}`
        : 'treino ainda não montado'
    ].filter(Boolean).join(' · ');

    const sug = a.sugestao_modelo_id
      ? (_modelos.find(m => m.id === a.sugestao_modelo_id) || {}).nome : null;
    const podeTreinar = n > 0 && a.ja_comecou && a.status !== 'cancelada';
    box.innerHTML = `<div class="hoje-card">
      <div class="et">${d.eh_hoje ? 'Treino de hoje' : 'Próximo treino'}</div>
      <h3>${esc(titulo)}</h3>
      <div class="sub">${esc(quando)} · ${esc(linhas)}</div>
      ${sug ? `<div class="sub" style="margin-top:6px">💡 sugestão do aluno: <b>${esc(sug)}</b></div>` : ''}
      <div class="acoes">
        ${podeTreinar ? `<button class="btn btn-primary" onclick="tmAbrir(${a.id})">Treinar agora</button>` : ''}
        <button class="btn btn-ghost" onclick="abrirAula(${a.id})">
          ${n ? 'Ver treino' : (a.pode_montar ? 'Montar treino' : 'Ver aula')}</button>
      </div>
    </div>`;
  } catch (e) { box.innerHTML = ''; }
}

// ══════════════════════════ PAINEL DO MÊS (barras) ═══════════════════════════
function renderPainel(r) {
  const card = document.getElementById('card-painel');
  const box = document.getElementById('painel-mes');
  const linhas = r.painel || [];
  if (!linhas.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  box.innerHTML = linhas.map(l => `
    <div class="painel-linha ${l.pct === null ? 'vazia' : ''}">
      <span class="r">${esc(l.rotulo)}</span>
      <span class="b"><i style="width:${l.pct === null ? 0 : l.pct}%"></i></span>
      <span class="v">${esc(l.valor || l.texto || '—')}</span>
    </div>`).join('');
}

// ══════════════════════════════ MODO TREINO ══════════════════════════════════
// Uma tela para usar EM PÉ. Carga e repetições já chegam preenchidas (última
// carga e prescrição): no caso comum — mesmo peso da última vez — o único toque
// da série é o ✓.
let _tm = { aula: null, idx: 0, timer: null, restam: 0, pend: {}, aerobico: false };

const TM_PASSO_CARGA = 2.5;   // metade de uma anilha de 5 kg: o ajuste real

async function tmAbrir(aulaId) {
  try {
    _tm.aula = await api('GET', `/api/aulas/${aulaId}`);
  } catch (e) { return toast(e.message, 'err'); }
  _tm.aerobico = ehAerobico(_tm.aula.modalidade);
  if (_tm.aerobico) {
    if (!(_tm.aula.descricao || '').trim())
      return toast('Este treino de corrida ainda não tem prescrição', 'warn');
    document.getElementById('modo-treino').classList.add('open');
    document.body.style.overflow = 'hidden';
    return tmRenderAerobico();
  }
  if (!(_tm.aula.exercicios || []).length) return toast('Este treino ainda não tem exercícios', 'warn');
  // Abre no primeiro exercício que ainda não terminou — retomar de onde parou
  const i = _tm.aula.exercicios.findIndex(e => !e.feito);
  _tm.idx = i < 0 ? 0 : i;
  document.getElementById('modo-treino').classList.add('open');
  document.body.style.overflow = 'hidden';
  tmRender();
}

function tmFechar() {
  tmDescansoParar();
  document.getElementById('modo-treino').classList.remove('open');
  document.body.style.overflow = '';
  loadAgenda();
}

function tmAbrirAula() { const id = _tm.aula.id; tmFechar(); abrirAula(id); }

function tmIr(delta) {
  if (_tm.aerobico) return tmConcluir();
  const n = _tm.aula.exercicios.length;
  if (delta > 0 && _tm.idx === n - 1) return tmConcluir();
  _tm.idx = Math.max(0, Math.min(n - 1, _tm.idx + delta));
  tmRender();
  document.querySelector('#modo-treino .tm-corpo').scrollTop = 0;
}

function tmRepsPrescritas(it) {
  const m = String(it.repeticoes || '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

function tmRender() {
  const a = _tm.aula, it = a.exercicios[_tm.idx];
  document.querySelector('#modo-treino .tm-rot').style.display = '';
  document.getElementById('tm-ant').style.display = '';
  document.getElementById('tm-titulo').textContent = a.foco || a.tipo ||
    (ehAerobico(a.modalidade) ? 'Treino de corrida'
      : a.modalidade === 'sozinho' ? 'Treino individual' : 'Treino com o personal');
  document.getElementById('tm-subtitulo').textContent =
    `${fmtDataCurta(a.data)}${a.hora ? ' · ' + a.hora : ''} · exercício ${_tm.idx + 1} de ${a.exercicios.length}`;

  document.getElementById('tm-passos').innerHTML = a.exercicios.map((e, i) =>
    `<i class="${i === _tm.idx ? 'now' : (e.feito ? 'ok' : '')}"></i>`).join('');

  document.getElementById('tm-ex-nome').textContent = it.nome;

  const chips = [];
  if (it.series || it.repeticoes) chips.push(`${it.series || '?'} × ${it.repeticoes || '?'}`);
  if (it.descanso_seg) chips.push(`descanso ${it.descanso_seg}s`);
  if (it.ultima) chips.push(`<span class="tm-chip ult">última: ${fmtN(it.ultima.carga, 1)} kg${
    it.ultima.repeticoes ? ' × ' + it.ultima.repeticoes : ''} · ${fmtDataCurta(it.ultima.data)}</span>`);
  if (it.obs) chips.push(esc(it.obs));
  const cad = _exercicios.find(e => e.nome === it.nome);
  if (!a.ja_comecou) chips.push('<span class="tm-chip">treino ainda não começou</span>');
  document.getElementById('tm-ex-meta').innerHTML = chips
    .map(c => c.startsWith('<span') ? c : `<span class="tm-chip">${esc(c)}</span>`).join('');

  const comoBox = document.getElementById('tm-como');
  comoBox.textContent = (cad && cad.descricao) ? cad.descricao : '';
  comoBox.style.display = comoBox.textContent ? '' : 'none';

  const sugCarga = it.ultima ? it.ultima.carga : (it.carga || 0);
  const sugReps = tmRepsPrescritas(it);
  const trava = a.ja_comecou ? '' : 'disabled';
  document.getElementById('tm-series').innerHTML = (it.series_reg || []).map(s => {
    const carga = s.carga ?? sugCarga;
    const reps = s.repeticoes ?? sugReps;
    return `<div class="tm-serie ${s.feito ? 'feita' : ''}">
      <span class="tm-serie-n">${s.ordem}</span>
      <span class="tm-campo">
        <button ${trava} onclick="tmAjusta(${s.ordem},'carga',-${TM_PASSO_CARGA})">−</button>
        <button class="tm-valor" ${trava} onclick="tmRegua(${s.ordem},'carga')">${carga ? fmtN(carga, carga % 1 ? 1 : 0) : '—'}</button>
        <span class="tm-un">kg</span>
        <button ${trava} onclick="tmAjusta(${s.ordem},'carga',${TM_PASSO_CARGA})">+</button>
      </span>
      <span class="tm-campo">
        <button ${trava} onclick="tmAjusta(${s.ordem},'repeticoes',-1)">−</button>
        <button class="tm-valor" ${trava} onclick="tmRegua(${s.ordem},'repeticoes')">${reps ?? '—'}</button>
        <button ${trava} onclick="tmAjusta(${s.ordem},'repeticoes',1)">+</button>
      </span>
      <button class="tm-check ${s.feito ? 'on' : ''}" ${trava} onclick="tmMarcar(${s.ordem})">✓</button>
    </div>`;
  }).join('');

  const ultimo = _tm.idx === a.exercicios.length - 1;
  document.getElementById('tm-proximo').textContent = ultimo ? 'Concluir treino' : 'Próximo exercício';
  document.getElementById('tm-ant').disabled = _tm.idx === 0;
}

function tmSerie(ordem) {
  return (_tm.aula.exercicios[_tm.idx].series_reg || []).find(s => s.ordem === ordem);
}

// Valor mostrado hoje na linha (registrado, ou a sugestão que aparece nela)
function tmValorAtual(s, campo) {
  const it = _tm.aula.exercicios[_tm.idx];
  if (s[campo] !== null && s[campo] !== undefined) return s[campo];
  return campo === 'carga' ? (it.ultima ? it.ultima.carga : (it.carga || 0)) : tmRepsPrescritas(it);
}

function tmAjusta(ordem, campo, passo) {
  const s = tmSerie(ordem);
  const base = Number(tmValorAtual(s, campo) || 0);
  const novo = Math.max(0, Math.round((base + passo) * 10) / 10);
  s[campo] = campo === 'repeticoes' ? Math.round(novo) : novo;
  tmRender();
  tmSalvar(ordem, true);
}

function tmRegua(ordem, campo) {
  const s = tmSerie(ordem);
  const carga = campo === 'carga';
  reguaAbrir({
    titulo: carga ? 'Carga' : 'Repetições', unidade: carga ? 'kg' : 'reps',
    min: 0, max: carga ? 300 : 60, step: carga ? 0.5 : 1,
    valor: Number(tmValorAtual(s, campo) || 0),
    onOk: v => { s[campo] = v; tmRender(); tmSalvar(ordem, false); }
  });
}

async function tmMarcar(ordem) {
  const s = tmSerie(ordem);
  const it = _tm.aula.exercicios[_tm.idx];
  const marcando = !s.feito;
  // Ao marcar, congela na série o que está na tela (sugestão vira registro)
  if (marcando) {
    s.carga = Number(tmValorAtual(s, 'carga') || 0) || null;
    s.repeticoes = tmValorAtual(s, 'repeticoes') || null;
  }
  s.feito = marcando ? 1 : 0;
  tmRender();
  await tmSalvar(ordem, false);
  if (marcando && it.descanso_seg) tmDescansoIniciar(it.descanso_seg);
}

async function tmSalvar(ordem, comAtraso) {
  const chave = `${_tm.idx}:${ordem}`;
  clearTimeout(_tm.pend[chave]);
  const envia = async () => {
    const s = tmSerie(ordem);
    const it = _tm.aula.exercicios[_tm.idx];
    try {
      const r = await api('PATCH', `/api/aulas/${_tm.aula.id}/exercicios/${it.id}/series/${ordem}`,
        { carga: s.carga ?? null, repeticoes: s.repeticoes ?? null, feito: !!s.feito });
      it.feito = r.feito; it.carga = r.carga; it.series_reg = r.series_reg;
      document.getElementById('tm-passos').innerHTML = _tm.aula.exercicios.map((e, i) =>
        `<i class="${i === _tm.idx ? 'now' : (e.feito ? 'ok' : '')}"></i>`).join('');
    } catch (e) { toast(e.message, 'err'); }
  };
  if (comAtraso) _tm.pend[chave] = setTimeout(envia, 600); else await envia();
}

// ── Descanso ────────────────────────────────────────────────────────────────
function tmDescansoIniciar(seg) {
  tmDescansoParar();
  _tm.restam = seg;
  document.getElementById('tm-descanso').classList.add('on');
  tmDescansoPinta();
  _tm.timer = setInterval(() => {
    _tm.restam--;
    tmDescansoPinta();
    if (_tm.restam <= 0) { tmDescansoParar(); tmAviso(); }
  }, 1000);
}

function tmDescansoPinta() {
  const m = Math.floor(Math.max(_tm.restam, 0) / 60), s = Math.max(_tm.restam, 0) % 60;
  document.getElementById('tm-descanso-t').textContent = `${m}:${String(s).padStart(2, '0')}`;
}

function tmDescansoMais(seg) { _tm.restam += seg; tmDescansoPinta(); }

function tmDescansoParar() {
  clearInterval(_tm.timer); _tm.timer = null;
  document.getElementById('tm-descanso').classList.remove('on');
}

// Fim do descanso: vibra e apita. Sem áudio externo — o celular fica no bolso.
function tmAviso() {
  try { if (navigator.vibrate) navigator.vibrate([180, 90, 180]); } catch (e) {}
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = new C(), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = 880; g.gain.value = 0.15;
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.25);
    setTimeout(() => ctx.close(), 600);
  } catch (e) {}
}

// Tela do treino de corrida: a prescrição inteira, legível de longe, e nada mais.
// Não há série para marcar nem descanso para contar — inventar controles aqui
// seria dar trabalho sem devolver informação.
function tmRenderAerobico() {
  const a = _tm.aula;
  document.getElementById('tm-titulo').textContent = a.foco || a.tipo || 'Treino de corrida';
  document.getElementById('tm-subtitulo').textContent =
    `${fmtDataCurta(a.data)}${a.hora ? ' · ' + a.hora : ''} · corrida`;
  document.getElementById('tm-passos').innerHTML = '<i class="now"></i>';
  document.getElementById('tm-ex-nome').textContent = 'Prescrição do treinador';
  document.getElementById('tm-ex-meta').innerHTML = a.ja_comecou ? ''
    : '<span class="tm-chip">treino ainda não começou</span>';
  document.querySelector('#modo-treino .tm-rot').style.display = 'none';
  document.getElementById('tm-series').innerHTML =
    `<pre class="tm-aer">${esc(a.descricao || '')}</pre>`;
  document.getElementById('tm-como').style.display = 'none';
  document.getElementById('tm-ant').style.display = 'none';
  document.getElementById('tm-proximo').textContent = 'Concluir treino';
}

function tmConcluir() {
  const a = _tm.aula;
  if (a.status === 'realizada') { toast('Treino já estava marcado como feito'); return tmFechar(); }
  if (!a.ja_comecou) { toast('Este treino ainda não começou', 'err'); return; }
  const ex = a.exercicios || [];
  const feitos = ex.filter(e => e.feito).length;
  abrirConclusao(a.id, (ex.length && feitos < ex.length)
                   ? `Você marcou ${feitos} de ${ex.length} exercícios.` : '',
                 () => tmFechar());
}

// ══════════════════════════════ CORPO ════════════════════════════════════════
let _chPeso = null;

async function loadCorpo() {
  const box = document.getElementById('corpo-painel');
  let c;
  try { c = await api('GET', '/api/corpo'); }
  catch (e) { box.innerHTML = '<div class="empty">Não foi possível carregar.</div>'; return; }

  document.getElementById('btn-pesar').style.display = _cfg.pode_editar ? '' : 'none';

  if (!c.atual) {
    box.innerHTML = `<div class="empty">
      Nenhum peso registrado ainda.${_cfg.pode_editar ? ' Registre o primeiro para o gráfico começar a existir.' : ''}
    </div>`;
    document.getElementById('card-peso').style.display = 'none';
    return;
  }

  const d = c.variacao;
  const fatos = [];
  if (c.imc) fatos.push({ k: 'IMC', v: fmtN(c.imc, 1), o: c.imc_texto });
  else fatos.push({ k: 'IMC', v: '—', o: 'informe a altura em Ajustes' });
  if (c.meta) fatos.push({ k: 'Meta', v: fmtN(c.meta, 1) + ' kg',
    o: c.falta_para_meta > 0 ? `faltam ${fmtN(c.falta_para_meta, 1)} kg` : 'meta atingida' });
  if (c.ritmo_kg_semana !== null) fatos.push({ k: 'Ritmo', v: `${c.ritmo_kg_semana > 0 ? '+' : ''}${fmtN(c.ritmo_kg_semana, 2)} kg`,
    o: 'por semana, nos últimos 90 dias' });
  else fatos.push({ k: 'Ritmo', v: '—', o: `precisa de 3 pesagens em 2 semanas (tem ${c.registros})` });
  if (c.previsao_meta) fatos.push({ k: 'Meta em', v: fmtData(c.previsao_meta), o: 'mantendo este ritmo' });

  box.innerHTML = `
    <div class="corpo-num">
      <span class="p">${fmtN(c.atual, 1)}</span><span class="u">kg</span>
      ${d ? `<span class="d ${d > 0 ? 'sobe' : 'desce'}">${d > 0 ? '+' : ''}${fmtN(d, 1)} kg</span>` : ''}
      ${c.ultima_medida ? `<span class="u">em ${fmtDataCurta(c.ultima_medida.data)}</span>` : ''}
    </div>
    <div class="corpo-fatos">${fatos.map(f => `
      <div class="corpo-fato"><div class="k">${esc(f.k)}</div>
        <div class="v">${esc(f.v)}</div><div class="o">${esc(f.o || '')}</div></div>`).join('')}
    </div>`;

  const serie = c.serie || [];
  const card = document.getElementById('card-peso');
  if (serie.length < 2 || typeof Chart === 'undefined') { card.style.display = 'none'; return; }
  card.style.display = '';
  const dados = { labels: serie.map(p => fmtDataCurta(p.data)), datasets: [
    { label: 'Peso (kg)', data: serie.map(p => p.peso), borderColor: CORES.verde,
      backgroundColor: 'rgba(22,163,74,.12)', fill: true, tension: .3, pointRadius: 3 }
  ] };
  if (c.meta) dados.datasets.push({ label: 'Meta', data: serie.map(() => c.meta),
    borderColor: CORES.laranja, borderDash: [6, 4], pointRadius: 0, fill: false });
  _chPeso = novoChart(_chPeso, 'ch-peso', { type: 'line', data: dados,
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: !!c.meta } },
      scales: { y: { beginAtZero: false } } } });
}

function abrirMedida() {
  ['md-peso','md-cintura','md-quadril','md-peito','md-braco','md-coxa','md-obs'].forEach(i => setVal(i, ''));
  setVal('md-data', iso(new Date()));
  abrirModal('m-medida');
}

async function salvarMedida() {
  const body = { data: val('md-data') || null };
  ['peso','cintura','quadril','peito','braco','coxa'].forEach(k => {
    const v = num('md-' + k); if (v !== null) body[k] = v;
  });
  const obs = val('md-obs'); if (obs) body.obs = obs;
  if (Object.keys(body).length <= 1) return toast('Informe ao menos um valor', 'err');
  try {
    await api('POST', '/api/medidas', body);
    fecharModal('m-medida'); toast('Medida registrada'); loadCorpo();
  } catch (e) { toast(e.message, 'err'); }
}


// ══════════════════ LEVAR UM MODELO PARA UM DIA DA AGENDA ════════════════════
// A biblioteca só valia enquanto alguém abrisse a aula e fosse buscar o modelo
// lá dentro. Aqui o caminho é o inverso: escolhe-se o treino e depois o dia.
let _umModelo = null;

async function usarModelo(mid) {
  const m = _modelos.find(x => x.id === mid);
  if (!m) return;
  _umModelo = m;
  document.getElementById('um-titulo').textContent = `Usar "${m.nome}" em qual dia?`;
  const lista = document.getElementById('um-lista');
  lista.innerHTML = '<div class="empty">Carregando…</div>';
  abrirModal('m-usar-modelo');

  const hoje = iso(new Date());
  const fim = iso(new Date(Date.now() + 90 * 864e5));
  let aulas;
  try { aulas = await api('GET', `/api/aulas?ini=${hoje}&fim=${fim}`); }
  catch (e) { lista.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const abertas = aulas.filter(a => a.status === 'agendada');
  if (!abertas.length) {
    lista.innerHTML = `<div class="empty">
      Nenhuma aula agendada daqui para a frente.<br>
      Marque os dias do mês na Agenda e volte aqui.</div>`;
    return;
  }
  lista.innerHTML = abertas.map(a => {
    const solo = (a.modalidade || 'com_personal') === 'sozinho';
    const jaTem = (a.qtd_exercicios || 0) > 0;
    return `<button class="dia-op" onclick="usarModeloNoDia(${a.id}, ${solo}, ${jaTem})">
      <span>
        <span class="q">${fmtDataCurta(a.data)}${a.hora ? ' · ' + a.hora : ''}</span>
        <span class="s">${esc(diaSemana(a.data))}${jaTem ? ` · já tem ${a.qtd_exercicios} ${a.qtd_exercicios === 1 ? 'exercício' : 'exercícios'}` : ' · sem treino'}</span>
      </span>
      <span class="m ${solo ? 'i' : 'p'}">${solo ? 'Individual' : 'Personal'}</span>
    </button>`;
  }).join('');
}

async function usarModeloNoDia(aid, solo, jaTem) {
  // Aplicar substitui o treino inteiro do dia. Se já existe conteúdo lá,
  // perguntar é obrigatório — é trabalho de alguém que some.
  const vaiAplicar = solo || _user.role === 'personal';
  if (vaiAplicar && jaTem &&
      !confirm('Este dia já tem exercícios. Aplicar o modelo substitui todos eles. Continuar?')) return;
  try {
    const r = await api('POST', `/api/aulas/${aid}/usar-modelo/${_umModelo.id}`);
    fecharModal('m-usar-modelo');
    toast(r.acao === 'aplicado'
      ? `"${r.modelo}" aplicado (${r.itens} exercícios)`
      : `"${r.modelo}" sugerido ao personal`);
    loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

async function removerSugestao(aid) {
  try {
    await api('DELETE', `/api/aulas/${aid}/sugestao`);
    toast('Sugestão removida');
    abrirAula(aid);
    loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

async function aceitarSugestao(aid, mid) {
  try {
    await api('POST', `/api/aulas/${aid}/aplicar-modelo/${mid}`);
    toast('Modelo aplicado na aula');
    abrirAula(aid);
    loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

// Sugestão do aluno dentro da aula. Quem pode montar vê o botão de aplicar;
// quem sugeriu vê o de retirar. Ninguém fica preso ao pedido de ontem.
function renderSugestao(a) {
  const box = document.getElementById('a-aviso-sugestao');
  if (!a.sugestao_modelo_id) { box.style.display = 'none'; return; }
  const m = _modelos.find(x => x.id === a.sugestao_modelo_id);
  const nome = m ? m.nome : `modelo #${a.sugestao_modelo_id}`;
  const podeAplicar = podeMontarTreino(a.modalidade);
  box.style.display = '';
  box.innerHTML = `<b>Sugestão do aluno:</b> ${esc(nome)}.
    ${podeAplicar
      ? `<button class="btn btn-sm btn-primary" style="margin-left:8px" onclick="aceitarSugestao(${a.id}, ${a.sugestao_modelo_id})">Aplicar</button>`
      : ''}
    <button class="btn btn-sm" style="margin-left:6px" onclick="removerSugestao(${a.id})">Retirar</button>`;
}


// ═════════════ BARRA INFERIOR × BARRA DE ENDEREÇOS DO NAVEGADOR ══════════════
// No Safari do iPhone, esconder a barra de endereços ao rolar muda a altura
// VISÍVEL da página sem mover o que está em `position: fixed`. O resultado é uma
// fresta entre a barra do app e a do navegador, com o conteúdo aparecendo por
// ela. A VisualViewport diz quanto a área visível difere da área de layout;
// deslocamos a barra por essa diferença. Serve para os dois lados: barra alta
// demais (a fresta que ele viu) e barra escondida sob a do navegador.
function ajustarBarraInferior() {
  const barra = document.getElementById('tabbar');
  const vv = window.visualViewport;
  if (!barra || !vv) return;
  const sobra = window.innerHeight - vv.height - vv.offsetTop;
  barra.style.transform = Math.abs(sobra) > 1 ? `translateY(${-sobra}px)` : '';
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', ajustarBarraInferior);
  window.visualViewport.addEventListener('scroll', ajustarBarraInferior);
  window.addEventListener('orientationchange', () => setTimeout(ajustarBarraInferior, 250));
  // A rolagem da página é o gatilho de esconder/mostrar a barra de endereços,
  // e nem todo iOS emite 'scroll' na VisualViewport nesse momento.
  window.addEventListener('scroll', ajustarBarraInferior, { passive: true });
  document.addEventListener('DOMContentLoaded', ajustarBarraInferior);
}

// ══════════════ BASE DE PROFESSORES E LOCAIS ═════════════════════════════════
// Campo livre gerava "Academia", "academia" e "Academia " como três lugares
// diferentes — e aí filtro e histórico deixam de fechar. Agora é lista.
let _cad = { professor: [], local: [] };
let _resumoMes = null;

async function carregarCadastros() {
  try { _cad = await api('GET', '/api/cadastros'); }
  catch (e) { _cad = { professor: [], local: [] }; }
}

// Monta o <select> já com o valor atual selecionado. O valor de uma aula antiga
// que não esteja mais na base entra como opção própria: sumir com ele
// reescreveria o passado ao salvar.
function preencherCad(selectId, tipo, valor) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const nomes = [...(_cad[tipo] || [])];
  if (valor && !nomes.includes(valor)) nomes.unshift(valor);
  sel.innerHTML = '<option value="">—</option>'
    + nomes.map(n => `<option${n === valor ? ' selected' : ''}>${esc(n)}</option>`).join('')
    + '<option value="__novo__">+ Cadastrar novo…</option>';
  sel.value = valor || '';
}

// Escolher "+ Cadastrar novo…" abre o cadastro sem tirar o usuário da tela.
async function cadNovoSe(sel, tipo) {
  if (sel.value !== '__novo__') return;
  const nome = (prompt(tipo === 'professor' ? 'Nome do professor:' : 'Nome do local:') || '').trim();
  if (!nome) { preencherCad(sel.id, tipo, ''); return; }
  try {
    await api('POST', '/api/cadastros', { tipo, nome });
    await carregarCadastros();
    preencherCad(sel.id, tipo, nome);
    renderCadastros();
  } catch (e) { toast(e.message, 'err'); preencherCad(sel.id, tipo, ''); }
}

function renderCadastros() {
  [['professor', 'cad-professores'], ['local', 'cad-locais']].forEach(([tipo, alvo]) => {
    const box = document.getElementById(alvo);
    if (!box) return;
    const itens = _cad[tipo] || [];
    box.innerHTML = itens.length
      ? itens.map(n => `<div class="cad-item"><span>${esc(n)}</span>
          <button class="btn btn-sm btn-ghost" title="Remover"
            onclick="delCadastro('${tipo}', '${esc(n).replace(/'/g, "\\'")}')">✕</button></div>`).join('')
      : '<div class="muted" style="font-size:12px">Nenhum cadastrado.</div>';
  });
}

async function addCadastro(tipo) {
  const campo = document.getElementById(tipo === 'professor' ? 'cad-prof-novo' : 'cad-local-novo');
  const nome = campo.value.trim();
  if (!nome) return;
  try {
    await api('POST', '/api/cadastros', { tipo, nome });
    campo.value = '';
    await carregarCadastros(); renderCadastros();
    toast('Cadastrado');
  } catch (e) { toast(e.message, 'err'); }
}

async function delCadastro(tipo, nome) {
  try {
    const itens = await api('GET', `/api/cadastros?tipo=${tipo}`);
    const alvo = itens.find(i => i.nome === nome);
    if (!alvo) return;
    await api('DELETE', `/api/cadastros/${alvo.id}`);
    await carregarCadastros(); renderCadastros();
  } catch (e) { toast(e.message, 'err'); }
}

// ══════════════════════════ PAGAMENTO (PIX) ══════════════════════════════════
function abrirPix() {
  const hoje = new Date();
  setVal('px-mes', mesRefStr());
  setVal('px-data', iso(hoje));
  setVal('px-valor', _resumoMes && _resumoMes.financeiro ? _resumoMes.financeiro.falta_pagar || '' : '');
  setVal('px-obs', '');
  abrirModal('m-pix');
}

async function salvarPix() {
  const valor = num('px-valor');
  if (!valor || valor <= 0) return toast('Informe o valor pago', 'err');
  try {
    await api('POST', '/api/pagamentos', {
      mes: val('px-mes') || null, valor,
      data_pix: val('px-data') || null, obs: val('px-obs') || null
    });
    fecharModal('m-pix');
    toast('Pagamento informado — aguardando a confirmação do personal');
    loadPix();
  } catch (e) { toast(e.message, 'err'); }
}

async function loadPix() {
  const box = document.getElementById('pix-lista');
  document.getElementById('btn-pix').style.display = _user.role === 'aluno' ? '' : 'none';
  let itens;
  try { itens = await api('GET', `/api/pagamentos?ano=${_mesRef.getFullYear()}`); }
  catch (e) { box.innerHTML = '<div class="empty">Não foi possível carregar.</div>'; return; }
  if (!itens.length) {
    box.innerHTML = `<div class="empty">Nenhum pagamento informado neste ano.${
      _user.role === 'aluno' ? ' Use “Informar pagamento” quando pagar.' : ''}</div>`;
    return;
  }
  box.innerHTML = itens.map(p => `
    <div class="pix-linha">
      <div>
        <div class="q">${fmtR(p.valor)} <span class="muted">· ref. ${esc(fmtMes(p.mes))}</span></div>
        <div class="s">Pago em ${fmtDataCurta(p.data_pix)}${p.obs ? ' · ' + esc(p.obs) : ''}</div>
      </div>
      ${p.confirmado
        ? `<span class="pix-tag ok">✅ recebido</span>`
        : `<span class="pix-tag pend">⏳ aguardando</span>`}
      ${(!p.confirmado && _user.role === 'personal')
        ? `<button class="btn btn-sm btn-primary" onclick="confirmarPix(${p.id})">Confirmar</button>` : ''}
      ${(!p.confirmado && _user.role === 'aluno')
        ? `<button class="btn btn-sm btn-ghost" title="Cancelar aviso" onclick="apagarPix(${p.id})">✕</button>` : ''}
    </div>`).join('');
}

async function confirmarPix(id) {
  try {
    await api('POST', `/api/pagamentos/${id}/confirmar`);
    toast('Recebimento confirmado');
    fecharModal('m-pix-aviso');
    loadPix(); verificarAvisosPix();
  } catch (e) { toast(e.message, 'err'); }
}

async function apagarPix(id) {
  if (!confirm('Cancelar este aviso de pagamento?')) return;
  try { await api('DELETE', `/api/pagamentos/${id}`); loadPix(); }
  catch (e) { toast(e.message, 'err'); }
}

// ── Aviso prioritário, por cima da tela inicial ─────────────────────────────
// Personal: tem pagamento esperando confirmação — é ação dele.
// Aluno: o personal confirmou e ele ainda não viu — é notícia dele.
async function verificarAvisosPix() {
  let d;
  try { d = await api('GET', '/api/pagamentos/avisos'); } catch (e) { return; }
  const itens = d.itens || [];
  if (!itens.length) { fecharModal('m-pix-aviso'); return; }
  const p = itens[0];
  const titulo = document.getElementById('pix-av-titulo');
  const corpo = document.getElementById('pix-av-corpo');
  const acoes = document.getElementById('pix-av-acoes');
  const resto = itens.length > 1
    ? `<p class="muted" style="font-size:12px;margin-top:10px">
         E mais ${itens.length - 1} ${itens.length === 2 ? 'aviso' : 'avisos'} depois deste.</p>` : '';

  if (d.tipo === 'confirmar') {
    titulo.textContent = '💸 Pagamento informado — confirme o recebimento';
    corpo.innerHTML = `
      <div class="pix-destaque">${fmtR(p.valor)}</div>
      <p style="margin:10px 0 0">
        <b>${esc(p.informou_nome || 'O aluno')}</b> informou um pagamento feito em
        <b>${fmtData(p.data_pix)}</b>, referente a <b>${esc(fmtMes(p.mes))}</b>.
        ${p.obs ? `<br><span class="muted">${esc(p.obs)}</span>` : ''}
      </p>
      <p class="muted" style="font-size:12px;margin-top:10px">
        Confirme só depois de ver o dinheiro na conta. Enquanto não confirmar,
        este aviso volta a aparecer toda vez que você abrir o app.</p>${resto}`;
    acoes.innerHTML = `
      <button class="btn" onclick="fecharModal('m-pix-aviso')">Ainda não</button>
      <button class="btn btn-primary" onclick="confirmarPix(${p.id})">Confirmo que recebi</button>`;
  } else {
    titulo.textContent = '✅ Pagamento confirmado';
    corpo.innerHTML = `
      <div class="pix-destaque">${fmtR(p.valor)}</div>
      <p style="margin:10px 0 0">
        <b>${esc(p.confirmou_nome || 'O personal')}</b> confirmou o recebimento do pagamento
        de <b>${fmtData(p.data_pix)}</b>, referente a <b>${esc(fmtMes(p.mes))}</b>.
      </p>${resto}`;
    acoes.innerHTML = `<button class="btn btn-primary" onclick="pixVisto(${p.id})">Entendi</button>`;
  }
  abrirModal('m-pix-aviso');
}

async function pixVisto(id) {
  try { await api('POST', `/api/pagamentos/${id}/visto`); } catch (e) {}
  fecharModal('m-pix-aviso');
  verificarAvisosPix();   // encadeia o próximo aviso, se houver
}

// ══════════════════════ CONCLUSÃO DO TREINO ══════════════════════════════════
// Energia, fadiga e esforço são perguntados NA HORA de concluir. Perguntar
// depois é perguntar à memória, não ao corpo — e foi por não perguntar em lugar
// nenhum que a linha "Esforço médio" do painel do mês vivia em S/D.
//
// As duas escalas de 1 a 5 são simétricas em torno de "Normal" e monotônicas.
// Escala com dois rótulos que significam quase o mesmo ("média" e "normal",
// "alta" e "acima da média") gera dado que não se compara com ele mesmo.
const NIVEIS = [
  { v: 1, t: 'Muito baixa' }, { v: 2, t: 'Baixa' }, { v: 3, t: 'Normal' },
  { v: 4, t: 'Alta' },        { v: 5, t: 'Muito alta' }
];

// Borg CR10: o número continua de 1 a 10 (é o que o histórico e o painel usam),
// mas cada um ganha o rótulo que torna a pergunta respondível em pé, suado.
const PSE_ESCALA = [
  { v: 1,  t: 'Muito leve' },        { v: 2,  t: 'Leve' },
  { v: 3,  t: 'Moderada' },          { v: 4,  t: 'Pouco intensa' },
  { v: 5,  t: 'Intensa' },           { v: 6,  t: 'Intensa +' },
  { v: 7,  t: 'Muito intensa' },     { v: 8,  t: 'Muito intensa +' },
  { v: 9,  t: 'Muito, muito intensa' }, { v: 10, t: 'Exaustão máxima' }
];

function opcoesEscala(escala, valor) {
  return '<option value="">—</option>' + escala.map(o =>
    `<option value="${o.v}"${String(o.v) === String(valor ?? '') ? ' selected' : ''}>${o.v} · ${o.t}</option>`
  ).join('');
}

function rotuloEscala(escala, v) {
  const o = escala.find(x => x.v === Number(v));
  return o ? `${o.v} · ${o.t}` : '—';
}

let _cc = { id: null, depois: null };

function abrirConclusao(id, aviso, depois) {
  const a = (_aulas.find(x => x.id === id)) || (_tm.aula && _tm.aula.id === id ? _tm.aula : null);
  _cc = { id, depois: depois || null };
  const quando = a ? `${fmtDataCurta(a.data)}${a.hora ? ' às ' + a.hora : ''}` : 'deste treino';
  document.getElementById('cc-aviso').innerHTML =
    `${aviso ? `<b>${esc(aviso)}</b> ` : ''}Confirmar que o treino de <b>${quando}</b> foi feito?
     <b>Isso não pode ser desfeito.</b>`;
  const aer = ehAerobico(a && a.modalidade);
  document.getElementById('cc-aerobico').style.display = aer ? '' : 'none';
  setVal('cc-distancia', (a && a.distancia_km) ?? '');
  setVal('cc-tempo', (a && a.tempo_min) ?? '');
  _cc.aerobico = aer;
  document.getElementById('cc-energia').innerHTML = opcoesEscala(NIVEIS, a && a.energia);
  document.getElementById('cc-fadiga').innerHTML = opcoesEscala(NIVEIS, a && a.fadiga);
  document.getElementById('cc-pse').innerHTML = opcoesEscala(PSE_ESCALA, a && a.pse);
  setVal('cc-obs', (a && a.obs) || '');
  abrirModal('m-concluir');
}

async function confirmarConclusao() {
  const body = {
    status: 'realizada',
    energia: num('cc-energia'), fadiga: num('cc-fadiga'), pse: num('cc-pse'),
    obs: val('cc-obs') || null
  };
  if (_cc.aerobico) {
    body.distancia_km = num('cc-distancia');
    body.tempo_min = num('cc-tempo');
  }
  try {
    await api('PATCH', `/api/aulas/${_cc.id}`, body);
    fecharModal('m-concluir');
    toast('Treino registrado como feito');
    if (_cc.depois) _cc.depois();
    loadAgenda();
  } catch (e) { toast(e.message, 'err'); }
}

// ══════════════════════════ AERÓBICO (CORRIDA) ═══════════════════════════════
// Ritmo em min/km — é assim que corredor lê, não em decimal.
function paceStr(km, min) {
  if (!km || !min || km <= 0) return null;
  const t = min / km, m = Math.floor(t);
  let s = Math.round((t - m) * 60), mm = m;
  if (s === 60) { mm += 1; s = 0; }
  return `${mm}:${String(s).padStart(2, '0')}`;
}

function atualizarPace() {
  const box = document.getElementById('a-aer-pace');
  if (!box) return;
  const p = paceStr(num('a-distancia'), num('a-tempo'));
  box.textContent = p ? `Ritmo: ${p} min/km` : '';
}

let _chAer = null;

async function loadAerobico() {
  const box = document.getElementById('aer-painel');
  const card = document.getElementById('card-aer-gr');
  let d;
  try { d = await api('GET', `/api/aerobico?ano=${_mesRef.getFullYear()}`); }
  catch (e) { box.innerHTML = '<div class="empty">Não foi possível carregar.</div>'; return; }
  document.getElementById('aer-ano').textContent = d.ano;

  if (!d.treinos_no_ano) {
    box.innerHTML = `<div class="empty">Nenhuma corrida registrada em ${d.ano}.<br>
      Marque o dia como <b>Aeróbico</b> na agenda, cole a prescrição do treinador
      e registre distância e tempo ao concluir.</div>`;
    card.style.display = 'none';
    return;
  }

  const fatos = [
    { k: 'Volume no ano', v: `${fmtN(d.total_km, 1)} km`, o: `${d.treinos_no_ano} treinos` },
    { k: 'Tempo total', v: `${Math.floor(d.total_min / 60)}h${String(d.total_min % 60).padStart(2, '0')}`, o: 'correndo' },
    { k: 'Ritmo médio', v: d.pace_medio ? `${d.pace_medio}/km` : '—', o: 'no ano' },
    { k: 'Melhor ritmo', v: d.melhor_pace ? `${d.melhor_pace}/km` : '—', o: 'num treino' }
  ];
  box.innerHTML = `<div class="corpo-fatos">${fatos.map(f => `
      <div class="corpo-fato"><div class="k">${esc(f.k)}</div>
        <div class="v">${esc(f.v)}</div><div class="o">${esc(f.o)}</div></div>`).join('')}
    </div>
    ${d.sem_registro ? `<div class="aviso" style="margin-top:12px">
      <b>${d.sem_registro} ${d.sem_registro === 1 ? 'corrida' : 'corridas'} sem distância lançada.</b>
      Elas ficam fora dos números acima — abra a aula e registre para o gráfico
      contar a história inteira.</div>` : ''}
    <div class="table-wrap" style="margin-top:12px">
      <table><thead><tr><th>Data</th><th>Treino</th><th class="right">km</th>
        <th class="right">tempo</th><th class="right">ritmo</th></tr></thead>
      <tbody>${d.treinos.slice().reverse().map(t => `
        <tr><td><b>${fmtDataCurta(t.data)}</b></td>
          <td>${esc(t.foco || t.tipo || 'Corrida')}</td>
          <td class="right">${fmtN(t.distancia_km, 1)}</td>
          <td class="right">${t.tempo_min ? fmtN(t.tempo_min, 0) + ' min' : '—'}</td>
          <td class="right"><b>${t.pace ? t.pace : '—'}</b></td></tr>`).join('')}
      </tbody></table>
    </div>`;

  if (typeof Chart === 'undefined') { card.style.display = 'none'; return; }
  card.style.display = '';
  // Volume em barras e ritmo em linha no eixo invertido: no gráfico de corrida,
  // ritmo MENOR é melhor — sem inverter, a melhora apareceria como queda.
  const paceMin = d.mensal.map(m => m.pace
    ? Number(m.pace.split(':')[0]) + Number(m.pace.split(':')[1]) / 60 : null);
  _chAer = novoChart(_chAer, 'ch-aer', {
    type: 'bar',
    data: {
      labels: MESES,
      datasets: [
        { label: 'km', data: d.mensal.map(m => m.km), backgroundColor: CORES.verde,
          borderRadius: 6, yAxisID: 'y' },
        { label: 'ritmo (min/km)', data: paceMin, type: 'line', borderColor: CORES.laranja,
          backgroundColor: CORES.laranja, tension: .3, spanGaps: true, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'km' } },
        y1: { position: 'right', reverse: true, grid: { drawOnChartArea: false },
              title: { display: true, text: 'min/km (menor é melhor)' } }
      }
    }
  });
}

// ═══════════════ ESCOLHER EXERCÍCIO NA BIBLIOTECA ════════════════════════════
// O <input list=…> resolve no computador e falha no celular: o Safari do iPhone
// transforma o datalist em três sugestões na barra do teclado, sem seta e sem
// rolagem — a biblioteca existe, mas não há como navegá-la. Este seletor é o
// caminho explícito, com busca, favoritos e grupos.
let _exAlvo = null;      // input .ex-nome que receberá o nome escolhido
let _exGrupo = '';       // filtro de grupo ativo

function abrirEscolherEx(botao) {
  _exAlvo = botao.closest('.ex-row').querySelector('.ex-nome');
  _exGrupo = '';
  setVal('ex-busca', '');
  const grupos = [...new Set(_exercicios.map(e => e.grupo).filter(Boolean))].sort();
  document.getElementById('ex-grupos').innerHTML =
    `<button class="tab active" onclick="filtrarEscolherEx('')">Todos</button>` +
    (_exercicios.some(e => e.favorito) ? `<button class="tab" onclick="filtrarEscolherEx('⭐')">⭐</button>` : '') +
    grupos.map(g => `<button class="tab" onclick="filtrarEscolherEx('${esc(g).replace(/'/g, "\\'")}')">${esc(g)}</button>`).join('');
  renderEscolherEx();
  abrirModal('m-escolher-ex');
}

function filtrarEscolherEx(g) {
  _exGrupo = g;
  document.querySelectorAll('#ex-grupos .tab').forEach(t =>
    t.classList.toggle('active', t.textContent === (g || 'Todos')));
  renderEscolherEx();
}

function renderEscolherEx() {
  const b = val('ex-busca').toLowerCase();
  const itens = _exercicios.filter(e => {
    if (_exGrupo === '⭐' && !e.favorito) return false;
    if (_exGrupo && _exGrupo !== '⭐' && e.grupo !== _exGrupo) return false;
    if (!b) return true;
    return (e.nome + ' ' + (e.equipamento || '') + ' ' + (e.grupo || '')).toLowerCase().includes(b);
  });
  const box = document.getElementById('ex-lista');
  if (!itens.length) {
    box.innerHTML = `<div class="empty">Nada encontrado.
      <button class="btn btn-sm" style="margin-top:10px" onclick="usarNomeDigitado()">
        Usar “${esc(val('ex-busca') || '—')}” mesmo assim</button></div>`;
    return;
  }
  // Favoritos primeiro: são os que ele repete toda semana.
  itens.sort((a, x) => (x.favorito || 0) - (a.favorito || 0) ||
    (a.grupo || '').localeCompare(x.grupo || '') || a.nome.localeCompare(x.nome));
  box.innerHTML = itens.map(e => `
    <button type="button" class="ex-op" onclick="escolherEx(${e.id})">
      <span>
        <span class="n">${e.favorito ? '⭐ ' : ''}${esc(e.nome)}</span>
        <span class="s">${esc(e.grupo || 'sem grupo')}${e.equipamento ? ' · ' + esc(e.equipamento) : ''}</span>
      </span>
    </button>`).join('');
}

function escolherEx(id) {
  const e = _exercicios.find(x => x.id === id);
  if (e && _exAlvo) {
    _exAlvo.value = e.nome;
    _exAlvo.dispatchEvent(new Event('input', { bubbles: true }));
  }
  fecharModal('m-escolher-ex');
}

// Exercício que não está na biblioteca continua permitido: quem prescreve não
// pode ficar preso ao cadastro.
function usarNomeDigitado() {
  if (_exAlvo) _exAlvo.value = val('ex-busca');
  fecharModal('m-escolher-ex');
}
