import {
  CarState,
  ItemState,
  MissileState,
  RaceState,
  RoomState
} from "../types/trackTypes";
import {
  STATE_NUMBER_PRECISION
} from "../config";

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (STATE_NUMBER_PRECISION <= 0) {
    return value;
  }
  const factor = 10 ** STATE_NUMBER_PRECISION;
  return Math.round(value * factor) / factor;
}

function optionalRound(value: number | undefined): number | undefined {
  return value === undefined ? undefined : roundNumber(value);
}

function serializeCarState(car: CarState): CarState {
  return {
    playerId: car.playerId,
    username: car.username,
    x: roundNumber(car.x),
    z: roundNumber(car.z),
    angle: roundNumber(car.angle),
    speed: roundNumber(car.speed),
    isNpc: car.isNpc,
    turboActive: car.turboActive,
    turboCharges: car.turboCharges,
    missileCharges: car.missileCharges,
    impactSpinTimeLeft: optionalRound(car.impactSpinTimeLeft)
  };
}

function serializeMissile(missile: MissileState): MissileState {
  return {
    id: missile.id,
    ownerId: missile.ownerId,
    x: roundNumber(missile.x),
    z: roundNumber(missile.z),
    angle: roundNumber(missile.angle),
    speed: roundNumber(missile.speed),
    targetId: missile.targetId
  };
}

function serializeItem(item: ItemState): ItemState {
  return {
    id: item.id,
    type: item.type,
    x: roundNumber(item.x),
    z: roundNumber(item.z),
    angle: roundNumber(item.angle)
  };
}

function serializeLeaderboardEntry(entry: RaceState["leaderboard"][number]): RaceState["leaderboard"][number] {
  return {
    ...entry,
    totalDistance: roundNumber(entry.totalDistance),
    gapToFirst: entry.gapToFirst === null ? null : roundNumber(entry.gapToFirst),
    finishTime: entry.finishTime === undefined ? undefined : roundNumber(entry.finishTime)
  };
}

function serializeRacePlayer(player: RaceState["players"][number]): RaceState["players"][number] {
  return {
    ...player,
    progressOnLap: roundNumber(player.progressOnLap),
    totalDistance: roundNumber(player.totalDistance),
    finishTime: player.finishTime === undefined ? undefined : roundNumber(player.finishTime)
  };
}

function serializeRaceState(race: RaceState): RaceState {
  return {
    phase: race.phase,
    lapsRequired: race.lapsRequired,
    countdownRemaining: race.countdownRemaining === null ? null : roundNumber(race.countdownRemaining),
    countdownTotal: race.countdownTotal === null ? null : roundNumber(race.countdownTotal),
    finishTimeoutRemaining: race.finishTimeoutRemaining === null ? null : roundNumber(race.finishTimeoutRemaining),
    postRaceRemaining: race.postRaceRemaining === null ? null : roundNumber(race.postRaceRemaining),
    startSegmentIndex: race.startSegmentIndex,
    leaderboard: race.leaderboard.map(serializeLeaderboardEntry),
    players: race.players.map(serializeRacePlayer)
  };
}

export function serializeRoomState(state: RoomState): RoomState {
  return {
    roomId: state.roomId,
    trackId: state.trackId,
    serverTime: roundNumber(state.serverTime),
    cars: state.cars.map(serializeCarState),
    missiles: state.missiles.map(serializeMissile),
    items: state.items.map(serializeItem),
    race: serializeRaceState(state.race)
  };
}
