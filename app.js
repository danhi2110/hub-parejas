// ==============================================================================
// HUB INTERACTIVO DE PAREJAS - LÓGICA PRINCIPAL (FASE 3 & ARCADE TOTAL)
// ==============================================================================

import { supabase, isConfigured } from './supabaseClient.js';

// ESTADO GLOBAL DE LA APLICACIÓN
const state = {
  currentUser: null,
  currentProfile: null,
  currentSpace: null,
  partnerProfile: null,
  notes: [],
  songs: [],
  reactions: {},
  memories: [],
  bucketList: [],
  activeBucketFilter: 'all',
  moods: { mine: null, partner: null },
  timerInterval: null,
  realtimeChannel: null,
  isLoginMode: false,

  // Marcador Global de Rondas
  globalScore: { winsP1: 0, winsP2: 0 },

  // Arcade: 3 en Raya Dinámico (3x3 a 8x8)
  ttt: {
    size: 3,
    board: [],
    turn: 'P1',
    active: true
  },

  // Arcade: Damas
  checkers: {
    board: [],
    turn: 'red', // 'red' (❤️ P1) o 'black' (⭐ P2)
    selected: null,
    validMoves: [],
    active: true
  },

  // Arcade: Ajedrez
  chess: {
    board: [],
    turn: 'white', // 'white' (P1) o 'black' (P2)
    selected: null,
    validMoves: [],
    active: true
  },

  // Arcade: Trivia
  trivia: {
    allQuestions: [],
    activeQuiz: [],
    currentIndex: 0,
    scoreP1: 0,
    totalQuestions: 5,
    inProgress: false
  },

  // Arcade: Verdad o Reto
  vorFilter: 'all',
  customVor: [],

  // Arcade: Esto o Aquello
  tntIndex: 0,
  customTnt: [],

  // Arcade: Cooperativo
  coop: {
    running: false,
    score: 0,
    timeLeft: 30,
    timerId: null,
    player: { x: 200, y: 130, speed: 12 },
    items: [],
    animId: null
  },

  // Arcade: Partida multijugador 1v1 en tiempo real (RPS, Ajedrez, Damas)
  arcade: {
    matchId: null,
    gameType: null,
    player1Id: null,
    player2Id: null,
    winnerId: null,
    myRole: 'player_1',
    isMyTurn: false,
    channel: null,
    scores: { p1: 0, p2: 0 },
    boardState: {},
    status: null,
    rev: 0,
    waiting: false,
    finished: false,
    rpsChoice: null,
    rpsRevealTimer: null,
    triviaChannel: null,
    triviaRoundId: null,
    triviaPlayer1Id: null,
    triviaPlayer2Id: null,
    triviaResults: {},
    cleanupInterval: null
  }
};

// ==============================================================================
// 1. UTILIDADES GENERALES & CONVERTIDORES (DRIVE, SPOTIFY, YOUTUBE)
// ==============================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Convertidor inteligente para fotos de Google Drive
function convertDriveImageUrl(url) {
  if (!url) return '';
  const driveRegex = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|lh3\.googleusercontent\.com\/d\/)([a-zA-Z0-9_-]+)/;
  const match = url.match(driveRegex);
  if (match && match[1]) {
    return `https://lh3.googleusercontent.com/d/${match[1]}`;
  }
  return url;
}

// Generador de Embed para canciones (YouTube / Spotify)
function getMusicEmbedHtml(url) {
  if (!url) return '';

  // Spotify
  if (url.includes('spotify.com')) {
    const trackMatch = url.match(/track\/([a-zA-Z0-9]+)/);
    if (trackMatch) {
      return `<iframe style="border-radius:12px" src="https://open.spotify.com/embed/track/${trackMatch[1]}?utm_source=generator&theme=0" width="100%" height="152" frameBorder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
    }
  }

  // YouTube
  let ytId = null;
  if (url.includes('youtu.be/')) {
    ytId = url.split('youtu.be/')[1]?.split('?')[0];
  } else if (url.includes('youtube.com/watch')) {
    const params = new URLSearchParams(url.split('?')[1]);
    ytId = params.get('v');
  }
  if (ytId) {
    return `<iframe width="100%" height="180" src="https://www.youtube-nocookie.com/embed/${ytId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }

  return `<a href="${encodeURI(url)}" target="_blank" rel="noopener noreferrer" style="color: #fde047; text-decoration: underline;">🔗 Abrir enlace de canción</a>`;
}

// ==============================================================================
// 2. TEMAS Y NAVEGACIÓN
// ==============================================================================
// Partículas por tema
const THEME_PARTICLES = {
  romantic: ['❤️', '🩷', '💕', '💖', '💗', '💓', '🌹', '💝'],
  warm:     ['🐰', '⭐', '🌸', '🍭', '🌈', '🧸', '✨', '🦋'],
  dark:     []
};

function spawnThemeParticles(theme) {
  // Limpiar partículas anteriores
  document.querySelectorAll('.theme-particle').forEach(el => el.remove());
  const emojis = THEME_PARTICLES[theme] || [];
  if (!emojis.length) return;

  const count = 18;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'theme-particle';
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    const x = Math.random() * 98;
    const dur = 6 + Math.random() * 8;
    const delay = Math.random() * 10;
    el.style.cssText = `--x:${x}%;--dur:${dur.toFixed(1)}s;--delay:-${delay.toFixed(1)}s;font-size:${(1.1 + Math.random() * 1.2).toFixed(2)}rem;`;
    document.body.appendChild(el);
  }
}

function initTheme() {
  const saved = localStorage.getItem('hub_parejas_theme') || 'romantic';
  document.documentElement.setAttribute('data-theme', saved);
  const select = document.getElementById('select-theme');
  if (select) select.value = saved;
  spawnThemeParticles(saved);
  select?.addEventListener('change', (e) => {
    const theme = e.target.value;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('hub_parejas_theme', theme);
    spawnThemeParticles(theme);
  });
}


function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('hidden', pane.id !== tabId));
  if (tabId === 'tab-story') updateStoryStats();
  // Al abrir Arcade, si aún no hay partida activa, conecta automáticamente a RPS
  if (tabId === 'tab-arcade' && state.currentUser && state.currentSpace && !state.arcade.matchId) {
    startArcadeGame('rps');
  }
}

function switchView(viewName) {
  const views = { auth: document.getElementById('view-auth'), onboarding: document.getElementById('view-onboarding'), dashboard: document.getElementById('view-dashboard') };
  const headerUser = document.getElementById('header-user-section');
  Object.values(views).forEach(v => v?.classList.add('hidden'));

  if (viewName === 'auth') {
    views.auth?.classList.remove('hidden');
    headerUser?.classList.add('hidden');
    if (state.timerInterval) clearInterval(state.timerInterval);
  } else if (viewName === 'onboarding') {
    views.onboarding?.classList.remove('hidden');
    headerUser?.classList.remove('hidden');
    if (state.timerInterval) clearInterval(state.timerInterval);
  } else if (viewName === 'dashboard') {
    views.dashboard?.classList.remove('hidden');
    headerUser?.classList.remove('hidden');
  }
}

// ==============================================================================
// 3. AUTENTICACIÓN (USERNAME ONLY)
// ==============================================================================
const toPseudoEmail = (u) => `${u.toLowerCase().trim()}@parejas.local`;

async function handleAuthSubmit(e) {
  e.preventDefault();
  if (!isConfigured()) {
    showToast('⚠️ Supabase no está configurado en supabaseClient.js', 'error');
    return;
  }
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const alias = document.getElementById('auth-alias')?.value.trim() || username;
  const submitBtn = document.getElementById('btn-auth-submit');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Cargando...';

  try {
    const pseudoEmail = toPseudoEmail(username);
    if (state.isLoginMode) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: pseudoEmail, password });
      if (error) throw error;
      showToast('¡Bienvenido de vuelta! ❤️', 'success');
      await initAppState(data.user);
    } else {
      const { data, error } = await supabase.auth.signUp({ email: pseudoEmail, password, options: { data: { username, alias } } });
      if (error) throw error;
      showToast('¡Cuenta creada exitosamente! 🎉', 'success');
      await initAppState(data.user);
    }
  } catch (err) {
    showToast(err.message || 'Error al autenticar', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = state.isLoginMode ? 'Iniciar Sesión' : 'Registrarme y Comenzar';
  }
}

async function handleSignOut() {
  await supabase.auth.signOut();
  if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  leaveArcadeChannel();
  if (state.arcade.triviaChannel) supabase.removeChannel(state.arcade.triviaChannel);
  if (state.arcade.cleanupInterval) clearInterval(state.arcade.cleanupInterval);
  state.arcade.cleanupInterval = null;
  state.arcade.matchId = null;
  state.arcade.triviaRoundId = null;
  state.currentUser = null;
  state.currentProfile = null;
  state.currentSpace = null;
  state.partnerProfile = null;
  switchView('auth');
  showToast('Sesión cerrada', 'info');
}

function toggleAuthMode(e) {
  e.preventDefault();
  state.isLoginMode = !state.isLoginMode;
  document.getElementById('auth-title').innerText = state.isLoginMode ? 'Iniciar Sesión' : 'Bienvenido a Nuestro Rincón';
  document.getElementById('group-alias').classList.toggle('hidden', state.isLoginMode);
  document.getElementById('btn-auth-submit').innerText = state.isLoginMode ? 'Iniciar Sesión' : 'Registrarme y Comenzar';
  document.getElementById('auth-toggle-msg').innerText = state.isLoginMode ? '¿Aún no tienes cuenta?' : '¿Ya tienes una cuenta?';
  document.getElementById('auth-toggle-link').innerText = state.isLoginMode ? 'Regístrate aquí' : 'Inicia sesión aquí';
}

// ==============================================================================
// 4. ONBOARDING & ESPACIOS
// ==============================================================================
async function handleCreateSpace(e) {
  e.preventDefault();
  const dateInput = document.getElementById('create-anniversary-date').value;
  if (!dateInput) return;
  try {
    const { data, error } = await supabase.rpc('crear_espacio_pareja', {
      p_alias: state.currentProfile?.alias || 'Tú',
      p_fecha_aniversario: new Date(dateInput).toISOString()
    });
    if (error) throw error;
    document.getElementById('onboarding-choices').classList.add('hidden');
    document.getElementById('onboarding-create-form').classList.add('hidden');
    document.getElementById('onboarding-waiting').classList.remove('hidden');
    document.getElementById('display-invite-code').innerText = data.codigo_invitacion;
    showToast('¡Espacio creado! Comparte el código con tu pareja 💖', 'success');

    // Escucha en tiempo real cuando se una
    if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = supabase.channel(`space-${data.espacio_id}`).on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'espacios', filter: `id=eq.${data.espacio_id}` },
      async (payload) => {
        if (payload.new.estado === 'activo') {
          showToast('🎉 ¡Tu pareja se unió! Activando espacio...', 'success');
          await initAppState(state.currentUser);
        }
      }
    ).subscribe();
  } catch (err) {
    showToast(err.message || 'Error al crear espacio', 'error');
  }
}

async function handleJoinSpace(e) {
  e.preventDefault();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length !== 6) return;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Verificando...';

  try {
    const { error } = await supabase.rpc('unirse_a_espacio', {
      p_alias: state.currentProfile?.alias || 'Tu Pareja',
      p_codigo: code
    });
    if (error) throw error;
    showToast('¡Vinculados con éxito! 💖', 'success');
    await initAppState(state.currentUser);
  } catch (err) {
    showToast(err.message || 'Código inválido o espacio lleno', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = 'Vincularnos Ahora';
  }
}

// ==============================================================================
// 5. INICIALIZACIÓN DEL HUB
// ==============================================================================
async function initAppState(user) {
  if (!user) { switchView('auth'); return; }
  state.currentUser = user;

  const { data: profile } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
  state.currentProfile = profile;

  if (!profile?.espacio_id) {
    switchView('onboarding');
    document.getElementById('onboarding-choices').classList.remove('hidden');
    document.getElementById('onboarding-create-form').classList.add('hidden');
    document.getElementById('onboarding-join-form').classList.add('hidden');
    document.getElementById('onboarding-waiting').classList.add('hidden');
    return;
  }

  const { data: space } = await supabase.from('espacios').select('*').eq('id', profile.espacio_id).single();
  state.currentSpace = space;

  if (space?.estado === 'pendiente_pareja') {
    switchView('onboarding');
    document.getElementById('onboarding-choices').classList.add('hidden');
    document.getElementById('onboarding-create-form').classList.add('hidden');
    document.getElementById('onboarding-join-form').classList.add('hidden');
    document.getElementById('onboarding-waiting').classList.remove('hidden');
    document.getElementById('display-invite-code').innerText = space.codigo_invitacion;
    return;
  }

  // Pareja vinculada
  const { data: partner } = await supabase
    .from('usuarios').select('*').eq('espacio_id', space.id).neq('id', user.id).maybeSingle();
  state.partnerProfile = partner;

  updateHeaderUI();
  switchView('dashboard');
  switchTab('tab-home');

  // Componentes
  initLiveTimer(space.fecha_aniversario);
  await loadMoods();
  await loadNotes();
  await loadSongs();
  await loadBucketList();
  await loadMemories();
  await loadArcadeScores();

  initArcadeSystems();
  setupRealtime(space.id);
  setupArcadeCleanup();
}

function updateHeaderUI() {
  const coupleNamesEl = document.getElementById('header-couple-names');
  if (coupleNamesEl) {
    const myName = state.currentProfile?.alias || state.currentProfile?.username || 'Tú';
    const partnerName = state.partnerProfile?.alias || state.partnerProfile?.username || 'Tu Pareja';
    coupleNamesEl.innerHTML = `<span>${myName}</span> ❤️ <span>${partnerName}</span>`;
  }
  document.getElementById('global-name-p1').innerText = state.currentProfile?.alias || 'Tú';
  document.getElementById('global-name-p2').innerText = state.partnerProfile?.alias || 'Tu Pareja';
}

function initLiveTimer(anniversaryDateString) {
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (!anniversaryDateString) return;

  const startDate = new Date(anniversaryDateString);
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('timer-anniversary-label').innerText = `Juntos desde el ${startDate.toLocaleDateString('es-ES', options)}`;

  function update() {
    const now = new Date();
    if (now < startDate) return;
    let years = now.getFullYear() - startDate.getFullYear();
    let months = now.getMonth() - startDate.getMonth();
    let days = now.getDate() - startDate.getDate();
    let hours = now.getHours() - startDate.getHours();
    let minutes = now.getMinutes() - startDate.getMinutes();
    let seconds = now.getSeconds() - startDate.getSeconds();

    if (seconds < 0) { seconds += 60; minutes--; }
    if (minutes < 0) { minutes += 60; hours--; }
    if (hours < 0) { hours += 24; days--; }
    if (days < 0) {
      const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      days += prevMonth.getDate();
      months--;
    }
    if (months < 0) { months += 12; years--; }

    document.getElementById('t-years').innerText = years;
    document.getElementById('t-months').innerText = months;
    document.getElementById('t-days').innerText = days;
    document.getElementById('t-hours').innerText = String(hours).padStart(2, '0');
    document.getElementById('t-minutes').innerText = String(minutes).padStart(2, '0');
    document.getElementById('t-seconds').innerText = String(seconds).padStart(2, '0');
  }
  update();
  state.timerInterval = setInterval(update, 1000);
}

// ==============================================================================
// 6. PIZARRÓN: NOTAS Y CANCIONES EMBED
// ==============================================================================
async function loadNotes() {
  if (!state.currentSpace) return;
  const { data: notesData } = await supabase
    .from('notas')
    .select('*, autor:autor_id(username, alias)')
    .eq('espacio_id', state.currentSpace.id)
    .order('fijada', { ascending: false })
    .order('creado_en', { ascending: false });

  state.notes = notesData || [];

  try {
    const { data: reactData } = await supabase.from('reacciones_notas').select('*');
    state.reactions = {};
    reactData?.forEach((r) => {
      if (!state.reactions[r.nota_id]) state.reactions[r.nota_id] = [];
      state.reactions[r.nota_id].push(r);
    });
  } catch (err) {}

  renderNotes();
}

function renderNotes() {
  const container = document.getElementById('notes-wall-container');
  if (!container) return;
  if (state.notes.length === 0) {
    container.innerHTML = `<p style="color: #cbd5e1; grid-column: 1 / -1; text-align: center; padding: 2rem;">El pizarrón está listo. ¡Escribe la primera nota de tiza para tu pareja! 💌</p>`;
    return;
  }

  container.innerHTML = state.notes.map((note) => {
    const isAuthor = note.autor_id === state.currentUser.id;
    const authorName = note.autor?.alias || note.autor?.username || (isAuthor ? 'Tú' : 'Tu Pareja');
    const noteReactions = state.reactions[note.id] || [];
    const counts = {};
    noteReactions.forEach(r => { counts[r.emoji] = (counts[r.emoji] || 0) + 1; });

    const reactionsHtml = Object.entries(counts).map(([emoji, count]) => `
      <span class="reaction-badge" onclick="window.toggleNoteReaction('${note.id}', '${emoji}')">
        ${emoji} ${count}
      </span>
    `).join('');

    return `
      <div class="note-card ${note.fijada ? 'pinned' : ''}" style="background-color: ${note.color_hex};">
        <p class="note-content">${escapeHtml(note.contenido)}</p>
        <div class="note-footer">
          <div class="note-meta">
            <span>De: <strong>${escapeHtml(authorName)}</strong></span>
            <div>
              <button class="btn-icon" onclick="window.togglePinNote('${note.id}', ${!note.fijada})" title="${note.fijada ? 'Desfijar' : 'Fijar'}">
                ${note.fijada ? '📍' : '📌'}
              </button>
              <button class="btn-icon" onclick="window.deleteNote('${note.id}')" title="Eliminar">🗑️</button>
            </div>
          </div>
          <div class="note-reactions-bar">
            ${reactionsHtml}
            <button class="reaction-add-btn" onclick="window.showReactionPicker('${note.id}')" title="Reaccionar">+ 😀</button>
          </div>
          <div id="react-picker-${note.id}" class="reaction-popover hidden">
            <button onclick="window.toggleNoteReaction('${note.id}', '❤️')">❤️</button>
            <button onclick="window.toggleNoteReaction('${note.id}', '🥰')">🥰</button>
            <button onclick="window.toggleNoteReaction('${note.id}', '😂')">😂</button>
            <button onclick="window.toggleNoteReaction('${note.id}', '😭')">😭</button>
            <button onclick="window.toggleNoteReaction('${note.id}', '🫶')">🫶</button>
            <button onclick="window.toggleNoteReaction('${note.id}', '💀')">💀</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadSongs() {
  if (!state.currentSpace) return;
  try {
    const { data } = await supabase
      .from('canciones_pizarron')
      .select('*, autor:autor_id(username, alias)')
      .eq('espacio_id', state.currentSpace.id)
      .order('creado_en', { ascending: false });

    state.songs = data || [];
    renderSongs();
  } catch (err) {}
}

function renderSongs() {
  const container = document.getElementById('music-grid-container');
  if (!container) return;
  if (state.songs.length === 0) {
    container.innerHTML = `<p style="color: #cbd5e1; grid-column: 1 / -1; text-align: center; padding: 2rem;">Aún no han dedicado canciones en el pizarrón. ¡Comparte su canción favorita de YouTube o Spotify! 🎶</p>`;
    return;
  }

  container.innerHTML = state.songs.map((song) => {
    const isAuthor = song.autor_id === state.currentUser.id;
    const authorName = song.autor?.alias || (isAuthor ? 'Tú' : 'Tu Pareja');
    return `
      <div class="music-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <h4 class="music-card-title">🎵 ${escapeHtml(song.titulo)}</h4>
          <button class="btn-icon" onclick="window.deleteSong('${song.id}')" title="Eliminar">🗑️</button>
        </div>
        ${song.dedicatoria ? `<p class="music-card-dedication">"${escapeHtml(song.dedicatoria)}"</p>` : ''}
        <div class="music-embed-container">
          ${getMusicEmbedHtml(song.url)}
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8; text-align: right;">Dedicada por: ${escapeHtml(authorName)}</div>
      </div>
    `;
  }).join('');
}

async function handleCreateSong(e) {
  e.preventDefault();
  const title = document.getElementById('music-title').value.trim();
  const url = document.getElementById('music-url').value.trim();
  const ded = document.getElementById('music-dedication').value.trim();
  if (!title || !url) return;

  try {
    const { error } = await supabase.from('canciones_pizarron').insert({
      espacio_id: state.currentSpace.id,
      autor_id: state.currentUser.id,
      titulo: title,
      url: url,
      dedicatoria: ded
    });
    if (error) throw error;
    document.getElementById('form-create-music').reset();
    closeModal('modal-music');
    showToast('¡Canción dedicada en el pizarrón! 🎵', 'success');
    await loadSongs();
  } catch (err) {
    showToast(err.message || 'Error al guardar canción', 'error');
  }
}

window.deleteSong = async function(id) {
  if (!confirm('¿Eliminar esta canción del pizarrón?')) return;
  await supabase.from('canciones_pizarron').delete().eq('id', id);
  await loadSongs();
};

window.showReactionPicker = function(id) { document.getElementById(`react-picker-${id}`)?.classList.toggle('hidden'); };
window.toggleNoteReaction = async function(noteId, emoji) {
  document.getElementById(`react-picker-${noteId}`)?.classList.add('hidden');
  try {
    await supabase.from('reacciones_notas').upsert({ nota_id: noteId, usuario_id: state.currentUser.id, emoji: emoji });
    await loadNotes();
  } catch (err) {}
};
window.deleteNote = async function(id) {
  if (!confirm('¿Eliminar esta nota?')) return;
  await supabase.from('notas').delete().eq('id', id);
  await loadNotes();
};
window.togglePinNote = async function(id, val) {
  await supabase.from('notas').update({ fijada: val }).eq('id', id);
  await loadNotes();
};

// ==============================================================================
// 7. ARCADE: SISTEMA GLOBAL & JUEGOS
// ==============================================================================
async function loadArcadeScores() {
  if (!state.currentSpace) return;
  try {
    const { data } = await supabase.from('puntuaciones_arcade').select('*').eq('espacio_id', state.currentSpace.id).maybeSingle();
    if (data) {
      state.globalScore.winsP1 = data.wins_p1 || 0;
      state.globalScore.winsP2 = data.wins_p2 || 0;
    }
  } catch (err) {
    const local = JSON.parse(localStorage.getItem('arcade_global_scores') || '{"winsP1":0,"winsP2":0}');
    state.globalScore = local;
  }
  updateGlobalScoreUI();
}

function updateGlobalScoreUI() {
  document.getElementById('global-score-p1').innerText = state.globalScore.winsP1;
  document.getElementById('global-score-p2').innerText = state.globalScore.winsP2;
}

async function addGlobalWin(player) {
  if (player === 'P1') state.globalScore.winsP1++;
  else state.globalScore.winsP2++;
  updateGlobalScoreUI();

  try {
    await supabase.rpc('sumar_victoria_arcade', { p_jugador: player });
  } catch (err) {
    localStorage.setItem('arcade_global_scores', JSON.stringify(state.globalScore));
  }
}

async function resetGlobalScore() {
  if (!confirm('¿Reiniciar el marcador global de rondas a 0?')) return;
  state.globalScore.winsP1 = 0;
  state.globalScore.winsP2 = 0;
  updateGlobalScoreUI();
  try {
    await supabase.rpc('reiniciar_marcador_arcade');
    showToast('Marcador global reiniciado 🔄', 'info');
  } catch (err) {
    localStorage.setItem('arcade_global_scores', JSON.stringify(state.globalScore));
  }
}

function initArcadeSystems() {
  // Selector de juegos
  document.querySelectorAll('.arcade-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('.arcade-chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const g = e.currentTarget.dataset.game;
      const gameCards = ['rps', 'ttt', 'checkers', 'chess', 'trivia', 'vor', 'tnt', 'coop'];
      gameCards.forEach(id => {
        document.getElementById(`game-${id}`)?.classList.toggle('hidden', id !== g);
      });

      // Juegos 1v1 online: RPS, Ajedrez y Damas -> matchmaking + tiempo real
      if (g === 'rps' || g === 'checkers' || g === 'chess') {
        startArcadeGame(g);
      } else if (g === 'ttt') {
        buildTttBoard();
      }
    });
  });

  // Acciones de la partida 1v1
  document.getElementById('btn-chess-reset')?.addEventListener('click', requestNextRound);
  document.getElementById('btn-checkers-reset')?.addEventListener('click', requestNextRound);
  document.getElementById('btn-arcade-cancel-wait')?.addEventListener('click', cancelArcadeWaiting);

  // Botones de Piedra, Papel o Tijera
  document.querySelectorAll('.rps-hand-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRpsChoice(btn.dataset.choice));
  });

  // Reinicio global
  document.getElementById('btn-reset-global-score')?.addEventListener('click', resetGlobalScore);

  // 3 en Raya adaptable (3x3 a 8x8)
  initDynamicTtt();

  // Trivia
  initTriviaSystem();

  // Verdad o Reto
  initVorSystem();

  // Esto o Aquello
  initTntSystem();

  // Cooperativo Canvas
  initCoopGame();
}

// ------------------------------------------------------------------------------
// ARCADE 1v1: HELPERS DE NOMBRES Y COLORES
// ------------------------------------------------------------------------------
function arcadeMyName() {
  return state.currentProfile?.alias || state.currentProfile?.username || 'Tú';
}
function arcadePartnerName() {
  return state.partnerProfile?.alias || state.partnerProfile?.username || 'Tu Pareja';
}
function arcadeMyColor() {
  // Ajedrez: player_1 siempre juega Blancas
  return state.arcade.myRole === 'player_1' ? 'white' : 'black';
}
function arcadeMyRedColor() {
  // Damas: player_1 siempre juega rojo/Corazones ❤️
  return state.arcade.myRole === 'player_1' ? 'red' : 'black';
}
function deepCopyMatrix(m) {
  return (m || []).map(row => (Array.isArray(row) ? row.slice() : row));
}

function updateSessionScore(gameType) {
  const s = state.arcade.scores;
  const el = document.getElementById(`${gameType}-session-score`);
  if (el) el.innerText = `${arcadeMyName()}  ${s.p1}  -  ${s.p2}  ${arcadePartnerName()}`;
}

// ------------------------------------------------------------------------------
// ARCADE 1v1: MATCHMAKING + REALTIME (enlace de sala / room_id)
// ------------------------------------------------------------------------------
async function startArcadeGame(gameType) {
  if (!state.currentUser?.id || !state.currentSpace) {
    showToast('Inicia sesión y vincula tu espacio para jugar en línea', 'error');
    return;
  }

  leaveArcadeChannel();
  state.arcade.finished = false;
  state.arcade.rpsChoice = null;
  state.arcade.rev = 0;
  const modeLabel = { rps: 'Piedra, Papel o Tijera', chess: 'Ajedrez', checkers: 'Damas' }[gameType] || gameType;
  updateSessionScore(gameType);

  const { data, error } = await supabase.rpc('arcade_find_or_create', { p_game_type: gameType });
  if (error || !data) {
    showToast(error?.message || 'Error al buscar o crear la sala', 'error');
    return;
  }

  state.arcade.matchId = data.match_id;
  applyMatchRow(data);
  subscribeArcadeMatch(data.match_id);

  // Mostrar overlay de espera solo si no inició todavía
  showArcadeWaiting(state.arcade.status === 'waiting', gameType);
  if (state.arcade.status === 'in_progress') {
    showToast(`Partida de ${modeLabel} conectada 🤝`, 'info');
  }
}

function applyMatchRow(row) {
  const a = state.arcade;
  a.matchId = row.match_id;
  a.gameType = row.game_type;
  a.player1Id = row.player_1_id;
  a.player2Id = row.player_2_id;
  a.winnerId = row.winner_id || null;
  a.myRole = row.player_1_id === state.currentUser.id ? 'player_1' : 'player_2';
  a.scores = {
    p1: (row.scores && row.scores.p1) || 0,
    p2: (row.scores && row.scores.p2) || 0
  };
  a.boardState = row.board_state || {};
  a.status = row.status;
  a.rev = row.rev || 0;
  a.isMyTurn = !!row.current_turn && row.current_turn === state.currentUser.id;
  a.finished = row.status === 'finished';

  if (row.game_type === 'chess') {
    state.chess.myColor = arcadeMyColor();
    state.chess.turn = a.isMyTurn ? arcadeMyColor() : (arcadeMyColor() === 'white' ? 'black' : 'white');
    state.chess.board = deepCopyMatrix(a.boardState.board || createChessBoard());
    state.chess.selected = null;
    state.chess.validMoves = [];
    state.chess.active = !a.finished;
    renderChess();
  } else if (row.game_type === 'checkers') {
    state.checkers.myColor = arcadeMyRedColor();
    state.checkers.turn = a.isMyTurn ? arcadeMyRedColor() : (arcadeMyRedColor() === 'red' ? 'black' : 'red');
    state.checkers.board = deepCopyMatrix(a.boardState.board || createCheckersBoard());
    state.checkers.selected = null;
    state.checkers.validMoves = [];
    state.checkers.active = !a.finished;
    renderCheckers();
  } else if (row.game_type === 'rps') {
    state.arcade.rpsChoice = null;
    renderRps();
  }

  updateArcadeMatchUI();
}

function handleArcadeMatchEvent(row) {
  const a = state.arcade;
  if (!row || row.id !== a.matchId) return;
  const wasWaiting = a.status === 'waiting';
  const wasFinished = a.finished;

  applyMatchRow(row);

  if (wasWaiting && a.status === 'in_progress') {
    showArcadeWaiting(false);
    const modeLabel = { rps: 'Piedra, Papel o Tijera', chess: 'Ajedrez', checkers: 'Damas' }[a.gameType] || '';
    showToast(`🎉 ¡Tu pareja se unió! Comienza ${modeLabel}`, 'success');
  }

  // Cuando una ronda de Ajedrez/Damas termina (viene del oponente)
  if (wasFinished !== a.finished && a.finished) {
    showToast(arcadeFinishText(), a.winnerId === state.currentUser.id ? 'success' : 'info');
  }
}

function subscribeArcadeMatch(matchId) {
  if (!matchId) return;
  leaveArcadeChannel();

  state.arcade.channel = supabase
    .channel(`arcade-match-${matchId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'arcade_matches',
      filter: `id=eq.${matchId}`
    }, (payload) => {
      if (payload.new && (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT')) {
        handleArcadeMatchEvent(payload.new);
      }
    })
    .subscribe((status) => {
      // Hidratar por si se perdieron eventos mientras no había suscripción
      if (status === 'SUBSCRIBED') {
        supabase.from('arcade_matches')
          .select('*')
          .eq('id', matchId)
          .single()
          .then(({ data }) => { if (data) handleArcadeMatchEvent(data); })
          .catch(() => {});
      }
    });
}

function leaveArcadeChannel() {
  if (state.arcade.channel) {
    supabase.removeChannel(state.arcade.channel);
    state.arcade.channel = null;
  }
}

function showArcadeWaiting(show, gameType) {
  const overlay = document.getElementById('arcade-waiting-overlay');
  if (!overlay) return;
  state.arcade.waiting = show;
  overlay.classList.toggle('hidden', !show);
  if (show) {
    const partnerEl = document.getElementById('arcade-waiting-partner');
    if (partnerEl) partnerEl.innerText = arcadePartnerName();
  }
}

async function cancelArcadeWaiting() {
  const a = state.arcade;
  if (a.matchId) {
    await supabase.rpc('arcade_cancel_waiting', { p_match_id: a.matchId }).catch(() => {});
  }
  leaveArcadeChannel();
  state.arcade.matchId = null;
  state.arcade.status = null;
  showArcadeWaiting(false);
  showToast('Sala cancelada', 'info');
}

async function requestNextRound() {
  const a = state.arcade;
  if (!a.matchId) return;
  if (a.status === 'in_progress' && !a.finished && a.gameType !== 'rps') {
    if (!confirm('¿Reiniciar la ronda en curso? Los movimientos actuales se descartarán.')) return;
  }
  const { error } = await supabase.rpc('arcade_next_round', { p_match_id: a.matchId });
  if (error) showToast(error.message || 'No se pudo iniciar la siguiente ronda', 'error');
}

function arcadeFinishText() {
  const a = state.arcade;
  if (!a.winnerId) return '🤝 ¡Empate en esta ronda!';
  if (a.winnerId === state.currentUser.id) return '🏆 ¡Ganaste esta ronda! (+1 al marcador)';
  return `🌟 Ganó ${arcadePartnerName()} esta ronda`;
}

function updateArcadeMatchUI() {
  const a = state.arcade;
  if (!a.gameType) return;
  updateSessionScore(a.gameType);

  const bannerId = a.gameType === 'chess' ? 'chess-finished-banner' : (a.gameType === 'checkers' ? 'checkers-finished-banner' : null);
  if (bannerId) {
    const banner = document.getElementById(bannerId);
    if (banner) {
      banner.classList.toggle('hidden', a.status !== 'finished');
      if (a.status === 'finished') banner.innerText = arcadeFinishText();
    }
  }
}

function setupArcadeCleanup() {
  if (state.arcade.cleanupInterval) clearInterval(state.arcade.cleanupInterval);
  // Ejecuta la limpieza de partidas viejas cada 15 minutos (respaldo del cron SQL)
  state.arcade.cleanupInterval = setInterval(() => {
    supabase.rpc('arcade_cleanup_old_matches').catch(() => {});
    supabase.rpc('trivia_cleanup_old_rounds').catch(() => {});
  }, 15 * 60 * 1000);
}

// ------------------------------------------------------------------------------
// PIEDRA, PAPEL O TIJERA (MULTIJUGADOR ONLINE - SELECCIÓN CIEGA SIMULTÁNEA)
// ------------------------------------------------------------------------------
const RPS_EMOJIS = { piedra: '✊', papel: '✋', tijera: '✌️' };

function handleRpsChoice(choice) {
  const a = state.arcade;
  if (!a.matchId) {
    showToast('Sin sala activa, reconectando...', 'info');
    startArcadeGame('rps');
    return;
  }
  if (a.status !== 'in_progress') {
    showToast('La partida aún no ha comenzado', 'info');
    return;
  }
  if (a.rpsChoice || a.boardState.last_result) return; // ya elegiste o se está revelando

  supabase.rpc('arcade_rps_choose', { p_match_id: a.matchId, p_choice: choice })
    .then(({ error }) => {
      if (error) {
        // Probablemente ya se envió (evento en camino) o la ronda se reinició
        if (error.message && !error.message.includes('Ya has elegido')) {
          showToast(error.message || 'No se pudo enviar tu jugada', 'error');
        }
        return;
      }
      a.rpsChoice = choice;
      renderRps();
    });
}

function renderRps() {
  const a = state.arcade;
  const buttons = [...document.querySelectorAll('.rps-hand-btn')];
  const resultEl = document.getElementById('rps-result');
  const myEmojiEl = document.getElementById('rps-my-emoji');
  const partnerEmojiEl = document.getElementById('rps-partner-emoji');
  const myCard = document.getElementById('rps-my-card');
  const partnerCard = document.getElementById('rps-partner-card');
  const myNameEl = document.getElementById('rps-my-name');
  const partnerNameEl = document.getElementById('rps-partner-name');

  if (!resultEl || !myEmojiEl) return;
  myNameEl.innerText = arcadeMyName();
  partnerNameEl.innerText = arcadePartnerName();
  updateSessionScore('rps');

  const bs = a.boardState || {};

  const showReveal = (lr) => {
    const myChoice = a.myRole === 'player_1' ? lr.p1_choice : lr.p2_choice;
    const partnerChoice = a.myRole === 'player_1' ? lr.p2_choice : lr.p1_choice;

    myEmojiEl.innerText = RPS_EMOJIS[myChoice] || '❓';
    partnerEmojiEl.innerText = RPS_EMOJIS[partnerChoice] || '❓';
    myCard.classList.add('revealed');
    partnerCard.classList.add('revealed');
    buttons.forEach(b => { b.disabled = true; b.classList.remove('picked'); });

    const iWon = (lr.winner === 'p1' && a.myRole === 'player_1') ||
                 (lr.winner === 'p2' && a.myRole === 'player_2');
    if (lr.winner === 'draw') {
      resultEl.innerText = `🤝 ¡Empate! (${RPS_EMOJIS[lr.p1_choice]} vs ${RPS_EMOJIS[lr.p2_choice]})`;
    } else if (iWon) {
      resultEl.innerText = `🎉 ¡Ganaste esta ronda! (+1 al marcador)`;
    } else {
      resultEl.innerText = `🌟 Ganó ${arcadePartnerName()} esta ronda`;
    }

    if (a.rpsRevealTimer) clearTimeout(a.rpsRevealTimer);
    // Tras el reveal, dejar la mesa lista para la siguiente ronda
    a.rpsRevealTimer = setTimeout(() => {
      a.boardState.last_result = null;
      a.rpsChoice = null;
      myEmojiEl.innerText = '❓';
      partnerEmojiEl.innerText = '❓';
      myCard.classList.remove('revealed');
      partnerCard.classList.remove('revealed');
      resultEl.innerText = 'Haz clic en tu jugada para comenzar la ronda';
      buttons.forEach(b => { b.disabled = false; b.classList.remove('picked'); });
    }, 1800);
  };

  // Revelación pendiente: mostrar ambas elecciones al mismo tiempo
  if (bs.last_result) {
    showReveal(bs.last_result);
    return;
  }

  // Ronda en curso: cada quien elige en secreto
  buttons.forEach(b => {
    b.disabled = false;
    b.classList.toggle('picked', a.rpsChoice === b.dataset.choice);
  });

  const partnerSlot = a.myRole === 'player_1' ? 'p2' : 'p1';
  if (a.rpsChoice) {
    myEmojiEl.innerText = '🤔';
    resultEl.innerText = 'Jugada enviada. Esperando a tu pareja...';
  } else {
    myEmojiEl.innerText = '❓';
    resultEl.innerText = 'Haz clic en tu jugada para comenzar la ronda';
  }
  partnerEmojiEl.innerText = bs[partnerSlot] ? '🤔' : '❓';
}

// ------------------------------------------------------------------------------
// 3 EN RAYA ADAPTABLE (3x3 A 8x8)
// ------------------------------------------------------------------------------
function initDynamicTtt() {
  const select = document.getElementById('select-ttt-size');
  select?.addEventListener('change', (e) => {
    state.ttt.size = parseInt(e.target.value, 10);
    buildTttBoard();
  });
  document.getElementById('btn-ttt-reset')?.addEventListener('click', buildTttBoard);
  buildTttBoard();
}

function buildTttBoard() {
  const size = state.ttt.size;
  state.ttt.board = Array(size * size).fill('');
  state.ttt.active = true;

  const container = document.getElementById('ttt-dynamic-container');
  if (!container) return;
  container.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  container.innerHTML = '';

  for (let i = 0; i < size * size; i++) {
    const cell = document.createElement('div');
    cell.className = 'ttt-dynamic-cell';
    cell.dataset.idx = i;
    cell.addEventListener('click', () => handleDynamicTttMove(i));
    container.appendChild(cell);
  }
  updateTttTurnLabel();
}

function updateTttTurnLabel() {
  const mark = state.ttt.turn === 'P1' ? '❤️' : '⭐';
  const name = state.ttt.turn === 'P1' ? (state.currentProfile?.alias || 'Tú') : (state.partnerProfile?.alias || 'Tu Pareja');
  document.getElementById('ttt-turn-label').innerText = `Turno de: ${mark} ${name}`;
}

function handleDynamicTttMove(idx) {
  if (!state.ttt.active || state.ttt.board[idx] !== '') return;
  const mark = state.ttt.turn === 'P1' ? '❤️' : '⭐';
  state.ttt.board[idx] = mark;

  const cell = document.querySelector(`.ttt-dynamic-cell[data-idx="${idx}"]`);
  cell.innerText = mark;
  cell.classList.add('taken');

  if (checkDynamicTttWinner()) {
    state.ttt.active = false;
    const winnerName = state.ttt.turn === 'P1' ? (state.currentProfile?.alias || 'Tú') : (state.partnerProfile?.alias || 'Tu Pareja');
    document.getElementById('ttt-turn-label').innerText = `🎉 ¡Victoria de ${winnerName}! (+1 al Marcador Global)`;
    addGlobalWin(state.ttt.turn);
    showToast(`🏆 ¡${winnerName} ganó la ronda!`, 'success');
    return;
  }

  if (state.ttt.board.every(c => c !== '')) {
    state.ttt.active = false;
    document.getElementById('ttt-turn-label').innerText = '🤝 ¡Empate con amor!';
    return;
  }

  state.ttt.turn = state.ttt.turn === 'P1' ? 'P2' : 'P1';
  updateTttTurnLabel();
}

function checkDynamicTttWinner() {
  const s = state.ttt.size;
  const target = s === 3 ? 3 : (s <= 5 ? 4 : 5); // 3 en raya, 4 en 4x4-5x5, 5 en 6x6+
  const b = state.ttt.board;

  function get(r, c) {
    if (r < 0 || r >= s || c < 0 || c >= s) return '';
    return b[r * s + c];
  }

  for (let r = 0; r < s; r++) {
    for (let c = 0; c < s; c++) {
      const val = get(r, c);
      if (!val) continue;

      const dirs = [[0,1], [1,0], [1,1], [1,-1]];
      for (const [dr, dc] of dirs) {
        let win = true;
        for (let k = 1; k < target; k++) {
          if (get(r + dr * k, c + dc * k) !== val) { win = false; break; }
        }
        if (win) return true;
      }
    }
  }
  return false;
}

// ------------------------------------------------------------------------------
// DAMAS (CHECKERS) MULTIJUGADOR ONLINE
// ------------------------------------------------------------------------------
function createCheckersBoard() {
  const board = Array(8).fill(null).map(() => Array(8).fill(null));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = 'b';
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = 'r';
    }
  }
  return board;
}

function renderCheckers() {
  const container = document.getElementById('checkers-board-container');
  if (!container) return;
  container.innerHTML = '';

  const a = state.arcade;
  const label = document.getElementById('checkers-turn-label');

  if (a.finished) {
    label.innerText = '🏁 Ronda terminada';
  } else if (!a.isMyTurn) {
    label.innerText = `⏳ Turno de ${arcadePartnerName()}`;
  } else {
    const colorName = state.checkers.myColor === 'red' ? 'Corazones ❤️' : 'Estrellas ⭐';
    label.innerText = `👉 Tu turno (${colorName})`;
  }

  container.classList.toggle('board-locked', !a.isMyTurn || a.finished);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div');
      cell.className = `checkers-cell ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      if (state.checkers.selected && state.checkers.selected.r === r && state.checkers.selected.c === c) {
        cell.classList.add('selected');
      }
      const isValid = state.checkers.validMoves.some(m => m.r === r && m.c === c);
      if (isValid) cell.classList.add('valid-move');

      const piece = state.checkers.board?.[r]?.[c];
      if (piece) {
        if (piece === 'r') cell.innerText = '❤️';
        else if (piece === 'R') cell.innerText = '👑';
        else if (piece === 'b') cell.innerText = '⭐';
        else if (piece === 'B') cell.innerText = '💎';
      }
      cell.addEventListener('click', () => handleCheckersClick(r, c));
      container.appendChild(cell);
    }
  }
}

function handleCheckersClick(r, c) {
  const a = state.arcade;
  if (!state.checkers.active || a.finished || !a.isMyTurn) return;
  const piece = state.checkers.board[r][c];

  // Si hace clic en un movimiento válido (incluye saltos/capturas)
  const move = state.checkers.validMoves.find(m => m.r === r && m.c === c);
  if (move && state.checkers.selected) {
    const { r: fromR, c: fromC } = state.checkers.selected;
    const movingPiece = state.checkers.board[fromR][fromC];

    state.checkers.board[fromR][fromC] = null;
    state.checkers.board[r][c] = movingPiece;

    // Captura (salto sobre ficha rival)
    if (move.captured) {
      state.checkers.board[move.captured.r][move.captured.c] = null;
    }

    // Coronación de reina
    if (movingPiece === 'r' && r === 0) state.checkers.board[r][c] = 'R';
    if (movingPiece === 'b' && r === 7) state.checkers.board[r][c] = 'B';

    state.checkers.selected = null;
    state.checkers.validMoves = [];

    // ¿Terminó la ronda con esta jugada?
    const winnerRole = checkCheckersWinner();
    if (winnerRole) {
      state.checkers.active = false;
      showToast('🏆 ¡Ronda terminada! Sincronizando resultado...', 'success');
    }
    submitCheckersMove(winnerRole);
    renderCheckers();
    return;
  }

  // Seleccionar ficha propia (solo en tu turno)
  if (piece && ((state.checkers.myColor === 'red' && piece.toLowerCase() === 'r') ||
                (state.checkers.myColor === 'black' && piece.toLowerCase() === 'b'))) {
    state.checkers.selected = { r, c };
    state.checkers.validMoves = getCheckersMoves(r, c, piece);
    renderCheckers();
  }
}

async function submitCheckersMove(winnerRole) {
  const a = state.arcade;
  if (!a.matchId) {
    showToast('Sin sala activa, reconectando...', 'info');
    startArcadeGame('checkers');
    return;
  }
  const payload = { board: deepCopyMatrix(state.checkers.board) };
  if (winnerRole) payload.result = winnerRole;
  const { error } = await supabase.rpc('arcade_turn_move', {
    p_match_id: a.matchId,
    p_board: payload,
    p_rev: a.rev
  });
  if (error) {
    showToast(error.message || 'No se pudo enviar tu jugada', 'error');
  }
}

function getCheckersMoves(r, c, piece) {
  const moves = [];
  const isKing = piece === 'R' || piece === 'B';
  const dirs = [];
  if (piece.toLowerCase() === 'r' || isKing) dirs.push([-1, -1], [-1, 1]);
  if (piece.toLowerCase() === 'b' || isKing) dirs.push([1, -1], [1, 1]);

  dirs.forEach(([dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      if (!state.checkers.board[nr][nc]) {
        moves.push({ r: nr, c: nc });
      } else if (state.checkers.board[nr][nc].toLowerCase() !== piece.toLowerCase()) {
        const jumpR = nr + dr, jumpC = nc + dc;
        if (jumpR >= 0 && jumpR < 8 && jumpC >= 0 && jumpC < 8 && !state.checkers.board[jumpR][jumpC]) {
          moves.push({ r: jumpR, c: jumpC, captured: { r: nr, c: nc } });
        }
      }
    }
  });
  return moves;
}

function checkCheckersWinner() {
  let hasRed = false, hasBlack = false;
  state.checkers.board.flat().forEach(p => {
    if (p?.toLowerCase() === 'r') hasRed = true;
    if (p?.toLowerCase() === 'b') hasBlack = true;
  });
  if (!hasRed) return 'p2';     // Estrellas ⭐ (player_2)
  if (!hasBlack) return 'p1';   // Corazones ❤️ (player_1)
  return null;
}

// ------------------------------------------------------------------------------
// AJEDREZ (CHESS) MULTIJUGADOR ONLINE
// ------------------------------------------------------------------------------
const CHESS_PIECES = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};

function createChessBoard() {
  return [
    ['bR','bN','bB','bQ','bK','bB','bN','bR'],
    ['bP','bP','bP','bP','bP','bP','bP','bP'],
    Array(8).fill(null), Array(8).fill(null), Array(8).fill(null), Array(8).fill(null),
    ['wP','wP','wP','wP','wP','wP','wP','wP'],
    ['wR','wN','wB','wQ','wK','wB','wN','wR']
  ];
}

function renderChess() {
  const container = document.getElementById('chess-board-container');
  if (!container) return;
  container.innerHTML = '';

  const a = state.arcade;
  const label = document.getElementById('chess-turn-label');

  if (a.finished) {
    label.innerText = '🏁 Ronda terminada';
  } else if (!a.isMyTurn) {
    label.innerText = `⏳ Turno de ${arcadePartnerName()}`;
  } else {
    const colorName = state.chess.myColor === 'white' ? 'Blancas ⚪' : 'Negras ⚫';
    label.innerText = `👉 Tu turno (${colorName})`;
  }

  // Bloquea la interfaz completa de quien no tiene el turno
  container.classList.toggle('board-locked', !a.isMyTurn || a.finished);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div');
      cell.className = `chess-cell ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      if (state.chess.selected?.r === r && state.chess.selected?.c === c) cell.classList.add('selected');
      if (state.chess.validMoves.some(m => m.r === r && m.c === c)) cell.classList.add('valid-move');

      // Piezas con color sólido e inconfundible (#FFFFFF vs #1A1A1A)
      const p = state.chess.board?.[r]?.[c];
      if (p) {
        const tone = p[0] === 'w' ? 'white' : 'black';
        cell.innerHTML = `<span class="chess-piece ${tone}">${CHESS_PIECES[p] || ''}</span>`;
      }

      cell.addEventListener('click', () => handleChessClick(r, c));
      container.appendChild(cell);
    }
  }
}

function handleChessClick(r, c) {
  const a = state.arcade;
  if (!state.chess.active || a.finished || !a.isMyTurn) return;
  const p = state.chess.board[r][c];
  const isMove = state.chess.validMoves.some(m => m.r === r && m.c === c);

  if (isMove && state.chess.selected) {
    const { r: fr, c: fc } = state.chess.selected;
    const movingPiece = state.chess.board[fr][fc];
    const targetPiece = state.chess.board[r][c];

    // Detecta jaque mate (captura del rey) como victoria de la ronda
    let winnerRole = null;
    if (targetPiece === 'bK') winnerRole = 'p1';
    else if (targetPiece === 'wK') winnerRole = 'p2';

    state.chess.board[r][c] = movingPiece;
    state.chess.board[fr][fc] = null;

    state.chess.selected = null;
    state.chess.validMoves = [];

    if (winnerRole) {
      state.chess.active = false;
      showToast('🏆 ¡Jaque Mate! Sincronizando resultado...', 'success');
    }
    submitChessMove(fr, fc, r, c, winnerRole);
    renderChess();
    return;
  }

  // Seleccionar pieza propia (solo en tu turno)
  if (p && ((state.chess.myColor === 'white' && p[0] === 'w') ||
            (state.chess.myColor === 'black' && p[0] === 'b'))) {
    state.chess.selected = { r, c };
    state.chess.validMoves = getBasicChessMoves(r, c, p);
    renderChess();
  }
}

async function submitChessMove(fr, fc, tr, tc, winnerRole) {
  const a = state.arcade;
  if (!a.matchId) {
    showToast('Sin sala activa, reconectando...', 'info');
    startArcadeGame('chess');
    return;
  }
  const payload = {
    board: deepCopyMatrix(state.chess.board),
    from: [fr, fc],
    to: [tr, tc]
  };
  if (winnerRole) payload.result = winnerRole;
  const { error } = await supabase.rpc('arcade_turn_move', {
    p_match_id: a.matchId,
    p_board: payload,
    p_rev: a.rev
  });
  if (error) {
    showToast(error.message || 'No se pudo enviar tu jugada', 'error');
  }
}

function getBasicChessMoves(r, c, p) {
  const moves = [];
  const color = p[0];
  const type = p[1];

  function addIfEmptyOrOpponent(nr, nc) {
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const occ = state.chess.board[nr][nc];
      if (!occ) { moves.push({ r: nr, c: nc }); return true; }
      if (occ[0] !== color) { moves.push({ r: nr, c: nc }); return false; }
    }
    return false;
  }

  // Peón
  if (type === 'P') {
    const dir = color === 'w' ? -1 : 1;
    if (!state.chess.board[r + dir]?.[c]) moves.push({ r: r + dir, c });
    if (state.chess.board[r + dir]?.[c - 1]?.[0] && state.chess.board[r + dir][c - 1][0] !== color) moves.push({ r: r + dir, c: c - 1 });
    if (state.chess.board[r + dir]?.[c + 1]?.[0] && state.chess.board[r + dir][c + 1][0] !== color) moves.push({ r: r + dir, c: c + 1 });
  }

  // Torre o Reina
  if (type === 'R' || type === 'Q') {
    [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr,dc]) => {
      for (let i = 1; i < 8; i++) { if (!addIfEmptyOrOpponent(r + dr*i, c + dc*i)) break; }
    });
  }

  // Alfil o Reina
  if (type === 'B' || type === 'Q') {
    [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc]) => {
      for (let i = 1; i < 8; i++) { if (!addIfEmptyOrOpponent(r + dr*i, c + dc*i)) break; }
    });
  }

  // Caballo
  if (type === 'N') {
    [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]].forEach(([dr,dc]) => addIfEmptyOrOpponent(r + dr, c + dc));
  }

  // Rey
  if (type === 'K') {
    [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc]) => addIfEmptyOrOpponent(r + dr, c + dc));
  }

  return moves;
}

// ------------------------------------------------------------------------------
// TRIVIA DE PAREJA PERSONALIZADA (5 A 20 PREGUNTAS)
// ------------------------------------------------------------------------------
const DEFAULT_TRIVIA = [
  { q: '¿Dónde fue nuestro primer beso o primera cita?', opts: ['En un parque', 'En el cine', 'En una cafetería/restaurante', 'En casa'], ans: 0 },
  { q: '¿Quién suele tardar más en arreglarse antes de salir?', opts: ['Yo', 'Mi pareja', 'Ambos igual', 'Depende de la ocasión'], ans: 1 },
  { q: '¿Cuál es nuestra comida favorita para comer juntos?', opts: ['Pizza / Hamburguesas', 'Sushi / Comida asiática', 'Tacos / Comida típica', 'Postres y helado'], ans: 0 },
  { q: '¿Quién dijo "te amo" primero?', opts: ['Yo', 'Mi pareja', 'Al mismo tiempo', 'Fue por mensaje'], ans: 1 },
  { q: '¿Qué plan describe nuestro domingo perfecto?', opts: ['Maratón de películas y cobijas', 'Paseo al aire libre', 'Cocinar algo rico juntos', 'Dormir hasta tarde'], ans: 0 },
  { q: '¿Cuál es el destino de viaje que más deseamos visitar?', opts: ['Una playa paradisíaca', 'Europa / Japón', 'Una cabaña en la nieve', 'Pueblito mágico'], ans: 0 },
  { q: '¿Quién se duerme primero viendo una película?', opts: ['Yo', 'Mi pareja', 'Casi nunca nos dormimos', 'Siempre los dos'], ans: 1 },
  { q: '¿Cuál es la fecha de nuestro aniversario?', opts: ['La tengo grabada en el corazón', 'Siempre dudo del día', 'La tengo en mi alarma', 'A veces la olvido'], ans: 0 }
];

function initTriviaSystem() {
  document.getElementById('btn-open-add-trivia-modal')?.addEventListener('click', () => openModal('modal-trivia-add'));
  document.getElementById('form-create-trivia')?.addEventListener('submit', handleAddCustomTrivia);
  document.getElementById('btn-start-trivia')?.addEventListener('click', startTriviaQuiz);
  document.getElementById('btn-next-trivia-q')?.addEventListener('click', nextTriviaQuestion);
  document.getElementById('btn-restart-trivia-menu')?.addEventListener('click', () => {
    document.getElementById('trivia-result-box').classList.add('hidden');
    document.getElementById('trivia-setup-box').classList.remove('hidden');
  });
}

async function handleAddCustomTrivia(e) {
  e.preventDefault();
  const q = document.getElementById('tq-question').value.trim();
  const opt0 = document.getElementById('tq-opt-0').value.trim();
  const opt1 = document.getElementById('tq-opt-1').value.trim();
  const opt2 = document.getElementById('tq-opt-2').value.trim();
  const correct = parseInt(document.querySelector('input[name="tq-correct"]:checked').value, 10);

  try {
    await supabase.from('trivias_pareja').insert({
      espacio_id: state.currentSpace.id,
      creado_por: state.currentUser.id,
      pregunta: q,
      opciones: [opt0, opt1, opt2],
      indice_correcto: correct
    });
    document.getElementById('form-create-trivia').reset();
    closeModal('modal-trivia-add');
    showToast('¡Pregunta de trivia guardada! 🧠', 'success');
  } catch (err) {
    showToast('Guardada localmente', 'info');
  }
}

async function startTriviaQuiz() {
  const count = parseInt(document.getElementById('select-trivia-count').value, 10);
  let pool = [...DEFAULT_TRIVIA];

  try {
    const { data } = await supabase.from('trivias_pareja').select('*').eq('espacio_id', state.currentSpace.id);
    if (data && data.length > 0) {
      const customFormatted = data.map(d => ({ q: d.pregunta, opts: d.opciones, ans: d.indice_correcto }));
      pool = [...pool, ...customFormatted];
    }
  } catch (err) {}

  // Barajar
  pool.sort(() => Math.random() - 0.5);
  state.trivia.activeQuiz = pool.slice(0, Math.min(count, pool.length));
  state.trivia.totalQuestions = state.trivia.activeQuiz.length;
  state.trivia.currentIndex = 0;
  state.trivia.scoreP1 = 0;

  document.getElementById('trivia-setup-box').classList.add('hidden');
  document.getElementById('trivia-result-box').classList.add('hidden');
  document.getElementById('trivia-game-box').classList.remove('hidden');

  // Abre/comparte la ronda con tu pareja para comparar aciertos al final
  initializeTriviaRound();

  renderTriviaQuestion();
}

function renderTriviaQuestion() {
  const qObj = state.trivia.activeQuiz[state.trivia.currentIndex];
  document.getElementById('trivia-progress-label').innerText = `Pregunta ${state.trivia.currentIndex + 1} de ${state.trivia.totalQuestions}`;
  document.getElementById('trivia-question-text').innerText = qObj.q;
  document.getElementById('trivia-feedback').innerText = '';
  document.getElementById('btn-next-trivia-q').classList.add('hidden');

  const container = document.getElementById('trivia-options-container');
  container.innerHTML = qObj.opts.map((opt, i) => `
    <button class="trivia-opt-btn" onclick="window.chooseTriviaOption(${i})">${escapeHtml(opt)}</button>
  `).join('');
}

window.chooseTriviaOption = function(idx) {
  const qObj = state.trivia.activeQuiz[state.trivia.currentIndex];
  const buttons = document.querySelectorAll('.trivia-opt-btn');
  buttons.forEach(b => b.disabled = true);

  if (idx === qObj.ans) {
    buttons[idx].classList.add('correct');
    document.getElementById('trivia-feedback').innerHTML = '✅ ¡Acierto! ¡Se conocen a la perfección! ❤️';
    state.trivia.scoreP1++;
  } else {
    buttons[idx].classList.add('wrong');
    buttons[qObj.ans].classList.add('correct');
    document.getElementById('trivia-feedback').innerHTML = '❌ ¡Casi! La opción correcta era la marcada en verde.';
  }

  document.getElementById('btn-next-trivia-q').classList.remove('hidden');
};

async function nextTriviaQuestion() {
  state.trivia.currentIndex++;
  if (state.trivia.currentIndex >= state.trivia.totalQuestions) {
    // Final — eliminar preguntas custom de Supabase
    try {
      await supabase.from('trivias_pareja')
        .delete()
        .eq('espacio_id', state.currentSpace.id);
    } catch (err) {}

    document.getElementById('trivia-game-box').classList.add('hidden');
    document.getElementById('trivia-result-box').classList.remove('hidden');
    document.getElementById('trivia-final-score').innerText = `Aciertos: ${state.trivia.scoreP1} de ${state.trivia.totalQuestions}`;

    // Publica tus aciertos para compararlos en tiempo real con los de tu pareja
    submitTriviaResult();
  } else {
    renderTriviaQuestion();
  }
}

async function initializeTriviaRound() {
  try {
    const { data, error } = await supabase.rpc('trivia_begin_round');
    if (error) throw error;
    if (!data?.round_id) return;
    state.arcade.triviaRoundId = data.round_id;
    state.arcade.triviaPlayer1Id = data.player_1_id ?? null;
    state.arcade.triviaPlayer2Id = data.player_2_id ?? null;
    state.arcade.triviaResults = {};
    subscribeTriviaResults();
  } catch (err) {
    showToast('No se pudo abrir la ronda de trivia', 'error');
    console.error('trivia_begin_round', err);
  }
}

function subscribeTriviaResults() {
  const roundId = state.arcade.triviaRoundId;
  if (!roundId) return;
  if (state.arcade.triviaChannel) supabase.removeChannel(state.arcade.triviaChannel);

  // Resultados ya publicados por tu pareja
  supabase
    .from('arcade_trivia_results')
    .select('usuario_id, aciertos, total')
    .eq('round_id', roundId)
    .then(({ data, error }) => {
      if (!error && data) data.forEach(r => updateTriviaResultCache(r));
      renderTriviaCompare();
    });

  const channel = supabase
    .channel(`trivia-round-${roundId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'arcade_trivia_results',
      filter: `round_id=eq.${roundId}`
    }, payload => {
      if (payload?.new) updateTriviaResultCache(payload.new);
      renderTriviaCompare();
    })
    .subscribe();
  state.arcade.triviaChannel = channel;
}

function updateTriviaResultCache(row) {
  if (row?.usuario_id == null) return;
  state.arcade.triviaResults[row.usuario_id] = {
    aciertos: row.aciertos ?? 0,
    total: row.total ?? state.trivia.totalQuestions
  };
}

function triviaNameForUser(usuarioId) {
  const a = state.arcade;
  const myId = state.currentUser?.id;
  if (usuarioId === a.triviaPlayer1Id) {
    return a.triviaPlayer1Id === myId ? arcadeMyName() : arcadePartnerName();
  }
  if (usuarioId === a.triviaPlayer2Id) {
    return a.triviaPlayer2Id === myId ? arcadeMyName() : arcadePartnerName();
  }
  return 'Tu Pareja';
}

function renderTriviaCompare() {
  try {
    const resultBox = document.getElementById('trivia-result-box');
    const line = document.getElementById('trivia-compare-line');
    const winnerBox = document.getElementById('trivia-compare-winner');
    if (!resultBox || !line || !winnerBox) return;
    if (resultBox.classList.contains('hidden')) return;

    const results = Object.entries(state.arcade.triviaResults);
    if (results.length === 0) {
      line.innerText = state.arcade.triviaRoundId
        ? 'Tu pareja también está jugando en su dispositivo. Sus aciertos aparecerán aquí en vivo.'
        : 'Cada quien juega en su dispositivo y compara sus aciertos al terminar.';
      winnerBox.style.display = 'none';
      return;
    }

    const parts = results.map(([uid, r]) => `${triviaNameForUser(uid)}: ${r.aciertos}/${r.total}`);
    line.innerText = `📊 ${parts.join('  •  ')}`;

    if (results.length >= 2) {
      const sorted = [...results].sort((x, y) => y[1].aciertos - x[1].aciertos);
      const first = sorted[0], second = sorted[1];
      let winnerText;
      if (first[1].aciertos > second[1].aciertos) {
        winnerText = `🏆 ¡Más aciertos: ${triviaNameForUser(first[0])}!`;
      } else {
        winnerText = '🤝 ¡Empate! Ambos se conocen igual de bien.';
      }
      winnerBox.innerText = winnerText;
      winnerBox.style.display = 'block';
    } else {
      winnerBox.style.display = 'none';
    }
  } catch (err) {
    console.error('renderTriviaCompare', err);
  }
}

async function submitTriviaResult() {
  const roundId = state.arcade.triviaRoundId;
  if (!roundId) return;
  const myId = state.currentUser?.id;
  if (myId) updateTriviaResultCache({ usuario_id: myId, aciertos: state.trivia.scoreP1, total: state.trivia.totalQuestions });
  renderTriviaCompare();
  try {
    const { error } = await supabase.rpc('trivia_submit_result', {
      p_round_id: roundId,
      p_aciertos: state.trivia.scoreP1,
      p_total: state.trivia.totalQuestions
    });
    if (error) throw error;
  } catch (err) {
    showToast('No se pudo publicar tu resultado', 'error');
    console.error('trivia_submit_result', err);
  }
}

// ------------------------------------------------------------------------------
// VERDAD O RETO & ESTO O AQUELLO
// ------------------------------------------------------------------------------
const DEFAULT_VOR = [
  { type: 'VERDAD', cat: 'romantic', text: '¿Qué detalle mío te enamoró más?' },
  { type: 'VERDAD', cat: 'romantic', text: '¿Cuál es tu recuerdo más feliz a mi lado?' },
  { type: 'VERDAD', cat: 'fun', text: '¿Cuál es mi manía más graciosa?' },
  { type: 'RETO', cat: 'romantic', text: 'Dame un abrazo de 30 segundos sin soltarme.' },
  { type: 'RETO', cat: 'fun', text: 'Canta el coro de una canción romántica como si fueras un locutor.' }
];

function initVorSystem() {
  document.getElementById('btn-open-vor-add')?.addEventListener('click', () => openModal('modal-vor-add'));
  document.getElementById('form-create-vor')?.addEventListener('submit', handleAddCustomVor);
  document.getElementById('btn-clear-custom-vor')?.addEventListener('click', handleClearCustomVor);
  document.getElementById('btn-vor-next')?.addEventListener('click', () => drawVorCard());
  document.getElementById('btn-vor-truth')?.addEventListener('click', () => drawVorCard('VERDAD'));
  document.getElementById('btn-vor-dare')?.addEventListener('click', () => drawVorCard('RETO'));
  drawVorCard();
}

async function handleAddCustomVor(e) {
  e.preventDefault();
  const type = document.getElementById('vor-add-type').value;
  const text = document.getElementById('vor-add-text').value.trim();
  if (!text) return;
  state.customVor.push({ type, cat: 'all', text });
  try {
    await supabase.from('retos_custom').insert({ espacio_id: state.currentSpace.id, tipo: type, texto: text });
  } catch (err) {}
  document.getElementById('form-create-vor').reset();
  closeModal('modal-vor-add');
  showToast('¡Agregado a la baraja! 💭', 'success');
}

async function handleClearCustomVor() {
  if (!confirm('¿Eliminar todos los retos y preguntas que agregaron?')) return;
  state.customVor = [];
  try {
    await supabase.from('retos_custom').delete().eq('espacio_id', state.currentSpace.id);
  } catch (err) {}
  showToast('Baraja restablecida a la original', 'info');
  drawVorCard();
}

function drawVorCard(forceType = null) {
  let pool = [...DEFAULT_VOR, ...state.customVor];
  if (state.vorFilter !== 'all') pool = pool.filter(c => c.cat === state.vorFilter || c.cat === 'all');
  if (forceType) pool = pool.filter(c => c.type === forceType);
  if (pool.length === 0) pool = DEFAULT_VOR;

  const card = pool[Math.floor(Math.random() * pool.length)];
  document.getElementById('vor-card-badge').innerText = card.type === 'VERDAD' ? '💭 VERDAD' : '🔥 RETO';
  document.getElementById('vor-card-text').innerText = card.text;
}

const DEFAULT_TNT = [
  { a: 'Noche de pizza y películas 🍕', b: 'Cena formal elegante 🍷' },
  { a: 'Atardecer en la playa 🏖️', b: 'Cabaña en el bosque 🌲' },
  { a: 'Cocinar juntos 👨‍🍳', b: 'Pedir comida a domicilio 🛵' }
];

function initTntSystem() {
  document.getElementById('btn-open-tnt-add')?.addEventListener('click', () => openModal('modal-tnt-add'));
  document.getElementById('form-create-tnt')?.addEventListener('submit', handleAddCustomTnt);
  document.getElementById('btn-clear-custom-tnt')?.addEventListener('click', handleClearCustomTnt);
  document.getElementById('btn-opt-a')?.addEventListener('click', () => handleTntChoice('A'));
  document.getElementById('btn-opt-b')?.addEventListener('click', () => handleTntChoice('B'));
  document.getElementById('btn-tnt-next')?.addEventListener('click', nextTnt);
  renderTnt();
}

async function handleAddCustomTnt(e) {
  e.preventDefault();
  const a = document.getElementById('tnt-add-a').value.trim();
  const b = document.getElementById('tnt-add-b').value.trim();
  if (!a || !b) return;
  state.customTnt.push({ a, b });
  try {
    await supabase.from('dilemas_custom').insert({ espacio_id: state.currentSpace.id, opcion_a: a, opcion_b: b });
  } catch (err) {}
  document.getElementById('form-create-tnt').reset();
  closeModal('modal-tnt-add');
  showToast('Dilema agregado ⚖️', 'success');
}

async function handleClearCustomTnt() {
  if (!confirm('¿Eliminar todos los dilemas que agregaron?')) return;
  state.customTnt = [];
  try {
    await supabase.from('dilemas_custom').delete().eq('espacio_id', state.currentSpace.id);
  } catch (err) {}
  showToast('Dilemas restablecidos', 'info');
  renderTnt();
}

function renderTnt() {
  const pool = [...DEFAULT_TNT, ...state.customTnt];
  const d = pool[state.tntIndex % pool.length];
  document.getElementById('label-opt-a').innerText = d.a;
  document.getElementById('label-opt-b').innerText = d.b;
  document.getElementById('tnt-feedback').innerText = '';
}

function handleTntChoice(choice) {
  const pool = [...DEFAULT_TNT, ...state.customTnt];
  const d = pool[state.tntIndex % pool.length];
  document.getElementById('tnt-feedback').innerText = `✨ Elegiste: "${choice === 'A' ? d.a : d.b}". ¿Qué elegirá tu pareja? 😉`;
}

function nextTnt() {
  state.tntIndex++;
  renderTnt();
}

// ------------------------------------------------------------------------------
// MINIJUEGO COOPERATIVO CON D-PAD EN PANTALLA
// ------------------------------------------------------------------------------
function initCoopGame() {
  const canvas = document.getElementById('coopCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  document.getElementById('btn-start-coop')?.addEventListener('click', startCoopGame);

  // D-Pad botones
  function movePlayer(dx, dy) {
    if (!state.coop.running) return;
    state.coop.player.x = Math.max(15, Math.min(canvas.width - 15, state.coop.player.x + dx * state.coop.player.speed));
    state.coop.player.y = Math.max(15, Math.min(canvas.height - 15, state.coop.player.y + dy * state.coop.player.speed));
  }

  document.getElementById('btn-dpad-up')?.addEventListener('click', () => movePlayer(0, -1));
  document.getElementById('btn-dpad-down')?.addEventListener('click', () => movePlayer(0, 1));
  document.getElementById('btn-dpad-left')?.addEventListener('click', () => movePlayer(-1, 0));
  document.getElementById('btn-dpad-right')?.addEventListener('click', () => movePlayer(1, 0));

  window.addEventListener('keydown', (e) => {
    if (!state.coop.running) return;
    if (e.key === 'ArrowUp') movePlayer(0, -1);
    if (e.key === 'ArrowDown') movePlayer(0, 1);
    if (e.key === 'ArrowLeft') movePlayer(-1, 0);
    if (e.key === 'ArrowRight') movePlayer(1, 0);
  });
}

function startCoopGame() {
  const canvas = document.getElementById('coopCanvas');
  const ctx = canvas.getContext('2d');

  state.coop.running = true;
  state.coop.score = 0;
  state.coop.timeLeft = 30;
  state.coop.player = { x: canvas.width / 2, y: canvas.height / 2, speed: 18 };
  state.coop.items = [];

  document.getElementById('coop-score').innerText = '0';
  document.getElementById('coop-timer').innerText = '30s';

  // Generar items flotantes
  for (let i = 0; i < 6; i++) spawnCoopItem(canvas);

  if (state.coop.timerId) clearInterval(state.coop.timerId);
  state.coop.timerId = setInterval(() => {
    state.coop.timeLeft--;
    document.getElementById('coop-timer').innerText = `${state.coop.timeLeft}s`;
    if (state.coop.timeLeft <= 0) {
      endCoopGame();
    }
  }, 1000);

  function loop() {
    if (!state.coop.running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dibujar jugador
    ctx.font = '24px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💖', state.coop.player.x, state.coop.player.y);

    // Dibujar y comprobar items
    for (let i = state.coop.items.length - 1; i >= 0; i--) {
      const it = state.coop.items[i];
      ctx.fillText(it.type, it.x, it.y);

      // Colisión
      const dist = Math.hypot(it.x - state.coop.player.x, it.y - state.coop.player.y);
      if (dist < 26) {
        state.coop.score += 10;
        document.getElementById('coop-score').innerText = state.coop.score;
        state.coop.items.splice(i, 1);
        spawnCoopItem(canvas);
      }
    }

    state.coop.animId = requestAnimationFrame(loop);
  }
  loop();
}

function spawnCoopItem(canvas) {
  const types = ['⭐', '💕', '✨', '🌹'];
  state.coop.items.push({
    x: Math.random() * (canvas.width - 40) + 20,
    y: Math.random() * (canvas.height - 40) + 20,
    type: types[Math.floor(Math.random() * types.length)]
  });
}

function endCoopGame() {
  state.coop.running = false;
  clearInterval(state.coop.timerId);
  cancelAnimationFrame(state.coop.animId);
  showToast(`🎉 ¡Fin del juego! Puntaje en equipo: ${state.coop.score} puntos ❤️`, 'success');
}

// ==============================================================================
// 8. RECUERDOS & GOOGLE DRIVE
// ==============================================================================
async function loadMemories() {
  if (!state.currentSpace) return;
  const { data } = await supabase.from('recuerdos').select('*').eq('espacio_id', state.currentSpace.id).order('fecha_evento', { ascending: false });
  state.memories = data || [];
  renderMemories();
}

function renderMemories() {
  const container = document.getElementById('memories-feed-container');
  if (!container) return;
  if (state.memories.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Aún no hay fotos o recuerdos en el álbum. ¡Guarden su primer momento juntos! 📸</p>`;
    return;
  }

  container.innerHTML = state.memories.map((m) => {
    const dateFormatted = new Date(m.fecha_evento + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const imgUrl = convertDriveImageUrl(m.imagen_url);

    return `
      <div class="card" style="padding: 1.25rem; margin-bottom: 0.75rem;">
        <span style="font-size: 0.8rem; font-weight: 700; color: var(--primary);">🗓️ ${dateFormatted}</span>
        <h4 style="font-size: 1.15rem; font-weight: 800; margin: 0.2rem 0;">${escapeHtml(m.titulo)}</h4>
        ${imgUrl ? `<img src="${imgUrl}" alt="${escapeHtml(m.titulo)}" class="memory-photo-preview" loading="lazy" onerror="this.style.display='none'">` : ''}
        ${m.descripcion ? `<p style="font-size: 0.92rem; color: var(--text-muted); margin-top: 0.5rem;">${escapeHtml(m.descripcion)}</p>` : ''}
      </div>
    `;
  }).join('');
}

async function handleCreateMemory(e) {
  e.preventDefault();
  const title = document.getElementById('memory-title').value.trim();
  const date = document.getElementById('memory-date').value;
  const imgUrl = document.getElementById('memory-image-url').value.trim();
  const desc = document.getElementById('memory-desc').value.trim();
  if (!title || !date) return;

  try {
    const { error } = await supabase.from('recuerdos').insert({
      espacio_id: state.currentSpace.id,
      autor_id: state.currentUser.id,
      titulo: title,
      fecha_evento: date,
      imagen_url: imgUrl,
      descripcion: desc
    });
    if (error) throw error;
    document.getElementById('form-create-memory').reset();
    closeModal('modal-memory');
    showToast('Recuerdo guardado en el álbum 📸', 'success');
    await loadMemories();
  } catch (err) {
    showToast(err.message || 'Error al guardar recuerdo', 'error');
  }
}

// ==============================================================================
// 9. BUCKET LIST & ÁNIMOS & HISTORIA
// ==============================================================================
async function loadBucketList() {
  if (!state.currentSpace) return;
  try {
    const { data } = await supabase.from('bucket_list').select('*').eq('espacio_id', state.currentSpace.id).order('creado_en', { ascending: false });
    state.bucketList = data || [];
    renderBucketList();
  } catch (err) {}
}

function renderBucketList() {
  const container = document.getElementById('bucket-items-container');
  if (!container) return;
  let filtered = state.bucketList;
  if (state.activeBucketFilter !== 'all') filtered = filtered.filter(i => i.categoria === state.activeBucketFilter);

  if (filtered.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No hay metas en esta categoría. ¡Agreguen su próximo sueño! ✨</p>`;
    return;
  }

  container.innerHTML = filtered.map(item => `
    <div class="bucket-item ${item.completado ? 'completed' : ''}">
      <div class="bucket-left">
        <input type="checkbox" class="bucket-checkbox" ${item.completado ? 'checked' : ''} onchange="window.toggleBucketItem('${item.id}', this.checked)">
        <span class="bucket-title" style="font-weight: 600;">${escapeHtml(item.titulo)}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 0.6rem;">
        <span class="bucket-tag">${escapeHtml(item.categoria)}</span>
        <button class="btn-icon" onclick="window.deleteBucketItem('${item.id}')" title="Eliminar">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function handleCreateBucketItem(e) {
  e.preventDefault();
  const title = document.getElementById('bucket-title').value.trim();
  const cat = document.getElementById('bucket-category').value;
  if (!title) return;
  try {
    await supabase.from('bucket_list').insert({ espacio_id: state.currentSpace.id, creado_por: state.currentUser.id, titulo: title, categoria: cat, completado: false });
    document.getElementById('form-create-bucket').reset();
    closeModal('modal-bucket');
    showToast('¡Sueño agregado! 🎯', 'success');
    await loadBucketList();
  } catch (err) {}
}

window.toggleBucketItem = async function(id, val) {
  await supabase.from('bucket_list').update({ completado: val }).eq('id', id);
  if (val) showToast('🎉 ¡Meta completada juntos! Felicidades ❤️', 'success');
  await loadBucketList();
};

window.deleteBucketItem = async function(id) {
  await supabase.from('bucket_list').delete().eq('id', id);
  await loadBucketList();
};

async function loadMoods() {
  if (!state.currentSpace) return;
  try {
    const { data } = await supabase.from('estados_animo').select('*').eq('espacio_id', state.currentSpace.id);
    if (!data) return;
    state.moods.mine = data.find(m => m.usuario_id === state.currentUser.id);
    state.moods.partner = data.find(m => m.usuario_id !== state.currentUser.id);

    const myName = state.currentProfile?.alias || 'Tú';
    const partnerName = state.partnerProfile?.alias || 'Tu Pareja';
    document.getElementById('my-mood-user').innerText = myName;
    document.getElementById('partner-mood-user').innerText = partnerName;

    if (state.moods.mine) {
      document.getElementById('my-mood-emoji').innerText = state.moods.mine.emoji;
      document.getElementById('my-mood-note').innerText = state.moods.mine.nota_corta ? `"${state.moods.mine.nota_corta}"` : 'Sin nota';
    }
    if (state.moods.partner) {
      document.getElementById('partner-mood-emoji').innerText = state.moods.partner.emoji;
      document.getElementById('partner-mood-note').innerText = state.moods.partner.nota_corta ? `"${state.moods.partner.nota_corta}"` : 'Sin nota';
    }
  } catch (err) {}
}

async function handleUpdateMood(e) {
  e.preventDefault();
  const selectedEmoji = document.querySelector('.mood-option-btn.selected')?.dataset.emoji || '😊';
  const note = document.getElementById('mood-note-input').value.trim();
  try {
    await supabase.from('estados_animo').upsert({ usuario_id: state.currentUser.id, espacio_id: state.currentSpace.id, emoji: selectedEmoji, nota_corta: note, actualizado_en: new Date().toISOString() });
    closeModal('modal-mood');
    showToast('Estado de ánimo compartido 💕', 'success');
    await loadMoods();
  } catch (err) {}
}

function updateStoryStats() {
  if (state.currentSpace?.fecha_aniversario) {
    const start = new Date(state.currentSpace.fecha_aniversario);
    const diff = Math.max(0, Math.floor((new Date() - start) / (1000 * 60 * 60 * 24)));
    document.getElementById('stat-days').innerText = diff;
  }
  document.getElementById('stat-notes').innerText = state.notes.length;
  document.getElementById('stat-memories').innerText = state.memories.length;
  document.getElementById('stat-bucket').innerText = state.bucketList.filter(b => b.completado).length;
}

// ==============================================================================
// 10. REALTIME & EVENTOS DEL DOM
// ==============================================================================
function setupRealtime(spaceId) {
  if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  state.realtimeChannel = supabase.channel(`space-rt-${spaceId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notas', filter: `espacio_id=eq.${spaceId}` }, () => loadNotes())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'canciones_pizarron', filter: `espacio_id=eq.${spaceId}` }, () => loadSongs())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'puntuaciones_arcade', filter: `espacio_id=eq.${spaceId}` }, () => loadArcadeScores())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'estados_animo', filter: `espacio_id=eq.${spaceId}` }, () => loadMoods())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bucket_list', filter: `espacio_id=eq.${spaceId}` }, () => loadBucketList())
    .subscribe();
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // Listeners de Auth
  document.getElementById('form-auth')?.addEventListener('submit', handleAuthSubmit);
  document.getElementById('auth-toggle-link')?.addEventListener('click', toggleAuthMode);
  document.getElementById('btn-logout')?.addEventListener('click', handleSignOut);

  // Onboarding
  document.getElementById('btn-show-create-space')?.addEventListener('click', () => {
    document.getElementById('onboarding-choices').classList.add('hidden');
    document.getElementById('onboarding-create-form').classList.remove('hidden');
    document.getElementById('create-anniversary-date').value = new Date().toISOString().slice(0, 16);
  });
  document.getElementById('btn-cancel-create')?.addEventListener('click', () => {
    document.getElementById('onboarding-choices').classList.remove('hidden');
    document.getElementById('onboarding-create-form').classList.add('hidden');
  });
  document.getElementById('btn-show-join-space')?.addEventListener('click', () => {
    document.getElementById('onboarding-choices').classList.add('hidden');
    document.getElementById('onboarding-join-form').classList.remove('hidden');
  });
  document.getElementById('btn-cancel-join')?.addEventListener('click', () => {
    document.getElementById('onboarding-choices').classList.remove('hidden');
    document.getElementById('onboarding-join-form').classList.add('hidden');
  });
  document.getElementById('form-create-space')?.addEventListener('submit', handleCreateSpace);
  document.getElementById('form-join-space')?.addEventListener('submit', handleJoinSpace);
  document.getElementById('btn-copy-code')?.addEventListener('click', () => {
    const code = document.getElementById('display-invite-code').innerText;
    navigator.clipboard.writeText(code).then(() => showToast('Código copiado 📋', 'info'));
  });

  // Pestañas
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', (e) => switchTab(e.currentTarget.dataset.tab)));

  // Subpestañas del pizarrón
  document.getElementById('btn-pizarron-tab-notes')?.addEventListener('click', () => {
    document.getElementById('btn-pizarron-tab-notes').classList.add('active');
    document.getElementById('btn-pizarron-tab-music').classList.remove('active');
    document.getElementById('pizarron-notes-view').classList.remove('hidden');
    document.getElementById('pizarron-music-view').classList.add('hidden');
  });
  document.getElementById('btn-pizarron-tab-music')?.addEventListener('click', () => {
    document.getElementById('btn-pizarron-tab-music').classList.add('active');
    document.getElementById('btn-pizarron-tab-notes').classList.remove('active');
    document.getElementById('pizarron-music-view').classList.remove('hidden');
    document.getElementById('pizarron-notes-view').classList.add('hidden');
  });

  // Modales
  document.getElementById('btn-open-note-modal')?.addEventListener('click', () => openModal('modal-note'));
  document.getElementById('btn-open-music-modal')?.addEventListener('click', () => openModal('modal-music'));
  document.getElementById('btn-open-mood-modal')?.addEventListener('click', () => openModal('modal-mood'));
  document.getElementById('btn-open-bucket-modal')?.addEventListener('click', () => openModal('modal-bucket'));
  document.getElementById('btn-open-memory-modal')?.addEventListener('click', () => openModal('modal-memory'));
  document.getElementById('btn-open-anniversary-modal')?.addEventListener('click', () => {
    if (state.currentSpace?.fecha_aniversario) {
      document.getElementById('edit-anniversary-date').value = new Date(state.currentSpace.fecha_aniversario).toISOString().slice(0, 16);
    }
    openModal('modal-anniversary');
  });

  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', (e) => closeModal(e.target.dataset.close)));

  // Formularios
  document.getElementById('form-create-note')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = document.getElementById('note-content').value.trim();
    const color = document.querySelector('.color-option.selected')?.dataset.color || '#fef3c7';
    const pinned = document.getElementById('note-pinned').checked;
    if (!content) return;
    try {
      await supabase.from('notas').insert({ espacio_id: state.currentSpace.id, autor_id: state.currentUser.id, contenido: content, color_hex: color, fijada: pinned });
      document.getElementById('note-content').value = '';
      closeModal('modal-note');
      showToast('Nota pegada en el pizarrón 🖍️', 'success');
      await loadNotes();
    } catch (err) {}
  });

  document.getElementById('form-create-music')?.addEventListener('submit', handleCreateSong);
  document.getElementById('form-create-memory')?.addEventListener('submit', handleCreateMemory);
  document.getElementById('form-create-bucket')?.addEventListener('submit', handleCreateBucketItem);
  document.getElementById('form-update-mood')?.addEventListener('submit', handleUpdateMood);

  document.getElementById('form-update-anniversary')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = document.getElementById('edit-anniversary-date').value;
    if (!val) return;
    const iso = new Date(val).toISOString();
    await supabase.rpc('actualizar_aniversario', { p_fecha: iso });
    state.currentSpace.fecha_aniversario = iso;
    initLiveTimer(iso);
    closeModal('modal-anniversary');
    showToast('Fecha de aniversario actualizada 🗓️', 'success');
  });

  // Colores de notas
  document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      e.target.classList.add('selected');
    });
  });

  // Emojis de ánimo
  document.querySelectorAll('.mood-option-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.mood-option-btn').forEach(b => b.classList.remove('selected'));
      e.currentTarget.classList.add('selected');
    });
  });

  // Filtros bucket list
  document.querySelectorAll('[data-bcat]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('[data-bcat]').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      state.activeBucketFilter = e.target.dataset.bcat;
      renderBucketList();
    });
  });

  // Restauración de sesión
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await initAppState(session.user);
    else switchView('auth');
  } catch (err) {
    switchView('auth');
  }
});
