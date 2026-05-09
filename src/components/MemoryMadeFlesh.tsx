import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, BrainCircuit, Trash2, Download, Upload, FileText, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { db, auth } from '../firebase';
import { processMatchData } from '../lib/riot';
import { doc, setDoc, getDoc, serverTimestamp, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';

interface MemoryMadeFleshProps {
  puuid?: string;
  region?: string;
  matchHistory?: any[];
}

interface RecentMatch {
  matchId: string;
  champion: string;
  win?: boolean;
  kills?: number;
  deaths?: number;
  assists?: number;
  timestamp: number;
}

export default function MemoryMadeFlesh({ puuid, region, matchHistory }: MemoryMadeFleshProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string>('');
  const [isPairing, setIsPairing] = useState(false);
  const [pairingSuccess, setPairingSuccess] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const transcriptRef = useRef('');

  useEffect(() => {
    if (matchHistory && matchHistory.length > 0) {
      const matches = matchHistory.map(m => ({
        matchId: m.matchId,
        champion: m.champion || m.championName,
        win: m.win,
        kills: m.kills,
        deaths: m.deaths,
        assists: m.assists,
        timestamp: m.timestamp || m.gameCreation
      }));
      setRecentMatches(matches);
      if (matches.length > 0 && !selectedMatchId) setSelectedMatchId(matches[0].matchId);
    } else {
      fetchRecentMatches();
    }
  }, [puuid, region, matchHistory]);

  const fetchRecentMatches = async () => {
    if (!puuid || !region) {
      // If no puuid/region, try to get from labor_stats
      if (auth.currentUser) {
        try {
          const q = query(
            collection(db, 'labor_stats'),
            where('userId', '==', auth.currentUser.uid),
            orderBy('createdAt', 'desc'),
            limit(10)
          );
          const snap = await getDocs(q);
          const matches = snap.docs.map(d => ({
            matchId: d.data().matchId,
            champion: d.data().champion,
            timestamp: d.data().createdAt?.toMillis() || 0
          }));
          setRecentMatches(matches);
          if (matches.length > 0) setSelectedMatchId(matches[0].matchId);
        } catch (err: any) {
          console.error("Failed to fetch matches from Firestore", err);
          if (err.message?.includes('index')) {
            setError("This feature requires a Firestore index. Check console for link.");
          }
        }
      }
      return;
    }

    try {
      const q = query(
        collection(db, 'labor_stats'),
        where('userId', '==', auth.currentUser?.uid),
        orderBy('createdAt', 'desc'),
        limit(10)
      );
      const snap = await getDocs(q);
      const matches = snap.docs.map(d => ({
        matchId: d.data().matchId,
        champion: d.data().champion,
        timestamp: d.data().createdAt?.toMillis() || 0
      }));
      setRecentMatches(matches);
      if (matches.length > 0) setSelectedMatchId(matches[0].matchId);
    } catch (err: any) {
      console.error("Failed to fetch matches", err);
      if (err.message?.includes('index')) {
        setError("This feature requires a Firestore index. Check console for link.");
      } else {
        setError(`Failed to fetch matches: ${err.message}`);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setTranscript(content);
      transcriptRef.current = content;
    };
    reader.readAsText(file);
  };

  const startRecording = async () => {
    if (isRecording) return;
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        
        // Prevent processing if audio is too short (less than 500ms or very small)
        if (audioBlob.size < 1000) {
          console.warn("Audio too short or silent, skipping transcription.");
          setIsProcessing(false);
          return;
        }

        await processAudio(audioBlob, mimeType);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      setError('Microphone access denied or error occurred.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async (blob: Blob, mimeType: string) => {
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        try {
          const base64data = (reader.result as string).split(',')[1];
          
          const keyRes = await fetch('/api/gemini-key');
          if (!keyRes.ok) throw new Error("Failed to get API key.");
          const keyData = await keyRes.json();
          const apiKey = keyData.key;
            
          const ai = new GoogleGenAI({ apiKey: apiKey });
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: {
              parts: [
                { text: "Transcribe the following audio exactly as spoken. If the audio is silent, contains only background noise, or is unintelligible, return an empty string. Do not add any commentary, formatting, or placeholder text like 'The quick brown fox...'. Just the raw text or nothing." },
                { inlineData: { data: base64data, mimeType: mimeType } }
              ]
            },
            config: {
              temperature: 0
            }
          });

          if (response.text) {
            const newText = transcriptRef.current ? transcriptRef.current + '\n\n' + response.text : response.text;
            transcriptRef.current = newText;
            setTranscript(newText);
            
            if (selectedMatchId && auth.currentUser) {
              try {
                const docRef = doc(db, 'labor_stats', `${auth.currentUser.uid}_${selectedMatchId}`);
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists()) {
                  await setDoc(docRef, { transcript: newText }, { merge: true });
                }
              } catch (err: any) {
                console.error("Failed to save transcript to Labor", err);
                if (err.message?.includes('permission')) {
                  setError("Permission denied when saving to Firestore. Ensure you own this match record.");
                }
              }
            }
          }
        } catch (err) {
          console.error(err);
          setError('Failed to transcribe audio.');
        } finally {
          setIsProcessing(false);
        }
      };
    } catch (err) {
      console.error(err);
      setError('Failed to process audio blob.');
      setIsProcessing(false);
    }
  };

  const handlePairing = async () => {
    if (!selectedMatchId || !transcript || !auth.currentUser) {
      setError('Match selection and transcript are required for pairing.');
      return;
    }

    setIsPairing(true);
    setError('');
    setPairingSuccess(false);

    try {
      // 1. Fetch match details (telemetry)
      const res = await fetch(`/api/riot/match/${region || 'na1'}/${selectedMatchId}/details`);
      if (!res.ok) throw new Error("Failed to fetch match telemetry.");
      const matchData = await res.json();

      // 2. Prepare telemetry summary for Gemini
      // Use processMatchData to get the clinical ledger events
      const processed = processMatchData(matchData.info, matchData.timeline, puuid || '');
      const events = processed.eventsLedger.map((entry: any) => ({
        minute: entry.minute,
        events: entry.events.map((e: any) => e.desc).join(', ')
      }));

      const keyRes = await fetch('/api/gemini-key');
      if (!keyRes.ok) throw new Error("Failed to get API key.");
      const keyData = await keyRes.json();
      const apiKey = keyData.key;
        
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { text: `You are a clinical analyst pairing pilot transcripts with match telemetry.
          
          Match Telemetry (Events by Minute):
          ${JSON.stringify(events)}
          
          Pilot Transcript:
          ${transcript}
          
          Task:
          Analyze the transcript and telemetry to determine the pilot's "Cognitive State" and "Thought" for each minute of the match where the transcript provides insight.
          
          Return the analysis as a JSON array of objects with this schema:
          {
            "minute": number,
            "cognitiveState": string (one or two words, e.g. "Focused", "Frustrated", "Analytical"),
            "thought": string (a short summary of the pilot's internal monologue or intent at that moment)
          }
          ` }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                minute: { type: Type.NUMBER },
                cognitiveState: { type: Type.STRING },
                thought: { type: Type.STRING }
              },
              required: ["minute", "cognitiveState", "thought"]
            }
          }
        }
      });

      const enrichment = JSON.parse(response.text);
      
      // 3. Save to Firestore
      const docRef = doc(db, 'labor_stats', `${auth.currentUser.uid}_${selectedMatchId}`);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        throw new Error("This match has not been saved to 'The Labor' yet. Please save it from the Match History tab first.");
      }

      await setDoc(docRef, { 
        memoryEnrichment: enrichment,
        transcript: transcript 
      }, { merge: true });

      setPairingSuccess(true);
    } catch (err: any) {
      console.error("Pairing failed:", err);
      if (err.message?.includes('permission')) {
        setError("Permission denied when saving pairing. Ensure you own this match record.");
      } else {
        setError(`Pairing failed: ${err.message}`);
      }
    } finally {
      setIsPairing(false);
    }
  };

  const downloadTranscript = () => {
    if (!transcript) return;
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memory-made-flesh-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePurge = () => {
    setTranscript('');
    transcriptRef.current = '';
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* Match Selection & Upload Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-brutal-black border border-brutal-gray p-6 md:p-10">
          <h3 className="font-mono text-xl text-neon-green uppercase tracking-widest mb-6 flex items-center gap-3 border-b border-brutal-gray pb-4">
            <BrainCircuit className="w-6 h-6" />
            Memory Made Flesh
          </h3>
          
          <div className="space-y-6">
            <div className="space-y-4">
              <label className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Target Match Selection</label>
              <div className="border border-brutal-gray overflow-hidden">
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-brutal-black z-10">
                      <tr className="border-b border-brutal-gray font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
                        <th className="p-3">Result</th>
                        <th className="p-3">Champion</th>
                        <th className="p-3">K/D/A</th>
                        <th className="p-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                      {recentMatches.length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-zinc-500">No recent matches found</td>
                        </tr>
                      )}
                      {recentMatches.map((match) => {
                        const isSelected = match.matchId === selectedMatchId;
                        return (
                          <tr 
                            key={match.matchId}
                            className={`border-b border-brutal-gray/30 transition-colors ${isSelected ? 'bg-neon-green/10' : 'hover:bg-white/5'}`}
                          >
                            <td className="p-3">
                              {match.win !== undefined ? (
                                <span className={`font-bold ${match.win ? 'text-neon-green' : 'text-neon-red'}`}>
                                  {match.win ? 'VIC' : 'DEF'}
                                </span>
                              ) : (
                                <span className="text-zinc-500">---</span>
                              )}
                            </td>
                            <td className="p-3 text-white font-bold">{match.champion}</td>
                            <td className="p-3 text-zinc-400">
                              {match.kills !== undefined ? (
                                <><span className="text-white">{match.kills}</span>/<span className="text-neon-red">{match.deaths}</span>/<span className="text-blue-400">{match.assists}</span></>
                              ) : (
                                '---'
                              )}
                            </td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() => setSelectedMatchId(match.matchId)}
                                className={`uppercase tracking-widest text-[10px] font-bold transition-colors flex items-center justify-end gap-1 w-full ${isSelected ? 'text-neon-green' : 'text-zinc-500 hover:text-white'}`}
                              >
                                {isSelected ? 'Selected' : 'Select'}
                                {!isSelected && <ChevronRight className="w-3 h-3" />}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  disabled={isProcessing || isPairing}
                  className="bg-neon-green text-brutal-black font-mono font-bold px-4 py-4 uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  <Mic className="w-5 h-5" />
                  Dictate
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  className="bg-neon-red text-white font-mono font-bold px-4 py-4 uppercase tracking-widest hover:bg-red-400 transition-colors flex items-center justify-center gap-3 animate-pulse"
                >
                  <Square className="w-5 h-5 fill-current" />
                  Halt
                </button>
              )}

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing || isPairing}
                className="bg-brutal-gray text-white font-mono font-bold px-4 py-4 uppercase tracking-widest hover:bg-white hover:text-brutal-black transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <Upload className="w-5 h-5" />
                Upload
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept=".txt,.md"
              />
            </div>

            {error && (
              <div className="text-neon-red font-mono text-xs border border-neon-red/30 bg-neon-red/10 p-4 flex items-center gap-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {pairingSuccess && (
              <div className="text-neon-green font-mono text-xs border border-neon-green/30 bg-neon-green/10 p-4 flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Memory Enriched. Telemetry updated with Cognitive States.
              </div>
            )}
          </div>
        </div>

        <div className="bg-brutal-black border border-brutal-gray p-6 md:p-10 flex flex-col">
          <h3 className="font-mono text-sm text-zinc-500 uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-brutal-gray pb-4">
            <FileText className="w-4 h-4" />
            Transcript Processing
          </h3>
          
          <div className="flex-1 space-y-6">
            <div className="bg-zinc-900/50 border border-brutal-gray p-4 h-[180px] overflow-y-auto font-mono text-sm text-zinc-400 whitespace-pre-wrap">
              {transcript || "No transcript loaded. Dictate or upload to begin."}
            </div>

            <button
              onClick={handlePairing}
              disabled={!transcript || !selectedMatchId || isPairing || isProcessing}
              className="w-full bg-white text-brutal-black font-mono font-bold px-8 py-6 text-lg uppercase tracking-widest hover:bg-neon-green transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isPairing ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Pairing Telemetry...
                </>
              ) : (
                <>
                  <BrainCircuit className="w-6 h-6" />
                  Pair Telemetry
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-brutal-black border border-brutal-gray p-6 md:p-10 min-h-[200px] flex flex-col">
        <div className="flex justify-between items-center mb-6 border-b border-brutal-gray pb-4">
          <h3 className="font-mono text-sm text-white uppercase tracking-widest flex items-center gap-2">
            <Mic className="w-4 h-4" />
            Raw Memory
          </h3>
          {transcript && (
            <div className="flex items-center gap-4">
              <button 
                onClick={downloadTranscript}
                className="text-zinc-500 hover:text-neon-green transition-colors flex items-center gap-2 font-mono text-xs uppercase tracking-widest"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              <button 
                onClick={handlePurge}
                className="text-zinc-500 hover:text-neon-red transition-colors flex items-center gap-2 font-mono text-xs uppercase tracking-widest"
              >
                <Trash2 className="w-4 h-4" />
                Purge
              </button>
            </div>
          )}
        </div>
        
        <div className="flex-1 font-mono text-base text-zinc-300 whitespace-pre-wrap leading-relaxed">
          {transcript || (
            <span className="text-zinc-600 italic">Silence. Awaiting input...</span>
          )}
          {isProcessing && (
            <div className="mt-6 flex items-center gap-3 text-neon-green font-mono text-sm uppercase tracking-widest">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Manifesting thoughts...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
