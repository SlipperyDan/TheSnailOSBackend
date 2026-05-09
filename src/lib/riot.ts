export const formatMinute = (min: number) => {
  const m = Math.floor(min || 0);
  const s = Math.floor(((min || 0) - m) * 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const getPlayerGold = (f: any): Record<number, number> => {
  const res: Record<number, number> = {};
  Object.values(f.participantFrames).forEach((pf: any) => {
    res[pf.participantId] = pf.totalGold || 0;
  });
  return res;
};

export const getPlayerXp = (f: any): Record<number, number> => {
  const res: Record<number, number> = {};
  Object.values(f.participantFrames).forEach((pf: any) => {
    res[pf.participantId] = pf.xp || 0;
  });
  return res;
};

export const getPlayerPositions = (f: any): Record<number, { x: number; y: number } | null> => {
  const res: Record<number, { x: number; y: number } | null> = {};
  Object.values(f.participantFrames).forEach((pf: any) => {
    res[pf.participantId] = pf.position
      ? { x: pf.position.x, y: pf.position.y }
      : null;
  });
  return res;
};

export const interpolatePositions = (
  prevFrame: any,
  currFrame: any,
  ratio: number
): Record<number, { x: number; y: number } | null> => {
  const res: Record<number, { x: number; y: number } | null> = {};
  for (let i = 1; i <= 10; i++) {
    const prevPos = prevFrame.participantFrames[i]?.position;
    const currPos = currFrame.participantFrames[i]?.position;

    if (prevPos && currPos) {
      res[i] = {
        x: prevPos.x + (currPos.x - prevPos.x) * ratio,
        y: prevPos.y + (currPos.y - prevPos.y) * ratio
      };
    } else if (currPos) {
      res[i] = { x: currPos.x, y: currPos.y };
    } else if (prevPos) {
      res[i] = { x: prevPos.x, y: prevPos.y };
    } else {
      res[i] = null;
    }
  }
  return res;
};

export const getRelativePositions = (
  positions: Record<number, { x: number; y: number } | null>,
  targetId: number,
  playersList: { id: number; teamId: number }[]
) => {
  const targetPos = positions[targetId];
  const targetMeta = playersList.find((p) => p.id === targetId);

  if (!targetPos || !targetMeta) {
    return { allies: [], enemies: [] };
  }

  const allies: any[] = [];
  const enemies: any[] = [];

  for (const p of playersList) {
    if (p.id === targetId) continue;

    const pos = positions[p.id];
    if (!pos) continue;

    const dx = pos.x - targetPos.x;
    const dy = pos.y - targetPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const entry = {
      participantId: p.id,
      dx,
      dy,
      distance
    };

    if (p.teamId === targetMeta.teamId) allies.push(entry);
    else enemies.push(entry);
  }

  allies.sort((a, b) => a.distance - b.distance);
  enemies.sort((a, b) => a.distance - b.distance);

  return { allies, enemies };
};

/**
 * Compute the win probability for Team 100 based on both gold and experience.
 * The probability is defined as the average of the team gold ratio and team XP ratio.
 * A simple dampening is applied in the first 5 minutes of the game to avoid extreme swings.
 *
 * @param g100 Total gold for team 100 at the current snapshot
 * @param g200 Total gold for team 200 at the current snapshot
 * @param xp100 Total experience for team 100 at the current snapshot
 * @param xp200 Total experience for team 200 at the current snapshot
 * @param minute Game minute of the snapshot (e.g. 1, 2, 3...)
 * @returns A probability between 0 and 1 representing Team 100's advantage
 */
/*
 * Compute win probability for Team 100 based solely on gold using a squared formula.
 * This function was reverted to use the Pythagorean expectation (gold squared ratio)
 * after moving away from combined gold+XP models. An early-game dampening smooths
 * out volatility in the first five minutes.
 */
export const calcProb100 = (g100: number, g200: number, minute: number) => {
  // If both teams have no gold (e.g., pre-game), return neutral 50%
  let pG = g100 === 0 && g200 === 0
    ? 0.5
    : Math.pow(g100, 2) / (Math.pow(g100, 2) + Math.pow(g200, 2));

  // Early-game dampening: gradually transition from neutral to gold-derived probability
  if (minute < 5) {
    const dampening = Math.pow(minute / 5, 2);
    pG = 0.5 + (pG - 0.5) * dampening;
  }
  return pG;
};

export function processMatchData(info: any, timeline: any, targetPuuid: string, championData?: any) {
  const targetParticipant = info.participants.find((p: any) => p.puuid === targetPuuid);
  if (!targetParticipant) {
    throw new Error(`Target participant not found for puuid: ${targetPuuid}`);
  }

  const targetTeamId = targetParticipant.teamId;

  const players = info.participants.map((p: any) => ({
    id: p.participantId,
    name: p.riotIdGameName || p.summonerName,
    champion: p.championName,
    lane: p.teamPosition || p.lane || 'UNKNOWN',
    teamId: p.teamId,
    isTarget: p.puuid === targetPuuid,
    receipt: 0,
    svHistory: [] as number[],
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    damage: p.totalDamageDealtToChampions,
    damageTaken: p.totalDamageTaken,
    gold: p.goldEarned,
    vision: p.visionScore,
    ccScore: p.timeCCingOthers || 0,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    shielding: p.totalDamageShieldedOnTeammates || 0,
    healing: p.totalHeal || 0,
    mitigated: p.damageSelfMitigated || 0,
    healingReduced: p.totalDamageDealtToChampions || 0
  }));

  const targetPlayer = players.find((p: any) => p.id === targetParticipant.participantId);
  if (!targetPlayer) {
    throw new Error('Target player not found in normalized players array');
  }

  const chartData: any[] = [];
  const csHistory: { minute: number; cs: number; csPerMin: number }[] = [];
  const snapshots: any[] = [];

  timeline.frames.forEach((frame: any, idx: number) => {
    if (idx > 0) {
      const pf = frame.participantFrames[targetParticipant.participantId.toString()];
      if (pf) {
        const totalCs = (pf.minionsKilled || 0) + (pf.jungleMinionsKilled || 0);
        csHistory.push({
          minute: idx,
          cs: totalCs,
          csPerMin: totalCs / idx
        });
      }
    }

    if (idx === 0) {
      const playerPositions = getPlayerPositions(frame);
      snapshots.push({
        type: 'MINUTE',
        timestamp: frame.timestamp,
        minute: 0,
        playerGold: getPlayerGold(frame),
        playerXp: getPlayerXp(frame),
        playerPositions,
        relativePositions: getRelativePositions(
          playerPositions,
          targetParticipant.participantId,
          players.map((p: any) => ({ id: p.id, teamId: p.teamId }))
        ),
        events: []
      });
      return;
    }

    const prevFrame = timeline.frames[idx - 1];
    const prevTimestamp = prevFrame.timestamp;
    const currTimestamp = frame.timestamp;

    let currentEvents: any[] = [];

    frame.events.forEach((event: any) => {
      if (
        event.type === 'CHAMPION_KILL' ||
        event.type === 'BUILDING_KILL' ||
        event.type === 'ELITE_MONSTER_KILL'
      ) {
        const ratio = (event.timestamp - prevTimestamp) / (currTimestamp - prevTimestamp);
        const prevGold = getPlayerGold(prevFrame);
        const currGold = getPlayerGold(frame);
        const prevXp = getPlayerXp(prevFrame);
        const currXp = getPlayerXp(frame);
        const playerPositions = interpolatePositions(prevFrame, frame, ratio);

        const playerGold: Record<number, number> = {};
        const playerXp: Record<number, number> = {};

        for (let i = 1; i <= 10; i++) {
          playerGold[i] = prevGold[i] + (currGold[i] - prevGold[i]) * ratio;
          playerXp[i] = prevXp[i] + (currXp[i] - prevXp[i]) * ratio;
        }

        currentEvents.push(event);

        const snapType =
          event.type === 'CHAMPION_KILL'
            ? 'KILL'
            : event.type === 'BUILDING_KILL' || event.type === 'ELITE_MONSTER_KILL'
              ? 'OBJECTIVE'
              : 'EVENT';

        snapshots.push({
          type: snapType,
          timestamp: event.timestamp,
          minute: event.timestamp / 60000,
          playerGold,
          playerXp,
          playerPositions,
          relativePositions: getRelativePositions(
            playerPositions,
            targetParticipant.participantId,
            players.map((p: any) => ({ id: p.id, teamId: p.teamId }))
          ),
          events: [...currentEvents]
        });

        currentEvents = [];
      } else {
        currentEvents.push(event);
      }
    });

    const playerPositions = getPlayerPositions(frame);
    snapshots.push({
      type: 'MINUTE',
      timestamp: frame.timestamp,
      minute: idx,
      playerGold: getPlayerGold(frame),
      playerXp: getPlayerXp(frame),
      playerPositions,
      relativePositions: getRelativePositions(
        playerPositions,
        targetParticipant.participantId,
        players.map((p: any) => ({ id: p.id, teamId: p.teamId }))
      ),
      events: [...currentEvents]
    });
  });

  const ledgerMap = new Map<number, any>();

  snapshots.forEach((snap: any, idx: number) => {
    if (idx === 0) {
      chartData.push({
        minute: 0,
        winProb: 50,
        deltaP: 0,
        sv: 0,
        cumulativeSv: 0,
        cumulativeReceipt: 0,
        events: [],
        relativePositions: snap.relativePositions
      });
      return;
    }

    const prevSnap = snapshots[idx - 1];

    let gold100 = 0;
    let gold200 = 0;
    let xp100 = 0;
    let xp200 = 0;
    let prevGold100 = 0;
    let prevGold200 = 0;
    let prevXp100 = 0;
    let prevXp200 = 0;

    const playerGoldDiff: Record<number, number> = {};
    const playerXpDiff: Record<number, number> = {};

    for (let i = 1; i <= 10; i++) {
      const teamId = i <= 5 ? 100 : 200;
      const g = snap.playerGold[i] || 0;
      const x = snap.playerXp[i] || 0;
      const pg = prevSnap.playerGold[i] || 0;
      const px = prevSnap.playerXp[i] || 0;

      if (teamId === 100) {
        gold100 += g;
        xp100 += x;
        prevGold100 += pg;
        prevXp100 += px;
      } else {
        gold200 += g;
        xp200 += x;
        prevGold200 += pg;
        prevXp200 += px;
      }

      playerGoldDiff[i] = g - pg;

      const ignoreXp = idx === 1;
      playerXpDiff[i] = ignoreXp ? 0 : x - px;
    }

    // Use the gold-only win probability model. Ignore XP parameters.
    const prob100 = calcProb100(gold100, gold200, snap.minute);
    const prevProb100 = calcProb100(prevGold100, prevGold200, prevSnap.minute);

    const deltaP100 = prob100 - prevProb100;
    const currentProb = targetTeamId === 100 ? prob100 : 1 - prob100;
    const deltaP = targetTeamId === 100 ? deltaP100 : -deltaP100;

    const minuteEvents: any[] = [];

    snap.events.forEach((event: any) => {
      let involved = false;
      let desc = '';
      let type = '';

      if (event.type === 'CHAMPION_KILL') {
        if (event.killerId === targetParticipant.participantId) {
          involved = true;
          type = 'KILL';
          desc = 'Secured Kill';
        } else if (event.victimId === targetParticipant.participantId) {
          involved = true;
          type = 'DEATH';
          desc = 'Died in Combat';
        } else if (event.assistingParticipantIds?.includes(targetParticipant.participantId)) {
          involved = true;
          type = 'ASSIST';
          desc = 'Assisted Kill';
        }
      } else if (event.type === 'BUILDING_KILL') {
        if (
          event.killerId === targetParticipant.participantId ||
          event.assistingParticipantIds?.includes(targetParticipant.participantId)
        ) {
          involved = true;
          type = 'OBJECTIVE';
          const bType =
            event.buildingType === 'TOWER_BUILDING'
              ? 'Tower'
              : event.buildingType === 'INHIBITOR_BUILDING'
                ? 'Inhibitor'
                : 'Building';
          desc = `Destroyed ${bType}`;
        }
      } else if (event.type === 'ELITE_MONSTER_KILL') {
        if (
          event.killerId === targetParticipant.participantId ||
          event.assistingParticipantIds?.includes(targetParticipant.participantId)
        ) {
          involved = true;
          type = 'OBJECTIVE';
          const mType =
            event.monsterType === 'DRAGON'
              ? 'Dragon'
              : event.monsterType === 'BARON_NASHOR'
                ? 'Baron'
                : event.monsterType === 'RIFTHERALD'
                  ? 'Herald'
                  : event.monsterType === 'HORDE'
                    ? 'Voidgrub'
                    : 'Monster';
          desc = `Secured ${mType}`;
        }
      } else if (event.type === 'WARD_PLACED' && event.creatorId === targetParticipant.participantId) {
        involved = true;
        type = 'VISION';
        desc = `Placed ${event.wardType === 'CONTROL_WARD' ? 'Control ' : ''}Ward`;
      } else if (event.type === 'WARD_KILL' && event.killerId === targetParticipant.participantId) {
        involved = true;
        type = 'VISION';
        desc = `Cleared ${event.wardType === 'CONTROL_WARD' ? 'Control ' : ''}Ward`;
      } else if (event.type === 'ITEM_PURCHASED' && event.participantId === targetParticipant.participantId) {
        involved = true;
        type = 'ECONOMY';
        desc = `Purchased Item [ID:${event.itemId}]`;
      } else if (event.type === 'ITEM_SOLD' && event.participantId === targetParticipant.participantId) {
        involved = true;
        type = 'ECONOMY';
        desc = `Sold Item [ID:${event.itemId}]`;
      } else if (event.type === 'LEVEL_UP' && event.participantId === targetParticipant.participantId) {
        involved = true;
        type = 'POWER';
        desc = `Reached Level ${event.level}`;
      } else if (event.type === 'CHAMPION_SPECIAL_KILL' && event.killerId === targetParticipant.participantId) {
        involved = true;
        type = 'COMBAT';
        desc = `Special Kill (${event.killType})`;
      }

      if (involved) {
        minuteEvents.push({
          type,
          desc,
          timestamp: event.timestamp
        });
      }
    });

    /*
     * Revised Pilot Agency (Slaughter Velocity) Assignment
     *
     * With a gold-only probability model, we can calculate each player's individual
     * contribution to the win-probability change using their exact gold gain. Instead
     * of apportioning a fixed portion of the team’s shift, we remove each player’s
     * gold from the current totals and recompute the probability. The difference
     * between the actual probability and this hypothetical one represents that
     * player’s effect on the shift. Only players on the benefiting team (the team
     * whose probability increased) receive agency; the opposing team’s players
     * receive none. Contributions are normalized so that the sum of individual
     * Slaughter Velocities equals the absolute value of the team’s probability
     * change (|deltaP100|). This ensures that Slaughter Velocity is always
     * non‑negative.
     */
    // Determine which team benefitted from the probability change
    const benefitingTeamId = deltaP100 > 0 ? 100 : deltaP100 < 0 ? 200 : 0;

    // Map to store individual contributions before scaling
    const contributions: Record<number, number> = {};
    let totalContribution = 0;

    if (benefitingTeamId !== 0) {
      // Compute each benefiting player’s contribution by removing their gold gain
      players.forEach((p: any) => {
        if (p.teamId !== benefitingTeamId) {
          contributions[p.id] = 0;
          return;
        }
        const gain = Math.max(0, playerGoldDiff[p.id] || 0);
        if (gain <= 0) {
          contributions[p.id] = 0;
          return;
        }
        // Hypothetical totals without this player's gold gain
        let g100Without = gold100;
        let g200Without = gold200;
        if (benefitingTeamId === 100) {
          g100Without = Math.max(0, gold100 - gain);
        } else if (benefitingTeamId === 200) {
          g200Without = Math.max(0, gold200 - gain);
        }
        const probWithout = calcProb100(g100Without, g200Without, snap.minute);
        let contribution = 0;
        if (benefitingTeamId === 100) {
          // The player's gain increased Team 100's probability
          contribution = Math.max(0, prob100 - probWithout);
        } else {
          // The player's gain decreased Team 100's probability (thus increased Team 200's)
          contribution = Math.max(0, probWithout - prob100);
        }
        contributions[p.id] = contribution;
        totalContribution += contribution;
      });
    }

    let targetSv = 0;

    players.forEach((p: any) => {
      // Base Slaughter Velocity
      let sv = 0;
      if (benefitingTeamId !== 0 && p.teamId === benefitingTeamId && totalContribution > 0) {
        // Normalize the player's contribution so that sums to |deltaP100|
        const playerContribution = contributions[p.id] || 0;
        sv = Math.abs(deltaP100) * (playerContribution / totalContribution);
      }

      // Apply a late-game multiplier to emphasize late-game decisions
      const minute = snap.minute;
      const lateGameMultiplier = minute > 20 ? 1 + ((minute - 20) / 5) * 0.1 : 1.0;

      p.svHistory.push(sv);
      p.receipt += sv * lateGameMultiplier;

      if (p.id === targetParticipant.participantId) {
        targetSv = sv;
      }
    });

    const minuteBucket = Math.ceil(snap.minute) || 1;
    if (!ledgerMap.has(minuteBucket)) {
      ledgerMap.set(minuteBucket, {
        minute: minuteBucket,
        events: [],
        sv: 0,
        deltaP: 0,
        relativePositions: snap.relativePositions,
        playerPositions: snap.playerPositions
      });
    }

    const entry = ledgerMap.get(minuteBucket);
    entry.events.push(...minuteEvents);
    entry.sv += targetSv;
    entry.deltaP += deltaP;
    entry.relativePositions = snap.relativePositions;
    entry.playerPositions = snap.playerPositions;

    chartData.push({
      minute: snap.minute,
      winProb: currentProb * 100,
      deltaP: deltaP * 100,
      sv: targetSv * 100,
      cumulativeReceipt: targetPlayer.receipt * 100,
      events: minuteEvents,
      relativePositions: snap.relativePositions
    });
  });

  const eventsLedger = Array.from(ledgerMap.values())
    .filter(
      (entry) =>
        entry.events.length > 0 ||
        Math.abs(entry.sv) > 0.001 ||
        Math.abs(entry.deltaP) > 0.001
    )
    .sort((a, b) => a.minute - b.minute);

  players.sort((a, b) => b.receipt - a.receipt);

  const matchMetadata = {
    matchId: info.gameId || info.matchId || 'UNKNOWN',
    duration: info.gameDuration,
    version: info.gameVersion,
    queueId: info.queueId
  };

  const teamParticipants = info.participants.filter((p: any) => p.teamId === targetTeamId);
  const teamTotalDamage = teamParticipants.reduce(
    (sum: number, p: any) => sum + p.totalDamageDealtToChampions,
    0
  );
  const teamTotalDamageTaken = teamParticipants.reduce(
    (sum: number, p: any) => sum + p.totalDamageTaken,
    0
  );
  const teamTotalGold = teamParticipants.reduce((sum: number, p: any) => sum + p.goldEarned, 0);
  const teamTotalKills = teamParticipants.reduce((sum: number, p: any) => sum + p.kills, 0);
  const teamTotalVision = teamParticipants.reduce((sum: number, p: any) => sum + p.visionScore, 0);

  const damageShare =
    teamTotalDamage > 0 ? (targetParticipant.totalDamageDealtToChampions / teamTotalDamage) * 100 : 0;
  const damageTakenShare =
    teamTotalDamageTaken > 0 ? (targetParticipant.totalDamageTaken / teamTotalDamageTaken) * 100 : 0;
  const goldShare =
    teamTotalGold > 0 ? (targetParticipant.goldEarned / teamTotalGold) * 100 : 0;
  const killParticipation =
    teamTotalKills > 0
      ? ((targetParticipant.kills + targetParticipant.assists) / teamTotalKills) * 100
      : 0;
  const visionShare =
    teamTotalVision > 0 ? (targetParticipant.visionScore / teamTotalVision) * 100 : 0;

  const pilotStats = {
    kills: targetParticipant.kills,
    deaths: targetParticipant.deaths,
    assists: targetParticipant.assists,
    kda:
      targetParticipant.deaths === 0
        ? targetParticipant.kills + targetParticipant.assists
        : (
            (targetParticipant.kills + targetParticipant.assists) /
            targetParticipant.deaths
          ).toFixed(2),
    damage: targetParticipant.totalDamageDealtToChampions,
    damageTaken: targetParticipant.totalDamageTaken,
    vision: targetParticipant.visionScore,
    cs: targetParticipant.totalMinionsKilled + targetParticipant.neutralMinionsKilled,
    gold: targetParticipant.goldEarned,
    damageShare,
    damageTakenShare,
    goldShare,
    killParticipation,
    visionShare
  };

  const spatialHistory = Array.from(ledgerMap.values())
    .sort((a, b) => a.minute - b.minute)
    .map(entry => ({
      minute: entry.minute,
      playerPositions: entry.playerPositions
    }));

  return {
    chartData,
    players,
    targetParticipant,
    targetPlayer,
    eventsLedger,
    spatialHistory,
    matchMetadata,
    pilotStats,
    csHistory,
    memoryEnrichment: [] as any[]
  };
}