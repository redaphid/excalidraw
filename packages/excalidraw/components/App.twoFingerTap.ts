/** a two-finger tap is both fingers down and up within this long */
export const TWO_FINGER_TAP_MAX_DURATION = 250; // ms
/** a finger that travels farther than this is a pinch or pan, not a tap */
export const TWO_FINGER_TAP_MAX_TRAVEL = 10; // px
/** the second tap must land within this long of the first tap's lift */
export const TWO_FINGER_DOUBLE_TAP_MAX_GAP = 350; // ms
/** a touchdown this old whose fingers are not all heard lifting is dropped
 * when the next finger lands, so a lost lift cannot wedge the recogniser */
const STALE_TOUCHDOWN_AGE = 1000; // ms

type Contact = { startX: number; startY: number };

/**
 * One contact: the span from the first finger down to the last finger up.
 * `spoiled` once it can no longer be a tap (a finger travelled, a third
 * finger landed, or the browser cancelled a pointer).
 */
type Touchdown = {
  startTime: number;
  fingers: Map<number, Contact>;
  peakFingers: number;
  spoiled: boolean;
};

/**
 * Recognises a double two-finger tap from touch pointer events. Feed it
 * every touch pointer down, move, up and cancel on the canvas. `down` returns
 * true when the contact could be the first tap of a double tap; `up` returns
 * true on the lift that completes the second tap.
 */
export class TwoFingerDoubleTap {
  private touchdown: Touchdown | null = null;
  /** when the last clean two-finger tap lifted, while a second may follow */
  private lastTapEnd: number | null = null;

  down(pointerId: number, x: number, y: number, time: number): boolean {
    let startsSequence = false;
    if (
      this.touchdown &&
      time - this.touchdown.startTime > STALE_TOUCHDOWN_AGE
    ) {
      this.touchdown = null;
      this.lastTapEnd = null;
    }
    if (!this.touchdown) {
      if (
        this.lastTapEnd !== null &&
        time - this.lastTapEnd > TWO_FINGER_DOUBLE_TAP_MAX_GAP
      ) {
        this.lastTapEnd = null;
      }
      startsSequence = this.lastTapEnd === null;
      this.touchdown = {
        startTime: time,
        fingers: new Map(),
        peakFingers: 0,
        spoiled: false,
      };
    }
    const touchdown = this.touchdown;
    touchdown.fingers.set(pointerId, { startX: x, startY: y });
    touchdown.peakFingers = Math.max(
      touchdown.peakFingers,
      touchdown.fingers.size,
    );
    if (touchdown.peakFingers > 2) {
      touchdown.spoiled = true;
    }
    return startsSequence;
  }

  move(pointerId: number, x: number, y: number) {
    const contact = this.touchdown?.fingers.get(pointerId);
    if (
      contact &&
      Math.hypot(x - contact.startX, y - contact.startY) >
        TWO_FINGER_TAP_MAX_TRAVEL
    ) {
      this.touchdown!.spoiled = true;
    }
  }

  up(pointerId: number, time: number): boolean {
    const touchdown = this.touchdown;
    if (!touchdown || !touchdown.fingers.delete(pointerId)) {
      return false;
    }
    if (touchdown.fingers.size > 0) {
      return false;
    }
    this.touchdown = null;

    const isTap =
      !touchdown.spoiled &&
      touchdown.peakFingers === 2 &&
      time - touchdown.startTime <= TWO_FINGER_TAP_MAX_DURATION;
    if (!isTap) {
      this.lastTapEnd = null;
      return false;
    }
    if (
      this.lastTapEnd !== null &&
      touchdown.startTime - this.lastTapEnd <= TWO_FINGER_DOUBLE_TAP_MAX_GAP
    ) {
      this.lastTapEnd = null;
      return true;
    }
    this.lastTapEnd = time;
    return false;
  }

  cancel(pointerId: number) {
    const touchdown = this.touchdown;
    if (!touchdown || !touchdown.fingers.delete(pointerId)) {
      return;
    }
    touchdown.spoiled = true;
    if (touchdown.fingers.size === 0) {
      this.touchdown = null;
      this.lastTapEnd = null;
    }
  }
}
