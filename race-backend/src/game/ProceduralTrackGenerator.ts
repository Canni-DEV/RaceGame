import { TrackData, TrackDecoration, TreeBeltDecoration, Vec2 } from "../types/trackTypes";
import { planAssetDecorations } from "./TrackAssetPlanner";

export interface ProceduralTrackConfig {
  minPoints: number;
  maxPoints: number;
  minRadius: number;
  maxRadius: number;
  smoothingPasses: number;
  angleJitter: number;
  widthRange: [number, number];
  treeDensity: number;
  treeMinDistanceFactor: number;
  treeMaxDistanceFactor: number;
}

export class ProceduralTrackGenerator {
  constructor(private readonly config: ProceduralTrackConfig) {}

  generate(seed: number): TrackData {
    const random = this.createRandom(seed);
    const pointCount = this.randomInt(random, this.config.minPoints, this.config.maxPoints);
    const rawPoints: Vec2[] = [];
    const baseAngleStep = (Math.PI * 2) / pointCount;
    const offset = random() * Math.PI * 2;

    for (let i = 0; i < pointCount; i++) {
      const angle =
        offset +
        i * baseAngleStep +
        (random() - 0.5) * baseAngleStep * this.config.angleJitter;
      const radius = this.lerp(this.config.minRadius, this.config.maxRadius, random());
      rawPoints.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius
      });
    }

    const smoothed = this.smoothPoints(rawPoints, this.config.smoothingPasses);
    const width = this.lerp(this.config.widthRange[0], this.config.widthRange[1], random());
    const decorations = this.createDecorations(smoothed, width);

    return {
      id: `procedural-${seed}`,
      seed,
      width,
      centerline: smoothed,
      decorations
    };
  }

  private createDecorations(centerline: Vec2[], width: number): TrackDecoration[] {
    const treeDecoration: TreeBeltDecoration = {
      type: "tree-belt",
      density: this.config.treeDensity,
      minDistance: width * this.config.treeMinDistanceFactor,
      maxDistance: width * this.config.treeMaxDistanceFactor
    };
    const assetDecorations = planAssetDecorations(centerline, width);

    return [treeDecoration, ...assetDecorations];
  }

  private smoothPoints(points: Vec2[], passes: number): Vec2[] {
    let result = points.map((p) => ({ ...p }));
    for (let pass = 0; pass < passes; pass++) {
      result = result.map((point, index) => {
        const prev = result[(index - 1 + result.length) % result.length];
        const next = result[(index + 1) % result.length];
        return {
          x: (point.x + prev.x + next.x) / 3,
          z: (point.z + prev.z + next.z) / 3
        };
      });
    }
    return result;
  }

  private randomInt(random: () => number, min: number, max: number): number {
    return Math.floor(random() * (max - min + 1)) + min;
  }

  private lerp(min: number, max: number, t: number): number {
    return min + (max - min) * t;
  }

  private createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
