import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { motion } from 'motion/react';
import { Eye, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { auth } from '../firebase';

interface OracleInsightProps {
  matchData: any;
}

export function OracleInsight({ matchData }: OracleInsightProps) {
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateInsight = async () => {
    if (!matchData) return;
    
    setLoading(true);
    setError(null);

    try {
      const keyRes = await fetch('/api/gemini-key');
      if (!keyRes.ok) throw new Error("Failed to get API key.");
      const keyData = await keyRes.json();
      const apiKey = keyData.key;
        
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      const targetPlayer = matchData.players.find((p: any) => p.isTarget);
      
      // Filter events to only those with > 1% probability shift
      const significantEvents = matchData.eventsLedger.filter((e: any) => Math.abs(e.deltaP) > 0.01);
      
      const prompt = `
You are the "Oracle", a neutral, educational AI assistant for a League of Legends analytics tool called the Lunacy Protocol.
Your goal is to help players understand their match stats and the major events that shifted the game's win probability.
Do not assign blame or be toxic. Be objective, analytical, and encouraging.

Here is the data for the player (the "Pilot"):
Champion: ${targetPlayer.champion}
Lane: ${targetPlayer.lane}
K/D/A: ${targetPlayer.kills}/${targetPlayer.deaths}/${targetPlayer.assists}
CS: ${targetPlayer.cs}
Gold: ${targetPlayer.gold}
Damage Dealt: ${targetPlayer.damage}
Damage Taken: ${targetPlayer.damageTaken}
Vision Score: ${targetPlayer.vision}
CC Score: ${targetPlayer.ccScore}

Key Lunacy Protocol Stats:
- Slaughter Velocity (SV): ${ (targetPlayer.receipt * 100).toFixed(2) }% (The absolute amount of probability movement they authored)

Significant Events (>1% Win Probability Shift):
${significantEvents.map((e: any) => `- Minute ${e.minute}: ${e.events.map((ev: any) => ev.desc).join(', ')} | Authored Window Shift (SV): ${(e.sv * 100).toFixed(2)}% | Team Window Shift (ΔP): ${(e.deltaP * 100).toFixed(2)}%`).join('\n')}

Please provide:
1. A brief, neutral explanation of the player's overall stats (especially SV) and what they mean in the context of this match.
2. A chronological breakdown of the significant events provided above. Explain what happened, who it affected, and how it shifted the match's momentum. Keep it educational so the player learns how these events impact win probability.
3. A concluding thought on the player's agency in the match.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
      });

      setInsight(response.text || 'The Oracle remains silent.');
    } catch (err: any) {
      console.error('Oracle Insight Error:', err);
      setError('The Oracle could not be reached. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-brutal-gray pb-4">
        <div>
          <h2 className="text-2xl font-mono uppercase tracking-widest text-white flex items-center gap-3">
            <Eye className="w-6 h-6 text-neon-green" />
            Oracle's Insight
          </h2>
          <p className="text-zinc-500 font-mono text-sm mt-2">
            Neutral, educational analysis of your stats and major match events.
          </p>
        </div>
        {!insight && !loading && (
          <button
            onClick={generateInsight}
            className="flex items-center gap-2 px-6 py-3 bg-neon-green text-brutal-black font-mono text-sm uppercase tracking-widest hover:bg-white transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Consult the Oracle
          </button>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="w-8 h-8 text-neon-green animate-spin" />
          <p className="font-mono text-sm text-zinc-500 uppercase tracking-widest animate-pulse">
            The Oracle is analyzing the ledger...
          </p>
        </div>
      )}

      {error && (
        <div className="p-6 border border-neon-red bg-neon-red/10 text-neon-red font-mono text-sm">
          {error}
        </div>
      )}

      {insight && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 border border-brutal-gray bg-brutal-black/50 max-w-none"
        >
          <div className="markdown-body space-y-4 font-mono text-sm text-zinc-400 [&>h1]:text-white [&>h1]:uppercase [&>h1]:tracking-widest [&>h1]:text-xl [&>h1]:mb-4 [&>h2]:text-white [&>h2]:uppercase [&>h2]:tracking-widest [&>h2]:text-lg [&>h2]:mb-3 [&>h2]:mt-6 [&>h3]:text-white [&>h3]:uppercase [&>h3]:tracking-widest [&>h3]:mb-2 [&>h3]:mt-4 [&>p]:mb-4 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:mb-4 [&>ul>li]:mb-2 [&>strong]:text-neon-green">
            <ReactMarkdown>{insight}</ReactMarkdown>
          </div>
        </motion.div>
      )}
    </div>
  );
}
