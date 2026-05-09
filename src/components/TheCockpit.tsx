import { useState, useEffect, useRef } from 'react';
import { Activity, ShieldAlert, Crosshair, Zap, AlertTriangle, RefreshCw, Users, MapPin, Skull } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

interface LiveEvent {
  EventID: number;
  EventName: string;
  EventTime: number;
  KillerName?: string;
  VictimName?: string;
  Assisters?: string[];
  [key: string]: any;
}

interface LiveData {
  activePlayer: {
    summonerName: string;
    currentGold: number;
  };
  allPlayers: {
    summonerName: string;
    championName: string;
    team: string;
    level: number;
    position: string;
    rawPosition?: { x: number; y: number; z: number };
    coordinates?: { x: number; y: number; z: number };
    items?: {
      itemID: number;
      displayName: string;
      price: number;
      count?: number;
    }[];
    scores: {
      kills: number;
      deaths: number;
      assists: number;
      creepScore: number;
    };
  }[];
  gameData: {
    gameTime: number;
  };
  events: {
    Events: LiveEvent[];
  };
}

interface Snapshot {
  tick: number;
  pWin: number;
  playerGold: number;
  teamGold: number;
}

export default function TheCockpit() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  
  // SV Engine States
  const [currentPWin, setCurrentPWin] = useState<number>(0.5);
  const [netAuthorship, setNetAuthorship] = useState<number>(0);
  const [receiptOfLabor, setReceiptOfLabor] = useState<number>(0);
  
  // Refs for tracking without triggering effect re-runs
  const lastTickState = useRef<Snapshot | null>(null);
  const processedEventIds = useRef<Set<number>>(new Set());
  const lastLogTimeRef = useRef<number>(0);
  const sessionGameIdRef = useRef<string | null>(null);

  const [eventLog, setEventLog] = useState<{ id: number; time: string; text: string; pWin: number }[]>([]);
  const [svHistory, setSvHistory] = useState<{ time: string; sv: number; pWin: number }[]>([]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // SV Engine Helpers
  const calculateTeamStats = (allPlayers: any[], activePlayerName: string) => {
    let usGold = 0, themGold = 0;
    let usXp = 0, themXp = 0;
    let playerGold = 0;
    
    const activePlayer = allPlayers.find(p => p.summonerName === activePlayerName);
    const activeTeam = activePlayer?.team || 'ORDER';

    allPlayers.forEach(p => {
      // Realized Power: We only count liquidated gold (items) and levels.
      // Unspent gold is entropy (Zero State) and does not contribute to Win Probability.
      const gold = p.items ? p.items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.count || 1), 0) : 0;
      const xp = p.level;

      if (p.team === activeTeam) {
        usGold += gold;
        usXp += xp;
      } else {
        themGold += gold;
        themXp += xp;
      }

      if (p.summonerName === activePlayerName) {
        playerGold = gold;
      }
    });

    return { usGold, themGold, usXp, themXp, playerGold };
  };

  const calculatePWin = (stats: ReturnType<typeof calculateTeamStats>, gameTime: number) => {
    const { usGold, themGold } = stats;
    const gameMinutes = gameTime / 60;

    // Pythagorean Expectation (c=2)
    let pGold = (usGold === 0 && themGold === 0) ? 0.5 : Math.pow(usGold, 2) / (Math.pow(usGold, 2) + Math.pow(themGold, 2));

    // Dampen early game swings (first 5 minutes) to avoid data artifacts from item purchase timing
    if (gameMinutes < 5) {
      const dampening = Math.pow(gameMinutes / 5, 2);
      pGold = 0.5 + (pGold - 0.5) * dampening;
    }

    return pGold;
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;

    const fetchLiveTelemetry = async () => {
      try {
        setStatus(prev => prev === 'idle' ? 'connecting' : prev);
        
        // Try direct local fetch first (for PWA / standalone)
        let res;
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        
        try {
          // Direct fetch to local game client
          res = await fetch('https://127.0.0.1:2999/liveclientdata/allgamedata');
        } catch (directErr) {
          // Fallback to proxy if direct fails
          // Note: In cloud environments, the proxy to 127.0.0.1 will also fail
          res = await fetch('/api/riot/liveclientdata');
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          const errorMsg = errData?.error || errData?.details || `HTTP error! status: ${res.status}`;
          
          // If we're in the cloud and the proxy failed with ECONNREFUSED (503), give a specific hint
          if (!isLocal && res.status === 503) {
            throw new Error("Cloud Environment Limitation: The Live API cannot be reached from the cloud. To use live telemetry, you must run this application locally on the same machine as League of Legends.");
          }
          
          throw new Error(errorMsg);
        }
        
        const data: LiveData = await res.json();
        
        if (!data || !data.activePlayer || !data.activePlayer.summonerName) {
          // Game is likely in loading screen or not fully initialized
          return;
        }

        setLiveData(data);
        setStatus('connected');

        // --- Official Telemetry Logging ---
        // Log snapshot every 60 seconds of game time
        if (auth.currentUser && data.gameData.gameTime - lastLogTimeRef.current >= 60) {
          const logTelemetry = async () => {
            try {
              if (!sessionGameIdRef.current) {
                sessionGameIdRef.current = `LIVE_${data.activePlayer.summonerName}_${Date.now()}`;
              }

              const players = data.allPlayers.map(p => {
                const playerLog: any = {
                  summonerName: p.summonerName,
                  championName: p.championName,
                  team: p.team,
                  position: p.position || 'UNKNOWN',
                  kills: p.scores.kills,
                  deaths: p.scores.deaths,
                  assists: p.scores.assists,
                  gold: p.items ? p.items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.count || 1), 0) : 0
                };

                // Add coordinates only if they exist in the Riot payload
                // Coordinates can appear in various fields depending on API version/context
                const rawCoords = (p as any).coordinates || (p as any).position || (p as any).rawPosition;
                
                if (rawCoords && typeof rawCoords === 'object' && 'x' in rawCoords) {
                  playerLog.coords = {
                    x: Number(rawCoords.x),
                    y: Number(rawCoords.y),
                    z: Number(rawCoords.z)
                  };
                }

                // Fallback for active player specifically, as Riot often exposes their coords differently
                if (!playerLog.coords && p.summonerName === data.activePlayer.summonerName) {
                  const activePos = (data.activePlayer as any).position || (data.activePlayer as any).coordinates;
                  if (activePos && typeof activePos === 'object' && 'x' in activePos) {
                    playerLog.coords = {
                      x: Number(activePos.x),
                      y: Number(activePos.y),
                      z: Number(activePos.z)
                    };
                  }
                }

                return playerLog;
              });

              // The user requested: "If there are none, don't record anything"
              const matchHasCoords = players.some(p => p.coords && typeof p.coords.x === 'number');
              
              if (!matchHasCoords) {
                // Silent skip to avoid filling logs with incomplete data
                return;
              }

              await addDoc(collection(db, 'telemetry_logs'), {
                userId: auth.currentUser?.uid,
                matchId: sessionGameIdRef.current,
                gameTime: data.gameData.gameTime,
                timestamp: serverTimestamp(),
                players: players
              });
              
              lastLogTimeRef.current = data.gameData.gameTime;
              console.log(`[Cockpit] Telemetry snapshot logged at ${data.gameData.gameTime}s`);
            } catch (logErr) {
              console.error('[Cockpit] Logging failure:', logErr);
            }
          };
          logTelemetry();
        }

        // --- SV Calculation Engine ---
        const playerName = data.activePlayer.summonerName;
        const stats = calculateTeamStats(data.allPlayers, playerName);
        const pWin = calculatePWin(stats, data.gameData.gameTime);
        setCurrentPWin(pWin);
        
        // 10-second ticks for higher resolution momentum tracking
        const currentTick = Math.floor(data.gameData.gameTime / 10);

        if (!lastTickState.current) {
          // Initialize baseline
          const totalDeltaP = pWin - 0.5;
          const totalWp = stats.usGold > 0 ? stats.playerGold / stats.usGold : 0.2; // Default 20% if 0
          const instantNet = totalWp * totalDeltaP * 100;
          
          setNetAuthorship(instantNet);
          setReceiptOfLabor(Math.abs(instantNet));
          
          lastTickState.current = {
            tick: currentTick,
            pWin: pWin,
            playerGold: stats.playerGold,
            teamGold: stats.usGold
          };
        } else if (currentTick > lastTickState.current.tick) {
          // A 10-second tick has passed, calculate delta
          const deltaP = pWin - lastTickState.current.pWin;
          const deltaPlayerGold = stats.playerGold - lastTickState.current.playerGold;
          const deltaTeamGold = stats.usGold - lastTickState.current.teamGold;
          
          const wp = deltaTeamGold > 0 ? deltaPlayerGold / deltaTeamGold : 0;
          const sv = wp * deltaP * 100;
          
          setNetAuthorship(prev => prev + sv);
          setReceiptOfLabor(prev => prev + Math.abs(sv));
          
          setSvHistory(prev => {
            const newHistory = [...prev, { time: formatTime(data.gameData.gameTime), sv: sv, pWin: pWin * 100 }];
            if (newHistory.length > 60) return newHistory.slice(newHistory.length - 60); // Keep last 10 mins (60 * 10s)
            return newHistory;
          });
          
          lastTickState.current = {
            tick: currentTick,
            pWin: pWin,
            playerGold: stats.playerGold,
            teamGold: stats.usGold
          };
        }

        // --- Event Log ---
        const newLogs: typeof eventLog = [];

        data.events.Events.forEach((event) => {
          if (!processedEventIds.current.has(event.EventID)) {
            let logText = '';

            if (event.EventName === 'ChampionKill') {
              const killer = data.allPlayers.find(p => p.summonerName === event.KillerName);
              const victim = data.allPlayers.find(p => p.summonerName === event.VictimName);
              
              if (event.KillerName === playerName) {
                logText = `ELIMINATED ${event.VictimName}`;
              } else if (event.Assisters?.includes(playerName)) {
                logText = `ASSISTED IN ELIMINATING ${event.VictimName}`;
              } else if (event.VictimName === playerName) {
                logText = `ELIMINATED BY ${event.KillerName}`;
              } else {
                // Tactical logging of other player deaths
                logText = `${event.KillerName || 'MINION/TURRET'} ELIMINATED ${event.VictimName}`;
              }
            } else if (['TurretKilled', 'DragonKill', 'HeraldKill', 'BaronKill'].includes(event.EventName)) {
              if (event.KillerName === playerName) {
                logText = `SECURED ${event.EventName.replace('Killed', '').replace('Kill', '').toUpperCase()}`;
              } else if (event.Assisters?.includes(playerName)) {
                logText = `ASSISTED SECURING ${event.EventName.replace('Killed', '').replace('Kill', '').toUpperCase()}`;
              }
            }

            if (logText) {
              newLogs.push({
                id: event.EventID,
                time: formatTime(event.EventTime),
                text: logText,
                pWin: pWin
              });
            }
            
            processedEventIds.current.add(event.EventID);
          }
        });

        if (newLogs.length > 0) {
          setEventLog(prev => [...newLogs, ...prev].slice(0, 50)); // Keep last 50 events
        }

      } catch (err: any) {
        console.error('Live API Error:', err.message || err);
        // If it's a 404 or connection refused, the game just isn't running yet.
        // We don't want to show a scary red error, just keep polling.
        const errMsg = err.message || String(err);
        if (errMsg.includes('ECONNREFUSED') || errMsg.includes('404') || errMsg.includes('Failed to fetch') || errMsg.includes('Network response was not ok')) {
          setStatus('idle'); // Go back to idle/waiting instead of error
          setErrorMessage('');
        } else {
          setStatus('error');
          setErrorMessage(errMsg);
        }
      }
    };

    fetchLiveTelemetry();
    interval = setInterval(fetchLiveTelemetry, 1000);

    return () => clearInterval(interval);
  }, []);

  const activePlayerStats = liveData?.allPlayers?.find(
    p => p.summonerName === liveData.activePlayer.summonerName
  );

  const csPerMin = activePlayerStats && liveData && liveData.gameData.gameTime > 0 
    ? (activePlayerStats.scores.creepScore / (liveData.gameData.gameTime / 60)).toFixed(1) 
    : '0.0';

  return (
    <div className="min-h-screen bg-brutal-black text-white p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-end justify-between border-b border-brutal-gray pb-6">
          <div>
            <h1 className="font-mono text-6xl tracking-tighter uppercase mb-2">The Cockpit</h1>
            <p className="font-mono text-sm text-zinc-500 uppercase tracking-widest">
              Live Telemetry & Slaughter Velocity Engine
            </p>
          </div>
          
          {/* Connection Status */}
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              status === 'connected' ? 'bg-neon-green animate-pulse' : 
              status === 'error' ? 'bg-neon-red' : 
              'bg-zinc-500'
            }`} />
            <span className="font-mono text-sm uppercase tracking-widest text-zinc-400">
              {status === 'connected' ? 'SIGNAL ACQUIRED' : 
               status === 'error' ? 'SIGNAL LOST' : 
               'SEEKING SIGNAL...'}
            </span>
          </div>
        </div>

        {/* Error Details (if any) */}
        {status === 'error' && errorMessage && (
          <div className="p-4 border border-neon-red bg-neon-red/10 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-neon-red shrink-0 mt-0.5" />
            <div>
              <h3 className="font-mono text-sm text-neon-red uppercase font-bold mb-1">Connection Error</h3>
              <p className="font-mono text-xs text-zinc-400">{errorMessage}</p>
              <p className="font-mono text-xs text-zinc-500 mt-2">
                Ensure League of Legends is running on this machine and you are actively in a match.
              </p>
              {window.location.hostname.includes('run.app') || window.location.hostname.includes('studio') ? (
                <div className="mt-4 p-3 border border-yellow-500/30 bg-yellow-500/5 text-yellow-200/80 font-mono text-[10px] uppercase tracking-wider leading-relaxed">
                  <p className="font-bold text-yellow-500 mb-1">Cloud Preview Detected</p>
                  <p>The Live API requires a connection to your local machine (127.0.0.1). Browsers block this from cloud-hosted sites due to security policies.</p>
                  <p className="mt-2">To use The Cockpit:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li>Download the source code and run it locally</li>
                    <li>Or use a local proxy that supports CORS</li>
                  </ul>
                </div>
              ) : (
                <p className="font-mono text-xs text-zinc-500 mt-2">
                  <strong>PWA / Standalone Mode:</strong> If you are running this app locally, you must accept the Riot API's self-signed certificate. <a href="https://127.0.0.1:2999/liveclientdata/allgamedata" target="_blank" rel="noreferrer" className="text-neon-green underline">Click here</a>, type "thisisunsafe" or click "Advanced" -&gt; "Proceed", then return here.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Tactical Overview - All Players */}
        {liveData && (
          <div className="border border-brutal-gray bg-brutal-black p-6">
            <div className="flex items-center gap-2 text-zinc-500 mb-6">
              <Users className="w-5 h-5" />
              <h3 className="font-mono text-sm uppercase tracking-widest">Tactical Overview (All Pilots)</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Allied Team */}
              <div className="space-y-2">
                <div className="font-mono text-[10px] text-neon-green uppercase tracking-widest mb-2 px-2">Allied Readiness Vector</div>
                {liveData.allPlayers.filter(p => p.team === liveData.allPlayers.find(ap => ap.summonerName === liveData.activePlayer.summonerName)?.team).map(player => (
                  <div key={player.summonerName} className={`p-3 border flex items-center justify-between ${player.summonerName === liveData.activePlayer.summonerName ? 'border-neon-green bg-neon-green/5' : 'border-zinc-800 bg-zinc-900/20'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-800 flex items-center justify-center font-mono text-xs font-bold shrink-0 border border-zinc-700">
                        {player.level}
                      </div>
                      <div>
                        <div className="font-mono text-xs font-bold uppercase truncate max-w-[150px]">{player.summonerName}</div>
                        <div className="font-mono text-[10px] text-zinc-500 uppercase">{player.championName}</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-8">
                      <div className="flex items-center gap-1.5 text-zinc-500">
                        <MapPin className="w-3.5 h-3.5" />
                        <span className="font-mono text-[10px] uppercase tracking-wider">{player.position || 'UNKNOWN'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-500">
                        <Skull className="w-3.5 h-3.5 text-neon-red" />
                        <span className="font-mono text-[10px] text-neon-red font-bold">{player.scores.deaths}</span>
                      </div>
                      <div className="font-mono text-xs tabular-nums text-zinc-300 w-16 text-right">
                        {player.scores.kills}<span className="text-zinc-600">/</span>{player.scores.deaths}<span className="text-zinc-600">/</span>{player.scores.assists}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Hostile Team */}
              <div className="space-y-2">
                <div className="font-mono text-[10px] text-neon-red uppercase tracking-widest mb-2 px-2 text-right">Hostile Threat Vector</div>
                {liveData.allPlayers.filter(p => p.team !== liveData.allPlayers.find(ap => ap.summonerName === liveData.activePlayer.summonerName)?.team).map(player => (
                  <div key={player.summonerName} className="p-3 border border-zinc-800 bg-zinc-900/20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-800 flex items-center justify-center font-mono text-xs font-bold shrink-0 border border-zinc-700">
                        {player.level}
                      </div>
                      <div>
                        <div className="font-mono text-xs font-bold uppercase truncate max-w-[150px]">{player.summonerName}</div>
                        <div className="font-mono text-[10px] text-zinc-500 uppercase">{player.championName}</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-8">
                      <div className="flex items-center gap-1.5 text-zinc-500">
                        <MapPin className="w-3.5 h-3.5" />
                        <span className="font-mono text-[10px] uppercase tracking-wider">{player.position || 'UNKNOWN'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-500">
                        <Skull className="w-3.5 h-3.5 text-neon-red" />
                        <span className="font-mono text-[10px] text-neon-red font-bold">{player.scores.deaths}</span>
                      </div>
                      <div className="font-mono text-xs tabular-nums text-zinc-300 w-16 text-right">
                        {player.scores.kills}<span className="text-zinc-600">/</span>{player.scores.deaths}<span className="text-zinc-600">/</span>{player.scores.assists}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Dashboard */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Primary Metrics */}
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* KDA */}
            <div className="p-8 border border-brutal-gray bg-brutal-black flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <Crosshair className="w-32 h-32" />
              </div>
              <div className="flex items-center gap-2 text-zinc-500 mb-6 relative z-10">
                <Zap className="w-5 h-5" />
                <h3 className="font-mono text-sm uppercase tracking-widest">Lethality (KDA)</h3>
              </div>
              <div className="font-mono text-7xl text-white tracking-tighter relative z-10">
                {activePlayerStats?.scores.kills || 0}
                <span className="text-zinc-600 mx-2">/</span>
                <span className="text-neon-red">{activePlayerStats?.scores.deaths || 0}</span>
                <span className="text-zinc-600 mx-2">/</span>
                {activePlayerStats?.scores.assists || 0}
              </div>
            </div>

            {/* CS / Min */}
            <div className="p-8 border border-brutal-gray bg-brutal-black flex flex-col justify-between relative overflow-hidden">
              {liveData?.activePlayer.currentGold !== undefined && liveData.activePlayer.currentGold > 1500 && (
                <div className="absolute top-0 left-0 w-full h-1 bg-neon-red animate-pulse" />
              )}
              <div className="flex items-center gap-2 text-zinc-500 mb-6">
                <Activity className="w-5 h-5" />
                <h3 className="font-mono text-sm uppercase tracking-widest">Resource Extraction</h3>
              </div>
              <div className="flex items-baseline gap-4">
                <div className="font-mono text-7xl text-white tracking-tighter">
                  {csPerMin}
                </div>
                <div className="font-mono text-xl text-zinc-500">
                  CS/MIN
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="font-mono text-sm text-zinc-500">
                  ({activePlayerStats?.scores.creepScore || 0} TOTAL)
                </div>
                {liveData?.activePlayer.currentGold !== undefined && (
                  <div className={`font-mono text-sm font-bold ${liveData.activePlayer.currentGold > 1500 ? 'text-neon-red animate-pulse' : 'text-zinc-400'}`}>
                    {Math.floor(liveData.activePlayer.currentGold)}G UNSPENT
                  </div>
                )}
              </div>
            </div>

            {/* SV Metrics */}
            <div className="md:col-span-2 p-8 border border-brutal-gray bg-brutal-black flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <ShieldAlert className="w-32 h-32" />
              </div>
              <div className="flex items-center gap-2 text-zinc-500 mb-6 relative z-10">
                <Activity className="w-5 h-5" />
                <h3 className="font-mono text-sm uppercase tracking-widest">Slaughter Velocity Engine</h3>
              </div>
              
              <div className="relative z-10 grid grid-cols-2 gap-8 mb-8">
                <div>
                  <div className="font-mono text-sm text-zinc-500 mb-2">NET AUTHORSHIP</div>
                  <div className={`font-mono text-6xl tracking-tighter ${netAuthorship > 0 ? 'text-neon-green' : netAuthorship < 0 ? 'text-neon-red' : 'text-white'}`}>
                    {netAuthorship > 0 ? '+' : ''}{netAuthorship.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="font-mono text-sm text-zinc-500 mb-2 flex items-center gap-2">
                    RECEIPT OF LABOR
                    {receiptOfLabor > 7.5 && (
                      <span className="text-[10px] bg-neon-green text-black px-1 font-bold animate-pulse">TYRANT CARRY PRESSURE</span>
                    )}
                  </div>
                  <div className="font-mono text-6xl tracking-tighter text-white">
                    {receiptOfLabor.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* Live SV Chart */}
              <div className="h-[200px] w-full relative z-10 border-t border-zinc-900 pt-6">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={svHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                    <ReferenceLine y={0} stroke="#444" strokeWidth={2} />
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#050505', border: '1px solid #333', fontFamily: 'monospace' }}
                      itemStyle={{ color: '#00FF00' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="sv" 
                      stroke="#00FF00" 
                      strokeWidth={3} 
                      dot={false} 
                      animationDuration={300}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="absolute bottom-0 left-0 right-0 flex justify-between font-mono text-[10px] text-zinc-600 uppercase tracking-widest pointer-events-none">
                  <span>Live Momentum Flux</span>
                  <span>10s Resolution</span>
                </div>
              </div>

              <div className="relative z-10 mt-8">
                <div className="font-mono text-sm text-zinc-500 mb-2">WIN PROBABILITY (P_WIN)</div>
                <div className="font-mono text-4xl tracking-tighter text-zinc-300">
                  {(currentPWin * 100).toFixed(1)}%
                </div>
              </div>

              <p className="font-mono text-xs text-zinc-500 mt-6 max-w-md">
                Calculated via Pythagorean expectation of Realized Power (Items & Levels). Momentum tracked in 10-second intervals.
              </p>
            </div>
          </div>

          {/* Telemetry Log */}
          <div className="p-6 border border-brutal-gray bg-brutal-black flex flex-col h-[600px]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-mono text-sm uppercase tracking-widest text-zinc-500">Action Log</h3>
              <RefreshCw className={`w-4 h-4 text-zinc-600 ${status === 'connected' ? 'animate-spin' : ''}`} />
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              <AnimatePresence initial={false}>
                {eventLog.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 border border-zinc-800 bg-zinc-900/50 flex items-center gap-4"
                  >
                    <div className="font-mono text-xs text-zinc-500 w-12 shrink-0">
                      {log.time}
                    </div>
                    <div className="flex-1 font-mono text-sm text-white">
                      {log.text}
                    </div>
                    <div className="font-mono text-xs text-zinc-500">
                      P_WIN: {(log.pWin * 100).toFixed(1)}%
                    </div>
                  </motion.div>
                ))}
                {eventLog.length === 0 && (
                  <div className="h-full flex items-center justify-center text-zinc-600 font-mono text-sm uppercase">
                    Awaiting telemetry...
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
