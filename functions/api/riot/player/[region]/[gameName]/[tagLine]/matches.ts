export async function onRequest(context: any) {
  const { request, env, params } = context;
  const { region, gameName, tagLine } = params;
  const apiKey = env.RIOT_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "RIOT_API_KEY environment variable is missing in Cloudflare." }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  const headers = { 'X-Riot-Token': apiKey };

  // Helper to safely fetch and parse JSON from Riot API
  async function fetchRiotApi(url: string, headers: any) {
    const res = await fetch(url, { headers });
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
      throw new Error(`Riot API Error (${res.status}): ${errorText.substring(0, 200)}`);
    }

    if (!contentType || !contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(`Riot API returned non-JSON (Status ${res.status}): ${text.substring(0, 200)}`);
    }

    try {
      const data = await res.json();
      return data;
    } catch (e: any) {
      throw new Error(`Failed to parse Riot API response as JSON (Status ${res.status}): ${e.message}`);
    }
  }

  let accountRegion = 'americas';
  if (['europe', 'euw1', 'eun1', 'tr1', 'ru'].includes(region as string)) accountRegion = 'europe';
  if (['asia', 'kr', 'jp1'].includes(region as string)) accountRegion = 'asia';
  if (['sea', 'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2'].includes(region as string)) accountRegion = 'sea';

  try {
    const accData = await fetchRiotApi(`https://${accountRegion}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName as string)}/${encodeURIComponent(tagLine as string)}`, headers);
    const puuid = accData.puuid;

    const url = new URL(request.url);
    const start = parseInt(url.searchParams.get('start') || '0');
    const count = parseInt(url.searchParams.get('count') || '10');

    const matchIds = await fetchRiotApi(`https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`, headers);

    if (matchIds.length === 0) {
      return new Response(JSON.stringify({ puuid, history: [] }), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Fetch basic info for all matches in parallel
    const matchPromises = matchIds.map((id: string) => 
      fetchRiotApi(`https://${region}.api.riotgames.com/lol/match/v5/matches/${id}`, headers)
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

    return new Response(JSON.stringify({ puuid, history }), { 
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      } 
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}
