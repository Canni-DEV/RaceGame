import { STATE_BROADCAST_RATE, TICK_RATE } from "../config";
import { RoomState } from "../types/trackTypes";
import { RoomManager } from "./RoomManager";

export class GameLoop {
  private tickInterval?: NodeJS.Timeout;
  private broadcastInterval?: NodeJS.Timeout;

  constructor(
    private readonly roomManager: RoomManager,
    private readonly broadcastFn: (roomId: string, state: RoomState) => void
  ) {}

  start(): void {
    if (this.tickInterval || this.broadcastInterval) {
      return;
    }

    const tickMs = 1000 / TICK_RATE;
    const broadcastMs = 1000 / STATE_BROADCAST_RATE;

    this.tickInterval = setInterval(() => {
      const dt = 1 / TICK_RATE;
      for (const room of this.roomManager.getRooms()) {
        room.update(dt);
      }
    }, tickMs);

    this.broadcastInterval = setInterval(() => {
      for (const room of this.roomManager.getRooms()) {
        const state = room.toRoomState();
        this.broadcastFn(room.roomId, state);
      }
    }, broadcastMs);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = undefined;
    }
  }
}
