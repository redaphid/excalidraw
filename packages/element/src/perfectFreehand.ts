/**
 * perfect-freehand 1.2.0, https://github.com/steveruizok/perfect-freehand
 * (packages/perfect-freehand/src at v1.2.0, merged into one file).
 *
 * Changed for deep zoom, where a stroke and its pen are fractions of a unit:
 * - The radius floor is 1e-9, not 0.01, so lines keep getting finer.
 * - Points within 3 units of a stroke's end are skipped to round off its
 *   cap only for a pen of size 4.25 (Excalidraw's thinnest at 1x) or
 *   larger; the distance scales down with a smaller pen, so a stroke
 *   shorter than 3 units keeps its body.
 * - The two passes are split into steps, so `IncrementalStroke` can resume
 *   them on a stroke that grows while it is drawn.
 *
 * MIT License
 *
 * Copyright (c) 2021 Stephen Ruiz Ltd
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * The options object for `getStroke` or `getStrokePoints`.
 * @param points An array of points (as `[x, y, pressure]` or `{x, y, pressure}`). Pressure is optional in both cases.
 * @param options (optional) An object with options.
 * @param options.size	The base size (diameter) of the stroke.
 * @param options.thinning The effect of pressure on the stroke's size.
 * @param options.smoothing	How much to soften the stroke's edges.
 * @param options.easing	An easing function to apply to each point's pressure.
 * @param options.simulatePressure Whether to simulate pressure based on velocity.
 * @param options.start Cap, taper and easing for the start of the line.
 * @param options.end Cap, taper and easing for the end of the line.
 * @param options.last Whether to handle the points as a completed stroke.
 */
export interface StrokeOptions {
  size?: number;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  easing?: (pressure: number) => number;
  simulatePressure?: boolean;
  start?: {
    cap?: boolean;
    taper?: number | boolean;
    easing?: (distance: number) => number;
  };
  end?: {
    cap?: boolean;
    taper?: number | boolean;
    easing?: (distance: number) => number;
  };
  // Whether to handle the points as a completed stroke.
  last?: boolean;
}

/**
 * The points returned by `getStrokePoints`, and the input for `getStrokeOutlinePoints`.
 */
export interface StrokePoint {
  point: number[];
  pressure: number;
  distance: number;
  vector: number[];
  runningLength: number;
}

/**
 * Negate a vector.
 * @param A
 * @internal
 */
function neg(A: number[]) {
  return [-A[0], -A[1]];
}

/**
 * Add vectors.
 * @param A
 * @param B
 * @internal
 */
function add(A: number[], B: number[]) {
  return [A[0] + B[0], A[1] + B[1]];
}

/**
 * Subtract vectors.
 * @param A
 * @param B
 * @internal
 */
function sub(A: number[], B: number[]) {
  return [A[0] - B[0], A[1] - B[1]];
}

/**
 * Vector multiplication by scalar
 * @param A
 * @param n
 * @internal
 */
function mul(A: number[], n: number) {
  return [A[0] * n, A[1] * n];
}

/**
 * Vector division by scalar.
 * @param A
 * @param n
 * @internal
 */
function div(A: number[], n: number) {
  return [A[0] / n, A[1] / n];
}

/**
 * Perpendicular rotation of a vector A
 * @param A
 * @internal
 */
function per(A: number[]) {
  return [A[1], -A[0]];
}

/**
 * Dot product
 * @param A
 * @param B
 * @internal
 */
function dpr(A: number[], B: number[]) {
  return A[0] * B[0] + A[1] * B[1];
}

/**
 * Get whether two vectors are equal.
 * @param A
 * @param B
 * @internal
 */
function isEqual(A: number[], B: number[]) {
  return A[0] === B[0] && A[1] === B[1];
}

/**
 * Length of the vector
 * @param A
 * @internal
 */
function len(A: number[]) {
  return Math.hypot(A[0], A[1]);
}

/**
 * Length of the vector squared
 * @param A
 * @internal
 */
function len2(A: number[]) {
  return A[0] * A[0] + A[1] * A[1];
}

/**
 * Dist length from A to B squared.
 * @param A
 * @param B
 * @internal
 */
function dist2(A: number[], B: number[]) {
  return len2(sub(A, B));
}

/**
 * Get normalized / unit vector.
 * @param A
 * @internal
 */
function uni(A: number[]) {
  return div(A, len(A));
}

/**
 * Dist length from A to B
 * @param A
 * @param B
 * @internal
 */
function dist(A: number[], B: number[]) {
  return Math.hypot(A[1] - B[1], A[0] - B[0]);
}

/**
 * Rotate a vector around another vector by r (radians)
 * @param A vector
 * @param C center
 * @param r rotation in radians
 * @internal
 */
function rotAround(A: number[], C: number[], r: number) {
  const s = Math.sin(r);
  const c = Math.cos(r);

  const px = A[0] - C[0];
  const py = A[1] - C[1];

  const nx = px * c - py * s;
  const ny = px * s + py * c;

  return [nx + C[0], ny + C[1]];
}

/**
 * Interpolate vector A to B with a scalar t
 * @param A
 * @param B
 * @param t scalar
 * @internal
 */
function lrp(A: number[], B: number[], t: number) {
  return add(A, mul(sub(B, A), t));
}

/**
 * Project a point A in the direction B by a scalar c
 * @param A
 * @param B
 * @param c
 * @internal
 */
function prj(A: number[], B: number[], c: number) {
  return add(A, mul(B, c));
}

/**
 * Compute a radius based on the pressure.
 * @param size
 * @param thinning
 * @param pressure
 * @param easing
 * @internal
 */
function getStrokeRadius(
  size: number,
  thinning: number,
  pressure: number,
  easing: (t: number) => number = (t) => t,
) {
  return size * easing(0.5 - thinning * (0.5 - pressure));
}

/**
 * The state of `getStrokePoints` after reading some inputs, none of them the
 * last: streamline only ever looks back, so these stroke points stay put as
 * the stroke grows.
 * @internal
 */
type StrokePointsState = {
  strokePoints: StrokePoint[];
  prev: StrokePoint;
  runningLength: number;
  hasReachedMinimumLength: boolean;
};

function startStrokePoints(first: number[]): StrokePointsState {
  const start: StrokePoint = {
    point: [first[0], first[1]],
    pressure: first[2] >= 0 ? first[2] : 0.25,
    vector: [1, 1],
    distance: 0,
    runningLength: 0,
  };
  return {
    strokePoints: [start],
    prev: start,
    runningLength: 0,
    hasReachedMinimumLength: false,
  };
}

/**
 * Read an input point that is not the last one.
 * @internal
 */
function addStrokePoint(
  state: StrokePointsState,
  input: number[],
  t: number,
  size: number,
) {
  const { prev } = state;

  // Using the t calculated from the streamline option, interpolate a new
  // point between the previous point the current point.
  const point = lrp(prev.point, input, t);

  // If the new point is the same as the previous point, skip ahead.
  if (isEqual(prev.point, point)) {
    return;
  }

  // How far is the new point from the previous point?
  const distance = dist(point, prev.point);

  // Add this distance to the total "running length" of the line.
  state.runningLength += distance;

  // At the start of the line, we wait until the new point is a
  // certain distance away from the original point, to avoid noise
  if (!state.hasReachedMinimumLength) {
    if (state.runningLength < size) {
      return;
    }
    state.hasReachedMinimumLength = true;
    // TODO: Backfill the missing points so that tapering works correctly.
  }

  // Create a new strokepoint (it will be the new "previous" one).
  state.prev = {
    // The adjusted point
    point,
    // The input pressure (or .5 if not specified)
    pressure: input[2] >= 0 ? input[2] : 0.5,
    // The vector from the current point to the previous point
    vector: uni(sub(prev.point, point)),
    // The distance between the current point and the previous point
    distance,
    // The total distance so far
    runningLength: state.runningLength,
  };

  // Push it to the strokePoints array.
  state.strokePoints.push(state.prev);
}

/**
 * The stroke point of the last input, which never waits for the minimum
 * length, and is the input itself for a completed stroke.
 * @internal
 */
function getLastStrokePoint(
  state: StrokePointsState,
  input: number[],
  t: number,
  isComplete: boolean,
): StrokePoint | undefined {
  const { prev } = state;

  const point = isComplete ? input.slice(0, 2) : lrp(prev.point, input, t);

  if (isEqual(prev.point, point)) {
    return undefined;
  }

  const distance = dist(point, prev.point);

  return {
    point,
    pressure: input[2] >= 0 ? input[2] : 0.5,
    vector: uni(sub(prev.point, point)),
    distance,
    runningLength: state.runningLength + distance,
  };
}

function finishStrokePoints(
  state: StrokePointsState,
  last: StrokePoint | undefined,
): StrokePoint[] {
  const strokePoints = last
    ? state.strokePoints.concat([last])
    : state.strokePoints.slice();

  // Set the vector of the first point to be the same as the second point.
  strokePoints[0] = {
    ...strokePoints[0],
    vector: strokePoints[1]?.vector || [0, 0],
  };

  return strokePoints;
}

/**
 * ## getStrokePoints
 * @description Get an array of points as objects with an adjusted point, pressure, vector, distance, and runningLength.
 * @param points An array of points (as `[x, y, pressure]` or `{x, y, pressure}`). Pressure is optional in both cases.
 * @param options (optional) An object with options.
 * @param options.size	The base size (diameter) of the stroke.
 * @param options.thinning The effect of pressure on the stroke's size.
 * @param options.smoothing	How much to soften the stroke's edges.
 * @param options.easing	An easing function to apply to each point's pressure.
 * @param options.simulatePressure Whether to simulate pressure based on velocity.
 * @param options.start Cap, taper and easing for the start of the line.
 * @param options.end Cap, taper and easing for the end of the line.
 * @param options.last Whether to handle the points as a completed stroke.
 */
export function getStrokePoints<
  T extends number[],
  K extends { x: number; y: number; pressure?: number },
>(points: (T | K)[], options = {} as StrokeOptions): StrokePoint[] {
  const { streamline = 0.5, size = 16, last: isComplete = false } = options;

  // If we don't have any points, return an empty array.
  if (points.length === 0) {
    return [];
  }

  // Find the interpolation level between points.
  const t = 0.15 + (1 - streamline) * 0.85;

  // Whatever the input is, make sure that the points are in number[][].
  let pts = Array.isArray(points[0])
    ? (points as T[])
    : (points as K[]).map(({ x, y, pressure = 0.5 }) => [x, y, pressure]);

  // Add extra points between the two, to help avoid "dash" lines
  // for strokes with tapered start and ends. Don't mutate the
  // input array!
  if (pts.length === 2) {
    const last = pts[1];
    pts = pts.slice(0, -1);
    for (let i = 1; i < 5; i++) {
      pts.push(lrp(pts[0], last, i / 4));
    }
  }

  // If there's only one point, add another point at a 1pt offset.
  // Don't mutate the input array!
  if (pts.length === 1) {
    pts = [...pts, [...add(pts[0], [1, 1]), ...pts[0].slice(2)]];
  }

  const state = startStrokePoints(pts[0]);

  const max = pts.length - 1;

  for (let i = 1; i < max; i++) {
    addStrokePoint(state, pts[i], t, size);
  }

  return finishStrokePoints(
    state,
    getLastStrokePoint(state, pts[max], t, isComplete),
  );
}

const { min, PI } = Math;

// This is the rate of change for simulated pressure. It could be an option.
const RATE_OF_PRESSURE_CHANGE = 0.275;

// Browser strokes seem to be off if PI is regular, a tiny offset seems to fix it
const FIXED_PI = PI + 0.0001;

/**
 * The options of `getStrokeOutlinePoints` resolved for one stroke.
 * @internal
 */
type OutlineSettings = {
  size: number;
  thinning: number;
  simulatePressure: boolean;
  easing: (t: number) => number;
  capStart: boolean;
  capEnd: boolean;
  taperStartEase: (t: number) => number;
  taperEndEase: (t: number) => number;
  isComplete: boolean;
  totalLength: number;
  taperStart: number;
  taperEnd: number;
  minDistance: number;
};

function getOutlineSettings(
  options: Partial<StrokeOptions>,
  totalLength: number,
): OutlineSettings {
  const {
    size = 16,
    smoothing = 0.5,
    thinning = 0.5,
    simulatePressure = true,
    easing = (t) => t,
    start = {},
    end = {},
    last: isComplete = false,
  } = options;

  const { cap: capStart = true, easing: taperStartEase = (t) => t * (2 - t) } =
    start;

  const { cap: capEnd = true, easing: taperEndEase = (t) => --t * t * t + 1 } =
    end;

  const taperStart =
    start.taper === false
      ? 0
      : start.taper === true
      ? Math.max(size, totalLength)
      : (start.taper as number);

  const taperEnd =
    end.taper === false
      ? 0
      : end.taper === true
      ? Math.max(size, totalLength)
      : (end.taper as number);

  return {
    size,
    thinning,
    simulatePressure,
    easing,
    capStart,
    capEnd,
    taperStartEase,
    taperEndEase,
    isComplete,
    totalLength,
    taperStart,
    taperEnd,
    // The minimum allowed distance between points (squared)
    minDistance: Math.pow(size * smoothing, 2),
  };
}

/**
 * The state of `getStrokeOutlinePoints` between two stroke points.
 * @internal
 */
type OutlineState = {
  // Our collected left and right points
  leftPts: number[][];
  rightPts: number[][];
  prevPressure: number;
  // The current radius
  radius: number;
  // The radius of the first saved point
  firstRadius: number | undefined;
  // Previous vector
  prevVector: number[];
  // Previous left and right points
  pl: number[];
  pr: number[];
  // Temporary left and right points
  tl: number[];
  tr: number[];
  // Keep track of whether the previous point is a sharp corner
  // ... so that we don't detect the same corner twice
  isPrevPointSharpCorner: boolean;
};

function startOutline(points: StrokePoint[], s: OutlineSettings): OutlineState {
  const { size, simulatePressure } = s;

  // Previous pressure (start with average of first five pressures,
  // in order to prevent fat starts for every line. Drawn lines
  // almost always start slow!
  const prevPressure = points.slice(0, 10).reduce((acc, curr) => {
    let pressure = curr.pressure;

    if (simulatePressure) {
      // Speed of change - how fast should the the pressure changing?
      const sp = min(1, curr.distance / size);
      // Rate of change - how much of a change is there?
      const rp = min(1, 1 - sp);
      // Accelerate the pressure
      pressure = min(1, acc + (rp - acc) * (sp * RATE_OF_PRESSURE_CHANGE));
    }

    return (acc + pressure) / 2;
  }, points[0].pressure);

  const pl = points[0].point;

  return {
    leftPts: [],
    rightPts: [],
    prevPressure,
    radius: getStrokeRadius(
      size,
      s.thinning,
      points[points.length - 1].pressure,
      s.easing,
    ),
    firstRadius: undefined,
    prevVector: points[0].vector,
    pl,
    pr: pl,
    tl: pl,
    tr: pl,
    isPrevPointSharpCorner: false,
  };
}

/**
 * Find the outline's left and right points for `points[i]`. The first and
 * last points get caps later on.
 * @internal
 */
function addOutlinePoint(
  state: OutlineState,
  points: StrokePoint[],
  i: number,
  s: OutlineSettings,
) {
  const { size, thinning, totalLength, taperStart, taperEnd } = s;
  let { pressure } = points[i];
  const { point, vector, distance, runningLength } = points[i];

  // Removes noise from the end of the line
  if (
    i < points.length - 1 &&
    totalLength - runningLength < Math.min(3, (size / 4.25) * 3)
  ) {
    return;
  }

  /*
    Calculate the radius

    If not thinning, the current point's radius will be half the size; or
    otherwise, the size will be based on the current (real or simulated)
    pressure.
  */

  if (thinning) {
    if (s.simulatePressure) {
      // If we're simulating pressure, then do so based on the distance
      // between the current point and the previous point, and the size
      // of the stroke. Otherwise, use the input pressure.
      const sp = min(1, distance / size);
      const rp = min(1, 1 - sp);
      pressure = min(
        1,
        state.prevPressure +
          (rp - state.prevPressure) * (sp * RATE_OF_PRESSURE_CHANGE),
      );
    }

    state.radius = getStrokeRadius(size, thinning, pressure, s.easing);
  } else {
    state.radius = size / 2;
  }

  if (state.firstRadius === undefined) {
    state.firstRadius = state.radius;
  }

  /*
    Apply tapering

    If the current length is within the taper distance at either the
    start or the end, calculate the taper strengths. Apply the smaller
    of the two taper strengths to the radius.
  */

  const ts =
    runningLength < taperStart
      ? s.taperStartEase(runningLength / taperStart)
      : 1;

  const te =
    totalLength - runningLength < taperEnd
      ? s.taperEndEase((totalLength - runningLength) / taperEnd)
      : 1;

  const radius = Math.max(1e-9, state.radius * Math.min(ts, te));
  state.radius = radius;

  /* Add points to left and right */

  /*
    Handle sharp corners

    Find the difference (dot product) between the current and next vector.
    If the next vector is at more than a right angle to the current vector,
    draw a cap at the current point.
  */

  const nextVector = (i < points.length - 1 ? points[i + 1] : points[i]).vector;
  const nextDpr = i < points.length - 1 ? dpr(vector, nextVector) : 1.0;
  const prevDpr = dpr(vector, state.prevVector);

  const isPointSharpCorner = prevDpr < 0 && !state.isPrevPointSharpCorner;
  const isNextPointSharpCorner = nextDpr !== null && nextDpr < 0;

  if (isPointSharpCorner || isNextPointSharpCorner) {
    // It's a sharp corner. Draw a rounded cap and move on to the next point
    // Considering saving these and drawing them later? So that we can avoid
    // crossing future points.

    const offset = mul(per(state.prevVector), radius);

    for (let step = 1 / 13, t = 0; t <= 1; t += step) {
      state.tl = rotAround(sub(point, offset), point, FIXED_PI * t);
      state.leftPts.push(state.tl);

      state.tr = rotAround(add(point, offset), point, FIXED_PI * -t);
      state.rightPts.push(state.tr);
    }

    state.pl = state.tl;
    state.pr = state.tr;

    if (isNextPointSharpCorner) {
      state.isPrevPointSharpCorner = true;
    }
    return;
  }

  state.isPrevPointSharpCorner = false;

  // Handle the last point
  if (i === points.length - 1) {
    const offset = mul(per(vector), radius);
    state.leftPts.push(sub(point, offset));
    state.rightPts.push(add(point, offset));
    return;
  }

  /*
    Add regular points

    Project points to either side of the current point, using the
    calculated size as a distance. If a point's distance to the
    previous point on that side greater than the minimum distance
    (or if the corner is kinda sharp), add the points to the side's
    points array.
  */

  const offset = mul(per(lrp(nextVector, vector, nextDpr)), radius);

  state.tl = sub(point, offset);

  if (i <= 1 || dist2(state.pl, state.tl) > s.minDistance) {
    state.leftPts.push(state.tl);
    state.pl = state.tl;
  }

  state.tr = add(point, offset);

  if (i <= 1 || dist2(state.pr, state.tr) > s.minDistance) {
    state.rightPts.push(state.tr);
    state.pr = state.tr;
  }

  // Set variables for next iteration
  state.prevPressure = pressure;
  state.prevVector = vector;
}

/**
 * Draw the caps and join the sides into the outline.
 * @internal
 */
function closeOutline(
  state: OutlineState,
  points: StrokePoint[],
  s: OutlineSettings,
): number[][] {
  const { taperStart, taperEnd } = s;
  const { radius, leftPts, rightPts } = state;

  /*
    Drawing caps

    Now that we have our points on either side of the line, we need to
    draw caps at the start and end. Tapered lines don't have caps, but
    may have dots for very short lines.
  */

  const firstPoint = points[0].point.slice(0, 2);

  const lastPoint =
    points.length > 1
      ? points[points.length - 1].point.slice(0, 2)
      : add(points[0].point, [1, 1]);

  const startCap: number[][] = [];

  const endCap: number[][] = [];

  /*
    Draw a dot for very short or completed strokes

    If the line is too short to gather left or right points and if the line is
    not tapered on either side, draw a dot. If the line is tapered, then only
    draw a dot if the line is both very short and complete. If we draw a dot,
    we can just return those points.
  */

  if (points.length === 1) {
    if (!(taperStart || taperEnd) || s.isComplete) {
      const start = prj(
        firstPoint,
        uni(per(sub(firstPoint, lastPoint))),
        -(state.firstRadius || radius),
      );
      const dotPts: number[][] = [];
      for (let step = 1 / 13, t = step; t <= 1; t += step) {
        dotPts.push(rotAround(start, firstPoint, FIXED_PI * 2 * t));
      }
      return dotPts;
    }
  } else {
    /*
    Draw a start cap

    Unless the line has a tapered start, or unless the line has a tapered end
    and the line is very short, draw a start cap around the first point. Use
    the distance between the second left and right point for the cap's radius.
    Finally remove the first left and right points. :psyduck:
  */

    if (taperStart || (taperEnd && points.length === 1)) {
      // The start point is tapered, noop
    } else if (s.capStart) {
      // Draw the round cap - add thirteen points rotating the right point around the start point to the left point
      for (let step = 1 / 13, t = step; t <= 1; t += step) {
        const pt = rotAround(rightPts[0], firstPoint, FIXED_PI * t);
        startCap.push(pt);
      }
    } else {
      // Draw the flat cap - add a point to the left and right of the start point
      const cornersVector = sub(leftPts[0], rightPts[0]);
      const offsetA = mul(cornersVector, 0.5);
      const offsetB = mul(cornersVector, 0.51);

      startCap.push(
        sub(firstPoint, offsetA),
        sub(firstPoint, offsetB),
        add(firstPoint, offsetB),
        add(firstPoint, offsetA),
      );
    }

    /*
    Draw an end cap

    If the line does not have a tapered end, and unless the line has a tapered
    start and the line is very short, draw a cap around the last point. Finally,
    remove the last left and right points. Otherwise, add the last point. Note
    that This cap is a full-turn-and-a-half: this prevents incorrect caps on
    sharp end turns.
  */

    const direction = per(neg(points[points.length - 1].vector));

    if (taperEnd || (taperStart && points.length === 1)) {
      // Tapered end - push the last point to the line
      endCap.push(lastPoint);
    } else if (s.capEnd) {
      // Draw the round end cap
      const start = prj(lastPoint, direction, radius);
      for (let step = 1 / 29, t = step; t < 1; t += step) {
        endCap.push(rotAround(start, lastPoint, FIXED_PI * 3 * t));
      }
    } else {
      // Draw the flat end cap

      endCap.push(
        add(lastPoint, mul(direction, radius)),
        add(lastPoint, mul(direction, radius * 0.99)),
        sub(lastPoint, mul(direction, radius * 0.99)),
        sub(lastPoint, mul(direction, radius)),
      );
    }
  }

  /*
    Return the points in the correct winding order: begin on the left side, then
    continue around the end cap, then come back along the right side, and finally
    complete the start cap.
  */

  return leftPts.concat(endCap, rightPts.reverse(), startCap);
}

/**
 * ## getStrokeOutlinePoints
 * @description Get an array of points (as `[x, y]`) representing the outline of a stroke.
 * @param points An array of StrokePoints as returned from `getStrokePoints`.
 * @param options (optional) An object with options.
 * @param options.size	The base size (diameter) of the stroke.
 * @param options.thinning The effect of pressure on the stroke's size.
 * @param options.smoothing	How much to soften the stroke's edges.
 * @param options.easing	An easing function to apply to each point's pressure.
 * @param options.simulatePressure Whether to simulate pressure based on velocity.
 * @param options.start Cap, taper and easing for the start of the line.
 * @param options.end Cap, taper and easing for the end of the line.
 * @param options.last Whether to handle the points as a completed stroke.
 */
export function getStrokeOutlinePoints(
  points: StrokePoint[],
  options: Partial<StrokeOptions> = {} as Partial<StrokeOptions>,
): number[][] {
  if (points.length === 0) {
    return [];
  }

  const s = getOutlineSettings(
    options,
    // The total length of the line
    points[points.length - 1].runningLength,
  );

  // We can't do anything with a stroke with negative size.
  if (s.size <= 0) {
    return [];
  }

  const state = startOutline(points, s);

  for (let i = 0; i < points.length; i++) {
    addOutlinePoint(state, points, i, s);
  }

  return closeOutline(state, points, s);
}

/**
 * ## getStroke
 * @description Get an array of points describing a polygon that surrounds the input points.
 * @param points An array of points (as `[x, y, pressure]` or `{x, y, pressure}`). Pressure is optional in both cases.
 * @param options (optional) An object with options.
 * @param options.size	The base size (diameter) of the stroke.
 * @param options.thinning The effect of pressure on the stroke's size.
 * @param options.smoothing	How much to soften the stroke's edges.
 * @param options.easing	An easing function to apply to each point's pressure.
 * @param options.simulatePressure Whether to simulate pressure based on velocity.
 * @param options.start Cap, taper and easing for the start of the line.
 * @param options.end Cap, taper and easing for the end of the line.
 * @param options.last Whether to handle the points as a completed stroke.
 */

export function getStroke(
  points: (number[] | { x: number; y: number; pressure?: number })[],
  options: StrokeOptions = {} as StrokeOptions,
): number[][] {
  return getStrokeOutlinePoints(getStrokePoints(points, options), options);
}

// Reading past the end of a point without pressure is a slow lookup. A
// negative pressure reads as none, like a missing one does.
const pressureOf = (
  points: readonly (readonly number[])[],
  pressures: readonly number[] | undefined,
  i: number,
): number =>
  pressures ? pressures[i] : points[i].length > 2 ? points[i][2] : -1;

/**
 * `getStroke` for a stroke that grows one point at a time, as it does while
 * it is drawn. It keeps the work for the part of the stroke that later
 * points can no longer change, and redoes only the rest:
 * - stroke points from every input but the last, as streamline only looks
 *   back;
 * - the outline of a stroke point once its successor is one of those, the
 *   first ten (which seed the pressure) are, and it is farther from the end
 *   than the end noise cut and the end taper, which a longer stroke only
 *   moves away from it.
 *
 * The outline is the one `getStroke` returns for the same points and
 * options. Inputs are compared with the ones read before, so any change
 * other than appending starts over.
 */
export class IncrementalStroke {
  private readonly options: StrokeOptions;
  private readonly t: number;
  private readonly size: number;
  private readonly isComplete: boolean;
  private readonly growable: boolean;

  /** inputs read as not the last, as `[x, y, pressure]` */
  private inputs: number[][] = [];
  private strokePoints: StrokePointsState | null = null;
  /** the outline after the stroke points before `outlined` */
  private outline: OutlineState | null = null;
  private outlined = 0;

  constructor(options: StrokeOptions) {
    const { streamline = 0.5, size = 16, last = false, start, end } = options;
    this.options = options;
    this.t = 0.15 + (1 - streamline) * 0.85;
    this.size = size;
    this.isComplete = last;
    // tapers of `true` follow the stroke's whole length
    this.growable = start?.taper !== true && end?.taper !== true && size > 0;
  }

  /**
   * @param points `[x, y]` or `[x, y, pressure]` inputs
   * @param pressures the inputs' pressures, if not in `points`
   */
  getOutline(
    points: readonly (readonly number[])[],
    pressures?: readonly number[],
  ): number[][] {
    const input = (i: number) => [
      points[i][0],
      points[i][1],
      pressureOf(points, pressures, i),
    ];

    // `getStrokePoints` pads strokes of one or two points
    if (points.length < 3 || !this.growable) {
      this.reset();
      return getStroke(
        points.map((_, i) => input(i)),
        this.options,
      );
    }

    if (!this.isGrowing(points, pressures)) {
      this.reset();
    }

    const max = points.length - 1;
    const state = (this.strokePoints ??= startStrokePoints(
      this.read(input(0)),
    ));
    for (let i = this.inputs.length; i < max; i++) {
      addStrokePoint(state, this.read(input(i)), this.t, this.size);
    }

    const strokePoints = finishStrokePoints(
      state,
      getLastStrokePoint(state, input(max), this.t, this.isComplete),
    );

    const s = getOutlineSettings(
      this.options,
      strokePoints[strokePoints.length - 1].runningLength,
    );

    const settled = this.settleOutline(strokePoints, s);

    const tail: OutlineState = {
      ...(this.outline ?? startOutline(strokePoints, s)),
      leftPts: [],
      rightPts: [],
    };
    for (let i = settled; i < strokePoints.length; i++) {
      addOutlinePoint(tail, strokePoints, i, s);
    }
    if (this.outline) {
      tail.leftPts = this.outline.leftPts.concat(tail.leftPts);
      tail.rightPts = this.outline.rightPts.concat(tail.rightPts);
    }

    return closeOutline(tail, strokePoints, s);
  }

  /**
   * Extend the kept outline over the stroke points later points cannot
   * change, and return how many stroke points it covers.
   */
  private settleOutline(strokePoints: StrokePoint[], s: OutlineSettings) {
    const kept = this.strokePoints!.strokePoints;
    if (kept.length < 10) {
      return this.outlined;
    }

    // Every later stroke is at least this long
    const minLength = kept[kept.length - 1].runningLength;
    const endCut = Math.min(3, (this.size / 4.25) * 3);

    let last = kept.length - 2;
    while (
      last >= this.outlined &&
      (minLength - kept[last].runningLength < endCut ||
        minLength - kept[last].runningLength < s.taperEnd)
    ) {
      last--;
    }
    if (last < this.outlined) {
      return this.outlined;
    }

    const outline = (this.outline ??= startOutline(strokePoints, s));
    for (let i = this.outlined; i <= last; i++) {
      addOutlinePoint(outline, strokePoints, i, s);
    }
    this.outlined = last + 1;
    return this.outlined;
  }

  private read(input: number[]) {
    this.inputs.push(input);
    return input;
  }

  private isGrowing(
    points: readonly (readonly number[])[],
    pressures?: readonly number[],
  ) {
    const { inputs } = this;
    if (inputs.length >= points.length) {
      return false;
    }
    for (let i = 0; i < inputs.length; i++) {
      const read = inputs[i];
      const point = points[i];
      if (
        read[0] !== point[0] ||
        read[1] !== point[1] ||
        read[2] !== pressureOf(points, pressures, i)
      ) {
        return false;
      }
    }
    return true;
  }

  private reset() {
    this.inputs = [];
    this.strokePoints = null;
    this.outline = null;
    this.outlined = 0;
  }
}
