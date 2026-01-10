import {
  CarState,
  EntityDelta,
  ItemDelta,
  ItemState,
  MissileState,
  RoomState,
  RoomStateDelta
} from "../types/trackTypes";
import {
  STATE_DELTA_MAX_RATIO,
  STATE_DELTA_MIN_CHANGES
} from "../config";

type KeySelector<T> = (value: T) => string;
type EqualityFn<T> = (a: T, b: T) => boolean;

const DEFAULT_CAR_KEYS: (keyof CarState)[] = [
  "playerId",
  "username",
  "x",
  "z",
  "angle",
  "speed",
  "isNpc",
  "turboActive",
  "turboCharges",
  "missileCharges",
  "impactSpinTimeLeft"
];

const DEFAULT_MISSILE_KEYS: (keyof MissileState)[] = [
  "id",
  "ownerId",
  "x",
  "z",
  "angle",
  "speed",
  "targetId"
];

const DEFAULT_ITEM_KEYS: (keyof ItemState)[] = [
  "id",
  "type",
  "x",
  "z",
  "angle"
];

function shallowEqual<T extends object>(a: T, b: T, keys: (keyof T)[]): boolean {
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function diffEntities<T extends { id?: string; playerId?: string }>(
  previous: T[],
  next: T[],
  keySelector: KeySelector<T>,
  equals: EqualityFn<T>
): EntityDelta<T> | null {
  const prevMap = new Map<string, T>();
  previous.forEach((value) => prevMap.set(keySelector(value), value));

  const nextMap = new Map<string, T>();
  next.forEach((value) => nextMap.set(keySelector(value), value));

  const added: T[] = [];
  const updated: T[] = [];
  const removed: string[] = [];

  for (const [id, value] of nextMap.entries()) {
    const prevValue = prevMap.get(id);
    if (!prevValue) {
      added.push(value);
      continue;
    }
    if (!equals(prevValue, value)) {
      updated.push(value);
    }
  }

  for (const [id] of prevMap.entries()) {
    if (!nextMap.has(id)) {
      removed.push(id);
    }
  }

  if (added.length === 0 && updated.length === 0 && removed.length === 0) {
    return null;
  }

  return { added, updated, removed };
}

function carsEqual(a: CarState, b: CarState): boolean {
  return shallowEqual(a, b, DEFAULT_CAR_KEYS);
}

function missilesEqual(a: MissileState, b: MissileState): boolean {
  return shallowEqual(a, b, DEFAULT_MISSILE_KEYS);
}

function itemsEqual(a: ItemState, b: ItemState): boolean {
  return shallowEqual(a, b, DEFAULT_ITEM_KEYS);
}

function raceEqual(a: RoomState["race"], b: RoomState["race"]): boolean {
  if (a === b) {
    return true;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function radioEqual(a: RoomState["radio"], b: RoomState["radio"]): boolean {
  if (a === b) {
    return true;
  }
  return a.enabled === b.enabled && a.stationIndex === b.stationIndex;
}

function hasAnyChanges(delta: RoomStateDelta | null | undefined): boolean {
  return Boolean(delta && (delta.cars || delta.missiles || delta.items || delta.race || delta.radio));
}

function countEntityDelta<T extends { id?: string; playerId?: string }>(delta?: EntityDelta<T> | null): number {
  if (!delta) {
    return 0;
  }
  return (delta.added?.length ?? 0) + (delta.updated?.length ?? 0) + (delta.removed?.length ?? 0);
}

function countItemDelta(delta?: ItemDelta | null): number {
  if (!delta) {
    return 0;
  }
  return (delta.added?.length ?? 0) + (delta.removed?.length ?? 0);
}

export function computeStateDelta(previous: RoomState, next: RoomState): RoomStateDelta | null {
  const cars = diffEntities(previous.cars, next.cars, (car) => car.playerId, carsEqual);
  const missiles = diffEntities(previous.missiles, next.missiles, (missile) => missile.id, missilesEqual);
  const items = diffEntities(previous.items, next.items, (item) => item.id, itemsEqual);
  const raceChanged = !raceEqual(previous.race, next.race);
  const radioChanged = !radioEqual(previous.radio, next.radio);

  if (!cars && !missiles && !items && !raceChanged && !radioChanged) {
    return null;
  }

  const delta: RoomStateDelta = {
    roomId: next.roomId
  };

  if (cars) {
    delta.cars = cars;
  }
  if (missiles) {
    delta.missiles = missiles;
  }
  if (items) {
    delta.items = items;
  }
  if (raceChanged) {
    delta.race = next.race;
  }
  if (radioChanged) {
    delta.radio = next.radio;
  }
  return delta;
}

export function shouldSendFullSnapshot(delta: RoomStateDelta, previous: RoomState, next: RoomState): boolean {
  const changedCount =
    countEntityDelta(delta.cars) +
    countEntityDelta(delta.missiles) +
    countItemDelta(delta.items) +
    (delta.race ? 1 : 0) +
    (delta.radio ? 1 : 0);
  const totalCount = Math.max(
    previous.cars.length +
    previous.missiles.length +
    previous.items.length,
    next.cars.length + next.missiles.length + next.items.length,
    1
  );
  const changeRatio = changedCount / totalCount;

  if (changeRatio >= STATE_DELTA_MAX_RATIO) {
    return true;
  }
  if (changedCount >= STATE_DELTA_MIN_CHANGES) {
    return true;
  }
  return false;
}

export function hasBroadcastableChanges(delta: RoomStateDelta | null): delta is RoomStateDelta {
  return hasAnyChanges(delta);
}
