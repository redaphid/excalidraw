// A populated scene for theme screenshots: frames, every shape, arrows,
// bound and free text, and a freedraw stroke, drawn with a theme's
// new-element defaults and swatches (see `readStyle` in shoot.mjs) the way a
// user of that theme would draw it. Elements are skeletons; `restore` fills
// in the remaining fields when the playground loads them.

const STROKE_WIDTH = { thin: 1, medium: 2, bold: 4 };

const UPSTREAM_STROKE_PICKS = [
  "#1e1e1e",
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
];
const UPSTREAM_BACKGROUND_PICKS = [
  "transparent",
  "#ffc9c9",
  "#b2f2bb",
  "#a5d8ff",
  "#ffec99",
];

/** fills a pick list to five, so every slot has a color */
const fivePicks = (picks, fallback) =>
  fallback.map((color, index) => picks?.[index] ?? color);

/**
 * `stacked` puts the Build frame under Discovery instead of beside it, the
 * layout a phone gives a scene.
 */
export const buildScene = (style, { stacked = false } = {}) => {
  const stroke = fivePicks(style.strokePicks, UPSTREAM_STROKE_PICKS);
  const fill = fivePicks(style.backgroundPicks, UPSTREAM_BACKGROUND_PICKS);
  const ink = style.currentItemStrokeColor;
  const fontSize = style.currentItemFontSize;
  const fontFamily = style.currentItemFontFamily;
  const roughness = style.currentItemRoughness;
  const shapeRoundness =
    style.currentItemRoundness === "round" ? { type: 3 } : null;
  const arrowRoundness =
    style.currentItemArrowType === "round" ? { type: 2 } : null;

  const base = (id, type, x, y, width, height, extra = {}) => ({
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: ink,
    backgroundColor: "transparent",
    fillStyle: style.currentItemFillStyle,
    strokeWidth: STROKE_WIDTH[style.currentItemStrokeWidthKey],
    strokeStyle: style.currentItemStrokeStyle,
    roughness,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: id.length * 7919 + x,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  });

  const text = (id, x, y, value, extra = {}) =>
    base(id, "text", x, y, 400, fontSize * 1.25, {
      text: value,
      originalText: value,
      fontSize,
      fontFamily,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
      ...extra,
    });

  const boxed = (shape, value) => {
    const textId = `${shape.id}-label`;
    return [
      { ...shape, boundElements: [{ id: textId, type: "text" }] },
      text(
        textId,
        shape.x,
        shape.y + shape.height / 2 - (fontSize * 1.25) / 2,
        value,
        {
          width: shape.width,
          textAlign: "center",
          verticalAlign: "middle",
          containerId: shape.id,
          frameId: shape.frameId,
        },
      ),
    ];
  };

  const arrow = (id, x, y, dx, dy, extra = {}) =>
    base(id, "arrow", x, y, Math.abs(dx), Math.abs(dy), {
      points: [
        [0, 0],
        [dx, dy],
      ],
      startArrowhead: style.currentItemStartArrowhead,
      endArrowhead: style.currentItemEndArrowhead,
      roundness: arrowRoundness,
      ...extra,
    });

  const freedrawPoints = () => {
    const points = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      points.push([
        Math.round(t * 195 * 10) / 10,
        Math.round(Math.sin(t * Math.PI * 3) * 34 * (1 - t * 0.4) * 10) / 10,
      ]);
    }
    return points;
  };

  const research = base("research", "rectangle", 80, 170, 200, 100, {
    frameId: "discovery",
    backgroundColor: fill[3],
    strokeColor: stroke[3],
    roundness: shapeRoundness,
  });
  const interviews = base("interviews", "ellipse", 390, 160, 220, 120, {
    frameId: "discovery",
    backgroundColor: fill[4],
    // hachure reads as hand-drawn, so only themes that draw by hand get it
    fillStyle: roughness > 0 ? "hachure" : style.currentItemFillStyle,
    strokeColor: stroke[4],
  });
  const decide = base("decide", "diamond", 250, 330, 190, 150, {
    frameId: "discovery",
    backgroundColor: fill[2],
    strokeColor: stroke[2],
    roundness: shapeRoundness,
  });
  const prototype = base("prototype", "rectangle", 740, 170, 210, 110, {
    frameId: "build",
    backgroundColor: fill[1],
    strokeColor: stroke[1],
    strokeStyle: "dashed",
    roundness: shapeRoundness,
  });

  const elements = [
    text("title", 60, 20, "Q4 launch map", {
      fontSize: Math.round(fontSize * 1.8),
      height: Math.round(fontSize * 1.8) * 1.25,
    }),
    base("discovery", "frame", 40, 110, 620, 420, {
      name: "Discovery",
      roughness: 0,
    }),
    base("build", "frame", 700, 110, 500, 420, { name: "Build", roughness: 0 }),
    ...boxed(research, "Research"),
    ...boxed(interviews, "Interviews"),
    ...boxed(decide, "Decide?"),
    ...boxed(prototype, "Prototype"),
    arrow("a1", 180, 275, 110, 90, { frameId: "discovery" }),
    arrow("a2", 470, 285, -60, 80, { frameId: "discovery" }),
    arrow("a3", 445, 405, 290, -165, { strokeColor: stroke[3] }),
    base("squiggle", "freedraw", 975, 210, 195, 70, {
      frameId: "build",
      strokeWidth: style.currentItemFreedrawStrokeWidth,
      strokeStyle: "solid",
      points: freedrawPoints(),
      pressures: [],
      simulatePressure: true,
      strokeOptions: {
        variability: style.currentItemStrokeVariability,
        streamline: 0.5,
      },
    }),
    text("notes", 740, 340, "Ship behind a flag,\nmeasure, then widen.", {
      frameId: "build",
      fontSize: Math.round(fontSize * 1.2),
      height: Math.round(fontSize * 1.2) * 1.25 * 2,
    }),
    base("line", "line", 740, 460, 420, 0, {
      frameId: "build",
      points: [
        [0, 0],
        [420, 0],
      ],
      strokeStyle: "dotted",
      strokeColor: stroke[0],
    }),
  ];
  const BUILD_SHIFT = { x: -660, y: 470 };
  const placed = stacked
    ? elements.map((element) => {
        if (element.id === "build" || element.frameId === "build") {
          return {
            ...element,
            x: element.x + BUILD_SHIFT.x,
            y: element.y + BUILD_SHIFT.y,
          };
        }
        // from Decide? down to Prototype
        return element.id === "a3"
          ? {
              ...element,
              x: 345,
              y: 482,
              points: [
                [0, 0],
                [-150, 152],
              ],
              width: 150,
              height: 152,
            }
          : element;
      })
    : elements;

  return {
    elements: placed,
    appState: { gridModeEnabled: true, viewBackgroundColor: "#ffffff" },
    files: {},
  };
};
