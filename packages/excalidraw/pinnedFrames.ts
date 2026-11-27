// A frame pinned to the screen (#240): it keeps its screen place and size
// while the board pans and zooms under it. A pin is this viewer's view, not
// the scene: the frame stays where it is on the board for everyone else.

/** where a pinned frame's top-left sits in the editor, in screen px, and the
 * zoom it was pinned at, which keeps its size */
export type FramePin = { x: number; y: number; scale: number };

export type FramePins = Readonly<Record<string, FramePin>>;

type Box = { x: number; y: number; width: number; height: number };

type Camera = { scrollX: number; scrollY: number; zoom: { value: number } };

/** how much of a dragged pin stays on screen, so it can be grabbed again */
const KEEP_ON_SCREEN = 32;

/** pin the frame where it is drawn now */
export const pinFrameAt = (frame: Box, camera: Camera): FramePin => ({
  x: (frame.x + camera.scrollX) * camera.zoom.value,
  y: (frame.y + camera.scrollY) * camera.zoom.value,
  scale: camera.zoom.value,
});

/** where a pinned frame is drawn, in editor px */
export const pinnedBox = (pin: FramePin, frame: Box) => ({
  left: pin.x,
  top: pin.y,
  width: frame.width * pin.scale,
  height: frame.height * pin.scale,
});

/** `value` kept in [low, high]; an editor not laid out yet has no bounds */
const clamp = (value: number, low: number, high: number, size: number) =>
  size > 0 ? Math.min(Math.max(value, low), Math.max(low, high)) : value;

/** a pin dragged by `delta`, a corner of it still on screen */
export const movePin = (
  pin: FramePin,
  frame: Box,
  delta: { dx: number; dy: number },
  editor: { width: number; height: number },
): FramePin => {
  const { width, height } = pinnedBox(pin, frame);
  return {
    ...pin,
    x: clamp(
      pin.x + delta.dx,
      KEEP_ON_SCREEN - width,
      editor.width - KEEP_ON_SCREEN,
      editor.width,
    ),
    y: clamp(
      pin.y + delta.dy,
      KEEP_ON_SCREEN - height,
      editor.height - KEEP_ON_SCREEN,
      editor.height,
    ),
  };
};

/** the camera that draws the frame on the board exactly where its pin shows
 * it, so unpinning drops it in place */
export const cameraToDropPin = (pin: FramePin, frame: Box) => ({
  scrollX: pin.x / pin.scale - frame.x,
  scrollY: pin.y / pin.scale - frame.y,
  zoom: { value: pin.scale },
});

export const withoutPin = (pins: FramePins, id: string): FramePins => {
  const { [id]: _gone, ...rest } = pins;
  return rest;
};
