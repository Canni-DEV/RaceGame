# Car model assets

Place your preferred GLB/GLTF assets in this folder. The front-end loader expects a file named `car.glb` by default, but you can update the path via the `CarModelLoader` constructor or the `VITE_CAR_MODEL_URL` environment variable if desired.

# Room model assets

The scene decorator looks for `room.glb` by default (configurable via `VITE_ROOM_MODEL_URL`). You can position and scale it with `VITE_ROOM_MODEL_OFFSET_X`, `VITE_ROOM_MODEL_OFFSET_Y`, `VITE_ROOM_MODEL_OFFSET_Z`, and `VITE_ROOM_MODEL_SCALE`.

Use `VITE_GROUND_PLANE_MARGIN` to expand the ground plane beyond the track bounds.
