import React, { useState } from 'react';
import { Upload, Search, Loader2, Play, Activity, Clock } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { auth } from '../firebase';

const CHAMPIONS = [
  "Aatrox", "Ahri", "Akali", "Akshan", "Alistar", "Ambessa", "Amumu", "Anivia", "Annie", "Aphelios", "Ashe",
  "Aurelion Sol", "Aurora", "Azir", "Bard", "Bel'Veth", "Blitzcrank", "Brand", "Braum", "Briar", "Caitlyn",
  "Camille", "Cassiopeia", "Cho'Gath", "Corki", "Darius", "Diana", "Dr. Mundo", "Draven", "Ekko",
  "Elise", "Evelynn", "Ezreal", "Fiddlesticks", "Fiora", "Fizz", "Galio", "Gangplank", "Garen",
  "Gnar", "Gragas", "Graves", "Gwen", "Hecarim", "Heimerdinger", "Hwei", "Illaoi", "Irelia", "Ivern",
  "Janna", "Jarvan IV", "Jax", "Jayce", "Jhin", "Jinx", "K'Sante", "Kai'Sa", "Kalista", "Karma",
  "Karthus", "Kassadin", "Katarina", "Kayle", "Kayn", "Kennen", "Kha'Zix", "Kindred", "Kled",
  "Kog'Maw", "LeBlanc", "Lee Sin", "Leona", "Lillia", "Lissandra", "Lucian", "Lulu", "Lux",
  "Malphite", "Malzahar", "Maokai", "Master Yi", "Mel", "Milio", "Miss Fortune", "Mordekaiser", "Morgana",
  "Naafiri", "Nami", "Nasus", "Nautilus", "Neeko", "Nidalee", "Nilah", "Nocturne", "Nunu & Willump",
  "Olaf", "Orianna", "Ornn", "Pantheon", "Poppy", "Pyke", "Qiyana", "Quinn", "Rakan", "Rammus",
  "Rek'Sai", "Rell", "Renata Glasc", "Renekton", "Rengar", "Riven", "Rumble", "Ryze", "Samira",
  "Sejuani", "Senna", "Seraphine", "Sett", "Shaco", "Shen", "Shyvana", "Singed", "Sion", "Sivir",
  "Skarner", "Smolder", "Sona", "Soraka", "Swain", "Sylas", "Syndra", "Tahm Kench", "Taliyah",
  "Talon", "Taric", "Teemo", "Thresh", "Tristana", "Trundle", "Tryndamere", "Twisted Fate", "Twitch",
  "Udyr", "Urgot", "Varus", "Vayne", "Veigar", "Vel'Koz", "Vex", "Vi", "Viego", "Viktor",
  "Vladimir", "Volibear", "Warwick", "Wukong", "Xayah", "Xerath", "Xin Zhao", "Yasuo", "Yone",
  "Yorick", "Yuumi", "Zac", "Zed", "Zeri", "Ziggs", "Zilean", "Zoe", "Zyra"
];

interface LedgerEvent {
  timestamp: string;
  type: string;
  description: string;
}

interface AnalysisData {
  ledger: LedgerEvent[];
}

export default function ValkyrieEngine() {
  const [champion, setChampion] = useState('');
  const [otherChampions, setOtherChampions] = useState('');
  const [context, setContext] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!videoFile || !champion) return;
    setLoading(true);
    setError('');
    setAnalysisData(null);
    
    try {
      const keyRes = await fetch('/api/gemini-key');
      if (!keyRes.ok) {
        throw new Error("Failed to get API key.");
      }
      const keyData = await keyRes.json();
      const apiKey = keyData.key;
        
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      // Convert file to base64
      const reader = new FileReader();
      reader.readAsDataURL(videoFile);
      const base64Data = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
      });
      const base64Content = base64Data.split(',')[1];

      const prompt = `
        Analyze this League of Legends clip. The player is playing ${champion}.
        ${otherChampions ? `Other champions involved in this clip: ${otherChampions}.` : ''}
        ${context ? `Additional Context from the player: ${context}` : ''}
        Perform the following 7 passes:
        1. Identify player position on map and nearby champions (relative to player). Use relative directions (e.g., 'from behind', 'from the flank', 'from the river') instead of cardinal directions.
        2. Read player health, mana, summoner spells, and cooldowns.
        3. Identify health of nearby enemies.
        4. Map abilities used by the player and nearby enemies.
        5. Identify who the player and enemies cast those abilities on.
        6. Identify who died and by whose hand they were killed.
        7. Do one final pass to be as accurate as possible and construct a highly detailed, chronological event ledger. Compare the actions to strict League of Legends game mechanics. If the engine identifies an action as 'impossible' based on these mechanics, infer the most reasonable sequence of events.
        
        Use the following EXAMPLE as a guide for the level of detail required in the ledger (DO NOT use this example's content for your actual output, it is purely for structural reference):
        | Timestamp | Event Type | Description |
        | :--- | :--- | :--- |
        | 0:00.000 | MOVEMENT | Malzahar walks into bot lane while using his blue trinket on the bottom lane river bush. |
        | 0:03.490 | VISION | Malzahar centers his camera on himself and notices an enemy Tryndamere in melee range. |
        | 0:05.930 | ATTACK | Tryndamere attacks Malzahar, breaking his Void Shift passive shield. |
        | 0:06.732 | CAST | Malzahar casts Malefic Visions (E) on Tryndamere. |
        | 0:07.099 | ATTACK | Malzahar casts Summoner Ignite on Tryndamere. |
        | 0:08.432 | CAST | Malzahar casts Summoner Flash towards tower, canceling his Call of the Void (Q) animation at 50%. |
        | 0:10.482 | LIQUIDATION | Tryndamere dies to Nether Grasp (R), giving 378 gold. |
        
        Output the result as a JSON object with a single property:
        - "ledger": An array of objects, each representing a distinct event in the video. Each object must have "timestamp" (string, e.g., "0:05.630"), "type" (string, e.g., "CAST", "DAMAGE", "KILL", "DEATH", "MOVEMENT", "VISION", "ATTACK", "DEBUFF", "LIQUIDATION", "ECONOMY"), and "description" (string, clinical description of the event).
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: videoFile.type,
                data: base64Content,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ledger: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timestamp: { type: Type.STRING },
                    type: { type: Type.STRING },
                    description: { type: Type.STRING }
                  },
                  required: ["timestamp", "type", "description"]
                }
              }
            },
            required: ["ledger"]
          }
        }
      });

      if (response.text) {
        setAnalysisData(JSON.parse(response.text));
      } else {
        setError('No analysis generated.');
      }
    } catch (err) {
      console.error(err);
      setError('Error analyzing video. Please check your API key and file size.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-brutal-black border border-brutal-gray p-6">
        <h3 className="font-mono text-sm text-neon-green uppercase tracking-widest mb-6 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Valkyrie Engine: Video Analysis
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-4">
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-widest">Select Champion</label>
            <input
              type="text"
              list="champions"
              value={champion}
              onChange={(e) => setChampion(e.target.value)}
              className="w-full bg-[#050505] border border-brutal-gray p-3 text-white font-mono focus:border-neon-green focus:outline-none transition-colors"
              placeholder="e.g. Aatrox"
            />
            <datalist id="champions">
              {CHAMPIONS.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-widest">Other Champions (Optional)</label>
            <input
              type="text"
              value={otherChampions}
              onChange={(e) => setOtherChampions(e.target.value)}
              className="w-full bg-[#050505] border border-brutal-gray p-3 text-white font-mono focus:border-neon-green focus:outline-none transition-colors"
              placeholder="e.g. Yasuo, Lee Sin"
            />
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-widest">Upload Clip</label>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-zinc-500 file:mr-4 file:py-3 file:px-4 file:border-0 file:text-xs file:font-mono file:uppercase file:tracking-widest file:bg-brutal-gray file:text-white hover:file:bg-zinc-700 transition-colors cursor-pointer bg-[#050505] border border-brutal-gray"
            />
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block text-xs font-mono text-zinc-500 uppercase tracking-widest">Additional Context (Optional)</label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="w-full bg-[#050505] border border-brutal-gray p-3 text-white font-mono focus:border-neon-green focus:outline-none transition-colors min-h-[100px] resize-y"
            placeholder="e.g. I was trying to bait the enemy jungler here, but I think I misplayed my flash..."
          />
        </div>

        <div className="mt-6">
          <button
            onClick={handleAnalyze}
            disabled={loading || !videoFile || !champion}
            className="w-full md:w-auto bg-neon-green text-brutal-black font-mono font-bold px-8 py-3 uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {loading ? 'Processing Telemetry...' : 'Initialize Valkyrie'}
          </button>
        </div>
        
        {error && (
          <div className="mt-4 text-neon-red font-mono text-sm border border-neon-red/30 bg-neon-red/10 p-3">
            {error}
          </div>
        )}
      </div>

      {analysisData && (
        <div className="bg-brutal-black border border-brutal-gray p-6">
          <h3 className="font-mono text-sm text-neon-green uppercase tracking-widest mb-4 border-b border-brutal-gray pb-2 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Event Ledger
          </h3>
          <div className="space-y-4">
            {analysisData.ledger.map((event, idx) => (
              <div key={idx} className="border-l-2 border-zinc-800 pl-4 py-1 relative">
                <div className="absolute -left-[5px] top-2.5 w-2 h-2 rounded-full bg-zinc-800"></div>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="font-mono text-xs text-neon-green">{event.timestamp}</span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 bg-zinc-900 px-2 py-0.5">
                    {event.type}
                  </span>
                </div>
                <p className="font-mono text-sm text-zinc-300">
                  {event.description}
                </p>
              </div>
            ))}
            {analysisData.ledger.length === 0 && (
              <p className="font-mono text-sm text-zinc-500 italic">No distinct events extracted.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
