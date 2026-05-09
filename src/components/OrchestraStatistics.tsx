import React, { useMemo } from 'react';

/**
 * OrchestraStatistics
 *
 * This component provides a high‑level overview of player and match performance
 * across multiple match analyses. It aggregates key metrics such as average
 * Slaughter Velocity (SV), Receipt of Labor, and basic combat statistics. The
 * intent is to help coaches and analysts spot long‑term trends across a
 * collection of games rather than inspecting each game in isolation.
 *
 * Props:
 *   matches – An array of processed match results (as returned by
 *             `processMatchData`) containing players, chartData, pilotStats,
 *             and metadata. It is the caller's responsibility to supply a
 *             consistent structure.
 */

interface PlayerStats {
  id: number;
  name: string;
  teamId: number;
  champion: string;
  lane: string;
  isTarget: boolean;
  receipt: number;
  svHistory: number[];
  kills: number;
  deaths: number;
  assists: number;
}

interface MatchData {
  chartData: { minute: number; winProb: number; deltaP: number; sv: number }[];
  players: PlayerStats[];
  pilotStats: any;
  matchMetadata: any;
}

interface OrchestraStatisticsProps {
  matches: MatchData[];
}

const OrchestraStatistics: React.FC<OrchestraStatisticsProps> = ({ matches }) => {
  // Compute aggregate statistics once per render
  const aggregates = useMemo(() => {
    if (!matches || matches.length === 0) {
      return null;
    }

    // Aggregate player-centric statistics across all matches.  We focus on the
    // target (pilot) player rather than every participant.  Receipts are
    // recorded on the player objects, SV and deltaP values come from the
    // chart data, and pilotStats provides kills/deaths/assists per match.
    let totalReceipt = 0;
    let totalSvSum = 0;
    let totalSvCount = 0;
    let totalDeltaPSum = 0;
    let totalDeltaPCount = 0;
    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;
    const perMatchStats: any[] = [];

    matches.forEach((m) => {
      // Identify the target player by isTarget flag
      const player = m.players.find((p) => p.isTarget);

      // Sum receipts
      if (player) {
        totalReceipt += player.receipt;
      }

      // Sum SV and deltaP from chart data
      m.chartData.forEach((entry) => {
        if (typeof entry.sv === 'number') {
          totalSvSum += entry.sv;
          totalSvCount += 1;
        }
        if (typeof entry.deltaP === 'number') {
          totalDeltaPSum += entry.deltaP;
          totalDeltaPCount += 1;
        }
      });

      // Aggregate combat stats from pilotStats
      const ps = m.pilotStats || {};
      totalKills += ps.kills || 0;
      totalDeaths += ps.deaths || 0;
      totalAssists += ps.assists || 0;

      // Prepare per-match summary for the table
      const matchId = (m.matchMetadata && m.matchMetadata.matchId) || '';
      const champion = player?.champion || '';
      const lane = player?.lane || '';
      const receipt = player?.receipt || 0;
      // Calculate average SV for this match
      let avgSvMatch = 0;
      if (m.chartData && m.chartData.length > 0) {
        const svSum = m.chartData.reduce((sum, entry) => sum + (entry.sv || 0), 0);
        avgSvMatch = svSum / m.chartData.length;
      }
      const kills = ps.kills || 0;
      const deaths = ps.deaths || 0;
      const assists = ps.assists || 0;
      const kda = ps.kda || '';
      const damageShare = ps.damageShare;
      const goldShare = ps.goldShare;
      const killParticipation = ps.killParticipation;
      const visionShare = ps.visionShare;
      perMatchStats.push({
        matchId,
        champion,
        lane,
        receipt,
        avgSv: avgSvMatch,
        kills,
        deaths,
        assists,
        kda,
        damageShare,
        goldShare,
        killParticipation,
        visionShare,
      });
    });

    const matchCount = matches.length;
    const avgReceipt = matchCount > 0 ? totalReceipt / matchCount : 0;
    const avgSv = totalSvCount > 0 ? totalSvSum / totalSvCount : 0;
    const avgDeltaP = totalDeltaPCount > 0 ? totalDeltaPSum / totalDeltaPCount : 0;

    return {
      avgReceipt,
      avgSv,
      avgDeltaP,
      totalKills,
      totalDeaths,
      totalAssists,
      perMatchStats,
    };
  }, [matches]);

  if (!aggregates) {
    return (
      <div className="p-4">
        <h2 className="text-xl font-semibold mb-2">Orchestra Statistics</h2>
        <p className="text-gray-500">No match data provided.</p>
      </div>
    );
  }

  const {
    avgReceipt,
    avgSv,
    avgDeltaP,
    totalKills,
    totalDeaths,
    totalAssists,
    perMatchStats,
  } = aggregates;

  return (
    <div className="p-4 overflow-auto">
      <h2 className="text-xl font-semibold mb-4">Orchestra Statistics</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-gray-800 rounded-lg shadow">
          <h3 className="text-sm text-gray-300">Average Receipt of Labor</h3>
          <p className="text-2xl font-bold text-white">{avgReceipt.toFixed(2)}</p>
        </div>
        <div className="p-4 bg-gray-800 rounded-lg shadow">
          <h3 className="text-sm text-gray-300">Average Slaughter Velocity (SV)</h3>
          <p className="text-2xl font-bold text-white">{avgSv.toFixed(2)}</p>
        </div>
        <div className="p-4 bg-gray-800 rounded-lg shadow">
          <h3 className="text-sm text-gray-300">Average Probability Change (ΔP)</h3>
          <p className="text-2xl font-bold text-white">{avgDeltaP.toFixed(2)}</p>
        </div>
        <div className="p-4 bg-gray-800 rounded-lg shadow">
          <h3 className="text-sm text-gray-300">Total Kills</h3>
          <p className="text-2xl font-bold text-white">{totalKills}</p>
        </div>
        <div className="p-4 bg-gray-800 rounded-lg shadow">
          <h3 className="text-sm text-gray-300">Total Deaths</h3>
          <p className="text-2xl font-bold text-white">{totalDeaths}</p>
        </div>
        <div className="p-4 bg-gray-800 rounded-lg shadow">
          <h3 className="text-sm text-gray-300">Total Assists</h3>
          <p className="text-2xl font-bold text-white">{totalAssists}</p>
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-2">Per‑Match Player Summary</h3>
      <table className="min-w-full bg-gray-800 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-gray-700 text-gray-300 text-left">
            <th className="px-4 py-2">Match</th>
            <th className="px-4 py-2">Champion</th>
            <th className="px-4 py-2">Lane</th>
            <th className="px-4 py-2">Receipt</th>
            <th className="px-4 py-2">Avg SV</th>
            <th className="px-4 py-2">Kills</th>
            <th className="px-4 py-2">Deaths</th>
            <th className="px-4 py-2">Assists</th>
            <th className="px-4 py-2">KDA</th>
            <th className="px-4 py-2">Damage Share%</th>
            <th className="px-4 py-2">Gold Share%</th>
            <th className="px-4 py-2">Kill Part.%</th>
            <th className="px-4 py-2">Vision Share%</th>
          </tr>
        </thead>
        <tbody>
          {perMatchStats.map((pm, idx) => (
            <tr key={idx} className="border-t border-gray-700 text-gray-200">
              <td className="px-4 py-2 whitespace-nowrap">{pm.matchId || `Match ${idx + 1}`}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.champion}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.lane}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.receipt.toFixed(2)}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.avgSv.toFixed(2)}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.kills}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.deaths}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.assists}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.kda}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.damageShare !== undefined && pm.damageShare !== null ? pm.damageShare.toFixed(2) : ''}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.goldShare !== undefined && pm.goldShare !== null ? pm.goldShare.toFixed(2) : ''}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.killParticipation !== undefined && pm.killParticipation !== null ? pm.killParticipation.toFixed(2) : ''}</td>
              <td className="px-4 py-2 whitespace-nowrap">{pm.visionShare !== undefined && pm.visionShare !== null ? pm.visionShare.toFixed(2) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default OrchestraStatistics;