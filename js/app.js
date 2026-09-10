import { CONFIG, ESPN } from "./config.js";
import { faseLabel, pointValueFor, effectiveWinner } from "./nfl.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- estado ----------
let app, auth, db;
try {
  app = initializeApp(CONFIG.firebase);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase não configurado ainda — só a agenda da ESPN vai aparecer.", e.message);
}

const S = {
  uid: null,
  user: null, // {username, team, uid}
  teams: [], // [{abbr,name,logo,color}]
  teamByAbbr: {},
  week: 1,
  seasonType: 2,
  games: [], // mescla ESPN + Firestore
  fsGames: {}, // id -> doc Firestore
  picks: {}, // `${username}_${gameId}` -> {username,gameId,pickAbbr}  (salvos)
  pending: {}, // gameId -> abbr  (escolhas ainda não salvas)
  saving: false,
  standings: [],
  weekMeta: {},
  view: "rodada",
};

const $ = (s) => document.querySelector(s);
const fmtBR = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// ---------- tema ----------
$("#themeBtn").onclick = () => {
  const t = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = t;
  localStorage.setItem("yeiya_theme", t);
};
document.body.dataset.theme = localStorage.getItem("yeiya_theme") || "dark";

// ---------- navegação ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.onclick = () => {
    S.view = btn.dataset.view;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${S.view}`));
    render();
  };
});
$("#weekPrev").onclick = () => changeWeek(-1);
$("#weekNext").onclick = () => changeWeek(1);

function changeWeek(d) {
  if (S.seasonType === 2) {
    S.week = Math.min(18, Math.max(1, S.week + d));
  } else {
    S.week = Math.min(5, Math.max(1, S.week + d));
  }
  loadWeek();
}

// ---------- auth anônima + sessão ----------
if (auth) signInAnonymously(auth).catch((e) => console.error("auth", e));
if (auth) onAuthStateChanged(auth, async (u) => {
  if (!u) return;
  S.uid = u.uid;
  const saved = localStorage.getItem("yeiya_username");
  if (saved) {
    const snap = await getDoc(doc(db, "users", saved));
    if (snap.exists()) {
      S.user = snap.data();
      // reassocia este dispositivo ao usuário
      if (S.user.uid !== S.uid) {
        await setDoc(doc(db, "users", saved), { uid: S.uid }, { merge: true });
        S.user.uid = S.uid;
      }
    } else {
      localStorage.removeItem("yeiya_username");
    }
  }
  refreshUserUI();
  boot();
});

// ---------- login / cadastro ----------
const dlg = $("#loginDialog");
let selectedTeam = null;
$("#loginBtn").onclick = () => openLogin();
$("#userBtn").onclick = () => {
  if (confirm("Sair desta conta neste dispositivo?")) {
    localStorage.removeItem("yeiya_username");
    location.reload();
  }
};

async function openLogin() {
  $("#fUser").value = "";
  $("#fPin").value = "";
  $("#loginMsg").textContent = "";
  $("#teamPickerWrap").hidden = true;
  selectedTeam = null;
  renderTeamPicker();
  dlg.showModal();
}

async function sha(txt) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

$("#loginForm").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value !== "ok") return;
  e.preventDefault();
  const username = $("#fUser").value.trim().toLowerCase().replace(/\s+/g, "");
  const pin = $("#fPin").value.trim();
  const msg = $("#loginMsg");
  msg.className = "msg";
  if (!/^[a-z0-9_]{3,16}$/.test(username)) return (msg.textContent = "Username: 3–16 letras/números.", msg.className = "msg err");
  if (!/^[0-9]{4}$/.test(pin)) return (msg.textContent = "PIN precisa ter 4 dígitos.", msg.className = "msg err");

  const pinHash = await sha(username + ":" + pin);
  const ref = doc(db, "users", username);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    if (snap.data().pinHash !== pinHash) {
      msg.textContent = "PIN incorreto para esse username.";
      msg.className = "msg err";
      return;
    }
    await setDoc(ref, { uid: S.uid }, { merge: true });
    finishLogin(username, { ...snap.data(), uid: S.uid });
    return;
  }

  // cadastro novo — exige escolher time
  if (!$("#teamPickerWrap").hidden && !selectedTeam) {
    msg.textContent = "Escolha um time para continuar.";
    msg.className = "msg err";
    return;
  }
  if ($("#teamPickerWrap").hidden) {
    $("#teamPickerWrap").hidden = false;
    msg.textContent = "Username novo! Escolha seu time e clique em Entrar de novo.";
    return;
  }
  const data = {
    username,
    pinHash,
    team: selectedTeam,
    uid: S.uid,
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  finishLogin(username, data);
});

function finishLogin(username, data) {
  localStorage.setItem("yeiya_username", username);
  S.user = data;
  dlg.close();
  refreshUserUI();
  loadWeek();
}

function renderTeamPicker() {
  const wrap = $("#teamPicker");
  wrap.innerHTML = "";
  S.teams.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.title = t.name;
    b.innerHTML = `<img src="${t.logo}" alt="${t.abbr}">`;
    b.onclick = () => {
      selectedTeam = t.abbr;
      wrap.querySelectorAll("button").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
    };
    wrap.appendChild(b);
  });
}

function refreshUserUI() {
  const isLogged = !!S.user;
  $("#loginBtn").hidden = isLogged;
  const chip = $("#userBtn");
  chip.hidden = !isLogged;
  if (isLogged) {
    const t = S.teamByAbbr[S.user.team];
    chip.innerHTML = `${t ? `<img src="${t.logo}" alt="">` : "👤"} ${S.user.username}`;
  }
  const isAdmin = isLogged && S.user.username === CONFIG.adminUsername;
  document.querySelectorAll(".admin-only").forEach((el) => (el.hidden = !isAdmin));
}

// ---------- carregamento de dados ----------
let publicLoaded = false;
async function initPublic() {
  if (publicLoaded) return;
  publicLoaded = true;
  await loadTeams();
  // semana atual pela ESPN e render imediato da agenda
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
    );
    const j = await r.json();
    S.week = j.week?.number || S.week;
    S.seasonType = j.season?.type || S.seasonType;
  } catch (e) {
    console.error("season", e);
  }
  loadWeek();
  // refinamentos que dependem do Firebase — não travam a UI
  if (db) {
    loadSeasonConfig().then(() => loadWeek());
    try {
      subscribeStandings();
    } catch (e) {
      console.warn("Firestore indisponível:", e.message);
    }
  }
}
async function boot() {
  await initPublic();
}
initPublic();

async function loadTeams() {
  try {
    const r = await fetch("assets/teams.json");
    S.teams = await r.json();
    S.teamByAbbr = Object.fromEntries(S.teams.map((t) => [t.abbr, t]));
  } catch (e) {
    console.error("teams", e);
  }
}

// Ajuste fino da semana via Firestore, sem travar a UI (timeout curto)
async function loadSeasonConfig() {
  if (!db) return;
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "config", "season")),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3500)),
    ]);
    if (snap.exists()) {
      S.week = snap.data().currentWeek || S.week;
      S.seasonType = snap.data().seasonType || S.seasonType;
    }
  } catch (e) {}
}

let unsubPicks = null;
let unsubGames = null;

async function loadWeek() {
  $("#weekTitle").textContent = faseLabel({ seasonType: S.seasonType, week: S.week });
  // 1. jogos da ESPN
  try {
    const r = await fetch(ESPN.scoreboard(CONFIG.season.year, S.seasonType, S.week));
    const j = await r.json();
    S.games = (j.events || []).map(parseEspnEvent).sort((a, b) => a.kickoffMs - b.kickoffMs);
  } catch (e) {
    console.error("scoreboard", e);
    S.games = [];
  }
  if (!db) { render(); return; }
  // 2. docs Firestore da semana (vencedor oficial, override, pontos)
  if (unsubGames) unsubGames();
  unsubGames = onSnapshot(
    query(collection(db, "games"), where("week", "==", S.week), where("seasonType", "==", S.seasonType)),
    (qs) => {
      S.fsGames = {};
      qs.forEach((d) => (S.fsGames[d.id] = d.data()));
      render();
    }
  );
  // 3. palpites da semana (todos os usuários)
  if (unsubPicks) unsubPicks();
  unsubPicks = onSnapshot(
    query(collection(db, "picks"), where("week", "==", S.week), where("seasonType", "==", S.seasonType)),
    (qs) => {
      S.picks = {};
      qs.forEach((d) => (S.picks[d.id] = d.data()));
      render();
    }
  );
  render();
}

function subscribeStandings() {
  if (!db) return;
  onSnapshot(collection(db, "standings"), (qs) => {
    S.standings = [];
    qs.forEach((d) => S.standings.push(d.data()));
    S.standings.sort((a, b) => (a.rank || 99) - (b.rank || 99));
    if (S.view === "ranking") render();
  });
  onSnapshot(collection(db, "weekMeta"), (qs) => {
    S.weekMeta = {};
    qs.forEach((d) => (S.weekMeta[d.id] = d.data()));
    if (S.view === "ranking") render();
  });
}

function parseEspnEvent(ev) {
  const c = ev.competitions[0];
  const home = c.competitors.find((x) => x.homeAway === "home");
  const away = c.competitors.find((x) => x.homeAway === "away");
  const odds = c.odds?.[0];
  let favoriteAbbr = null;
  if (odds) {
    if (odds.homeTeamOdds?.favorite) favoriteAbbr = home.team.abbreviation;
    else if (odds.awayTeamOdds?.favorite) favoriteAbbr = away.team.abbreviation;
  }
  const winnerSide = c.competitors.find((x) => x.winner);
  return {
    id: ev.id,
    week: ev.week?.number ?? S.week,
    seasonType: ev.season?.type ?? S.seasonType,
    kickoffMs: Date.parse(ev.date),
    state: c.status?.type?.state || "pre", // pre | in | post
    completed: !!c.status?.type?.completed,
    statusDetail: c.status?.type?.shortDetail || "",
    homeAbbr: home.team.abbreviation,
    awayAbbr: away.team.abbreviation,
    homeName: home.team.shortDisplayName,
    awayName: away.team.shortDisplayName,
    homeLogo: home.team.logo,
    awayLogo: away.team.logo,
    homeRec: home.records?.[0]?.summary || "",
    awayRec: away.records?.[0]?.summary || "",
    homeScore: home.score,
    awayScore: away.score,
    espnWinner: winnerSide ? winnerSide.team.abbreviation : null,
    favoriteAbbr,
  };
}

// mescla jogo ESPN + doc Firestore
function merged(g) {
  const fs = S.fsGames[g.id] || {};
  return { ...g, ...fs, espnWinner: fs.espnWinner ?? g.espnWinner };
}

// ---------- palpitar ----------
// clique num time = escolha local (não salva ainda)
function pick(game, abbr) {
  if (!S.user) return openLogin();
  if (Date.now() >= game.kickoffMs) return;
  const saved = S.picks[`${S.user.username}_${game.id}`];
  if (saved && saved.pickAbbr === abbr) delete S.pending[game.id]; // voltou ao salvo
  else S.pending[game.id] = abbr;
  render();
}

// palpite "efetivo" a mostrar: pendente > salvo
function currentPick(gameId) {
  if (S.pending[gameId]) return S.pending[gameId];
  const saved = S.user && S.picks[`${S.user.username}_${gameId}`];
  return saved ? saved.pickAbbr : null;
}

// botão: salva todas as escolhas pendentes da rodada
async function saveRound() {
  if (!S.user || S.saving) return;
  const ids = Object.keys(S.pending).filter((id) =>
    S.games.some((g) => g.id === id)
  );
  if (!ids.length) return;
  S.saving = true;
  render();
  let ok = 0,
    skipped = 0,
    fail = 0;
  for (const gameId of ids) {
    const g = S.games.find((x) => x.id === gameId);
    if (g && Date.now() >= g.kickoffMs) {
      skipped++;
      delete S.pending[gameId];
      continue;
    }
    try {
      await setDoc(
        doc(db, "picks", `${S.user.username}_${gameId}`),
        {
          username: S.user.username,
          gameId,
          pickAbbr: S.pending[gameId],
          week: g?.week ?? S.week,
          seasonType: g?.seasonType ?? S.seasonType,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      delete S.pending[gameId];
      ok++;
    } catch (e) {
      console.error("save pick", gameId, e);
      fail++;
    }
  }
  S.saving = false;
  render();
  let msg = `${ok} palpite(s) salvo(s).`;
  if (skipped) msg += ` ${skipped} não salvo(s): jogo já começou.`;
  if (fail) msg += ` ${fail} falhou(aram) — tente de novo.`;
  toast(msg);
}

let toastTimer = null;
function toast(text) {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 4000);
}

// ---------- admin ----------
async function adminSet(game, field, value) {
  try {
    await setDoc(doc(db, "games", game.id), { [field]: value }, { merge: true });
  } catch (e) {
    alert("Erro: " + e.message);
  }
}

// ---------- render ----------
function render() {
  if (S.view === "rodada") renderGames();
  else if (S.view === "ranking") renderRanking();
  else if (S.view === "admin") renderAdmin();
  if (S.view !== "rodada") {
    const bar = $("#saveBar");
    if (bar) bar.remove();
  }
  refreshUserUI();
}

function renderGames() {
  const box = $("#games");
  if (!S.games.length) {
    box.innerHTML = `<div class="empty">Sem jogos para esta semana ainda.</div>`;
    return;
  }
  box.innerHTML = "";
  for (const raw of S.games) {
    const g = merged(raw);
    const locked = Date.now() >= g.kickoffMs;
    const winner = effectiveWinner(g);
    const shownPick = currentPick(g.id);
    const unsaved = g.id in S.pending;
    const pv = pointValueFor(g, CONFIG);

    const el = document.createElement("div");
    el.className = "game";
    el.innerHTML = `
      <div class="game-head">
        <span>${fmtBR.format(new Date(g.kickoffMs))} · Brasília</span>
        <span>${
          g.voided
            ? "❌ anulado"
            : locked
            ? `<span class="locked">${g.completed ? "encerrado " + (g.awayScore ?? "") + "–" + (g.homeScore ?? "") : "🔒 " + (g.statusDetail || "em jogo")}</span>`
            : "aberto"
        } · <span class="points-tag">${pv === 0 ? "amistoso" : pv + " pt"}</span>${
          unsaved ? ' · <span class="unsaved">não salvo</span>' : ""
        }</span>
      </div>
      <div class="matchup">
        ${sideBtn(g, "away", locked, winner, shownPick)}
        <span class="vs">@</span>
        ${sideBtn(g, "home", locked, winner, shownPick)}
      </div>
      <div class="friends" data-friends></div>
    `;
    el.querySelectorAll("[data-side]").forEach((btn) => {
      btn.onclick = () => pick(g, btn.dataset.abbr);
    });
    // palpites dos amigos (só se travado)
    const fbox = el.querySelector("[data-friends]");
    if (locked) {
      const rows = Object.values(S.picks).filter((p) => p.gameId === g.id);
      if (!rows.length) fbox.textContent = "Ninguém palpitou.";
      rows
        .sort((a, b) => a.username.localeCompare(b.username))
        .forEach((p) => {
          const t = S.teamByAbbr[p.pickAbbr];
          const cls = winner ? (p.pickAbbr === winner ? "hit" : "miss") : "";
          const s = document.createElement("span");
          s.className = "f " + cls;
          s.innerHTML = `${t ? `<img src="${t.logo}">` : ""}${p.username}`;
          fbox.appendChild(s);
        });
    } else {
      const n = Object.values(S.picks).filter((p) => p.gameId === g.id).length;
      fbox.textContent = n ? `${n} palpite(s) — revelados no kickoff` : "";
    }
    box.appendChild(el);
  }
  renderSaveBar();
}

function renderSaveBar() {
  let bar = $("#saveBar");
  const n = Object.keys(S.pending).filter((id) =>
    S.games.some((g) => g.id === id)
  ).length;
  if (!n || !S.user) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "saveBar";
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<button class="btn btn-primary" id="saveRoundBtn" ${
    S.saving ? "disabled" : ""
  }>${S.saving ? "Salvando…" : `💾 Salvar palpites da rodada (${n})`}</button>`;
  bar.querySelector("#saveRoundBtn").onclick = saveRound;
}

function sideBtn(g, side, locked, winner, shownPick) {
  const abbr = side === "home" ? g.homeAbbr : g.awayAbbr;
  const name = side === "home" ? g.homeName : g.awayName;
  const rec = side === "home" ? g.homeRec : g.awayRec;
  const logo = side === "home" ? g.homeLogo : g.awayLogo;
  const cls = [
    "side",
    shownPick === abbr ? "picked" : "",
    winner && winner === abbr ? "winner" : "",
    winner && winner !== abbr ? "loser" : "",
  ].join(" ");
  return `<button class="${cls}" data-side data-abbr="${abbr}" ${locked ? "disabled" : ""}>
    <img src="${logo}" alt="${abbr}">
    <span><span class="nm">${name}</span><br><span class="rec">${rec}</span></span>
  </button>`;
}

function renderRanking() {
  const box = $("#standings");
  if (!S.standings.length) {
    box.innerHTML = `<div class="empty">Ranking aparece depois da primeira rodada valendo.</div>`;
  } else {
    let html = `<table><thead><tr><th>#</th><th>Jogador</th><th>Acertos</th><th class="pts">Pts</th></tr></thead><tbody>`;
    for (const r of S.standings) {
      const t = S.teamByAbbr[r.team];
      const mv =
        r.lastRank && r.lastRank !== r.rank
          ? r.lastRank > r.rank
            ? `<span class="mv-up">▲${r.lastRank - r.rank}</span>`
            : `<span class="mv-down">▼${r.rank - r.lastRank}</span>`
          : "";
      const perfect = (r.perfectWeeks || []).length
        ? `<span class="badge">${r.perfectWeeks.length}× 💯</span>`
        : "";
      const me = S.user && r.username === S.user.username ? "me-row" : "";
      html += `<tr class="${me}">
        <td>${r.rank} ${mv}</td>
        <td><span class="rankcell">${t ? `<img src="${t.logo}">` : "👤"} ${r.username}${perfect}</span></td>
        <td>${r.correctCount || 0}${r.playoffCorrect ? ` <span class="muted">(${r.playoffCorrect} PO)</span>` : ""}</td>
        <td class="pts">${r.totalPoints || 0}</td>
      </tr>`;
    }
    box.innerHTML = html + "</tbody></table>";
  }

  const hi = $("#weekHighlights");
  const key = `${S.seasonType}-${S.week}`;
  const m = S.weekMeta[key];
  if (!m) {
    hi.innerHTML = `<div class="card muted">Sem destaques fechados para ${faseLabel({ seasonType: S.seasonType, week: S.week })} ainda.</div>`;
  } else {
    hi.innerHTML = `<div class="card">
      <p>🏅 <b>MVP da rodada:</b> ${(m.mvp || []).join(", ") || "—"} ${m.best ? `(${m.best} pts)` : ""}</p>
      <p>💯 <b>Semana perfeita:</b> ${(m.perfect || []).join(", ") || "ninguém"}</p>
    </div>`;
  }
}

function renderAdmin() {
  const box = $("#adminGames");
  if (S.user?.username !== CONFIG.adminUsername) {
    box.innerHTML = `<div class="empty">Área restrita.</div>`;
    return;
  }
  box.innerHTML = "";
  for (const raw of S.games) {
    const g = merged(raw);
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<b>${g.awayName} @ ${g.homeName}</b> <span class="muted">(${fmtBR.format(new Date(g.kickoffMs))})</span><br>
      <span class="muted">ESPN: ${g.espnWinner || "—"} · efetivo: ${effectiveWinner(g) || "—"}</span><br>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" data-w="${g.awayAbbr}">Vencedor: ${g.awayAbbr}</button>
        <button class="btn" data-w="${g.homeAbbr}">Vencedor: ${g.homeAbbr}</button>
        <button class="btn" data-w="">Limpar override</button>
        <button class="btn" data-void="${g.voided ? 0 : 1}">${g.voided ? "Reativar" : "Anular jogo"}</button>
      </div>`;
    el.querySelectorAll("[data-w]").forEach((b) => {
      b.onclick = () => adminSet(g, "adminOverrideWinner", b.dataset.w || null);
    });
    el.querySelector("[data-void]").onclick = (e) =>
      adminSet(g, "voided", e.target.dataset.void === "1");
    box.appendChild(el);
  }
}
