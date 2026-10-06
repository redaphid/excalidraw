import type { Rgba } from "./color";
import type { Dab } from "./stroke";

// One instanced quad per segment between two dabs. The fragment shader takes
// the distance to the segment, minus a radius that tapers from one end to the
// other, and turns it into a pixel of antialiased coverage. Blending with MAX
// makes overlapping capsules a union, so a translucent stroke never darkens
// where it crosses itself. Adding a dab uploads 12 bytes; drawing is one call.

const VERTEX = `#version 300 es
layout(location = 0) in vec3 a_from;
layout(location = 1) in vec3 a_to;
uniform vec2 u_scroll;
uniform float u_scale;
uniform vec2 u_resolution;
out vec2 v_px;
flat out vec3 v_from;
flat out vec3 v_to;

const vec2 CORNERS[4] = vec2[4](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(1, 1));

void main() {
  vec3 from = vec3((a_from.xy + u_scroll) * u_scale, a_from.z * u_scale);
  vec3 to = vec3((a_to.xy + u_scroll) * u_scale, a_to.z * u_scale);
  vec2 corner = CORNERS[gl_VertexID];
  vec2 axis = to.xy - from.xy;
  float len = length(axis);
  vec2 along = len > 1e-4 ? axis / len : vec2(1, 0);
  vec2 across = vec2(-along.y, along.x);
  float pad = max(from.z, to.z) + 1.0;
  vec2 px = mix(from.xy, to.xy, corner.x * 0.5 + 0.5) + (along * corner.x + across * corner.y) * pad;
  v_px = px;
  v_from = from;
  v_to = to;
  vec2 clip = px / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0, 1);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_px;
flat in vec3 v_from;
flat in vec3 v_to;
uniform vec4 u_color;
out vec4 color;

void main() {
  vec2 pa = v_px - v_from.xy;
  vec2 ba = v_to.xy - v_from.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h) - mix(v_from.z, v_to.z, h);
  float coverage = clamp(0.5 - d, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  color = u_color * coverage;
}`;

export type View = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  dpr: number;
};

type InkRenderer = {
  ready(): boolean;
  /** The browser has no GPU to give WebGL, so every pixel costs CPU. */
  software: boolean;
  /** Matches the backing store to the canvas' CSS size. */
  fit(dpr: number): void;
  /**
   * Starts a stroke. Dabs are kept relative to `origin`: GPU floats are 32
   * bits, and a thousandfold zoomed in, board coordinates in the thousands
   * would jitter by whole pixels.
   */
  begin(color: Rgba, origin: { x: number; y: number }): void;
  push(dab: Dab): void;
  /** Draws the settled dabs, then a provisional tail up to the pen. */
  draw(view: View, tail: readonly Dab[]): void;
  clear(): void;
  dispose(): void;
};

/** The browser renders WebGL on the CPU: no GPU, or a blocklisted one. */
const isSoftwareRenderer = (renderer: string) =>
  /swiftshader|basic render|llvmpipe|software/i.test(renderer);

const FLOATS_PER_DAB = 3;
const BYTES_PER_DAB = FLOATS_PER_DAB * 4;

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("the GPU would not make a shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }
  throw new Error(`ink shader: ${gl.getShaderInfoLog(shader)}`);
};

const link = (gl: WebGL2RenderingContext) => {
  const program = gl.createProgram();
  const shaders = [
    compile(gl, gl.VERTEX_SHADER, VERTEX),
    compile(gl, gl.FRAGMENT_SHADER, FRAGMENT),
  ];
  for (const shader of shaders) {
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  // A linked program keeps its own copy; the shaders are only flagged until
  // it lets go of them.
  for (const shader of shaders) {
    gl.deleteShader(shader);
  }
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return program;
  }
  throw new Error(`ink program: ${gl.getProgramInfoLog(program)}`);
};

export const createInkRenderer = (
  canvas: HTMLCanvasElement,
  { desynchronized }: { desynchronized: boolean },
): InkRenderer | null => {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    // Lets the browser put this canvas on screen without waiting for the
    // compositor's next frame: the heart of pen latency on Windows.
    desynchronized,
  });
  // A GPU reset, or too many contexts on the page, can hand out a context
  // that is lost from the start.
  if (!gl || gl.isContextLost()) {
    return null;
  }
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const software = isSoftwareRenderer(
    String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
  );

  let lost = false;
  let data = new Float32Array(1024 * FLOATS_PER_DAB);
  let settled = 0;
  let uploaded = 0;
  let capacity = 0;
  let color: Rgba = [0, 0, 0, 1];
  let origin = { x: 0, y: 0 };
  let program: WebGLProgram;
  let buffer: WebGLBuffer;
  let vao: WebGLVertexArrayObject;
  let uniforms: Record<
    "scroll" | "scale" | "resolution" | "color",
    WebGLUniformLocation | null
  >;

  const setup = () => {
    program = link(gl);
    buffer = gl.createBuffer();
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [location, offset] of [
      [0, 0],
      [1, BYTES_PER_DAB],
    ] as const) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        3,
        gl.FLOAT,
        false,
        BYTES_PER_DAB,
        offset,
      );
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    uniforms = {
      scroll: gl.getUniformLocation(program, "u_scroll"),
      scale: gl.getUniformLocation(program, "u_scale"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      color: gl.getUniformLocation(program, "u_color"),
    };
    capacity = 0;
    uploaded = 0;
  };

  const reserve = (dabs: number) => {
    if (dabs * FLOATS_PER_DAB > data.length) {
      const grown = new Float32Array(
        Math.max(data.length * 2, dabs * FLOATS_PER_DAB),
      );
      grown.set(data);
      data = grown;
    }
    if (dabs <= capacity) {
      return;
    }
    capacity = data.length / FLOATS_PER_DAB;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    uploaded = 0;
  };

  const write = (at: number, d: Dab) => {
    data[at * FLOATS_PER_DAB] = d.x - origin.x;
    data[at * FLOATS_PER_DAB + 1] = d.y - origin.y;
    data[at * FLOATS_PER_DAB + 2] = d.r;
  };

  const upload = (from: number, to: number) => {
    if (to <= from) {
      return;
    }
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      from * BYTES_PER_DAB,
      data,
      from * FLOATS_PER_DAB,
      (to - from) * FLOATS_PER_DAB,
    );
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    setup();
    lost = false;
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  setup();

  return {
    ready: () => !lost,
    software,
    fit(dpr) {
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width === width && canvas.height === height) {
        return;
      }
      canvas.width = width;
      canvas.height = height;
    },
    begin(next, at) {
      canvas.style.visibility = "visible";
      color = next;
      origin = at;
      settled = 0;
      uploaded = 0;
    },
    push(dab) {
      reserve(settled + 1);
      write(settled++, dab);
    },
    draw(view, tail) {
      if (lost || settled + tail.length === 0) {
        return;
      }
      // A lone dab still needs a segment to draw: pair it with itself.
      const lone = settled + tail.length === 1 ? 1 : 0;
      const total = settled + tail.length + lone;
      reserve(total);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      upload(uploaded, settled);
      uploaded = settled;
      tail.forEach((d, i) => write(settled + i, d));
      if (lone) {
        data.copyWithin(
          (total - 1) * FLOATS_PER_DAB,
          (total - 2) * FLOATS_PER_DAB,
          (total - 1) * FLOATS_PER_DAB,
        );
      }
      upload(settled, total);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      // Summed here in 64 bits: near the view, this is small and exact.
      gl.uniform2f(
        uniforms.scroll,
        origin.x + view.scrollX,
        origin.y + view.scrollY,
      );
      gl.uniform1f(uniforms.scale, view.zoom * view.dpr);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform4f(uniforms.color, ...color);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, total - 1);
      gl.bindVertexArray(null);
    },
    clear() {
      settled = 0;
      uploaded = 0;
      // Hidden between strokes, so the compositor has one layer fewer to blend.
      canvas.style.visibility = "hidden";
      if (lost) {
        return;
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
};
