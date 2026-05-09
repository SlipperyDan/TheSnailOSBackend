export async function onRequest(context: any) {
  const { env, params } = context;
  const { region, matchId } = params;
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

  try {
    const infoData = await fetchRiotApi(`https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`, headers);
    const timelineData = await fetchRiotApi(`https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`, headers);

    return new Response(JSON.stringify({ info: infoData.info, timeline: timelineData.info }), { 
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
