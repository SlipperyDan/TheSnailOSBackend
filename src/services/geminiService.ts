import { GoogleGenAI } from "@google/genai";
import { auth } from '../firebase';

export async function analyzeLeagueClip(videoBase64: string, mimeType: string, champion: string) {
  const keyRes = await fetch('/api/gemini-key');
  if (!keyRes.ok) {
    throw new Error("Failed to get API key.");
  }
  const keyData = await keyRes.json();
  const apiKey = keyData.key;

  const ai = new GoogleGenAI({ apiKey: apiKey });

  const prompt = `
    Analyze this League of Legends clip. The player is playing ${champion}.
    Perform the following 7 passes over the video:
    1. Identify the player's position on the map and any nearby champions and their relative positions.
    2. Read the player's health, mana, summoner spells, and cooldowns.
    3. Identify the health of any nearby enemies.
    4. Map what abilities were used by the player.
    5. Identify who the player cast those abilities on.
    6. Map what died, where, and how it affects the fight.
    7. Synthesize findings and compare to reasonable expectations (e.g., player cannot ignite if they don't have it).
    
    Provide a detailed description of the fight based on these passes.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      {
        inlineData: {
          data: videoBase64,
          mimeType: mimeType,
        },
      },
      {
        text: prompt,
      },
    ],
  });

  return response.text;
}
