import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { db, auth } from '../firebase';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { Activity, Loader2, Trash2, TrendingUp, BarChart2 } from 'lucide-react';
import { deleteDoc, doc } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts';

export default function TheLabor() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setError(null);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    const q = query(
      collection(db, 'labor_stats'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newStats = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setStats(newStats);
      setLoading(false);
    }, (err) => {
      console.error("Firestore Error: ", err);
      setError(err.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'labor_stats', id));
    } catch (err: any) {
      console.error("Failed to delete stat: ", err);
    }
  };

  const { trendData, championData, laneData } = useMemo(() => {
    if (!stats.length) return { trendData: [], championData: [], laneData: [] };

    // Trend Data (chronological)
    const trendData = [...stats].reverse().map((stat, index) => ({
      index: index + 1,
      matchId: stat.matchId,
      sv: stat.slaughterVelocity || 0,
      net: stat.netAuthorship || 0,
      champion: stat.champion,
      lane: stat.lane || 'UNKNOWN'
    }));

    // Aggregate by Champion
    const champMap = new Map();
    stats.forEach(stat => {
      if (!stat.champion) return;
      if (!champMap.has(stat.champion)) {
        champMap.set(stat.champion, { champion: stat.champion, totalSv: 0, count: 0 });
      }
      const entry = champMap.get(stat.champion);
      entry.totalSv += (stat.slaughterVelocity || 0);
      entry.count += 1;
    });
    const championData = Array.from(champMap.values())
      .map(c => ({ champion: c.champion, avgSv: c.totalSv / c.count, count: c.count }))
      .sort((a, b) => b.avgSv - a.avgSv)
      .slice(0, 10); // Top 10

    // Aggregate by Lane
    const laneMap = new Map();
    stats.forEach(stat => {
      const lane = stat.lane || 'UNKNOWN';
      if (!laneMap.has(lane)) {
        laneMap.set(lane, { lane, totalSv: 0, count: 0 });
      }
      const entry = laneMap.get(lane);
      entry.totalSv += (stat.slaughterVelocity || 0);
      entry.count += 1;
    });
    const laneData = Array.from(laneMap.values())
      .map(l => ({ lane: l.lane, avgSv: l.totalSv / l.count, count: l.count }))
      .sort((a, b) => b.avgSv - a.avgSv);

    return { trendData, championData, laneData };
  }, [stats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-neon-green animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 border border-red-500/30 bg-red-500/10 text-red-400 font-mono text-sm">
        {error}
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-brutal-black border border-brutal-gray p-3 shadow-xl">
          <p className="font-mono text-xs text-zinc-400 mb-2">{payload[0].payload.champion} ({payload[0].payload.lane})</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="font-mono text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.value.toFixed(2)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const BarTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-brutal-black border border-brutal-gray p-3 shadow-xl">
          <p className="font-mono text-xs text-zinc-400 mb-2">{label}</p>
          <p className="font-mono text-sm" style={{ color: payload[0].color }}>
            Avg SV: {payload[0].value.toFixed(2)}
          </p>
          <p className="font-mono text-xs text-zinc-500 mt-1">
            Matches: {payload[0].payload.count}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between border-b border-brutal-gray pb-4">
        <h3 className="font-display text-2xl text-neon-green uppercase">The Labor</h3>
        <div className="font-mono text-xs text-zinc-500">
          {stats.length} RECORDS FOUND
        </div>
      </div>

      {stats.length === 0 ? (
        <div className="p-8 border border-brutal-gray bg-brutal-black/50 text-center">
          <p className="font-mono text-zinc-400">No telemetry recorded. Analyze a match and save it to The Labor.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="border border-brutal-gray bg-[#0a0a0a] p-4">
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="w-5 h-5 text-neon-green" />
                <h4 className="font-mono text-sm text-white uppercase tracking-widest">Slaughter Velocity Trend</h4>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="index" stroke="#666" tick={{ fill: '#666', fontSize: 10, fontFamily: 'monospace' }} />
                    <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10, fontFamily: 'monospace' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="sv" name="Slaughter Velocity" stroke="#00FF00" strokeWidth={2} dot={{ r: 3, fill: '#00FF00' }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="border border-brutal-gray bg-[#0a0a0a] p-4">
              <div className="flex items-center gap-2 mb-6">
                <BarChart2 className="w-5 h-5 text-neon-green" />
                <h4 className="font-mono text-sm text-white uppercase tracking-widest">Avg SV by Champion</h4>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={championData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                    <XAxis type="number" stroke="#666" tick={{ fill: '#666', fontSize: 10, fontFamily: 'monospace' }} />
                    <YAxis dataKey="champion" type="category" stroke="#666" tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'monospace' }} width={80} />
                    <Tooltip content={<BarTooltip />} cursor={{ fill: '#222' }} />
                    <Bar dataKey="avgSv" name="Avg SV" radius={[0, 4, 4, 0]}>
                      {championData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.avgSv > 0 ? '#00FF00' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="border border-brutal-gray bg-[#0a0a0a] p-4 lg:col-span-2">
              <div className="flex items-center gap-2 mb-6">
                <BarChart2 className="w-5 h-5 text-neon-green" />
                <h4 className="font-mono text-sm text-white uppercase tracking-widest">Avg SV by Lane</h4>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={laneData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="lane" stroke="#666" tick={{ fill: '#aaa', fontSize: 10, fontFamily: 'monospace' }} />
                    <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10, fontFamily: 'monospace' }} />
                    <Tooltip content={<BarTooltip />} cursor={{ fill: '#222' }} />
                    <Bar dataKey="avgSv" name="Avg SV" radius={[4, 4, 0, 0]}>
                      {laneData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.avgSv > 0 ? '#00FF00' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            {stats.map((stat) => (
              <div key={stat.id} className="p-4 border border-brutal-gray bg-[#0a0a0a] flex flex-col gap-4 group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div>
                      <div className="font-mono text-xs text-zinc-500 mb-1">CHAMPION</div>
                      <div className="font-display text-xl text-white uppercase">{stat.champion}</div>
                      {stat.lane && stat.lane !== 'UNKNOWN' && (
                        <div className="font-mono text-xs text-zinc-400 mt-1">{stat.lane}</div>
                      )}
                    </div>
                    <div>
                      <div className="font-mono text-xs text-zinc-500 mb-1">SLAUGHTER VELOCITY</div>
                      <div className={`font-mono text-lg ${stat.slaughterVelocity > 0 ? 'text-neon-green' : 'text-red-500'}`}>
                        {stat.slaughterVelocity > 0 ? '+' : ''}{stat.slaughterVelocity?.toFixed(2) || '0.00'}
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-xs text-zinc-500 mb-1">NET AUTHORSHIP</div>
                      <div className={`font-mono text-lg ${stat.netAuthorship > 0 ? 'text-neon-green' : 'text-red-500'}`}>
                        {stat.netAuthorship > 0 ? '+' : ''}{stat.netAuthorship?.toFixed(2) || '0.00'}%
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="font-mono text-xs text-zinc-600 text-right">
                      <div>MATCH ID</div>
                      <div>{stat.matchId}</div>
                    </div>
                    <button 
                      onClick={() => handleDelete(stat.id)}
                      className="p-2 text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete Record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {stat.transcript && (
                  <div className="mt-2 pt-4 border-t border-brutal-gray/30">
                    <div className="font-mono text-xs text-neon-green mb-2 uppercase tracking-widest">Memory Made Flesh (Transcript)</div>
                    <div className="font-mono text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                      {stat.transcript}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}
