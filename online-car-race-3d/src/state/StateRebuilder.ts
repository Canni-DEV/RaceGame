import type {
  CarState,
  ItemState,
  MissileState,
  RoomState,
  RoomStateDelta,
} from '../core/trackTypes'

type KeySelector<T> = (value: T) => string

function applyEntityDelta<T>(
  base: T[],
  delta: { added?: T[]; updated?: T[]; removed?: string[] },
  keySelector: KeySelector<T>,
): T[] {
  const map = new Map<string, T>()
  for (const entity of base) {
    map.set(keySelector(entity), entity)
  }

  if (delta.removed) {
    for (const id of delta.removed) {
      map.delete(id)
    }
  }

  if (delta.updated) {
    for (const entity of delta.updated) {
      const key = keySelector(entity)
      const previous = map.get(key)
      map.set(key, previous ? { ...previous, ...entity } : entity)
    }
  }

  if (delta.added) {
    for (const entity of delta.added) {
      map.set(keySelector(entity), entity)
    }
  }

  return Array.from(map.values())
}

function applyCarDelta(base: CarState[], delta: RoomStateDelta['cars']): CarState[] {
  if (!delta) {
    return base
  }
  return applyEntityDelta(base, delta, (car) => car.playerId)
}

function applyMissileDelta(base: MissileState[], delta: RoomStateDelta['missiles']): MissileState[] {
  if (!delta) {
    return base
  }
  return applyEntityDelta(base, delta, (missile) => missile.id)
}

function applyItemDelta(base: ItemState[], delta: RoomStateDelta['items']): ItemState[] {
  if (!delta) {
    return base
  }
  const updated: { added?: ItemState[]; removed?: string[] } = {
    added: delta.added,
    removed: delta.removed,
  }
  return applyEntityDelta(base, updated, (item) => item.id)
}

export function applyRoomStateDelta(base: RoomState | null, delta: RoomStateDelta): RoomState | null {
  if (!base) {
    return null
  }

  const cars = applyCarDelta(base.cars, delta.cars)
  const missiles = applyMissileDelta(base.missiles, delta.missiles)
  const items = applyItemDelta(base.items, delta.items)
  const radio = delta.radio ?? base.radio

  return {
    roomId: delta.roomId ?? base.roomId,
    trackId: delta.trackId ?? base.trackId,
    serverTime: delta.serverTime ?? base.serverTime,
    cars,
    missiles,
    items,
    radio,
    race: delta.race ?? base.race,
  }
}
