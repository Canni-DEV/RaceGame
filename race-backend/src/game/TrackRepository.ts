import { TrackData, Vec2 } from "../types/trackTypes";

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

const DEFAULT_TRACK: TrackData = {
  id: "sample-track",
  seed: 1337,
  width: 30,
  centerline: SAMPLE_CENTERLINE
};

export class TrackRepository {
  private tracks = new Map<string, TrackData>([[DEFAULT_TRACK.id, DEFAULT_TRACK]]);

  getDefaultTrack(): TrackData {
    return this.cloneTrack(DEFAULT_TRACK);
  }

  getTrackById(id: string): TrackData | undefined {
    const track = this.tracks.get(id);
    return track ? this.cloneTrack(track) : undefined;
  }

  private cloneTrack(track: TrackData): TrackData {
    return {
      ...track,
      centerline: track.centerline.map((point) => ({ ...point }))
    };
  }
}

export const trackRepository = new TrackRepository();
