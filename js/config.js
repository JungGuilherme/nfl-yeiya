// ============================================================
//  CONFIGURAÇÃO DO BOLÃO  —  edite só este arquivo
// ============================================================

export const CONFIG = {
  // Nome exibido no site
  poolName: "🏈 YEIYA",

  // Username (em minúsculas) de quem é o admin do bolão.
  // Só essa pessoa vê os botões de corrigir vencedor / anular jogo.
  // Entre no bolão com ESTE username pra ter os poderes de admin.
  adminUsername: "jungguilherme",

  // Temporada da NFL. Em 2026 a temporada é year=2026.
  season: {
    year: 2026,
  },

  // A partir de quando os jogos começam a valer ponto.
  // Jogos com kickoff ANTES desta data aparecem normalmente,
  // dá pra palpitar, mas valem 0 ponto (rótulo "amistoso").
  // Formato ISO em UTC.
  // Week 1/2026: só o jogo de abertura (NE @ SEA, 09/set 21h20 BRT) fica de fora.
  // O próximo jogo (SF @ LAR, 10/set) já vale ponto.
  scoringStartsAt: "2026-09-10T12:00:00Z",

  // Pontuação por fase (ESPN seasontype: 2 = regular, 3 = playoffs)
  points: {
    regular: 1,
    wildCard: 2,     // playoffs semana 1
    divisional: 2,   // playoffs semana 2
    conference: 3,   // playoffs semana 3
    superBowl: 5,     // playoffs semana 5
  },

  // Configuração do Firebase (cole aqui o objeto do console do Firebase).
  // Só chaves públicas de cliente — pode ficar no repositório público.
  firebase: {
    apiKey: "AIzaSyAusuepEfgI761cDKzdwoNEQXI6o4f1GwQ",
    authDomain: "nfl-yeiya.firebaseapp.com",
    projectId: "nfl-yeiya",
    storageBucket: "nfl-yeiya.firebasestorage.app",
    messagingSenderId: "598223854154",
    appId: "1:598223854154:web:d1fdfe726062b3213ae4b3",
  },
};

// URLs da API pública da ESPN (não precisa de chave)
export const ESPN = {
  scoreboard: (year, seasontype, week) =>
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${year}&seasontype=${seasontype}&week=${week}`,
  teams:
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40",
};
