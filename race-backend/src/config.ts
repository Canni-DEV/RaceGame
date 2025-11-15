export const PORT = 4000;
export const TICK_RATE = 60; // ticks per second
export const STATE_BROADCAST_RATE = 20; // snapshots per second
export const MAX_PLAYERS_PER_ROOM = 8;

// Physics configuration
export const MAX_SPEED = 40; // units per second
export const ACCELERATION = 30; // units per second^2
export const BRAKE_DECELERATION = 50; // units per second^2
export const FRICTION = 10; // passive deceleration per second
export const STEER_SENSITIVITY = 2.5; // radians per second at full steer and 1 unit of normalized speed

export const DEFAULT_ROOM_PREFIX = "room";
