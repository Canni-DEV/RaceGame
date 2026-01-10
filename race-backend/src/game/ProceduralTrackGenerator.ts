import { TrackData, Vec2 } from "../types/trackTypes";
import { planAssetDecorations } from "./TrackAssetPlanner";
import { planTrackItems } from "./TrackItemPlanner";

interface GridCell {
  x: number;
  y: number;
}

interface Direction {
  dx: number;
  dy: number;
}

const CARDINAL_DIRECTIONS: Direction[] = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 }
];

export interface ProceduralTrackConfig {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  targetCoverage: number;
  minLoopLength: number;
  maxAttempts: number;
  directionBias: number;
  turnBias: number;
  smoothingPasses: number;
  cornerSubdivisions: number;
  cornerRoundness: number;
  widthRange: [number, number];
  treeDensity: number;
  treeMinDistanceFactor: number;
  treeMaxDistanceFactor: number;
  startStraightMinCells: number;
  startStraightMaxCells: number;
}

export class ProceduralTrackGenerator {
  constructor(private readonly config: ProceduralTrackConfig) {}

  generate(seed: number): TrackData {
    const random = this.createRandom(seed);
    const loopCells = this.buildGridLoop(random);
    const basePoints = this.cellsToPoints(loopCells);
    const rounded = this.roundCorners(basePoints, this.config.cornerSubdivisions, this.config.cornerRoundness);
    const smoothed = this.smoothPoints(rounded, this.config.smoothingPasses);
    const oriented = this.alignToStartingStraight(smoothed);
    const width = this.lerp(this.config.widthRange[0], this.config.widthRange[1], random());
    const decorations = planAssetDecorations(oriented, width, seed);
    const itemSpawns = planTrackItems(oriented, width, seed);

    return {
      id: `procedural-${seed}`,
      seed,
      width,
      centerline: oriented,
      itemSpawns,
      decorations
    };
  }

  private buildGridLoop(random: () => number): GridCell[] {
    const totalCells = this.config.gridWidth * this.config.gridHeight;
    const targetCells = Math.min(
      totalCells,
      Math.max(this.config.minLoopLength, Math.floor(totalCells * this.config.targetCoverage))
    );

    let bestPath: GridCell[] = [];
    let longestAttempt: GridCell[] = [];

    for (let attempt = 0; attempt < this.config.maxAttempts; attempt++) {
      const { path: straightStart, direction: straightDirection } = this.buildStartingStraight(random);
      const start = straightStart[0];
      const visited = new Set<string>(straightStart.map((cell) => this.cellKey(cell)));
      const path: GridCell[] = [...straightStart];
      let lastDirection = straightDirection;

      for (let step = 0; step < totalCells * 3; step++) {
        const current = path[path.length - 1];
        const closableToStart = path.length >= this.config.minLoopLength && this.areNeighbors(current, start);

        if (visited.size >= targetCells && closableToStart) {
          return path;
        }

        const neighborDirections = this.getNeighborDirections(current);
        const options = neighborDirections
          .map((neighborDir) => ({
            cell: neighborDir.cell,
            direction: neighborDir.direction,
            visited: visited.has(this.cellKey(neighborDir.cell)),
            isStart: this.sameCell(neighborDir.cell, start),
            closableToStart
          }))
          .filter(
            (candidate) =>
              this.isInside(candidate.cell) && (!candidate.visited || (candidate.isStart && candidate.closableToStart))
          );

        const unvisitedOptions = options.filter((candidate) => !candidate.visited);
        const candidates = unvisitedOptions.length > 0 ? unvisitedOptions : options;

        if (candidates.length === 0) {
          if (closableToStart) {
            return path;
          }
          break;
        }

        const weighted = candidates.map((candidate) => ({
          candidate,
          weight: this.scoreCandidate(candidate, lastDirection, random)
        }));
        const selection = this.pickWeighted(weighted, random);

        path.push(selection.cell);
        visited.add(this.cellKey(selection.cell));
        lastDirection = selection.direction;
      }

      if (path.length > longestAttempt.length) {
        longestAttempt = path;
      }

      if (path.length > bestPath.length && this.areNeighbors(path[path.length - 1], path[0])) {
        bestPath = path;
      }
    }

    if (bestPath.length === 0) {
      bestPath = longestAttempt;
    }

    if (bestPath.length === 0) {
      const { path } = this.buildStartingStraight(random);
      const fallbackNeighbor = this.getNeighborDirections(path[0]).find((option) => this.isInside(option.cell));
      bestPath = fallbackNeighbor ? [...path, fallbackNeighbor.cell] : path;
    }

    return this.forceClosure(bestPath);
  }

  private buildStartingStraight(random: () => number): { path: GridCell[]; direction: Direction } {
    const direction = this.randomDirection(random);
    const length = this.pickStraightLength(direction, random);
    const start = this.pickStartForStraight(random, direction, length);

    const path: GridCell[] = [];
    for (let i = 0; i < length; i++) {
      path.push({
        x: start.x + direction.dx * i,
        y: start.y + direction.dy * i
      });
    }

    return { path, direction };
  }

  private pickStraightLength(direction: Direction, random: () => number): number {
    const axisLimit = direction.dx !== 0 ? this.config.gridWidth : this.config.gridHeight;
    const min = Math.max(2, Math.min(this.config.startStraightMinCells, axisLimit));
    const max = Math.max(min, Math.min(this.config.startStraightMaxCells, axisLimit));
    return this.randomInt(random, min, max);
  }

  private pickStartForStraight(random: () => number, direction: Direction, length: number): GridCell {
    const biasX = Math.floor(this.config.gridWidth / 3);
    const biasY = Math.floor(this.config.gridHeight / 3);

    const [minX, maxX] = this.computeStartRange(direction.dx, length, this.config.gridWidth);
    const [minY, maxY] = this.computeStartRange(direction.dy, length, this.config.gridHeight);

    const startX = this.pickBiasedCoordinate(random, minX, maxX, biasX, this.config.gridWidth - biasX - 1);
    const startY = this.pickBiasedCoordinate(random, minY, maxY, biasY, this.config.gridHeight - biasY - 1);

    return { x: startX, y: startY };
  }

  private computeStartRange(delta: number, length: number, limit: number): [number, number] {
    if (delta > 0) {
      return [0, Math.max(0, limit - length)];
    }
    if (delta < 0) {
      return [length - 1, limit - 1];
    }
    return [0, limit - 1];
  }

  private pickBiasedCoordinate(
    random: () => number,
    min: number,
    max: number,
    biasMin: number,
    biasMax: number
  ): number {
    const clampedMin = Math.max(0, min);
    const clampedMax = Math.max(clampedMin, max);
    const preferredMin = Math.max(clampedMin, biasMin);
    const preferredMax = Math.min(clampedMax, biasMax);

    if (preferredMin <= preferredMax) {
      return this.randomInt(random, preferredMin, preferredMax);
    }

    return this.randomInt(random, clampedMin, clampedMax);
  }

  private randomDirection(random: () => number): Direction {
    return CARDINAL_DIRECTIONS[this.randomInt(random, 0, CARDINAL_DIRECTIONS.length - 1)];
  }

  private getNeighborDirections(cell: GridCell): { cell: GridCell; direction: Direction }[] {
    return [
      { cell: { x: cell.x + 1, y: cell.y }, direction: { dx: 1, dy: 0 } },
      { cell: { x: cell.x - 1, y: cell.y }, direction: { dx: -1, dy: 0 } },
      { cell: { x: cell.x, y: cell.y + 1 }, direction: { dx: 0, dy: 1 } },
      { cell: { x: cell.x, y: cell.y - 1 }, direction: { dx: 0, dy: -1 } }
    ];
  }

  private scoreCandidate(
    candidate: { cell: GridCell; direction: Direction; visited: boolean },
    lastDirection: Direction,
    random: () => number
  ): number {
    const directionAlignment = candidate.direction.dx === lastDirection.dx && candidate.direction.dy === lastDirection.dy;
    const centerX = (this.config.gridWidth - 1) / 2;
    const centerY = (this.config.gridHeight - 1) / 2;
    const distanceFromCenter = Math.hypot(candidate.cell.x - centerX, candidate.cell.y - centerY);
    const radius = Math.max(centerX, centerY, 1);

    let weight = 1 + random() * 0.25;
    weight += directionAlignment ? this.config.directionBias : this.config.turnBias;
    weight += (distanceFromCenter / radius) * 0.35;
    if (candidate.visited) {
      weight *= 0.25;
    }

    return Math.max(weight, 0.01);
  }

  private pickWeighted(
    weightedCandidates: { candidate: { cell: GridCell; direction: Direction }; weight: number }[],
    random: () => number
  ): { cell: GridCell; direction: Direction } {
    const totalWeight = weightedCandidates.reduce((sum, item) => sum + item.weight, 0);
    let roll = random() * totalWeight;
    for (const item of weightedCandidates) {
      roll -= item.weight;
      if (roll <= 0) {
        return item.candidate;
      }
    }
    return weightedCandidates[weightedCandidates.length - 1].candidate;
  }

  private cellsToPoints(cells: GridCell[]): Vec2[] {
    const offsetX = (this.config.gridWidth - 1) / 2;
    const offsetY = (this.config.gridHeight - 1) / 2;
    return cells.map((cell) => ({
      x: (cell.x - offsetX) * this.config.cellSize,
      z: (cell.y - offsetY) * this.config.cellSize
    }));
  }

  private roundCorners(points: Vec2[], passes: number, roundness: number): Vec2[] {
    let current = points;
    for (let i = 0; i < passes; i++) {
      const next: Vec2[] = [];
      for (let j = 0; j < current.length; j++) {
        const a = current[j];
        const b = current[(j + 1) % current.length];
        const q = this.mix(a, b, roundness);
        const r = this.mix(a, b, 1 - roundness);
        next.push(q, r);
      }
      current = next;
    }
    return current;
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

  private alignToStartingStraight(points: Vec2[]): Vec2[] {
    if (points.length < 2) {
      return points;
    }

    const segmentDirections = points.map((point, index) => {
      const next = points[(index + 1) % points.length];
      return this.normalizeVector({ x: next.x - point.x, z: next.z - point.z });
    });

    const segmentLengths = points.map((point, index) =>
      this.distance(point, points[(index + 1) % points.length])
    );

    let bestStart = 0;
    let bestLength = -Infinity;
    const angleTolerance = 0.18; // ~10 degrees tolerance to consider segments part of the same straight

    for (let start = 0; start < segmentDirections.length; start++) {
      const baseDir = segmentDirections[start];
      if (!this.isNonZeroVector(baseDir)) {
        continue;
      }

      let totalLength = 0;
      for (let offset = 0; offset < segmentDirections.length; offset++) {
        const index = (start + offset) % segmentDirections.length;
        const direction = segmentDirections[index];
        if (!this.isNonZeroVector(direction)) {
          break;
        }

        const angleDiff = this.angleBetween(baseDir, direction);
        if (!Number.isFinite(angleDiff) || angleDiff > angleTolerance) {
          break;
        }

        totalLength += segmentLengths[index];
      }

      if (totalLength > bestLength) {
        bestLength = totalLength;
        bestStart = start;
      }
    }

    const minimumStraightLength = this.config.cellSize * Math.max(1, this.config.startStraightMinCells - 1);
    if (bestLength < minimumStraightLength) {
      return points;
    }

    return this.rotatePoints(points, bestStart);
  }

  private randomInt(random: () => number, min: number, max: number): number {
    return Math.floor(random() * (max - min + 1)) + min;
  }

  private lerp(min: number, max: number, t: number): number {
    return min + (max - min) * t;
  }

  private mix(a: Vec2, b: Vec2, t: number): Vec2 {
    return {
      x: a.x * (1 - t) + b.x * t,
      z: a.z * (1 - t) + b.z * t
    };
  }

  private rotatePoints(points: Vec2[], startIndex: number): Vec2[] {
    if (points.length === 0 || startIndex % points.length === 0) {
      return points;
    }

    const rotated: Vec2[] = [];
    for (let i = 0; i < points.length; i++) {
      rotated.push(points[(startIndex + i) % points.length]);
    }
    return rotated;
  }

  private angleBetween(a: Vec2, b: Vec2): number {
    const dot = a.x * b.x + a.z * b.z;
    const det = a.x * b.z - a.z * b.x;
    return Math.abs(Math.atan2(det, dot));
  }

  private distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private normalizeVector(vec: Vec2): Vec2 {
    const length = Math.hypot(vec.x, vec.z);
    if (length === 0) {
      return { x: 0, z: 0 };
    }
    return { x: vec.x / length, z: vec.z / length };
  }

  private isNonZeroVector(vec: Vec2): boolean {
    return Number.isFinite(vec.x) && Number.isFinite(vec.z) && Math.abs(vec.x) + Math.abs(vec.z) > 0;
  }

  private areNeighbors(a: GridCell, b: GridCell): boolean {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
  }

  private sameCell(a: GridCell, b: GridCell): boolean {
    return a.x === b.x && a.y === b.y;
  }

  private isInside(cell: GridCell): boolean {
    return (
      cell.x >= 0 &&
      cell.y >= 0 &&
      cell.x < this.config.gridWidth &&
      cell.y < this.config.gridHeight
    );
  }

  private cellKey(cell: GridCell): string {
    return `${cell.x},${cell.y}`;
  }

  private forceClosure(path: GridCell[]): GridCell[] {
    if (path.length === 0) {
      return path;
    }

    const closedPath = [...path];
    const start = closedPath[0];
    let guard = 0;

    while (!this.areNeighbors(closedPath[closedPath.length - 1], start) && guard < this.config.gridWidth + this.config.gridHeight) {
      const last = closedPath[closedPath.length - 1];
      const step: GridCell = {
        x: last.x + Math.sign(start.x - last.x),
        y: last.y + Math.sign(start.y - last.y)
      };

      if (this.sameCell(step, last)) {
        break;
      }

      if (!this.isInside(step)) {
        break;
      }

      closedPath.push(step);
      guard++;
    }

    return closedPath;
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
