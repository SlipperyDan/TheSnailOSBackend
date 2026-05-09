import React, { useState, useEffect } from 'react';
import ValkyrieEngine from './components/ValkyrieEngine';
import MemoryMadeFlesh from './components/MemoryMadeFlesh';
import TheLabor from './components/TheLabor';
import TheCockpit from './components/TheCockpit';
import { OracleInsight } from './components/OracleInsight';
import { FirebaseAuthGate } from './components/FirebaseAuthGate';
import OrchestraStatistics from './components/OrchestraStatistics';
import legioLogo from '/favicon.png';
import { motion } from 'motion/react';
import { Search, Loader2, Activity, History, ChevronRight, Download, BrainCircuit, Save, Radar, Target, Skull, Zap, Eye, Coins, Shield, Sword, Trophy, Crosshair, FileText, FileSpreadsheet, Database } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, CartesianGrid } from 'recharts';
import { db, auth } from './firebase';
import { processMatchData, formatMinute } from './lib/riot';
import { collection, doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { signOut, onAuthStateChanged, User } from 'firebase/auth';

const PROTOCOL_QUOTES = [
  "Inaction is entropy; only applied force proves you exist.",
  "The tapestry of fate is woven blind; we seize the needle and force the pattern with our labor.",
  "We do not build to increase our stats; we build to delete theirs.",
  "Assume the pilot (you) is an idiot. This is not self-criticism; it is engineering discipline.",
  "The Protocol is proof of growth. It documents authored resistance against entropy.",
  "The Receipt of Labor quantifies the total probability movement you authored, independent of outcome direction.",
  "Power does not reside in what you hold; it resides in what you move.",
  "Superiority in statistics is secondary. Superiority in relevance is decisive.",
  "Outcome is irrelevant. Only force exerted against inertia is measured."
];


const getEventLabel = (type: string, desc: string) => {
  if (type === 'KILL') return '│ kill';
  if (type === 'OBJECTIVE') {
    if (desc.includes('Dragon')) return '│ dragon';
    if (desc.includes('Baron')) return '│ baron';
    return '│ objective';
  }
  if (type === 'DEATH') return '│ death';
  if (type === 'COMBAT') return '│ teamfight';
  return '│ event';
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload;
    if (!data) return null;
    const events = data.events || [];
    const winProb = data.winProb || 0;
    const sv = data.sv || 0;
    const svColor = sv > 0 ? '#00FF00' : (sv < 0 ? '#FF0000' : '#888');

    return (
      <div className="bg-[#050505] border border-[#333] p-3 font-mono text-sm z-50 relative">
        <p className="text-[#888] mb-2">{`Minute ${formatMinute(label)}`}</p>
        <p style={{ color: '#00FF00' }}>Win Prob : {winProb.toFixed(1)}%</p>
        <div className="flex items-center gap-2">
          <p style={{ color: svColor }}>Authored Window Shift (SV) : {sv > 0 ? '+' : ''}{sv.toFixed(1)}%</p>
          {Math.abs(sv) > 7.5 && (
            <span className="text-[10px] bg-neon-green text-black px-1 font-bold animate-pulse">TYRANT</span>
          )}
        </div>
        {events.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#333] space-y-1">
            {events.map((e: any, i: number) => (
              <p key={i} className="text-[#AAA] text-xs">
                {e.type === 'KILL' ? '⚔️' : e.type === 'OBJECTIVE' ? '🚩' : e.type === 'DEATH' ? '💀' : '•'} {e.desc}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }
  return null;
};

const TUNING_ALPHA = 1.05; // User said 110% (1.1) is too high

const getClassification = (receipt: number, players: any[], duration: number = 0) => {
  const receiptPct = receipt * 100;
  if (receiptPct > 7.5) return { text: 'TYRANT CARRY PRESSURE', color: 'text-neon-green shadow-[0_0_20px_rgba(0,255,0,0.4)] animate-pulse' };

  const receipts = players.map(p => p.receipt).sort((a, b) => a - b);
  const medianReceipt = receipts[Math.floor(receipts.length / 2)];

  // Late game weighting: reward performance in long games
  const gameMinutes = duration / 60;
  // For every 5 minutes after 20 minutes, we lower the threshold by 1%
  const lateGameWeight = Math.max(0, (gameMinutes - 20) / 5) * 0.01;
  const dynamicAlpha = TUNING_ALPHA - lateGameWeight;

  const isHighReceipt = receipt > medianReceipt * dynamicAlpha;

  if (isHighReceipt) return { text: 'HIGH AGENCY PILOT', color: 'text-neon-green' };
  return { text: 'LOW AGENCY PILOT', color: 'text-zinc-500' };
};

const getEventIcon = (type: string) => {
  switch (type) {
    case 'KILL': return <Target className="w-3 h-3 text-neon-green" />;
    case 'DEATH': return <Skull className="w-3 h-3 text-neon-red" />;
    case 'OBJECTIVE': return <Trophy className="w-3 h-3 text-blue-400" />;
    case 'VISION': return <Eye className="w-3 h-3 text-purple-400" />;
    case 'ECONOMY': return <Coins className="w-3 h-3 text-yellow-500" />;
    case 'POWER': return <Zap className="w-3 h-3 text-cyan-400" />;
    case 'COMBAT': return <Sword className="w-3 h-3 text-orange-400" />;
    case 'ASSIST': return <Shield className="w-3 h-3 text-blue-300" />;
    default: return <Activity className="w-3 h-3 text-zinc-500" />;
  }
};

const TacticalRiftMap = ({ positions, players, pilotId }: { positions: Record<number, { x: number, y: number } | null>, players: any[], pilotId: number }) => {
  // Summoner's Rift Tactical Coordinate System (16,000 x 16,000 units)
  const MAX_X = 16000;
  const MAX_Y = 16000;

  const normalizeX = (val: number) => (val / MAX_X) * 100;
  const normalizeY = (val: number) => (val / MAX_Y) * 100;

  return (
    <div className="relative w-full h-full bg-transparent overflow-hidden group border border-zinc-800/10 shadow-2xl">
      {/* High-Fidelity Tactical Schematic Overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <img 
          src="/summonersrift.png" 
          alt="Tactical Rift Grid"
          className="w-full h-full object-fill brightness-[0.8] contrast-125"
          referrerPolicy="no-referrer"
        />
        {/* Subtle Neon Tint to harmonize with the UI markers */}
        <div className="absolute inset-0 bg-neon-green/5 mix-blend-overlay pointer-events-none" />
      </div>

      {/* Hardware Interface Markers */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none font-mono font-bold uppercase overflow-visible z-10">
        <defs>
          <filter id="neon-bloom" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="0.5" result="blur" />
            <feDropShadow dx="0" dy="0" stdDeviation="0.2" floodColor="#00FF00" floodOpacity="1" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        
        {/* Coordinate Anchor Points - Subtler */}
        <g style={{ filter: 'url(#neon-bloom)' }} opacity="0.3">
          <circle cx="2" cy="98" r="0.3" fill="#00FF00" />
          <circle cx="98" cy="2" r="0.3" fill="#FF0000" />
        </g>
      </svg>
      {players.map(p => {
        const pos = positions[p.id];
        if (!pos) return null;
        
        const isPilot = p.id === pilotId;
        const isBlueTeam = p.teamId === 100;
        const colorClass = isBlueTeam ? 'bg-blue-500' : 'bg-neon-red';
        const labelClass = isBlueTeam ? 'text-blue-400' : 'text-neon-red';
        
        return (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-300 hover:z-30`}
            style={{ 
              left: `${normalizeX(pos.x)}%`, 
              top: `${100 - normalizeY(pos.y)}%` 
            }}
          >
            <div className="relative">
               {/* Pulse effect for pilot */}
               {isPilot && (
                 <div className="absolute inset-0 rounded-full bg-neon-green/30 animate-ping -z-10" />
               )}
               <div className={`w-2 h-2 md:w-2.5 md:h-2.5 rounded-full ${colorClass} border border-black/80 ${isPilot ? 'border-neon-green shadow-[0_0_10px_rgba(0,255,0,1)] z-40' : 'z-20'} shadow-lg`}></div>
               
               {/* Label with technical styling - Smaller and more refined */}
               <div className={`absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[8px] leading-none tracking-tight ${isPilot ? 'text-neon-green font-bold z-50 border-neon-green/50' : labelClass} transition-all bg-black/90 px-1.5 py-0.5 rounded-xs border border-zinc-800 pointer-events-none shadow-xl flex items-center gap-1 opacity-100`}>
                 {isPilot && <div className="w-1 h-1 bg-neon-green rounded-full animate-pulse" />}
                 {p.name}
               </div>
            </div>
          </motion.div>
        );
      })}

      <div className="absolute inset-0 border border-white/5 pointer-events-none"></div>
      <div className="absolute top-1.5 left-1.5 flex flex-col gap-0 opacity-30">
        <span className="font-mono text-[5px] text-zinc-500 uppercase tracking-widest leading-none">Sector: 11-B</span>
        <span className="font-mono text-[5px] text-neon-green uppercase tracking-widest leading-none">Mode: Tactical_Overlay</span>
      </div>
      <div className="absolute bottom-1.5 right-1.5 font-mono text-[6px] text-zinc-600 uppercase tracking-[0.5em] opacity-20">
        PROTOCOL_VISTRA_09
      </div>
    </div>
  );
};

const ShiftBar = ({ value, max, isPercentage = false }: { value: number, max: number, isPercentage?: boolean }) => {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const absValue = Math.abs(value);
  const percentage = Math.min(100, (absValue / max) * 100);
  const formattedValue = isPercentage ? `${isPositive ? '+' : ''}${(value || 0).toFixed(2)}%` : `${isPositive ? '+' : ''}${(value || 0).toFixed(2)}`;
  const textColor = isPositive ? 'text-neon-green' : isNegative ? 'text-neon-red' : 'text-zinc-500';

  return (
    <div className="flex items-center justify-end gap-3">
      <span className={`font-mono text-[11px] font-bold w-16 text-right ${textColor} tabular-nums tracking-tighter`}>
        {formattedValue}
      </span>
      <div className="w-24 h-2 bg-zinc-900/80 flex relative border border-zinc-800/30 rounded-sm overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-700/30 z-10"></div>
        <div className="w-1/2 flex justify-end">
          {isNegative && (
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              className="h-full bg-gradient-to-l from-neon-red/80 to-neon-red/20 shadow-[0_0_10px_rgba(255,0,0,0.2)]" 
            />
          )}
        </div>
        <div className="w-1/2 flex justify-start">
          {isPositive && (
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              className="h-full bg-gradient-to-r from-neon-green/80 to-neon-green/20 shadow-[0_0_10px_rgba(0,255,0,0.2)]" 
            />
          )}
        </div>
      </div>
    </div>
  );
};

const formatLane = (lane: string) => {
  const l = (lane || 'UNKNOWN').toUpperCase();
  return l === 'UTILITY' ? 'SUPPORT' : l;
};

const summarizeRelativePositions = (relativePositions: any) => {
  if (!relativePositions) return 'No Spatial Context Available';

  const allies = relativePositions.allies || [];
  const enemies = relativePositions.enemies || [];

  const nearestAlly = allies.length ? Math.round(allies[0].distance) : null;
  const nearestEnemy = enemies.length ? Math.round(enemies[0].distance) : null;

  const closeAllies = allies.filter((a: any) => a.distance <= 2500).length;
  const closeEnemies = enemies.filter((e: any) => e.distance <= 2500).length;

  return [
    nearestAlly !== null ? `Nearest Ally: ${nearestAlly}` : 'Nearest Ally: N/A',
    nearestEnemy !== null ? `Nearest Enemy: ${nearestEnemy}` : 'Nearest Enemy: N/A',
    `Allies Nearby: ${closeAllies}`,
    `Enemies Nearby: ${closeEnemies}`
  ].join(', ');
};

const diagnoseLedgerWindow = (entry: any) => {
  const events = entry.events || [];
  const types = new Set(events.map((ev: any) => ev.type));

  if (types.has('KILL') && entry.sv > 0.03) return 'High-Agency Conversion';
  if (types.has('DEATH') && entry.deltaP > 0) return 'Profitable Death Window';
  if (types.has('OBJECTIVE')) return 'Objective Pressure Window';
  if (types.has('ECONOMY')) return 'Power Spike / Economic Conversion';
  if (types.has('VISION')) return 'Vision Manipulation';
  if (Math.abs(entry.deltaP) < 0.002) return 'Low-Impact Window';
  if (entry.deltaP < 0) return 'Adverse Team Window';

  return 'Kinetic Transition Window';
};

export default function App() {
  const [riotId, setRiotId] = useState('BananaTyrant#Snail');
  const [region, setRegion] = useState('americas');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [puuid, setPuuid] = useState('');
  const [matchHistory, setMatchHistory] = useState<any[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [matchData, setMatchData] = useState<any>(null);
  const [itemData, setItemData] = useState<Record<string, string>>({});
  
  const [activeTab, setActiveTab] = useState<'engine' | 'memory' | 'labor' | 'valkyrie' | 'history' | 'cockpit' | 'stats'>('engine');
  const [randomQuote, setRandomQuote] = useState('');
  const [savingToLabor, setSavingToLabor] = useState(false);
  const [laborSaveError, setLaborSaveError] = useState('');
  const [laborSaveSuccess, setLaborSaveSuccess] = useState(false);
  const [user, setUser] = useState<User | null>(auth.currentUser);

  useEffect(() => {
    setRandomQuote(PROTOCOL_QUOTES[Math.floor(Math.random() * PROTOCOL_QUOTES.length)]);
    
    const fetchItems = async () => {
      try {
        const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
        const versions = await versionsRes.json();
        const latestVersion = versions[0];
        const itemRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/item.json`);
        if (itemRes.ok) {
          const itemJson = await itemRes.json();
          const mapping: Record<string, string> = {};
          Object.keys(itemJson.data).forEach(id => {
            mapping[id] = itemJson.data[id].name;
          });
          setItemData(mapping);
        }
      } catch (e) {
        console.error("Failed to fetch item data", e);
      }
    };
    fetchItems();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleSaveToLabor = async () => {
    if (!matchData || !auth.currentUser) {
      setLaborSaveError("Must be logged in to save to The Labor.");
      return;
    }
    
    setSavingToLabor(true);
    setLaborSaveError('');
    setLaborSaveSuccess(false);
    
    try {
      const targetPlayer = matchData.players.find((p: any) => p.isTarget);
      const docRef = doc(db, 'labor_stats', `${auth.currentUser.uid}_${selectedMatchId}`);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        await updateDoc(docRef, {
          champion: targetPlayer.champion,
          lane: targetPlayer.lane,
          slaughterVelocity: targetPlayer.receipt * 100,
          damageTaken: targetPlayer.damageTaken,
          ccScore: targetPlayer.ccScore
        });
      } else {
        await setDoc(docRef, {
          userId: auth.currentUser.uid,
          matchId: selectedMatchId,
          champion: targetPlayer.champion,
          lane: targetPlayer.lane,
          slaughterVelocity: targetPlayer.receipt * 100,
          damageTaken: targetPlayer.damageTaken,
          ccScore: targetPlayer.ccScore,
          createdAt: serverTimestamp()
        });
      }
      
      setLaborSaveSuccess(true);
      setTimeout(() => setLaborSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error("Failed to save to The Labor:", err);
      setLaborSaveError(err.message);
    } finally {
      setSavingToLabor(false);
    }
  };

  const handleDownloadTelemetry = () => {
    if (!matchData) return;

    const targetPlayer = matchData.players.find((p: any) => p.isTarget);
    if (!targetPlayer) {
      throw new Error('Target player not found in matchData.players');
    }

    const classification = getClassification(targetPlayer.receipt, matchData.players, matchData.matchMetadata.duration);

    const teamPlayers = matchData.players.filter(
      (p: any) => p.teamId === targetPlayer.teamId && p.id !== targetPlayer.id
    );

    const safeAvg = (sum: number, count: number) => (count > 0 ? sum / count : 0);

    const teamAvg = {
      kills: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.kills, 0), teamPlayers.length),
      deaths: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.deaths, 0), teamPlayers.length),
      assists: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.assists, 0), teamPlayers.length),
      damage: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.damage, 0), teamPlayers.length),
      damageTaken: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.damageTaken, 0), teamPlayers.length),
      vision: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.vision, 0), teamPlayers.length),
      ccScore: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.ccScore, 0), teamPlayers.length),
      cs: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.cs, 0), teamPlayers.length),
      gold: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.gold, 0), teamPlayers.length),
      receipt: safeAvg(teamPlayers.reduce((sum: number, p: any) => sum + p.receipt, 0), teamPlayers.length),
    };

    const teamTotal = {
      kills: targetPlayer.kills + teamPlayers.reduce((sum: number, p: any) => sum + p.kills, 0),
      deaths: targetPlayer.deaths + teamPlayers.reduce((sum: number, p: any) => sum + p.deaths, 0),
      assists: targetPlayer.assists + teamPlayers.reduce((sum: number, p: any) => sum + p.assists, 0),
      damage: targetPlayer.damage + teamPlayers.reduce((sum: number, p: any) => sum + p.damage, 0),
      damageTaken: targetPlayer.damageTaken + teamPlayers.reduce((sum: number, p: any) => sum + p.damageTaken, 0),
      vision: targetPlayer.vision + teamPlayers.reduce((sum: number, p: any) => sum + p.vision, 0),
      ccScore: targetPlayer.ccScore + teamPlayers.reduce((sum: number, p: any) => sum + p.ccScore, 0),
      cs: targetPlayer.cs + teamPlayers.reduce((sum: number, p: any) => sum + p.cs, 0),
      gold: targetPlayer.gold + teamPlayers.reduce((sum: number, p: any) => sum + p.gold, 0),
      receipt: targetPlayer.receipt + teamPlayers.reduce((sum: number, p: any) => sum + p.receipt, 0),
    };

    const getShare = (pilot: number, total: number) => {
      if (total === 0) return '0.0%';
      return `${((pilot / total) * 100).toFixed(1)}%`;
    };

    const formatPct = (value: number, digits = 2) =>
      `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;

    const formatTable = (headers: string[], rows: string[][]) => {
      const colWidths = headers.map((h, i) => {
        return Math.max(h.length, ...rows.map((row) => (row[i] || '').length));
      });
      
      const pad = (str: string, width: number) => str + ' '.repeat(Math.max(0, width - str.length));
      
      const headerRow = `| ${headers.map((h, i) => pad(h, colWidths[i])).join(' | ')} |`;
      const separatorRow = `| ${colWidths.map((w) => '-'.repeat(w)).join(' | ')} |`;
      const dataRows = rows
        .map((row) => `| ${row.map((cell, i) => pad(cell, colWidths[i])).join(' | ')} |`)
        .join('\n');
      
      return `${headerRow}\n${separatorRow}\n${dataRows}`;
    };

    const summarizeRelativePositions = (relativePositions: any) => {
      if (!relativePositions) return 'No Spatial Context Available';
      
      const allies = relativePositions.allies || [];
      const enemies = relativePositions.enemies || [];
      
      const nearestAlly = allies.length ? Math.round(allies[0].distance) : null;
      const nearestEnemy = enemies.length ? Math.round(enemies[0].distance) : null;
      
      const closeAllies = allies.filter((a: any) => a.distance <= 2500).length;
      const closeEnemies = enemies.filter((e: any) => e.distance <= 2500).length;
      
      return [
        nearestAlly !== null ? `Nearest Ally: ${nearestAlly}` : 'Nearest Ally: N/A',
        nearestEnemy !== null ? `Nearest Enemy: ${nearestEnemy}` : 'Nearest Enemy: N/A',
        `Allies Nearby: ${closeAllies}`,
        `Enemies Nearby: ${closeEnemies}`
      ].join(', ');
    };

    const diagnoseLedgerWindow = (entry: any) => {
      const events = entry.events || [];
      const types = new Set(events.map((ev: any) => ev.type));
      
      if (types.has('KILL') && entry.sv > 0.03) return 'High-Agency Conversion';
      if (types.has('DEATH') && entry.deltaP > 0) return 'Profitable Death Window';
      if (types.has('OBJECTIVE')) return 'Objective Pressure Window';
      if (types.has('ECONOMY')) return 'Power Spike / Economic Conversion';
      if (types.has('VISION')) return 'Vision Manipulation';
      if (Math.abs(entry.deltaP) < 0.002) return 'Low-Impact Window';
      if (entry.deltaP < 0) return 'Adverse Team Window';
      
      return 'Kinetic Transition Window';
    };

    const compHeaders = ['Metric', 'Pilot', 'Team Avg', '% Share'];
    const compRows = [
      ['Kills', targetPlayer.kills.toString(), teamAvg.kills.toFixed(1), getShare(targetPlayer.kills, teamTotal.kills)],
      ['Deaths', targetPlayer.deaths.toString(), teamAvg.deaths.toFixed(1), getShare(targetPlayer.deaths, teamTotal.deaths)],
      ['Assists', targetPlayer.assists.toString(), teamAvg.assists.toFixed(1), getShare(targetPlayer.assists, teamTotal.assists)],
      ['Damage', targetPlayer.damage.toLocaleString(), teamAvg.damage.toLocaleString(undefined, { maximumFractionDigits: 0 }), getShare(targetPlayer.damage, teamTotal.damage)],
      ['Damage Taken', targetPlayer.damageTaken.toLocaleString(), teamAvg.damageTaken.toLocaleString(undefined, { maximumFractionDigits: 0 }), getShare(targetPlayer.damageTaken, teamTotal.damageTaken)],
      ['Vision', targetPlayer.vision.toString(), teamAvg.vision.toFixed(1), getShare(targetPlayer.vision, teamTotal.vision)],
      ['CC Score', targetPlayer.ccScore.toString(), teamAvg.ccScore.toFixed(1), getShare(targetPlayer.ccScore, teamTotal.ccScore)],
      ['CS', targetPlayer.cs.toString(), teamAvg.cs.toFixed(1), getShare(targetPlayer.cs, teamTotal.cs)],
      ['Gold', targetPlayer.gold.toLocaleString(), teamAvg.gold.toLocaleString(undefined, { maximumFractionDigits: 0 }), getShare(targetPlayer.gold, teamTotal.gold)],
      ['Slaughter Velocity', (targetPlayer.receipt * 100).toFixed(2), (teamAvg.receipt * 100).toFixed(2), getShare(targetPlayer.receipt, teamTotal.receipt)],
    ];
    const compTable = formatTable(compHeaders, compRows);
    
    const csHeaders = ['Minute', 'Total CS', 'CS/Min'];
    const csRows = matchData.csHistory.map((c: any) => [
      `${c.minute}m`,
      c.cs.toString(),
      c.csPerMin.toFixed(1)
    ]);
    const csTable = formatTable(csHeaders, csRows);
    
    const interpretLocation = (x: number, y: number) => {
      // Basic interpretation for Summoner's Rift 16k system
      if (x < 4000 && y < 4000) return 'Blue Base Area';
      if (x > 12000 && y > 12000) return 'Red Base Area';
      if (x < 8000 && y > 8000) return 'Top-Side Jungle';
      if (x > 8000 && y < 8000) return 'Bot-Side Jungle';
      if (Math.abs(x - y) < 1500) return 'Mid Lane Corridor';
      if (x < 2500 || y > 13500) return 'Top Lane Perimeter';
      if (x > 13500 || y < 2500) return 'Bot Lane Perimeter';
      return 'Neutral/River Transition';
    };
    
    const ledgerSections = matchData.eventsLedger.map((e: any) => {
      const window = `${(e.minute - 1).toString().padStart(2, '0')}:00-${e.minute.toString().padStart(2, '0')}:00`;
      
      const events = e.events.length
        ? e.events
            .map((ev: any) => {
              let desc = ev.desc;
              if (desc.includes('[ID:')) {
                const id = desc.match(/\[ID:(\d+)\]/)?.[1];
                if (id && itemData[id]) {
                  desc = desc.replace(`[ID:${id}]`, itemData[id]);
                }
              }
              return `  - [${ev.type}] ${desc} (${formatMinute(ev.timestamp / 60000)})`;
            })
            .join('\n')
        : '  - No Kinetic Events Recorded';
      
      const spatial = summarizeRelativePositions(e.relativePositions);
      const diagnosis = diagnoseLedgerWindow(e);
      
      const enrichment = matchData.memoryEnrichment?.find((en: any) => en.minute === e.minute);
      const cognitiveState = enrichment?.cognitiveState || 'UNRECORDED';
      const thought = enrichment?.thought || 'No memory data for this window.';
      
      const pilotPos = e.playerPositions?.[targetPlayer.id];
      const spatialInterpretation = pilotPos ? `${interpretLocation(pilotPos.x, pilotPos.y)} [${Math.round(pilotPos.x)}, ${Math.round(pilotPos.y)}]` : 'Spatial coordinates unavailable';
      
      return `### ${window}\n- **Cognitive State:** ${cognitiveState}\n- **Thought:** ${thought}\n- **Window Diagnosis:** ${diagnosis}\n- **Authored Window Shift (SV):** ${formatPct(e.sv)}\n- **Team Window Shift (ΔP):** ${formatPct(e.deltaP)}\n- **Spatial Relative Context:** ${spatial}\n- **Tactical Location:** ${spatialInterpretation}\n- **Clinical Event Log:**\n${events}`;
    }).join('\n\n');
    
    const formatLane = (lane: string) => {
      const l = (lane || 'UNKNOWN').toUpperCase();
      return l === 'UTILITY' ? 'SUPPORT' : l;
    };
    
    const alliesRoster = matchData.players
      .filter((p: any) => p.teamId === targetPlayer.teamId)
      .map((p: any) => `- **${formatLane(p.lane)}**: ${p.champion} (${p.name})`)
      .join('\n');
    
    const enemiesRoster = matchData.players
      .filter((p: any) => p.teamId !== targetPlayer.teamId)
      .map((p: any) => `- **${formatLane(p.lane)}**: ${p.champion} (${p.name})`)
      .join('\n');
    
    const spatialHeaders = ['Minute', 'Champion', 'Coordinates [X, Y]', 'Tactical Region'];
    const spatialRows: string[][] = [];
    
    (matchData.spatialHistory || []).forEach((snap: any) => {
      const minStr = snap.minute.toString().padStart(2, '0');
      
      // We sort by participantId (1-10) for consistency
      const sortedParticipants = [...matchData.players].sort((a, b) => a.id - b.id);
      
      sortedParticipants.forEach((p: any) => {
        const pos = snap.playerPositions?.[p.id];
        const coords = pos ? `[${Math.round(pos.x)}, ${Math.round(pos.y)}]` : 'N/A';
        const region = pos ? interpretLocation(pos.x, pos.y) : 'UNKNOWN';
        
        spatialRows.push([
          minStr,
          p.champion,
          coords,
          region
        ]);
      });
    });
    const spatialTelemetryTable = formatTable(spatialHeaders, spatialRows);
    
    const md = `## Metadata\n\n- **Pilot ID:** ${targetPlayer.name}\n- **Champion:** ${targetPlayer.champion}\n- **Protocol Classification:** ${classification.text}\n- **Slaughter Velocity (Total):** ${(targetPlayer.receipt * 100).toFixed(2)}\n- **Team:** ${targetPlayer.teamId === 100 ? "BLUE" : "RED"}\n- **K/D/A:** ${matchData.pilotStats.kills} / ${matchData.pilotStats.deaths} / ${matchData.pilotStats.assists} (${matchData.pilotStats.kda} Ratio)\n- **Damage to Champions:** ${matchData.pilotStats.damage.toLocaleString()}\n- **Damage Taken:** ${targetPlayer.damageTaken.toLocaleString()}\n- **CS:** ${matchData.pilotStats.cs}\n- **Vision Score:** ${matchData.pilotStats.vision}\n- **Gold Earned:** ${matchData.pilotStats.gold.toLocaleString()}\n- **Timestamp:** ${new Date().toISOString()}\n- **Match ID:** ${matchData.matchMetadata.matchId}\n- **Duration:** ${Math.floor(matchData.matchMetadata.duration / 60)}m ${matchData.matchMetadata.duration % 60}s\n- **Game Version:** ${matchData.matchMetadata.version}\n\n## Team Compositions\n\n### Pilot's Team\n${alliesRoster}\n\n### Enemy Team\n${enemiesRoster}\n\n## CS Progression\n${csTable}\n\n## Comparative Statistics\n${compTable}\n\n## Spatial Player Telemetry\n${spatialTelemetryTable}\n\n## Clinical Ledger\n${ledgerSections}\n`;
    
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beta-${targetPlayer.name.replace(/[^a-zA-Z0-9]/g, '_')}-${targetPlayer.champion.replace(/[^a-zA-Z0-9]/g, '_')}-${matchData.matchMetadata.matchId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Export the complete raw match data (info and timeline) as a Markdown document.
   * The output is optimized for language models by embedding the full JSON
   * structure in a fenced code block. This preserves all keys and values
   * exactly as received from the Riot API while providing context about the
   * match. The file is saved with a "raw" prefix to differentiate it from
   * the processed telemetry export.
   */
  const handleDownloadRawMatch = () => {
    if (!matchData || !matchData.rawInfo || !matchData.rawTimeline) return;
    // Combine the raw info and timeline into a single JSON object and stringify
    const jsonData = JSON.stringify({ info: matchData.rawInfo, timeline: matchData.rawTimeline }, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const matchId = matchData.matchMetadata?.matchId || 'match';
    // Save as .json file
    a.download = `raw-${matchId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Export the match data as SQL INSERT statements matching the provided database schema.
   * Instead of producing a CSV, this function converts the Riot info and timeline
   * objects into a series of SQL INSERT statements for the metaData, Teams,
   * Participants, Bans, ParticipantFrames, and MatchEvents tables. These
   * statements can be executed directly to import the match into a relational
   * database. String values are properly escaped, timestamps are formatted
   * using ISO 8601, booleans are converted to 1/0, and NULL values are used
   * where data is missing. Foreign keys are preserved by generating consistent
   * identifiers (participant IDs include the match ID).
   */
  const handleDownloadImport = () => {
    if (!matchData || !matchData.rawInfo || !matchData.rawTimeline) return;
    const info: any = matchData.rawInfo;
    const timeline: any = matchData.rawTimeline;

    // Determine match identifier (gameId or matchId)
    const matchId = info.gameId ?? info.matchId;
    if (!matchId) return;

    // Helper to escape single quotes in SQL strings
    const escapeSql = (str: string | undefined | null) => {
      if (str === null || str === undefined) return '';
      return String(str).replace(/'/g, "''");
    };

    const statements: string[] = [];
    // metaData insertion
    const gameCreationTs = info.gameCreation ? new Date(info.gameCreation).toISOString().slice(0, 19).replace('T', ' ') : '';
    const gameDuration = info.gameDuration ?? 0;
    const gameMode = escapeSql(info.gameMode);
    const gameVersion = escapeSql(info.gameVersion);
    const mapId = info.mapId ?? 0;
    statements.push(
      `INSERT INTO metaData (match_id, game_creation, game_duration, game_mode, game_version, map_id) VALUES (${matchId}, '${gameCreationTs}', ${gameDuration}, '${gameMode}', '${gameVersion}', ${mapId});`
    );

    // Precompute total gold per team from participants
    const teamGold: Record<number, number> = { 100: 0, 200: 0 };
    (info.participants || []).forEach((p: any) => {
      const tid = p.teamId;
      teamGold[tid] = (teamGold[tid] || 0) + (p.goldEarned ?? 0);
    });

    // Teams insertion
    (info.teams || []).forEach((team: any) => {
      const tid = team.teamId;
      const sideId = tid === 100 ? 1 : 2;
      const winVal = team.win ? 1 : 0;
      const obj = team.objectives || {};
      const towerKills = obj.tower?.kills ?? obj.tower?.first ?? 0;
      const dragonKills = obj.dragon?.kills ?? 0;
      const baronKills = obj.baron?.kills ?? 0;
      const championKills = obj.champion?.kills ?? 0;
      const totalGold = teamGold[tid] ?? 0;
      statements.push(
        `INSERT INTO Teams (match_id, side_id, win, tower_kills, dragon_kills, baron_kills, champion_kills, total_gold) VALUES (${matchId}, ${sideId}, ${winVal}, ${towerKills}, ${dragonKills}, ${baronKills}, ${championKills}, ${totalGold});`
      );
      // Bans insertion for this team
      (team.bans || []).forEach((ban: any, banIndex: number) => {
        const banId = `ban_${matchId}_${tid}_${ban.pickTurn}`;
        statements.push(
          `INSERT INTO Bans (ban_id, match_id, team_id, champion_id, pick_turn) VALUES ('${banId}', ${matchId}, '${tid}', ${ban.championId}, ${ban.pickTurn});`
        );
      });
    });

    // Participants insertion
    (info.participants || []).forEach((p: any) => {
      const pid = `${matchId}_${p.participantId}`;
      const teamIdStr = p.teamId !== undefined ? `'${p.teamId}'` : 'NULL';
      const puuid = `'${escapeSql(p.puuid)}'`;
      const summonerName = `'${escapeSql(p.riotIdGameName ?? p.summonerName ?? '')}'`;
      const championId = p.championId ?? 0;
      const championName = `'${escapeSql(p.championName ?? '')}'`;
      const teamPos = `'${escapeSql(p.teamPosition ?? p.lane ?? '')}'`;
      const kills = p.kills ?? 0;
      const deaths = p.deaths ?? 0;
      const assists = p.assists ?? 0;
      const totalDmgDealt = p.totalDamageDealtToChampions ?? 0;
      const totalDmgTaken = p.totalDamageTaken ?? 0;
      const goldEarned = p.goldEarned ?? 0;
      const visionScore = p.visionScore ?? 0;
      const totalMinions = p.totalMinionsKilled ?? 0;
      const neutralMinions = p.neutralMinionsKilled ?? 0;
      const items = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].map((it: any) => it ?? 0);
      const summSpells = [p.summoner1Id ?? 0, p.summoner2Id ?? 0];
      statements.push(
        `INSERT INTO Participants (participant_id, match_id, team_id, puuid, summoner_name, champion_id, champion_name, team_position, kills, deaths, assists, total_damage_dealt_to_champions, total_damage_taken, gold_earned, vision_score, total_minions_killed, neutral_minions_killed, item_0, item_1, item_2, item_3, item_4, item_5, item_6, summoner_spell_1, summoner_spell_2) VALUES ('${pid}', ${matchId}, ${teamIdStr}, ${puuid}, ${summonerName}, ${championId}, ${championName}, ${teamPos}, ${kills}, ${deaths}, ${assists}, ${totalDmgDealt}, ${totalDmgTaken}, ${goldEarned}, ${visionScore}, ${totalMinions}, ${neutralMinions}, ${items[0]}, ${items[1]}, ${items[2]}, ${items[3]}, ${items[4]}, ${items[5]}, ${items[6]}, ${summSpells[0]}, ${summSpells[1]});`
      );
    });

    // ParticipantFrames insertion
    (timeline.frames || []).forEach((frame: any) => {
      const timestamp = frame.timestamp ?? 0;
      const pfs = frame.participantFrames || {};
      Object.keys(pfs).forEach((key: string) => {
        const pf: any = pfs[key];
        const pid = `${matchId}_${key}`;
        const frameId = `frame_${matchId}_${timestamp}_${key}`;
        const currentGold = pf.currentGold ?? 0;
        const totalGold = pf.totalGold ?? 0;
        const level = pf.level ?? 0;
        const xp = pf.xp ?? 0;
        const minionsKilled = pf.minionsKilled ?? 0;
        const jungleMinionsKilled = pf.jungleMinionsKilled ?? 0;
        const posX = pf.position && pf.position.x !== undefined ? pf.position.x : 'NULL';
        const posY = pf.position && pf.position.y !== undefined ? pf.position.y : 'NULL';
        const damageStats = pf.damageStats || {};
        const totalDamageDone = damageStats.totalDamageDone ?? damageStats.totalDamageDealt ?? 0;
        const totalDamageTaken = damageStats.totalDamageTaken ?? 0;
        statements.push(
          `INSERT INTO ParticipantFrames (frame_id, match_id, participant_id, timestamp, current_gold, total_gold, level, xp, minions_killed, jungle_minions_killed, position_x, position_y, total_damage_done, total_damage_taken) VALUES ('${frameId}', ${matchId}, '${pid}', ${timestamp}, ${currentGold}, ${totalGold}, ${level}, ${xp}, ${minionsKilled}, ${jungleMinionsKilled}, ${posX}, ${posY}, ${totalDamageDone}, ${totalDamageTaken});`
        );
      });
    });

    // MatchEvents insertion
    (timeline.frames || []).forEach((frame: any, frameIndex: number) => {
      const evs = frame.events || [];
      evs.forEach((ev: any, evIndex: number) => {
        // Determine event ID
        const evId = ev.id ? ev.id : `event_${matchId}_${ev.timestamp}_${evIndex}`;
        const timestamp = ev.timestamp ?? 0;
        const eventType = escapeSql(ev.type ?? '');
        // Determine actor participant ID if available
        // Determine the actor (participant/killer/creator) if it exists and is greater than 0
        const rawActor: any =
          ev.participantId !== undefined && ev.participantId !== null
            ? ev.participantId
            : ev.killerId !== undefined && ev.killerId !== null
            ? ev.killerId
            : ev.creatorId !== undefined && ev.creatorId !== null
            ? ev.creatorId
            : null;
        const participantIdVal = rawActor && rawActor > 0 ? `'${matchId}_${rawActor}'` : 'NULL';
        // Victim ID should only be used if it exists and is greater than 0
        const victimIdVal = ev.victimId && ev.victimId > 0 ? `'${matchId}_${ev.victimId}'` : 'NULL';
        const itemIdVal = ev.itemId !== undefined && ev.itemId !== null ? ev.itemId : 'NULL';
        const skillSlotVal = ev.skillSlot !== undefined && ev.skillSlot !== null ? ev.skillSlot : 'NULL';
        const wardTypeVal = ev.wardType ? `'${escapeSql(ev.wardType)}'` : 'NULL';
        const buildingTypeVal = ev.buildingType ? `'${escapeSql(ev.buildingType)}'` : 'NULL';
        const monsterTypeVal = ev.monsterType ? `'${escapeSql(ev.monsterType)}'` : 'NULL';
        const posXVal = ev.position && ev.position.x !== undefined ? ev.position.x : 'NULL';
        const posYVal = ev.position && ev.position.y !== undefined ? ev.position.y : 'NULL';
        statements.push(
          `INSERT INTO MatchEvents (event_id, match_id, timestamp, event_type, participant_id, victim_id, item_id, skill_slot, ward_type, building_type, monster_type, position_x, position_y) VALUES ('${evId}', ${matchId}, ${timestamp}, '${eventType}', ${participantIdVal}, ${victimIdVal}, ${itemIdVal}, ${skillSlotVal}, ${wardTypeVal}, ${buildingTypeVal}, ${monsterTypeVal}, ${posXVal}, ${posYVal});`
        );
      });
    });

    // Combine all SQL statements into one string with newlines
    const sqlContent = statements.join('\n');
    const blob = new Blob([sqlContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-${matchId}.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!riotId.includes('#')) {
      setError('Please include the tagline (e.g. Player#NA1)');
      return;
    }
    
    const [gameName, tagLine] = riotId.split('#');
    if (!gameName || !tagLine) {
      setError('Both Game Name and Tagline are required (e.g. Player#NA1)');
      return;
    }
    
    setLoading(true);
    setError('');
    setMatchData(null);
    setMatchHistory([]);
    setSelectedMatchId('');
    
    try {
      const res = await fetch(`/api/riot/player/${region}/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}/matches?start=0&count=10`);
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Non-JSON response from server:", text.substring(0, 200));
        
        let errorMessage = `Server returned an invalid response (Status ${res.status}).`;
        if (text.trim().startsWith('<!')) {
          errorMessage += ` The server returned an HTML page instead of JSON data. This usually happens if the app is deployed to a static host (like Cloudflare Pages, Firebase Hosting, or Vercel) without a running backend, or if a proxy/WAF is blocking the request. Ensure your Express backend is running.`;
        } else {
          errorMessage += ` This might be caused by a proxy, WAF, or routing issue.`;
        }
        throw new Error(errorMessage);
      }
      
      let data;
      try {
        data = await res.json();
      } catch (e: any) {
        throw new Error(`Failed to parse server response as JSON (Status ${res.status}): ${e.message}`);
      }
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch player history');
      }
      
      setPuuid(data.puuid);
      setMatchHistory(data.history);
      
      if (data.history.length > 0) {
        await loadMatchDetails(data.history[0].matchId, data.puuid, region);
        
        // Background task to save recent matches to Labor (limit to 5 to avoid API limits)
        if (auth.currentUser) {
          autoSaveMatchesToLabor(data.history.slice(0, 5), data.puuid, region);
        }
      } else {
        setError('No matches found for this player.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const autoSaveMatchesToLabor = async (history: any[], playerPuuid: string, matchRegion: string) => {
    if (!auth.currentUser) return;
    
    for (const match of history) {
      try {
        const docRef = doc(db, 'labor_stats', `${auth.currentUser.uid}_${match.matchId}`);
        const docSnap = await getDoc(docRef);
        
        // Skip if already exists
        if (docSnap.exists() && docSnap.data().slaughterVelocity !== 0) {
          continue;
        }
        
        // Fetch details
        const res = await fetch(`/api/riot/match/${matchRegion}/${match.matchId}/details`);
        if (!res.ok) continue;
        
        const data = await res.json();
        
        let championData = null;
        try {
          const targetParticipant = data.info.participants.find((p: any) => p.puuid === playerPuuid);
          if (targetParticipant) {
            const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
            const versions = await versionsRes.json();
            const latestVersion = versions[0];
            const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion/${targetParticipant.championName}.json`);
            if (champRes.ok) {
              const champJson = await champRes.json();
              championData = champJson.data[targetParticipant.championName];
            }
          }
        } catch (e) {
          // Ignore champ data errors in background
        }
        
        const processed = processMatchData(data.info, data.timeline, playerPuuid, championData);
        const targetPlayer = processed.players.find((p: any) => p.isTarget);
        
        if (targetPlayer && auth.currentUser) {
          if (docSnap.exists()) {
            await updateDoc(docRef, {
              champion: targetPlayer.champion,
              lane: targetPlayer.lane,
              slaughterVelocity: targetPlayer.receipt * 100,
              damageTaken: targetPlayer.damageTaken,
              ccScore: targetPlayer.ccScore
            });
          } else {
            await setDoc(docRef, {
              userId: auth.currentUser.uid,
              matchId: match.matchId,
              champion: targetPlayer.champion,
              lane: targetPlayer.lane,
              slaughterVelocity: targetPlayer.receipt * 100,
              damageTaken: targetPlayer.damageTaken,
              ccScore: targetPlayer.ccScore,
              createdAt: serverTimestamp()
            });
          }
        }
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`Failed to auto-save match ${match.matchId}`, err);
      }
    }
  };

  const loadMoreMatches = async () => {
    if (!puuid) return;
    const [gameName, tagLine] = riotId.split('#');
    if (!gameName || !tagLine) return;
    
    setLoading(true);
    try {
      const start = matchHistory.length;
      const res = await fetch(`/api/riot/player/${region}/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}/matches?start=${start}&count=10`);
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Non-JSON response from server (load more):", text.substring(0, 200));
        
        let errorMessage = `Server returned an invalid response (Status ${res.status}).`;
        if (text.trim().startsWith('<!')) {
          errorMessage += ` The server returned an HTML page instead of JSON data. Ensure your Express backend is running and not just serving static files.`;
        } else {
          errorMessage += ` This might be caused by a proxy, WAF, or routing issue.`;
        }
        throw new Error(errorMessage);
      }
      
      let data;
      try {
        data = await res.json();
      } catch (e: any) {
        throw new Error(`Failed to parse server response as JSON (Status ${res.status}): ${e.message}`);
      }
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch more matches');
      }
      
      setMatchHistory(prev => [...prev, ...data.history]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadMatchDetails = async (matchId: string, playerPuuid: string, matchRegion: string = region) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/riot/match/${matchRegion}/${matchId}/details`);
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Non-JSON response from server (match details):", text.substring(0, 200));
        
        let errorMessage = `Server returned an invalid response for match details (Status ${res.status}).`;
        if (text.trim().startsWith('<!')) {
          errorMessage += ` The server returned an HTML page instead of JSON data. Ensure your Express backend is running and not just serving static files.`;
        } else {
          errorMessage += ` This might be caused by a proxy, WAF, or routing issue.`;
        }
        throw new Error(errorMessage);
      }
      
      let data;
      try {
        data = await res.json();
      } catch (e: any) {
        throw new Error(`Failed to parse server response as JSON (Status ${res.status}): ${e.message}`);
      }
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch match details');
      }
      
      let championData = null;
      try {
        const targetParticipant = data.info.participants.find((p: any) => p.puuid === playerPuuid);
        if (targetParticipant) {
          const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
          const versions = await versionsRes.json();
          const latestVersion = versions[0];
          const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion/${targetParticipant.championName}.json`);
          if (champRes.ok) {
            const champJson = await champRes.json();
            championData = champJson.data[targetParticipant.championName];
          }
        }
      } catch (e) {
        console.error("Failed to fetch champion data", e);
      }
      
      const processed = processMatchData(data.info, data.timeline, playerPuuid, championData);
      // Attach raw match data for raw telemetry export
      (processed as any).rawInfo = data.info;
      (processed as any).rawTimeline = data.timeline;
      
      // Fetch LaborStat for enrichment
      if (auth.currentUser) {
        try {
          const docRef = doc(db, 'labor_stats', `${auth.currentUser.uid}_${matchId}`);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            processed.memoryEnrichment = docSnap.data().memoryEnrichment || [];
          }
        } catch (err) {
          console.error("Failed to fetch memory enrichment", err);
        }
      }
      
      setMatchData(processed);
      setSelectedMatchId(matchId);
      setActiveTab('engine');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (matchHistory.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] font-sans selection:bg-neon-green selection:text-brutal-black relative overflow-hidden flex flex-col">
        {/* Grid Background */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(0, 255, 0, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 0, 0.05) 1px, transparent 1px)', backgroundSize: '40px 40px', opacity: 0.5 }}></div>
        
        {/* Marquee */}
        <div className="w-full border-b border-brutal-gray bg-brutal-black/50 p-3 overflow-hidden flex whitespace-nowrap relative z-20">
          <div className="animate-marquee font-mono text-xs text-zinc-500 uppercase tracking-widest flex gap-8">
            <span>AXIOM 1: THE ZERO STATE</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 2: SLAUGHTER VELOCITY</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 3: COUNTER VELOCITY</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 4: THE COEFFICIENT OF MEDIOCRITY</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 5: THE SOUL OF THE PROTOCOL</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 6: THE RECEIPT OF LABOR</span>
            <span className="text-neon-green">///</span>
            {/* Repeat for seamless marquee */}
            <span>AXIOM 1: THE ZERO STATE</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 2: SLAUGHTER VELOCITY</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 3: COUNTER VELOCITY</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 4: THE COEFFICIENT OF MEDIOCRITY</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 5: THE SOUL OF THE PROTOCOL</span>
            <span className="text-neon-green">///</span>
            <span>AXIOM 6: THE RECEIPT OF LABOR</span>
            <span className="text-neon-green">///</span>
          </div>
        </div>
        
        <div className="flex-1 relative z-10 flex flex-col p-6 md:p-12 h-full overflow-y-auto">
          
          {/* Top Section: Header & Title */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="w-full max-w-[1600px] mx-auto flex flex-col items-center shrink-0"
          >
            {/* Header Row: Logo & Status */}
            <div className="flex justify-between items-start w-full">
              <div className="w-20 h-20 md:w-32 md:h-32 flex items-center justify-center">
                <img 
                  src={legioLogo} 
                  alt="Legio Thirteen Logo" 
                  className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(0,255,0,0.3)]" 
                  referrerPolicy="no-referrer"
                />
              </div>
              
              {/* System Status & Auth */}
              <div className="flex flex-col items-end gap-4">
                <div className="font-mono text-neon-green text-xs md:text-sm tracking-widest text-right space-y-1 opacity-80">
                  <p>SYSTEM: ONLINE</p>
                  <p>VERSION: 1.0.0</p>
                  <p>STATUS: AWAITING INPUT</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="font-mono text-xs text-zinc-400">PILOT: {user?.displayName}</span>
                  <button onClick={handleLogout} className="font-mono text-xs text-brutal-black bg-neon-green px-3 py-1 uppercase tracking-widest hover:bg-white transition-colors">
                    Logout
                  </button>
                </div>
              </div>
            </div>
            
            {/* Typography */}
            <div className="space-y-3 w-full mt-4 md:mt-6 text-center">
              <h1 className="font-display text-10xl md:text-[100px] lg:text-[120px] leading-[1.1] tracking-tight text-neon-green uppercase">
                The fuck mothering <br/> Lunacy: Protocol
              </h1>
              <h2 className="font-mono text-xl md:text-3xl text-neon-green tracking-[0.4em] uppercase flex items-center justify-center gap-4 md:gap-8">
                <span className="w-8 md:w-24 h-px bg-neon-green"></span>
                Slaughter Engine
                <span className="w-8 md:w-24 h-px bg-neon-green"></span>
              </h2>
            </div>
          </motion.div>
          
          {/* Interactive Telemetry Box */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="w-full max-w-4xl mx-auto mt-4 md:mt-8 shrink-0 relative z-20"
          >
              <div className="bg-brutal-black border border-brutal-gray p-8 md:p-12 relative group text-left">
                {/* Corner accents */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-neon-green opacity-50 group-hover:opacity-100 transition-opacity"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-neon-green opacity-50 group-hover:opacity-100 transition-opacity"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-neon-green opacity-50 group-hover:opacity-100 transition-opacity"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-neon-green opacity-50 group-hover:opacity-100 transition-opacity"></div>
                
                <div className="space-y-8">
                  <div className="space-y-2 text-center">
                    <h3 className="font-mono text-2xl text-white uppercase tracking-widest">Initialize Telemetry</h3>
                    <p className="font-mono text-sm text-zinc-500 uppercase tracking-wider">Enter target pilot identification</p>
                  </div>
                  
                  <form onSubmit={handleSearch} className="space-y-6">
                    <div className="space-y-4">
                      <div className="flex flex-col md:flex-row gap-4">
                        <select
                          value={region}
                          onChange={(e) => setRegion(e.target.value)}
                          className="w-full md:w-1/3 bg-[#050505] border border-brutal-gray text-white font-mono text-xl py-6 px-6 focus:border-neon-green focus:outline-none transition-colors appearance-none cursor-pointer text-center"
                        >
                          <option value="americas">AMERICAS (NA, BR, LAN, LAS)</option>
                          <option value="europe">EUROPE (EUW, EUNE, TR, RU)</option>
                          <option value="asia">ASIA (KR, JP)</option>
                          <option value="sea">SEA (OCE, PH, SG, TH, TW, VN)</option>
                        </select>
                        <div className="relative flex-1">
                          <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none">
                            <Search className="h-6 w-6 text-zinc-500" />
                          </div>
                          <input
                            type="text"
                            value={riotId}
                            onChange={(e) => setRiotId(e.target.value)}
                            placeholder="GameName#TagLine"
                            className="w-full bg-[#050505] border border-brutal-gray text-white font-mono text-xl py-6 pl-16 pr-6 focus:border-neon-green focus:outline-none transition-colors text-center"
                          />
                        </div>
                      </div>
                    </div>
                    
                    <button 
                      type="submit" 
                      disabled={loading}
                      className="w-full bg-neon-green text-brutal-black font-mono font-bold text-xl py-6 uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 flex items-center justify-center gap-4"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-6 h-6 animate-spin" />
                          <span>Extracting Ledger...</span>
                        </>
                      ) : (
                        <>
                          <span>Commence Analysis</span>
                          <ChevronRight className="w-6 h-6" />
                        </>
                      )}
                    </button>
                  </form>
                  
                  {error && (
                    <div className="p-4 border border-neon-red bg-neon-red/10 text-neon-red font-mono text-base text-center">
                      {error}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          
            {/* Random Quote */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.4 }}
              className="font-mono text-zinc-400 text-sm md:text-xl uppercase tracking-widest leading-relaxed max-w-6xl border-l-4 border-r-4 border-brutal-gray px-6 md:px-12 py-8 mt-16 md:mt-24 mb-12 text-center shrink-0 mx-auto"
            >
              <p>"{randomQuote}"</p>
            </motion.div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-[#0a0a0a] font-sans selection:bg-neon-green selection:text-brutal-black relative">
      {/* Grid Background */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(0, 255, 0, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 0, 0.05) 1px, transparent 1px)', backgroundSize: '40px 40px', opacity: 0.5 }}></div>
      
      <div className="relative z-10 p-6 md:p-12 max-w-[1600px] mx-auto space-y-12 pb-24">
        
        {/* Header & Search (Compact for Stats Page) */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-brutal-gray pb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 md:w-16 md:h-16 flex items-center justify-center shrink-0">
              <img 
                src={legioLogo} 
                alt="Legio Thirteen Logo" 
                className="w-full h-full object-contain drop-shadow-[0_0_10px_rgba(0,255,0,0.3)]" 
                referrerPolicy="no-referrer"
              />
            </div>
            <div>
              <h1 className="font-display text-3xl md:text-4xl uppercase tracking-tight text-white leading-none">
                Slaughter Engine
              </h1>
              <h2 className="font-mono text-xs text-neon-green tracking-[0.2em] uppercase mt-1">
                Lunacy Protocol v1.0
              </h2>
            </div>
          </div>
          
          <div className="flex flex-col md:flex-row items-end gap-4 w-full md:w-auto">
            <div className="flex items-center gap-4">
              <span className="font-mono text-xs text-zinc-400 uppercase tracking-widest">PILOT: {user?.displayName}</span>
              <button 
                onClick={handleLogout}
                className="font-mono text-xs text-brutal-black bg-neon-green px-3 py-1 uppercase tracking-widest hover:bg-white transition-colors"
              >
                Logout
              </button>
            </div>
            <form onSubmit={handleSearch} className="flex gap-4 w-full md:w-auto">
            <div className="flex-1 md:w-64 relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-zinc-500" />
              </div>
              <input
                type="text"
                value={riotId}
                onChange={(e) => setRiotId(e.target.value)}
                placeholder="GameName#TagLine"
                className="w-full bg-brutal-black border border-brutal-gray text-white font-mono py-3 pl-10 pr-4 text-sm focus:border-neon-green focus:outline-none transition-colors"
              />
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="bg-neon-green text-brutal-black font-mono font-bold px-6 text-sm uppercase tracking-wider hover:bg-white transition-colors disabled:opacity-50 flex items-center justify-center"
            >
              {loading && !matchData ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Analyze'}
            </button>
          </form>
          </div>
        </header>
        
        {error && (
          <div className="p-4 border border-neon-red bg-neon-red/10 text-neon-red font-mono text-sm max-w-xl">
            {error}
          </div>
        )}
        
        {matchHistory.length > 0 && (
          <div className="space-y-8 animate-in fade-in duration-700">
            
            {/* Tabs */}
            <div className="flex border-b border-brutal-gray overflow-x-auto">
              <button
                onClick={() => setActiveTab('engine')}
                className={`flex items-center gap-2 px-6 py-4 font-mono text-sm uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap ${activeTab === 'engine' ? 'border-neon-green text-neon-green' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              >
                <Activity className="w-4 h-4" />
                Analysis Engine
              </button>
              <button
                onClick={() => setActiveTab('memory')}
                className={`flex items-center gap-2 px-6 py-4 font-mono text-sm uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap ${activeTab === 'memory' ? 'border-neon-green text-neon-green' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              >
                <BrainCircuit className="w-4 h-4" />
                Memory Made Flesh
              </button>
              <button
                onClick={() => setActiveTab('labor')}
                className={`flex items-center gap-2 px-6 py-4 font-mono text-sm uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap ${activeTab === 'labor' ? 'border-neon-green text-neon-green' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              >
                <Activity className="w-4 h-4" />
                The Labor
              </button>
              <button
                onClick={() => setActiveTab('valkyrie')}
                className={`flex items-center gap-2 px-6 py-4 font-mono text-sm uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap ${activeTab === 'valkyrie' ? 'border-neon-green text-neon-green' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              >
                <Activity className="w-4 h-4" />
                Valkyrie Engine
              </button>
              <button
                onClick={() => setActiveTab('cockpit')}
                className={`flex items-center gap-2 px-6 py-4 font-mono text-sm uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap ${activeTab === 'cockpit' ? 'border-neon-green text-neon-green' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              >
                <Radar className="w-4 h-4" />
                The Cockpit
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-6 py-4 font-mono text-sm uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap ${activeTab === 'history' ? 'border-neon-green text-neon-green' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              >
                <History className="w-4 h-4" />
                Match History
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={`flex items-center gap-2 px-6 py-4 font-mono text-sm uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap ${activeTab === 'stats' ? 'border-neon-green text-neon-green' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              >
                <Coins className="w-4 h-4" />
                Orchestra Stats
              </button>
            </div>
            
            {/* Tab Content: Engine */}
            {activeTab === 'cockpit' && <TheCockpit />}
            {activeTab === 'valkyrie' && <FirebaseAuthGate><ValkyrieEngine /></FirebaseAuthGate>}
            {activeTab === 'memory' && <FirebaseAuthGate><MemoryMadeFlesh puuid={puuid} region={region} matchHistory={matchHistory} /></FirebaseAuthGate>}
            {activeTab === 'labor' && <FirebaseAuthGate><TheLabor /></FirebaseAuthGate>}
            {activeTab === 'engine' && matchData && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-12"
              >
                {/* Focused Pilot Section */}
                <div className="space-y-4">
                  {(() => {
                    const targetPlayer = matchData.players.find((p: any) => p.isTarget);
                    const classification = getClassification(targetPlayer.receipt, matchData.players, matchData.matchMetadata.duration);
                    
                    return (
                      <div className="space-y-6">
                        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-brutal-gray pb-4">
                          <h3 className="font-mono text-sm text-neon-green uppercase tracking-widest">
                            Pilot Analysis: {targetPlayer.name}
                          </h3>
                          <div className="flex gap-2 flex-wrap justify-end">
                            {laborSaveError && <span className="text-red-500 text-xs font-mono flex items-center">{laborSaveError}</span>}
                            {laborSaveSuccess && <span className="text-neon-green text-xs font-mono flex items-center">SAVED TO LABOR</span>}
                            <button 
                              onClick={handleSaveToLabor}
                              disabled={savingToLabor}
                              className="flex items-center justify-center gap-2 font-mono text-xs text-brutal-black bg-neon-green px-4 py-2 uppercase tracking-widest hover:bg-white transition-colors font-bold disabled:opacity-50"
                            >
                              {savingToLabor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              Save to Labor
                            </button>
                            <button 
                              onClick={handleDownloadTelemetry}
                              className="flex items-center justify-center gap-2 font-mono text-xs text-brutal-black bg-neon-green px-4 py-2 uppercase tracking-widest hover:bg-white transition-colors font-bold"
                            >
                              <Download className="w-4 h-4" />
                              Export LLM Telemetry
                            </button>
                            <button
                              onClick={handleDownloadRawMatch}
                              className="flex items-center justify-center gap-2 font-mono text-xs text-brutal-black bg-neon-green px-4 py-2 uppercase tracking-widest hover:bg-white transition-colors font-bold"
                            >
                              <FileText className="w-4 h-4" />
                              Export Raw Match
                            </button>
                            <button
                              onClick={handleDownloadImport}
                              className="flex items-center justify-center gap-2 font-mono text-xs text-brutal-black bg-neon-green px-4 py-2 uppercase tracking-widest hover:bg-white transition-colors font-bold"
                            >
                              <Database className="w-4 h-4" />
                              Export as Import
                            </button>
                            <button 
                              onClick={() => window.print()}
                              className="flex items-center justify-center gap-2 font-mono text-xs text-white bg-brutal-gray px-4 py-2 uppercase tracking-widest hover:bg-zinc-700 transition-colors font-bold"
                            >
                              <Download className="w-4 h-4" />
                              Download PDF
                            </button>
                          </div>
                        </div>
                        
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <div className="p-6 border border-brutal-gray bg-brutal-black">
                              <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-2">Champion</h4>
                              <div className="font-display text-4xl text-white">
                                {targetPlayer.champion}
                              </div>
                            </div>
                            
                            <div className="p-6 border border-brutal-gray bg-brutal-black">
                              <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-2">CC Score</h4>
                              <div className="font-mono text-4xl text-white">
                                {targetPlayer.ccScore}
                              </div>
                              <p className="text-xs text-zinc-500 mt-2">Crowd control duration</p>
                            </div>
                            
                            <div className="p-6 border border-brutal-gray bg-brutal-black">
                              <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-2">Slaughter Velocity</h4>
                              <div className="font-mono text-4xl text-white">
                                {(targetPlayer.receipt * 100).toFixed(2)}
                              </div>
                              <p className="text-xs text-zinc-500 mt-2">Total probability moved</p>
                            </div>
                          </div>
                            
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                              <div className="p-6 border border-brutal-gray bg-brutal-black">
                                <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-2">Shielding</h4>
                                <div className="font-mono text-2xl text-white">
                                  {targetPlayer.shielding?.toLocaleString()}
                                </div>
                              </div>
                              <div className="p-6 border border-brutal-gray bg-brutal-black">
                                <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-2">Healing</h4>
                                <div className="font-mono text-2xl text-white">
                                  {targetPlayer.healing?.toLocaleString()}
                                </div>
                              </div>
                              <div className="p-6 border border-brutal-gray bg-brutal-black">
                                <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-2">Healing Reduced</h4>
                                <div className="font-mono text-2xl text-white">
                                  {targetPlayer.healingReduced?.toLocaleString()}
                                </div>
                              </div>
                              <div className="p-6 border border-brutal-gray bg-brutal-black">
                                <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-2">Mitigated</h4>
                                <div className="font-mono text-2xl text-white">
                                  {targetPlayer.mitigated?.toLocaleString()}
                                </div>
                              </div>
                            </div>
                        
                        <div className="p-8 border border-brutal-gray bg-brutal-black flex flex-col items-center justify-center text-center">
                          <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-4">Protocol Classification</h4>
                          <div className={`${classification.color} font-display text-4xl md:text-5xl tracking-wide`}>
                            {classification.text}
                          </div>
                        </div>
                        
                        {/* Team Compositions Section */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="p-6 border border-brutal-gray bg-brutal-black space-y-4">
                            <h4 className="font-mono text-xs text-neon-green uppercase tracking-widest flex items-center gap-2">
                              <Shield className="w-4 h-4" />
                              Pilot's Team
                            </h4>
                            <div className="space-y-2">
                              {matchData.players
                                .filter((p: any) => p.teamId === targetPlayer.teamId)
                                .map((p: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between font-mono text-sm border-b border-zinc-900/50 pb-2 last:border-0">
                                    <span className="text-zinc-400 w-20">{formatLane(p.lane)}</span>
                                    <span className="text-white flex-1 font-bold">{p.champion}</span>
                                    <span className="text-zinc-600 text-[10px]">{p.name}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                          <div className="p-6 border border-brutal-gray bg-brutal-black space-y-4">
                            <h4 className="font-mono text-xs text-neon-red uppercase tracking-widest flex items-center gap-2">
                              <Sword className="w-4 h-4" />
                              Enemy Team
                            </h4>
                            <div className="space-y-2">
                              {matchData.players
                                .filter((p: any) => p.teamId !== targetPlayer.teamId)
                                .map((p: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between font-mono text-sm border-b border-zinc-900/50 pb-2 last:border-0">
                                    <span className="text-zinc-400 w-20">{formatLane(p.lane)}</span>
                                    <span className="text-white flex-1 font-bold">{p.champion}</span>
                                    <span className="text-zinc-600 text-[10px]">{p.name}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        </div>
                        
                        {(() => {
                          const teamPlayers = matchData.players.filter((p: any) => p.teamId === targetPlayer.teamId && p.id !== targetPlayer.id);
                          const oppPlayers = matchData.players.filter((p: any) => p.teamId !== targetPlayer.teamId);
                          const teamAvgReceipt = teamPlayers.length > 0 ? teamPlayers.reduce((sum: number, p: any) => sum + p.receipt, 0) / teamPlayers.length : 0;
                          const oppAvgReceipt = oppPlayers.reduce((sum: number, p: any) => sum + p.receipt, 0) / oppPlayers.length;
                          
                          return (
                            <div className="grid grid-cols-1 gap-6 p-8 border border-brutal-gray bg-brutal-black">
                              <div className="space-y-4">
                                <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Slaughter Velocity Comparison</h4>
                                <div className="flex justify-between items-center">
                                  <span className="text-zinc-400">Pilot</span>
                                  <span className="text-white font-mono">{(targetPlayer.receipt * 100).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-zinc-500">Team Avg</span>
                                  <span className="text-zinc-500 font-mono">{(teamAvgReceipt * 100).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-zinc-500">Opp Avg</span>
                                  <span className="text-zinc-500 font-mono">{(oppAvgReceipt * 100).toFixed(2)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                        
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-6">
                          <div className="p-4 border border-brutal-gray bg-brutal-black/50">
                            <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-1">K / D / A</h4>
                            <div className="font-mono text-xl text-white">
                              {matchData.pilotStats.kills} / <span className="text-neon-red">{matchData.pilotStats.deaths}</span> / <span className="text-blue-400">{matchData.pilotStats.assists}</span>
                            </div>
                            <p className="text-xs text-zinc-500 mt-1">{matchData.pilotStats.kda} Ratio ({matchData.pilotStats.killParticipation.toFixed(1)}% KP)</p>
                          </div>
                          <div className="p-4 border border-brutal-gray bg-brutal-black/50">
                            <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-1">CS</h4>
                            <div className="font-mono text-xl text-white">
                              {matchData.pilotStats.cs}
                            </div>
                            <p className="text-xs text-zinc-500 mt-1">Total Minions ({matchData.pilotStats.goldShare.toFixed(1)}% Gold)</p>
                          </div>
                          <div className="p-4 border border-brutal-gray bg-brutal-black/50">
                            <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-1">Damage</h4>
                            <div className="font-mono text-xl text-white">
                              {matchData.pilotStats.damage.toLocaleString()}
                            </div>
                            <p className="text-xs text-zinc-500 mt-1">To Champions ({matchData.pilotStats.damageShare.toFixed(1)}% Share)</p>
                          </div>
                          <div className="p-4 border border-brutal-gray bg-brutal-black/50">
                            <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-1">Taken</h4>
                            <div className="font-mono text-xl text-white">
                              {matchData.pilotStats.damageTaken.toLocaleString()}
                            </div>
                            <p className="text-xs text-zinc-500 mt-1">Damage Taken ({matchData.pilotStats.damageTakenShare.toFixed(1)}% Share)</p>
                          </div>
                          <div className="p-4 border border-brutal-gray bg-brutal-black/50">
                            <h4 className="font-mono text-xs text-zinc-500 uppercase tracking-widest mb-1">Vision</h4>
                            <div className="font-mono text-xl text-white">
                              {matchData.pilotStats.vision}
                            </div>
                            <p className="text-xs text-zinc-500 mt-1">Vision Score ({matchData.pilotStats.visionShare.toFixed(1)}% Share)</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                
                {/* Chart Section: Win Probability */}
                <div className="p-6 border border-brutal-gray bg-brutal-black mb-6">
                  <h3 className="font-mono text-sm text-zinc-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Win Probability Protocol (P_WIN)
                  </h3>
                  <div className="h-[500px] w-full">
                    <ResponsiveContainer width="100%" height={500}>
                      <LineChart data={matchData.chartData} margin={{ top: 20, right: 20, bottom: 20, left: 0 }} >
                        <defs>
                          <linearGradient id="colorSvLine" x1="0" y1="0" x2="1" y2="0">
                            {matchData.chartData.map((d: any, i: number) => {
                              const offset = `${(i / (matchData.chartData.length - 1)) * 100}%`;
                              let color = '#bdbdbd';
                              if (d.sv > 0.2) color = '#00FF00';
                              else if (d.sv < -0.2) color = '#ff0000';
                              return <stop key={i} offset={offset} stopColor={color} />;
                            })}
                          </linearGradient>
                        </defs>
                        <ReferenceLine y={50} stroke="#333" strokeDasharray="3 3" />
                        {matchData.chartData.map((d: any, i: number) => {
                          if (d.deltaP <= -8) {
                            return (
                              <ReferenceArea 
                                key={`catastrophe-${i}`} 
                                {...({ x1: Math.max(0, d.minute - 1), x2: d.minute, fill: "#FF0000", fillOpacity: 0.15, label: { position: 'insideTop', value: 'collapse window', fill: '#FF0000', fontSize: 10, fontFamily: 'monospace' } } as any)}
                              />
                            );
                          }
                          return null;
                        })}
                        <XAxis dataKey="minute" stroke="#666" tick={{ fill: '#666', fontFamily: 'monospace', fontSize: 12 }} tickFormatter={(val) => formatMinute(val)} />
                        <YAxis domain={[0, 100]} stroke="#666" tick={{ fill: '#666', fontFamily: 'monospace', fontSize: 12 }} tickFormatter={(val) => `${val}%`} />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#333', strokeWidth: 1, strokeDasharray: '3 3' }} />
                        <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                        <Line type="monotone" dataKey="winProb" stroke="url(#colorSvLine)" strokeWidth={4} dot={false} activeDot={{ r: 6, fill: '#00FF00', stroke: '#000', strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                
                {/* Chart Section: Slaughter Velocity */}
                <div className="p-6 border border-brutal-gray bg-brutal-black mb-6">
                  <h3 className="font-mono text-sm text-neon-green uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Slaughter Velocity (SV) - Authored Probability Flux
                  </h3>
                  <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={matchData.chartData} margin={{ top: 20, right: 20, bottom: 20, left: 0 }} >
                        <defs>
                          <linearGradient id="svGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00FF00" stopOpacity={0.3}/>
                            <stop offset="50%" stopColor="#00FF00" stopOpacity={0}/>
                            <stop offset="95%" stopColor="#FF0000" stopOpacity={0.3}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                        <ReferenceLine y={0} stroke="#444" strokeWidth={2} />
                        <XAxis dataKey="minute" stroke="#666" tick={{ fill: '#666', fontFamily: 'monospace', fontSize: 12 }} tickFormatter={(val) => formatMinute(val)} />
                        <YAxis stroke="#666" tick={{ fill: '#666', fontFamily: 'monospace', fontSize: 12 }} tickFormatter={(val) => `${val > 0 ? '+' : ''}${val}%`} />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#333', strokeWidth: 1, strokeDasharray: '3 3' }} />
                        <Line 
                          type="stepAfter" 
                          dataKey="sv" 
                          stroke="#00FF00" 
                          strokeWidth={2} 
                          dot={false}
                          activeDot={{ r: 4, fill: '#00FF00' }}
                        />
                        {/* Add a secondary area for visual weight */}
                        <Line 
                          type="monotone" 
                          dataKey="sv" 
                          stroke="none" 
                          fill="url(#svGradient)" 
                          fillOpacity={1}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                
                {/* CS Progression Section */}
                <div className="space-y-4">
                  <h3 className="font-mono text-sm text-neon-green uppercase tracking-widest border-b border-brutal-gray pb-4">
                    Minute-by-Minute CS Progression
                  </h3>
                  <div className="h-[300px] w-full bg-brutal-black border border-brutal-gray p-6">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={matchData.csHistory}>
                        <XAxis dataKey="minute" stroke="#666" tick={{ fill: '#666', fontFamily: 'monospace', fontSize: 10 }} />
                        <YAxis stroke="#666" tick={{ fill: '#666', fontFamily: 'monospace', fontSize: 10 }} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#050505', border: '1px solid #333', fontFamily: 'monospace' }}
                          itemStyle={{ color: '#00FF00' }}
                          labelStyle={{ color: '#888' }}
                        />
                        <Line type="monotone" dataKey="cs" stroke="#00FF00" strokeWidth={2} dot={false} name="Total CS" />
                        <Line type="monotone" dataKey="csPerMin" stroke="#00FFFF" strokeWidth={2} dot={false} name="CS/Min" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                
                {/* Clinical Ledger Section */}
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-brutal-gray pb-4">
                    <h3 className="font-mono text-sm text-neon-green uppercase tracking-widest">
                      Clinical Ledger of Events
                    </h3>
                    <div className="flex items-center gap-6">
                       <span className="flex items-center gap-1.5 font-mono text-[9px] text-zinc-600 uppercase tracking-widest">
                         <div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Allied Forces
                       </span>
                       <span className="flex items-center gap-1.5 font-mono text-[9px] text-zinc-600 uppercase tracking-widest">
                         <div className="w-1.5 h-1.5 rounded-full bg-neon-red" /> Hostile Forces
                       </span>
                       <span className="flex items-center gap-1.5 font-mono text-[9px] text-neon-green uppercase tracking-widest font-bold">
                         <div className="w-1.5 h-1.5 rounded-full bg-blue-500 border border-neon-green" /> Pilot Signature
                       </span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-12 pt-8">
                    {matchData.eventsLedger.map((ledgerEntry: any, i: number) => {
                      const diagnosis = diagnoseLedgerWindow(ledgerEntry);
                      const spatial = summarizeRelativePositions(ledgerEntry.relativePositions);
                      const enrichment = matchData.memoryEnrichment?.find((e: any) => e.minute === ledgerEntry.minute);
                      const targetParticipant = matchData.players.find((p: any) => p.isTarget);
                      
                      return (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, y: 30 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true, margin: "-50px" }}
                          className="grid grid-cols-1 lg:grid-cols-12 gap-8 p-8 border-b border-zinc-900 last:border-0"
                        >
                          {/* Left Column: Temporal & Stats (Col 4) */}
                          <div className="lg:col-span-4 space-y-8">
                            <div className="flex items-end gap-3 mb-6">
                              <span className="text-neon-green font-display text-7xl leading-none tracking-tighter">
                                {ledgerEntry.minute.toString().padStart(2, '0')}
                              </span>
                              <div className="flex flex-col mb-1">
                                <span className="text-[10px] text-zinc-600 uppercase tracking-[0.3em] font-mono font-bold">
                                  TIMESTAMP
                                </span>
                                <span className="text-[12px] text-white font-mono">
                                  {`${(ledgerEntry.minute - 1).toString().padStart(2, '0')}:00-${ledgerEntry.minute.toString().padStart(2, '0')}:00`}
                                </span>
                              </div>
                            </div>
                            
                            <div className="space-y-6 bg-brutal-black/40 p-6 border border-zinc-900/50">
                               <div className="space-y-2">
                                 <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Slaughter Velocity (SV)</span>
                                 <ShiftBar value={ledgerEntry.sv * 100} max={100} />
                               </div>
                               <div className="space-y-2">
                                 <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Team Window Shift (ΔP)</span>
                                 <ShiftBar value={ledgerEntry.deltaP * 100} max={20} isPercentage />
                               </div>
                            </div>
                            
                            <div className="p-6 bg-brutal-black/20 border border-zinc-900 border-l-2 border-l-neon-green">
                              <div className="flex items-center gap-2 mb-4">
                                <BrainCircuit className="w-4 h-4 text-neon-green" />
                                <h4 className="font-mono text-xs text-neon-green uppercase tracking-widest">COGNITIVE_STATE</h4>
                              </div>
                              <p className="text-sm text-white font-mono uppercase tracking-wider mb-2">{enrichment?.cognitiveState || 'UNRECORDED'}</p>
                              <p className="text-xs text-zinc-500 font-mono italic leading-relaxed">{enrichment?.thought || 'No manual input for this window.'}</p>
                            </div>
                          </div>
                          
                          {/* Center Column: Tactical Map (Col 5) */}
                          <div className="lg:col-span-5 flex flex-col items-center">
                             <div className="w-full flex justify-between items-center mb-4">
                               <h4 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest font-bold flex items-center gap-2">
                                 <Radar className="w-3 h-3 text-neon-green" />
                                 Tactical Topology Trace
                               </h4>
                               <div className="font-mono text-[9px] text-zinc-700">XY:16K_GRID</div>
                             </div>
                             <div className="w-full aspect-square">
                               <TacticalRiftMap 
                                 positions={ledgerEntry.playerPositions} 
                                 players={matchData.players} 
                                 pilotId={targetParticipant.id} 
                               />
                             </div>
                          </div>
                          
                          {/* Right Column: Events & Diagnosis (Col 3) */}
                          <div className="lg:col-span-3 space-y-8 flex flex-col">
                            <div className="flex-1">
                              <h4 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-6 flex items-center gap-2 border-b border-zinc-900 pb-2">
                                <Activity className="w-3 h-3" />
                                Clinical Event Log
                              </h4>
                              <div className="space-y-4">
                                {ledgerEntry.events.map((e: any, j: number) => {
                                  let desc = e.desc;
                                  if (desc.includes('[ID:')) {
                                    const id = desc.match(/\[ID:(\d+)\]/)?.[1];
                                    if (id && itemData[id]) {
                                      desc = desc.replace(`[ID:${id}]`, itemData[id]);
                                    }
                                  }
                                  return (
                                    <div key={j} className="flex items-start gap-4 group/ev">
                                      <div className="p-2 rounded-sm bg-zinc-900/80 border border-zinc-800 group-hover/ev:border-neon-green transition-colors">
                                        {getEventIcon(e.type)}
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-white text-[11px] uppercase tracking-wide group-hover/ev:text-neon-green transition-colors">{desc}</span>
                                        <span className="text-[9px] text-zinc-600 font-mono">{formatMinute(e.timestamp / 60000)}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                                {ledgerEntry.events.length === 0 && (
                                  <div className="flex items-center gap-2 opacity-30 py-4">
                                    <div className="w-4 h-px bg-zinc-700" />
                                    <span className="text-[10px] font-mono uppercase tracking-widest">NO_SIGNIFICANT_FLUX</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="space-y-4 pt-6 border-t border-zinc-900">
                               <div className="space-y-2">
                                 <span className="text-[9px] text-zinc-700 uppercase tracking-widest font-bold">Diagnostic Resolution</span>
                                 <div className="p-3 bg-white/[0.02] border border-l-2 border-l-neon-green border-transparent text-[11px] text-zinc-300 font-mono uppercase">
                                   {diagnosis}
                                 </div>
                               </div>
                               <div className="space-y-2">
                                 <span className="text-[9px] text-zinc-700 uppercase tracking-widest font-bold">Spatial Profile Summary</span>
                                 <div className="text-[10px] text-zinc-500 font-mono uppercase leading-tight tracking-tighter">
                                   {spatial}
                                 </div>
                               </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
                
                {/* Oracle's Insight */}
                <div className="mt-12">
                    <OracleInsight matchData={matchData} />
                </div>
              </motion.div>
            )}
            
            {/* Tab Content: History */}
            {activeTab === 'history' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead>
                      <tr className="border-b border-brutal-gray font-mono text-xs text-zinc-500 uppercase tracking-wider">
                        <th className="p-4 w-1/4">Result</th>
                        <th className="p-4 w-1/4">Champion</th>
                        <th className="p-4 w-1/4">K / D / A</th>
                        <th className="p-4 w-1/4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-sm">
                      {matchHistory.map((match: any) => {
                        const isSelected = match.matchId === selectedMatchId;
                        
                        return (
                          <tr 
                            key={match.matchId} 
                            className={`border-b border-brutal-gray/50 transition-colors ${isSelected ? 'bg-neon-green/5' : 'hover:bg-white/5'}`}
                          >
                            <td className="p-4">
                              <span className={`font-bold ${match.win ? 'text-neon-green' : 'text-neon-red'}`}>
                                {match.win ? 'VICTORY' : 'DEFEAT'}
                              </span>
                            </td>
                            <td className="p-4 text-white font-display text-xl tracking-wide">{match.championName}</td>
                            <td className="p-4 text-zinc-400">
                              <span className="text-white">{match.kills}</span> / <span className="text-neon-red">{match.deaths}</span> / <span className="text-blue-400">{match.assists}</span>
                            </td>
                            <td className="p-4 text-right">
                              <button
                                onClick={() => loadMatchDetails(match.matchId, puuid)}
                                disabled={loading || isSelected}
                                className={`flex items-center justify-end gap-2 w-full uppercase tracking-widest text-xs font-bold transition-colors ${isSelected ? 'text-neon-green' : 'text-zinc-500 hover:text-white'}`}
                              >
                                {isSelected ? 'Viewing' : 'Analyze'}
                                {!isSelected && <ChevronRight className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                
                <div className="pt-6 flex justify-center">
                  <button
                    onClick={loadMoreMatches}
                    disabled={loading}
                    className="bg-brutal-black border border-brutal-gray text-white font-mono font-bold px-8 py-4 uppercase tracking-widest hover:border-neon-green hover:text-neon-green transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Load More Matches
                  </button>
                </div>
              </motion.div>
            )}
            
            {/* Tab Content: Orchestra Stats */}
            {activeTab === 'stats' && (
              <div className="mt-4">
                <OrchestraStatistics matches={matchData ? [matchData] : []} />
              </div>
            )}
          </div>
        )}
        
      </div>
    </div>
  );
}
