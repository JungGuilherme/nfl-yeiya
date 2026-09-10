// Automação do bolão YEIYA.
// Roda no GitHub Actions: puxa jogos/resultados da ESPN, grava no Firestore
// e recalcula a classificação. É idempotente — pode rodar quantas vezes quiser.

import admin from "firebase-admin";
import { CONFIG } from "../js/config.js";
import { computeStandings, pointValueFor, faseLabel } from "../js/nfl.js";

const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

const YEAR = CONFIG.season.year;

async function espn(seasontype, week) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${YEAR}&seasontype=${seasontype}&week=${week}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ESPN ${seasontype}/${week}: ${r.status}`);
  return r.json();
}

function parseEvent(ev) {
  const c = ev.competitions[0];
  const home = c.competitors.find((x) => x.homeAway === "home");
  const away = c.competitors.find((x) => x.homeAway === "away");
  const odds = c.odds?.[0];
  let favoriteAbbr = null;
  if (odds?.homeTeamOdds?.favorite) favoriteAbbr = home.team.abbreviation;
  else if (odds?.awayTeamOdds?.favorite) favoriteAbbr = away.team.abbreviation;
  const w = c.competitors.find((x) => x.winner);
  return {
    id: ev.id,
    week: ev.week?.number,
    seasonType: ev.season?.type,
    kickoffMs: Date.parse(ev.date),
    kickoff: admin.firestore.Timestamp.fromMillis(Date.parse(ev.date)),
    state: c.status?.type?.state || "pre",
    completed: !!c.status?.type?.completed,
    homeAbbr: home.team.abbreviation,
    awayAbbr: away.team.abbreviation,
    homeName: home.team.shortDisplayName,
    awayName: away.team.shortDisplayName,
    homeLogo: home.team.logo || "",
    awayLogo: away.team.logo || "",
    homeScore: Number(home.score) || 0,
    awayScore: Number(away.score) || 0,
    espnWinner: w ? w.team.abbreviation : null,
    favoriteAbbr,
  };
}

async function main() {
  // 1. Descobre a semana atual pela ESPN
  const now = await (
    await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
    )
  ).json();
  const curType = now.season?.type || 2;
  const curWeek = now.week?.number || 1;

  // 2. Junta a semana atual + a anterior (pega jogos que terminaram tarde)
  const targets = [];
  if (curType === 2) {
    targets.push([2, curWeek]);
    if (curWeek > 1) targets.push([2, curWeek - 1]);
    if (curWeek < 18) targets.push([2, curWeek + 1]); // deixa palpitar adiantado
  } else {
    targets.push([3, curWeek]);
    if (curWeek > 1) targets.push([3, curWeek - 1]);
    targets.push([2, 18]); // fim da temporada regular
  }

  const batch = db.batch();
  let touched = 0;
  for (const [st, wk] of targets) {
    let data;
    try {
      data = await espn(st, wk);
    } catch (e) {
      console.warn(e.message);
      continue;
    }
    for (const ev of data.events || []) {
      const g = parseEvent(ev);
      if (!g.week || !g.seasonType) continue;
      if (g.seasonType === 3 && g.week === 4) continue; // Pro Bowl
      const pv = pointValueFor(g, CONFIG);
      batch.set(
        db.collection("games").doc(g.id),
        { ...g, pointValue: pv, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      touched++;
    }
  }
  await batch.commit();
  console.log(`Jogos atualizados: ${touched}`);

  // 3. Recalcula a classificação (todos os jogos + todos os palpites)
  const [gamesSnap, picksSnap, usersSnap] = await Promise.all([
    db.collection("games").get(),
    db.collection("picks").get(),
    db.collection("users").get(),
  ]);
  const games = gamesSnap.docs.map((d) => {
    const x = d.data();
    return { ...x, id: d.id, kickoffMs: x.kickoff?.toMillis?.() ?? x.kickoffMs };
  });
  const picks = picksSnap.docs.map((d) => d.data());
  const users = usersSnap.docs.map((d) => d.data());

  const prevRank = {};
  (await db.collection("standings").get()).forEach((d) => (prevRank[d.id] = d.data().rank));

  const { standings, weekMeta } = computeStandings({ games, picks, users, cfg: CONFIG });

  const b2 = db.batch();
  for (const row of standings) {
    b2.set(db.collection("standings").doc(row.username), {
      ...row,
      lastRank: prevRank[row.username] ?? row.rank,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  for (const [key, meta] of Object.entries(weekMeta)) {
    b2.set(db.collection("weekMeta").doc(key), { ...meta, key });
  }
  b2.set(db.collection("config").doc("season"), {
    currentWeek: curWeek,
    seasonType: curType,
    year: YEAR,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await b2.commit();

  console.log(
    `Classificação: ${standings.length} jogadores. Semana atual ${faseLabel({ seasonType: curType, week: curWeek })}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
