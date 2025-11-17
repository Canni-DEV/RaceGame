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

type SegmentType = "straight" | "curve-open" | "curve-closed" | "chicane";
interface SegmentPlan {
  type: SegmentType;
  direction: 1 | -1;
}

interface SegmentState {
  position: Vec2;
  heading: number;
}

const LAYOUT_SEED = 0x243f6a88;
const POINTS_SEED = 0x9e3779b1;
const WIDTH_SEED = 0xb7e15162;

export class ProceduralTrackGenerator {
  constructor(private readonly config: ProceduralTrackConfig) {}

  generate(seed: number): TrackData {
    const pointsRandom = this.createRandom(seed ^ POINTS_SEED);
    const targetPointCount = this.randomInt(
      pointsRandom,
      this.config.minPoints,
      this.config.maxPoints
    );

    const widthRandom = this.createRandom(seed ^ WIDTH_SEED);
    const width = this.lerp(this.config.widthRange[0], this.config.widthRange[1], widthRandom());

    const layoutSeedBase = seed ^ LAYOUT_SEED;
    let centerline: Vec2[] | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      const layoutRandom = this.createRandom(layoutSeedBase + attempt * 0x517cc1b7);
      const rawPoints = this.generateLayout(layoutRandom, targetPointCount);
      const normalized = this.normalizePoints(rawPoints, layoutRandom);
      const smoothed = this.smoothPoints(normalized, this.config.smoothingPasses);
      const resampled = this.resamplePoints(smoothed, targetPointCount);
      if (this.validateTrack(resampled)) {
        centerline = resampled;
        break;
      }
    }
    if (!centerline) {
      centerline = this.fallbackCircularTrack(seed, targetPointCount);
    }

    const decorations = this.createDecorations(centerline, width);
    return {
      id: `procedural-${seed}`,
      seed,
      width,
      centerline,
      decorations
    };
  }

  private generateLayout(random: () => number, targetPointCount: number): Vec2[] {
    const complexity = this.clamp(this.config.angleJitter, 0.3, 2.2);
    const desiredPoints = Math.max(
      targetPointCount,
      Math.floor(targetPointCount * (1.4 + complexity * 0.3))
    );
    const state: SegmentState = {
      position: { x: 0, z: 0 },
      heading: random() * Math.PI * 2
    };
    const points: Vec2[] = [{ ...state.position }];
    let lastTurn: 1 | -1 | 0 = 0;
    let sameTurnCount = 0;

    while (points.length < desiredPoints) {
      const plan = this.pickSegmentPlan(random, lastTurn, sameTurnCount, complexity);
      const appliedTurn = this.applySegment(points, state, plan, random);
      if (appliedTurn !== 0) {
        sameTurnCount = lastTurn === appliedTurn ? sameTurnCount + 1 : 1;
        lastTurn = appliedTurn;
      } else {
        sameTurnCount = 0;
      }
    }

    this.closeLoop(points, state, random);
    return points;
  }

  private pickSegmentPlan(
    random: () => number,
    lastTurn: 1 | -1 | 0,
    sameTurnCount: number,
    complexity: number
  ): SegmentPlan {
    if (sameTurnCount >= 2 && lastTurn !== 0) {
      const forcedDirection = (lastTurn * -1) as 1 | -1;
      return {
        type: random() > 0.4 ? "curve-open" : "curve-closed",
        direction: forcedDirection
      };
    }
    const straightProbability = this.clamp(0.35 - (complexity - 1) * 0.08, 0.15, 0.5);
    const chicaneProbability = this.clamp(0.15 + (complexity - 1) * 0.05, 0.1, 0.25);
    const roll = random();
    if (roll < straightProbability) {
      return { type: "straight", direction: lastTurn || (random() > 0.5 ? 1 : -1) };
    }
    if (roll < straightProbability + chicaneProbability) {
      return { type: "chicane", direction: random() > 0.5 ? 1 : -1 };
    }
    const favorLeft = lastTurn >= 0 && random() > 0.2;
    const direction: 1 | -1 = favorLeft ? 1 : -1;
    const tightCurveChance = this.clamp(0.4 + (complexity - 1) * 0.2, 0.3, 0.7);
    return {
      type: random() < tightCurveChance ? "curve-closed" : "curve-open",
      direction: random() > 0.5 ? direction : (direction * -1) as 1 | -1
    };
  }

  private applySegment(
    points: Vec2[],
    state: SegmentState,
    plan: SegmentPlan,
    random: () => number
  ): 1 | -1 | 0 {
    switch (plan.type) {
      case "straight":
        this.addStraight(points, state, random);
        return 0;
      case "curve-open":
        this.addCurve(points, state, plan.direction, random, false);
        return plan.direction;
      case "curve-closed":
        this.addCurve(points, state, plan.direction, random, true);
        return plan.direction;
      case "chicane":
        this.addChicane(points, state, plan.direction, random);
        return (plan.direction * -1) as 1 | -1;
    }
  }

  private addStraight(points: Vec2[], state: SegmentState, random: () => number): void {
    const baseLength = this.lerp(60, 160, random());
    const steps = Math.max(2, Math.round(baseLength / 40));
    const drift = (random() - 0.5) * 0.06;
    for (let i = 0; i < steps; i++) {
      state.heading += drift;
      this.advance(points, state, baseLength / steps);
    }
  }

  private addCurve(
    points: Vec2[],
    state: SegmentState,
    direction: 1 | -1,
    random: () => number,
    tight: boolean
  ): void {
    const baseRadius = tight
      ? this.lerp(this.config.minRadius * 0.4, this.config.minRadius, random())
      : this.lerp(this.config.minRadius, this.config.maxRadius * 0.8, random());
    const angleRange: [number, number] = tight ? [0.8, 1.5] : [0.35, 0.9];
    const totalTurn = this.lerp(angleRange[0], angleRange[1], random()) * direction;
    const steps = Math.max(4, Math.round(Math.abs(totalTurn) / (Math.PI / 12)));
    const arcLength = Math.abs(totalTurn) * baseRadius;
    for (let i = 0; i < steps; i++) {
      state.heading += totalTurn / steps;
      this.advance(points, state, arcLength / steps);
    }
  }

  private addChicane(
    points: Vec2[],
    state: SegmentState,
    direction: 1 | -1,
    random: () => number
  ): void {
    const firstAngle = this.lerp(0.3, 0.6, random()) * direction;
    const secondAngle = this.lerp(0.35, 0.65, random()) * (direction * -1);
    const radius = this.lerp(this.config.minRadius * 0.4, this.config.minRadius * 0.9, random());
    const straightLength = this.lerp(30, 70, random());
    this.advanceArc(points, state, firstAngle, radius, 3);
    this.advanceStraight(points, state, straightLength, 2);
    this.advanceArc(points, state, secondAngle, radius * this.lerp(0.8, 1.2, random()), 3);
  }

  private advanceArc(
    points: Vec2[],
    state: SegmentState,
    totalTurn: number,
    radius: number,
    steps: number
  ): void {
    const arcLength = Math.abs(totalTurn) * radius;
    for (let i = 0; i < steps; i++) {
      state.heading += totalTurn / steps;
      this.advance(points, state, arcLength / steps);
    }
  }

  private advanceStraight(
    points: Vec2[],
    state: SegmentState,
    length: number,
    steps: number
  ): void {
    for (let i = 0; i < steps; i++) {
      this.advance(points, state, length / steps);
    }
  }

  private advance(points: Vec2[], state: SegmentState, distance: number): void {
    state.position = {
      x: state.position.x + Math.cos(state.heading) * distance,
      z: state.position.z + Math.sin(state.heading) * distance
    };
    points.push({ ...state.position });
  }

  private closeLoop(points: Vec2[], state: SegmentState, random: () => number): void {
    const start = points[0];
    const current = state.position;
    const toStart = { x: start.x - current.x, z: start.z - current.z };
    const distance = Math.hypot(toStart.x, toStart.z);
    if (distance < 1) {
      return;
    }
    const headingToStart = Math.atan2(toStart.z, toStart.x);
    const headingDelta = this.normalizeAngle(headingToStart - state.heading);
    const arcTurn = headingDelta === 0 ? (random() > 0.5 ? 0.2 : -0.2) : headingDelta * 0.8;
    const radius = Math.max(
      this.config.minRadius * 0.5,
      Math.min(distance / Math.max(Math.abs(arcTurn), 0.3), this.config.maxRadius)
    );
    this.advanceArc(points, state, arcTurn, radius, 4);
    const remaining = Math.hypot(start.x - state.position.x, start.z - state.position.z);
    if (remaining > 0.5) {
      this.advanceStraight(points, state, remaining, 4);
    }
    points.push({ x: start.x, z: start.z });
  }

  private normalizePoints(points: Vec2[], random: () => number): Vec2[] {
    const centered = this.centerPoints(points);
    const maxDistance = centered.reduce(
      (acc, point) => Math.max(acc, Math.hypot(point.x, point.z)),
      0
    );
    const avgDistance =
      centered.reduce((acc, point) => acc + Math.hypot(point.x, point.z), 0) /
        Math.max(centered.length, 1) || 0;
    let baseScale = 1;
    if (maxDistance > this.config.maxRadius) {
      baseScale = this.config.maxRadius / maxDistance;
    } else if (avgDistance < this.config.minRadius * 0.6) {
      baseScale = (this.config.minRadius * 0.8) / Math.max(avgDistance, 0.001);
    }
    let scaleX = baseScale * (0.9 + random() * 0.3);
    let scaleZ = baseScale * (0.85 + random() * 0.4);
    const anisotropic = centered.map((point) => ({
      x: point.x * scaleX,
      z: point.z * scaleZ
    }));
    const anisotropicMax = anisotropic.reduce(
      (acc, point) => Math.max(acc, Math.hypot(point.x, point.z)),
      0
    );
    if (anisotropicMax > this.config.maxRadius) {
      const correction = this.config.maxRadius / anisotropicMax;
      scaleX *= correction;
      scaleZ *= correction;
      return centered.map((point) => ({
        x: point.x * scaleX,
        z: point.z * scaleZ
      }));
    }
    return anisotropic;
  }

  private centerPoints(points: Vec2[]): Vec2[] {
    const centroid = points.reduce(
      (acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }),
      { x: 0, z: 0 }
    );
    centroid.x /= points.length;
    centroid.z /= points.length;
    return points.map((point) => ({
      x: point.x - centroid.x,
      z: point.z - centroid.z
    }));
  }

  private resamplePoints(points: Vec2[], desiredCount: number): Vec2[] {
    if (points.length === desiredCount) {
      return points.map((point) => ({ ...point }));
    }
    const closed = [...points, { ...points[0] }];
    const distances: number[] = [0];
    let total = 0;
    for (let i = 1; i < closed.length; i++) {
      total += Math.hypot(closed[i].x - closed[i - 1].x, closed[i].z - closed[i - 1].z);
      distances.push(total);
    }
    const segmentLength = total / desiredCount;
    const result: Vec2[] = [];
    for (let i = 0; i < desiredCount; i++) {
      const target = i * segmentLength;
      let idx = 0;
      while (idx < distances.length - 1 && distances[idx + 1] < target) {
        idx++;
      }
      const start = closed[idx];
      const end = closed[idx + 1];
      const span = distances[idx + 1] - distances[idx];
      const t = span === 0 ? 0 : (target - distances[idx]) / span;
      result.push({
        x: start.x + (end.x - start.x) * t,
        z: start.z + (end.z - start.z) * t
      });
    }
    return result;
  }

  private validateTrack(points: Vec2[]): boolean {
    if (points.length < 4) {
      return false;
    }
    const area = Math.abs(this.polygonArea(points));
    const minArea = Math.PI * this.config.minRadius * this.config.minRadius * 0.2;
    if (area < minArea) {
      return false;
    }
    if (this.hasSelfIntersections(points)) {
      return false;
    }
    return true;
  }

  private polygonArea(points: Vec2[]): number {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      area += current.x * next.z - next.x * current.z;
    }
    return area / 2;
  }

  private hasSelfIntersections(points: Vec2[]): boolean {
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const a1 = points[i];
      const a2 = points[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (j === i || (j + 1) % n === i) {
          continue;
        }
        const b1 = points[j];
        const b2 = points[(j + 1) % n];
        if (this.segmentsIntersect(a1, a2, b1, b2)) {
          return true;
        }
      }
    }
    return false;
  }

  private segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
    const d1 = this.direction(a1, a2, b1);
    const d2 = this.direction(a1, a2, b2);
    const d3 = this.direction(b1, b2, a1);
    const d4 = this.direction(b1, b2, a2);
    if (d1 === 0 && this.onSegment(a1, b1, a2)) return true;
    if (d2 === 0 && this.onSegment(a1, b2, a2)) return true;
    if (d3 === 0 && this.onSegment(b1, a1, b2)) return true;
    if (d4 === 0 && this.onSegment(b1, a2, b2)) return true;
    return d1 * d2 < 0 && d3 * d4 < 0;
  }

  private direction(a: Vec2, b: Vec2, c: Vec2): number {
    return (c.z - a.z) * (b.x - a.x) - (b.z - a.z) * (c.x - a.x);
  }

  private onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
    return (
      Math.min(a.x, c.x) <= b.x &&
      b.x <= Math.max(a.x, c.x) &&
      Math.min(a.z, c.z) <= b.z &&
      b.z <= Math.max(a.z, c.z)
    );
  }

  private fallbackCircularTrack(seed: number, pointCount: number): Vec2[] {
    const random = this.createRandom(seed ^ 0x1234567);
    const points: Vec2[] = [];
    const baseAngleStep = (Math.PI * 2) / pointCount;
    const offset = random() * Math.PI * 2;
    for (let i = 0; i < pointCount; i++) {
      const jitter = (random() - 0.5) * baseAngleStep * this.clamp(this.config.angleJitter, 0, 1);
      const angle = offset + i * baseAngleStep + jitter;
      const radius = this.lerp(this.config.minRadius, this.config.maxRadius, random());
      points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
    }
    return points;
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
    const iterations = Math.max(0, passes);
    let result = points.map((p) => ({ ...p }));
    for (let pass = 0; pass < iterations; pass++) {
      result = result.map((point, index) => {
        const prev = result[(index - 1 + result.length) % result.length];
        const next = result[(index + 1) % result.length];
        return {
          x: (prev.x + point.x * 2.5 + next.x) / 4.5,
          z: (prev.z + point.z * 2.5 + next.z) / 4.5
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

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private normalizeAngle(angle: number): number {
    let adjusted = angle;
    while (adjusted > Math.PI) {
      adjusted -= Math.PI * 2;
    }
    while (adjusted < -Math.PI) {
      adjusted += Math.PI * 2;
    }
    return adjusted;
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
