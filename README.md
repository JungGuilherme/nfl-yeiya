# 🏈 YEIYA — Bolão da NFL

Site simples e temático (campo de futebol americano + escudos dos times) pra
palpitar nos jogos da NFL com os amigos. Cada acerto vale ponto, os playoffs
valem mais, o palpite de cada jogo fecha no kickoff e a pontuação é calculada
sozinha seguindo a **ESPN**.

- **Frontend:** HTML/CSS/JS puro, hospedado no GitHub Pages
- **Banco:** Firebase Firestore (plano gratuito)
- **Automação:** GitHub Actions puxa jogos/resultados da ESPN e recalcula o ranking

---

## Pontuação

| Fase | Pontos por acerto |
|---|---|
| Temporada regular | 1 |
| Wild Card / Divisional | 2 |
| Conference Championship | 3 |
| Super Bowl | 5 |

- O **jogo de abertura não vale ponto** (ver `scoringStartsAt` no `js/config.js`).
- Empate no ranking: desempata quem tem **mais acertos nos playoffs**.
- **MVP da rodada:** quem fez mais pontos na semana. **Semana perfeita:** acertou
  todos os jogos que valem ponto naquela semana.

---

## Setup (uma vez, ~15 min)

### 1. Firebase

1. Crie um projeto em <https://console.firebase.google.com> (sem custo, sem cartão).
2. **Build → Firestore Database → Criar banco** → modo produção → região `southamerica-east1`.
3. **Build → Authentication → Começar → aba Sign-in method → ative "Anônimo".**
4. **Project settings (engrenagem) → Seus apps → ícone `</>`** → registre um app web,
   copie o objeto `firebaseConfig` e cole em `js/config.js` (campo `firebase`).
5. Ainda em `js/config.js`, troque `adminUsername` pelo **seu** username (minúsculas).
6. Em `firestore.rules`, troque as **3 ocorrências de `guilherme`** pelo mesmo username.
7. **Firestore → aba Regras** → cole todo o conteúdo de `firestore.rules` → Publicar.

### 2. Chave da automação (Service Account)

1. **Project settings → Service accounts → "Gerar nova chave privada"** → baixa um JSON.
2. No GitHub: **Settings do repositório → Secrets and variables → Actions → New repository secret**
   - Nome: `FIREBASE_SERVICE_ACCOUNT`
   - Valor: cole **todo o conteúdo do JSON**
3. Nunca faça commit desse arquivo (o `.gitignore` já bloqueia).

### 3. Publicar o site

Crie um repositório vazio chamado `nfl-yeiya` em <https://github.com/new> (público, sem README).
Depois, na pasta do projeto:

```bash
git remote add origin https://github.com/jungguilherme/nfl-yeiya.git
git push -u origin main
```

No GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `root`** → salvar.
Em 1–2 min o site fica no ar em `https://jungguilherme.github.io/nfl-yeiya/`.

### 4. Primeira carga de dados

**Actions → "Atualizar bolão YEIYA" → Run workflow.**
Isso cria os jogos da semana no Firestore. Depois disso o cron roda sozinho a cada 30 min.
(Os palpites só podem ser salvos depois que os jogos existem no banco.)

---

## Como jogar

1. Abrir o link → **Entrar** → escolher username + PIN de 4 dígitos → escolher o time (vira avatar).
2. Na aba **Rodada**, clicar no time que acha que ganha. Salva na hora.
3. O palpite trava no kickoff. Depois disso aparecem os palpites dos amigos.
4. **Ranking** mostra a classificação, os movimentos de posição e os destaques da rodada.

Login em outro aparelho: mesmo username + PIN.

---

## Admin

Logado com o `adminUsername`, aparece a aba **Admin**: dá pra forçar o vencedor de
um jogo (se a ESPN errar/atrasar) ou anular um jogo. O recálculo entra na próxima
passada da automação — ou rode o workflow manualmente.

## Rodar a automação localmente (opcional, pra testar)

```bash
cd scripts
npm install
FIREBASE_SERVICE_ACCOUNT="$(cat ../serviceAccount.json)" node update.mjs
```

## Ajustes rápidos

Tudo em **`js/config.js`**: nome do bolão, admin, ano da temporada, data de início
da pontuação e valores de pontos.
