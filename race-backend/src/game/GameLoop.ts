import { performance } from "node:perf_hooks";
import { STATE_BROADCAST_RATE, TICK_RATE } from "../config";
import { RoomState } from "../types/trackTypes";
import { RoomManager } from "./RoomManager";

export class GameLoop {
  private loopHandle?: NodeJS.Timeout | NodeJS.Immediate;
  private usingImmediate = false;
  private running = false;

  constructor(
    private readonly roomManager: RoomManager,
    private readonly broadcastFn: (roomId: string, state: RoomState) => void
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    const tickMs = 1000 / TICK_RATE;
    const broadcastMs = 1000 / STATE_BROADCAST_RATE;
    const dt = 1 / TICK_RATE;

    const getTimeMs = (): number => {
      if (typeof performance?.now === "function") {
        return performance.now();
      }
      const [seconds, nanoseconds] = process.hrtime();
      return seconds * 1000 + nanoseconds / 1_000_000;
    };

    let lastTime = getTimeMs();
    let accumulator = 0;
    let broadcastAccumulator = 0;

    const runLoop = () => {
      this.loopHandle = undefined;
      const now = getTimeMs();
      accumulator += now - lastTime;
      lastTime = now;

      while (accumulator >= tickMs) {
        accumulator -= tickMs;
        broadcastAccumulator += tickMs;
        for (const room of this.roomManager.getRooms()) {
          room.update(dt);
        }

        while (broadcastAccumulator >= broadcastMs) {
          broadcastAccumulator -= broadcastMs;
          for (const room of this.roomManager.getRooms()) {
            const state = room.toRoomState();
            this.broadcastFn(room.roomId, state);
          }
        }
      }

      if (this.running) {
        this.scheduleNext(runLoop);
      }
    };

    this.scheduleNext(runLoop);
  }

  stop(): void {
    this.running = false;

    if (this.loopHandle) {
      if (this.usingImmediate && typeof clearImmediate === "function") {
        clearImmediate(this.loopHandle as NodeJS.Immediate);
      } else {
        clearTimeout(this.loopHandle as NodeJS.Timeout);
      }
      this.loopHandle = undefined;
    }
  }

  private scheduleNext(callback: () => void): void {
    if (typeof setImmediate === "function") {
      this.loopHandle = setImmediate(callback);
      this.usingImmediate = true;
      return;
    }

    this.loopHandle = setTimeout(callback, 0);
    this.usingImmediate = false;
  }
}
