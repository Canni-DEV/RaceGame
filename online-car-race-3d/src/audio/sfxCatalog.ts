import { resolvePublicAssetUrl } from '../config'

export type SfxId =
  | 'pickup-turbo'
  | 'pickup-missile'
  | 'turbo-activate'
  | 'missile-fire'
  | 'lap-complete'
  | 'countdown-tick'
  | 'countdown-go'
  | 'player-join'

export type SfxDefinition = {
  id: SfxId
  file: string
  volume: number
  positional: boolean
  refDistance?: number
  rolloff?: number
  maxDistance?: number
}

const DEFAULT_POSITIONAL = {
  refDistance: 6,
  rolloff: 1.5,
  maxDistance: 140,
}

export const SFX_DEFINITIONS: Record<SfxId, SfxDefinition> = {
  'pickup-turbo': {
    id: 'pickup-turbo',
    file: 'pickup-turbo',
    volume: 0.7,
    positional: true,
    ...DEFAULT_POSITIONAL,
  },
  'pickup-missile': {
    id: 'pickup-missile',
    file: 'pickup-missile',
    volume: 0.7,
    positional: true,
    ...DEFAULT_POSITIONAL,
  },
  'turbo-activate': {
    id: 'turbo-activate',
    file: 'turbo-activate',
    volume: 0.75,
    positional: true,
    ...DEFAULT_POSITIONAL,
  },
  'missile-fire': {
    id: 'missile-fire',
    file: 'missile-fire',
    volume: 0.8,
    positional: true,
    ...DEFAULT_POSITIONAL,
  },
  'lap-complete': {
    id: 'lap-complete',
    file: 'lap-complete',
    volume: 0.7,
    positional: false,
  },
  'countdown-tick': {
    id: 'countdown-tick',
    file: 'countdown-tick',
    volume: 0.65,
    positional: false,
  },
  'countdown-go': {
    id: 'countdown-go',
    file: 'countdown-go',
    volume: 0.8,
    positional: false,
  },
  'player-join': {
    id: 'player-join',
    file: 'player-join',
    volume: 0.6,
    positional: false,
  },
}

const SFX_EXTENSION = 'mp3'

export function resolveSfxUrl(file: string): string {
  return resolvePublicAssetUrl(`audio/sfx/${file}.${SFX_EXTENSION}`)
}
