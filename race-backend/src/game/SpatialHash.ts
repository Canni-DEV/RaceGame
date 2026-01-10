const MIN_CELL_SIZE = 0.0001;

interface SpatialHashCell {
  key: string;
  x: number;
  z: number;
  indices: number[];
}

export class SpatialHash {
  private cellSize: number;
  private readonly cells = new Map<string, SpatialHashCell>();
  private readonly occupied: SpatialHashCell[] = [];
  private readonly pool: SpatialHashCell[] = [];

  constructor(cellSize: number) {
    this.cellSize = this.normalizeCellSize(cellSize);
  }

  reset(cellSize?: number): void {
    if (cellSize !== undefined) {
      const normalized = this.normalizeCellSize(cellSize);
      if (normalized !== this.cellSize) {
        this.cellSize = normalized;
        this.clear();
        return;
      }
    }
    this.clear();
  }

  insert(index: number, x: number, z: number): void {
    const cellX = Math.floor(x / this.cellSize);
    const cellZ = Math.floor(z / this.cellSize);
    const key = `${cellX},${cellZ}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = this.pool.pop() ?? { key, x: cellX, z: cellZ, indices: [] };
      cell.key = key;
      cell.x = cellX;
      cell.z = cellZ;
      cell.indices.length = 0;
      this.cells.set(key, cell);
      this.occupied.push(cell);
    }
    cell.indices.push(index);
  }

  queryIndices(x: number, z: number, radius: number, out: number[]): void {
    out.length = 0;
    if (radius < 0) {
      return;
    }
    const range = Math.ceil(radius / this.cellSize);
    const cellX = Math.floor(x / this.cellSize);
    const cellZ = Math.floor(z / this.cellSize);

    for (let dz = -range; dz <= range; dz++) {
      for (let dx = -range; dx <= range; dx++) {
        const key = `${cellX + dx},${cellZ + dz}`;
        const cell = this.cells.get(key);
        if (!cell) {
          continue;
        }
        out.push(...cell.indices);
      }
    }

    if (out.length > 1) {
      out.sort((a, b) => a - b);
    }
  }

  private clear(): void {
    for (const cell of this.occupied) {
      cell.indices.length = 0;
      this.cells.delete(cell.key);
      this.pool.push(cell);
    }
    this.occupied.length = 0;
  }

  private normalizeCellSize(cellSize: number): number {
    return Math.max(MIN_CELL_SIZE, cellSize);
  }
}
