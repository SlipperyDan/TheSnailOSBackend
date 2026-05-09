import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import https from 'https';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());

// Helper to safely fetch and parse JSON from Riot API
async function fetchRiotApi(url: string, apiKey: string, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, { 
      headers: { 'X-Riot-Token': apiKey },
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    const contentType = res.headers.get("content-type");

    if (!res.ok) {
      let errorText = res.statusText;
      try {
        if (contentType?.includes("application/json")) {
          const errData = await res.json();
          errorText = errData.status?.message || JSON.stringify(errData);
        } else {
          errorText = await res.text();
        }
      } catch (e) {}
      throw new Error(`Riot API Error (${res.status}): ${String(errorText).substring(0, 200)}`);
    }

    if (!contentType || !contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(`Riot API returned non-JSON (Status ${res.status}): ${text.substring(0, 200)}`);
    }

    return await res.json();
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error(`Riot API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

app.get('/api/gemini-key', async (req, res) => {
  try {
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("Gemini API key not found in environment variables (API_KEY or GEMINI_API_KEY).");
      res.status(404).json({ error: "API key not configured on server." });
      return;
    }
    res.json({ key: apiKey });
  } catch (error) {
    console.error("Error fetching API key:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/api/riot/player/:region/:gameName/:tagLine/matches', async (req, res) => {
  const { region, gameName, tagLine } = req.params;
  const apiKey = process.env.RIOT_API_KEY;

  if (!apiKey) {
    res.status(400).json({ error: "RIOT_API_KEY environment variable is missing." });
    return;
  }

  let accountRegion = 'americas';
  if (['europe', 'euw1', 'eun1', 'tr1', 'ru'].includes(region)) accountRegion = 'europe';
  if (['asia', 'kr', 'jp1'].includes(region)) accountRegion = 'asia';
  if (['sea', 'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2'].includes(region)) accountRegion = 'sea';

  try {
    const accData = await fetchRiotApi(`https://${accountRegion}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, apiKey);
    const puuid = accData.puuid;

    const start = parseInt((req.query.start as string) || '0');
    const count = parseInt((req.query.count as string) || '10');

    const matchIds = await fetchRiotApi(`https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`, apiKey);

    if (matchIds.length === 0) {
      res.json({ puuid, history: [] });
      return;
    }

    const matchPromises = matchIds.map((id: string) =>
      fetchRiotApi(`https://${region}.api.riotgames.com/lol/match/v5/matches/${id}`, apiKey)
        .catch(() => null)
    );

    const matchesData = await Promise.all(matchPromises);

    const history = matchesData.filter((m: any) => m && m.info).map((m: any) => {
      const info = m.info;
      const participant = info.participants.find((p: any) => p.puuid === puuid);
      return {
        matchId: m.metadata.matchId,
        gameCreation: info.gameCreation,
        gameDuration: info.gameDuration,
        championName: participant?.championName,
        kills: participant?.kills,
        deaths: participant?.deaths,
        assists: participant?.assists,
        win: participant?.win,
        queueId: info.queueId
      };
    });

    res.json({ puuid, history });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/riot/active-game/:region/:puuid', async (req, res) => {
  const { region, puuid } = req.params;
  const apiKey = process.env.RIOT_API_KEY;

  if (!apiKey) {
    res.status(400).json({ error: "RIOT_API_KEY environment variable is missing." });
    return;
  }

  let platforms: string[] = [];
  if (region === 'americas') platforms = ['na1', 'br1', 'la1', 'la2'];
  else if (region === 'europe') platforms = ['euw1', 'eun1', 'tr1', 'ru'];
  else if (region === 'asia') platforms = ['kr', 'jp1'];
  else if (region === 'sea') platforms = ['oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2'];
  else platforms = [region];

  for (const platform of platforms) {
    try {
      const url = `https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`;
      const response = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
      if (response.ok) {
        const data = await response.json();
        res.json({ inGame: true, gameId: data.gameId, platformId: platform });
        return;
      } else if (response.status === 404) {
        continue;
      } else {
        console.error(`Error checking active game on ${platform}: ${response.status}`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  res.json({ inGame: false });
});

app.get('/api/riot/match/:region/:matchId/details', async (req, res) => {
  const { region, matchId } = req.params;
  const apiKey = process.env.RIOT_API_KEY;

  if (!apiKey) {
    res.status(400).json({ error: "RIOT_API_KEY environment variable is missing." });
    return;
  }

  try {
    const infoData = await fetchRiotApi(`https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`, apiKey);
    const timelineData = await fetchRiotApi(`https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`, apiKey);

    res.json({ info: infoData.info, timeline: timelineData.info });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy for Riot Live Client Data API to bypass self-signed SSL issues in browser
app.get('/api/riot/liveclientdata', (req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: 2999,
    path: '/liveclientdata/allgamedata',
    method: 'GET',
    rejectUnauthorized: false, // Bypass self-signed cert error
    headers: {
      'Accept': 'application/json'
    }
  };

  const riotReq = https.request(options, (riotRes) => {
    let data = '';
    
    riotRes.on('data', (chunk) => {
      data += chunk;
    });
    
    riotRes.on('end', () => {
      if (riotRes.statusCode && riotRes.statusCode >= 400) {
        res.status(riotRes.statusCode).json({ error: `Riot Live API returned ${riotRes.statusCode}` });
        return;
      }
      try {
        res.json(JSON.parse(data));
      } catch (e: any) {
        res.status(500).json({ error: "Failed to parse Riot API response", details: e.message });
      }
    });
  });
  
  riotReq.on('error', (error: any) => {
    res.status(500).json({ error: error.message, details: "Make sure League of Legends is running on this machine." });
  });
  
  riotReq.end();
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { index: false }));
    app.get('*all', (req, res) => {
      const htmlPath = path.join(distPath, 'index.html');
      if (fs.existsSync(htmlPath)) {
        let html = fs.readFileSync(htmlPath, 'utf8');
        res.send(html);
      } else {
        res.status(404).send('Not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
