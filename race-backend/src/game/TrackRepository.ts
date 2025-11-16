import { PROCEDURAL_TRACK_SETTINGS, TRACK_GENERATION } from "../config";
import {
  StartBuildingDecoration,
  TrackData,
  TrackDecoration,
  TreeBeltDecoration,
  Vec2
} from "../types/trackTypes";
import { ProceduralTrackGenerator } from "./ProceduralTrackGenerator";

const SAMPLE_CENTERLINE: Vec2[] = [
  { x: 0, z: 0 },
  { x: 50, z: 0 },
  { x: 80, z: 30 },
  { x: 60, z: 60 },
  { x: 20, z: 80 },
  { x: -30, z: 70 },
  { x: -60, z: 30 },
  { x: -40, z: -20 }
];

const DEFAULT_TRACK = createDefaultTrack();

export class TrackRepository {
  private readonly generator = new ProceduralTrackGenerator(PROCEDURAL_TRACK_SETTINGS);
  private tracks = new Map<string, TrackData>([[DEFAULT_TRACK.id, DEFAULT_TRACK]]);

  getDefaultTrack(): TrackData {
    if (TRACK_GENERATION.mode === "debug") {
      const debugTrack = this.tracks.get(TRACK_GENERATION.debugTrackId) ?? DEFAULT_TRACK;
      return this.cloneTrack(debugTrack);
    }

    const seed = this.resolveSeed();
    const track = this.getOrCreateProceduralTrack(seed);
    return this.cloneTrack(track);
  }

  getTrackById(id: string): TrackData | undefined {
    const track = this.tracks.get(id);
    return track ? this.cloneTrack(track) : undefined;
  }

  private resolveSeed(): number {
    if (TRACK_GENERATION.seedOverride !== undefined) {
      return TRACK_GENERATION.seedOverride;
    }
    return this.getDailySeed();
  }

  private getDailySeed(): number {
    const today = new Date();
    const dateToken = today.toISOString().slice(0, 10).replace(/-/g, "");
    return Number(dateToken);
  }

  private getOrCreateProceduralTrack(seed: number): TrackData {
    const trackId = `procedural-${seed}`;
    let track = this.tracks.get(trackId);
    if (!track) {
      track = this.generator.generate(seed);
      this.tracks.set(track.id, track);
    }
    return track;
  }

  private cloneTrack(track: TrackData): TrackData {
    return {
      ...track,
      centerline: track.centerline.map((point) => ({ ...point })),
      decorations: track.decorations.map((decor) => cloneDecoration(decor))
    };
  }
}

function cloneDecoration(decoration: TrackDecoration): TrackDecoration {
  if (decoration.type === "start-building") {
    return {
      ...decoration,
      position: { ...decoration.position }
    };
  }
  return { ...decoration };
}

function createDefaultTrack(): TrackData {
  const width = 30;
  const decorations = createDecorations(SAMPLE_CENTERLINE, width);
  return {
    id: "sample-track",
    seed: 1337,
    width,
    centerline: SAMPLE_CENTERLINE.map((point) => ({ ...point })),
    decorations
  };
}

function createDecorations(centerline: Vec2[], width: number): TrackDecoration[] {
  const treeDecoration: TreeBeltDecoration = {
    type: "tree-belt",
    density: PROCEDURAL_TRACK_SETTINGS.treeDensity,
    minDistance: width * PROCEDURAL_TRACK_SETTINGS.treeMinDistanceFactor,
    maxDistance: width * PROCEDURAL_TRACK_SETTINGS.treeMaxDistanceFactor
  };

  const building = createStartBuilding(centerline, width);
  return building ? [treeDecoration, building] : [treeDecoration];
}

function createStartBuilding(centerline: Vec2[], width: number): StartBuildingDecoration | null {
  if (centerline.length < 2) {
    return null;
  }
  const start = centerline[0];
  const next = centerline[1];
  const direction = normalize({ x: next.x - start.x, z: next.z - start.z });
  if (direction.x === 0 && direction.z === 0) {
    return null;
  }
  const normal = { x: -direction.z, z: direction.x };
  const offset = width + PROCEDURAL_TRACK_SETTINGS.startBuildingOffset;
  const rotation = Math.atan2(direction.z, direction.x);

  return {
    type: "start-building",
    position: {
      x: start.x + normal.x * offset,
      z: start.z + normal.z * offset
    },
    rotation,
    length: width * 2.4,
    width: width * 1.1,
    height: width * 0.55
  };
}

function normalize(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.z);
  if (length === 0) {
    return { x: 0, z: 0 };
  }
  return { x: vec.x / length, z: vec.z / length };
}

export const trackRepository = new TrackRepository();
