// Funções puras compartilhadas (sem DOM). Usadas pelo site e pela automação.

// Valor em pontos de um jogo, dado fase/semana e regras do CONFIG.
export function pointValueFor({ seasonType, week, kickoffMs }, cfg) {
  if (kickoffMs && Date.parse(cfg.scoringStartsAt) > kickoffMs) return 0;
  if (seasonType === 3) {
    if (week === 1 || week === 2) return cfg.points.wildCard; // WC / Divisional
    if (week === 3) return cfg.points.conference;
    if (week === 5) return cfg.points.superBowl;
    return 0; // semana 4 = Pro Bowl, não conta
  }
  return cfg.points.regular;
}

export function faseLabel({ seasonType, week }) {
  if (seasonType !== 3) return `Semana ${week}`;
  return (
    { 1: "Wild Card", 2: "Divisional", 3: "Conf. Championship", 5: "Super Bowl" }[
      week
    ] || `Playoffs S${week}`
  );
}

// vencedor efetivo do jogo considerando override do admin e anulação
export function effectiveWinner(game) {
  if (game.voided) return null;
  if (game.adminOverrideWinner) return game.adminOverrideWinner;
  return game.espnWinner || null;
}

// Recalcula a classificação a partir de todos os jogos e todos os palpites.
// games: array de docs de jogo; picks: array {username, gameId, pickAbbr}
// users: array {username, team}
export function computeStandings({ games, picks, users, cfg }) {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const rows = new Map(); // username -> row

  for (const u of users) {
    rows.set(u.username, {
      username: u.username,
      team: u.team || null,
      totalPoints: 0,
      correctCount: 0,
      playoffCorrect: 0,
      weekPoints: {},
      perfectWeeks: [],
    });
  }

  for (const p of picks) {
    const g = gameById.get(p.gameId);
    if (!g) continue;
    const winner = effectiveWinner(g);
    if (!winner) continue; // jogo sem resultado ou anulado
    const row = rows.get(p.username);
    if (!row) continue;
    const pv = pointValueFor(
      { seasonType: g.seasonType, week: g.week, kickoffMs: g.kickoffMs },
      cfg
    );
    if (p.pickAbbr === winner) {
      row.correctCount += 1;
      row.totalPoints += pv;
      const key = `${g.seasonType}-${g.week}`;
      row.weekPoints[key] = (row.weekPoints[key] || 0) + pv;
      if (g.seasonType === 3) row.playoffCorrect += 1;
    }
  }

  // Semana perfeita + MVP: só sobre semanas totalmente encerradas
  const weekKeys = [...new Set(games.map((g) => `${g.seasonType}-${g.week}`))];
  const weekMeta = {};
  for (const key of weekKeys) {
    const [st, wk] = key.split("-").map(Number);
    const wGames = games.filter(
      (g) => g.seasonType === st && g.week === wk && !g.voided
    );
    const finished = wGames.length > 0 && wGames.every((g) => effectiveWinner(g));
    if (!finished) continue;
    const scoring = wGames.filter(
      (g) =>
        pointValueFor(
          { seasonType: st, week: wk, kickoffMs: g.kickoffMs },
          cfg
        ) > 0
    );

    // MVP: maior pontuação na semana (pode empatar)
    let best = 0;
    const wp = [];
    for (const row of rows.values()) {
      const pts = row.weekPoints[key] || 0;
      wp.push([row.username, pts]);
      if (pts > best) best = pts;
    }
    const mvp = best > 0 ? wp.filter(([, p]) => p === best).map(([u]) => u) : [];

    // Semana perfeita: acertou todos os jogos que valem ponto (e palpitou em todos)
    const perfect = [];
    for (const row of rows.values()) {
      if (scoring.length === 0) break;
      const ok = scoring.every((g) => {
        const pk = picks.find(
          (p) => p.username === row.username && p.gameId === g.id
        );
        return pk && pk.pickAbbr === effectiveWinner(g);
      });
      if (ok) {
        perfect.push(row.username);
        if (!row.perfectWeeks.includes(key)) row.perfectWeeks.push(key);
      }
    }
    weekMeta[key] = { mvp, perfect, best };
  }

  // Ordenação e ranking
  const list = [...rows.values()].sort(
    (a, b) =>
      b.totalPoints - a.totalPoints ||
      b.playoffCorrect - a.playoffCorrect ||
      b.correctCount - a.correctCount ||
      a.username.localeCompare(b.username)
  );
  list.forEach((r, i) => (r.rank = i + 1));

  return { standings: list, weekMeta };
}
