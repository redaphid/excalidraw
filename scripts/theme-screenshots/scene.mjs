// A populated scene for theme screenshots: frames, every shape, arrows,
// bound and free text, and a freedraw stroke. Elements are skeletons;
// `restore` fills in the remaining fields when the playground loads them.

const base = (id, type, x, y, width, height, extra = {}) => ({
  id,
  type,
  x,
  y,
  width,
  height,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
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

const label = (id, container, text, extra = {}) =>
  base(
    id,
    "text",
    container.x,
    container.y + container.height / 2 - 12.5,
    container.width,
    25,
    {
      text,
      originalText: text,
      fontSize: 20,
      fontFamily: 5,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: container.id,
      lineHeight: 1.25,
      autoResize: true,
      frameId: container.frameId,
      ...extra,
    },
  );

const boxed = (shape, text) => {
  const textId = `${shape.id}-label`;
  return [
    { ...shape, boundElements: [{ id: textId, type: "text" }] },
    label(textId, shape, text, { strokeColor: shape.strokeColor }),
  ];
};

const arrow = (id, x, y, dx, dy, extra = {}) =>
  base(id, "arrow", x, y, Math.abs(dx), Math.abs(dy), {
    points: [
      [0, 0],
      [dx, dy],
    ],
    endArrowhead: "arrow",
    startArrowhead: null,
    roundness: { type: 2 },
    ...extra,
  });

const freedrawPoints = () => {
  const points = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    points.push([
      Math.round(t * 230 * 10) / 10,
      Math.round(Math.sin(t * Math.PI * 3) * 34 * (1 - t * 0.4) * 10) / 10,
    ]);
  }
  return points;
};

export const buildScene = () => {
  const research = base("research", "rectangle", 80, 170, 200, 100, {
    frameId: "discovery",
    backgroundColor: "#a5d8ff",
    strokeColor: "#1971c2",
    roundness: { type: 3 },
  });
  const interviews = base("interviews", "ellipse", 390, 160, 220, 120, {
    frameId: "discovery",
    backgroundColor: "#ffec99",
    fillStyle: "hachure",
    strokeColor: "#f08c00",
  });
  const decide = base("decide", "diamond", 250, 330, 190, 150, {
    frameId: "discovery",
    backgroundColor: "#b2f2bb",
    strokeColor: "#2f9e44",
  });
  const prototype = base("prototype", "rectangle", 760, 170, 220, 110, {
    frameId: "build",
    backgroundColor: "#ffc9c9",
    strokeColor: "#e03131",
    strokeStyle: "dashed",
    roundness: { type: 3 },
  });
  const elements = [
    base("title", "text", 60, 20, 420, 45, {
      text: "Q4 launch map",
      originalText: "Q4 launch map",
      fontSize: 36,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
    }),
    base("discovery", "frame", 40, 110, 620, 420, {
      name: "Discovery",
      strokeColor: "#bbb",
      roughness: 0,
    }),
    base("build", "frame", 720, 110, 560, 420, {
      name: "Build",
      strokeColor: "#bbb",
      roughness: 0,
    }),
    ...boxed(research, "Research"),
    ...boxed(interviews, "Interviews"),
    ...boxed(decide, "Decide?"),
    ...boxed(prototype, "Prototype"),
    arrow("a1", 180, 275, 110, 90, { frameId: "discovery" }),
    arrow("a2", 470, 285, -60, 80, { frameId: "discovery" }),
    arrow("a3", 445, 405, 310, -165, { strokeColor: "#6741d9" }),
    base("squiggle", "freedraw", 1010, 210, 230, 70, {
      frameId: "build",
      strokeColor: "#1e1e1e",
      strokeWidth: 2,
      points: freedrawPoints(),
      pressures: [],
      simulatePressure: true,
    }),
    base("notes", "text", 760, 340, 400, 75, {
      frameId: "build",
      text: "Ship behind a flag,\nmeasure, then widen.",
      originalText: "Ship behind a flag,\nmeasure, then widen.",
      fontSize: 24,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
    }),
    base("line", "line", 760, 450, 470, 0, {
      frameId: "build",
      points: [
        [0, 0],
        [470, 0],
      ],
      strokeStyle: "dotted",
      strokeColor: "#868e96",
    }),
  ];
  return {
    elements,
    appState: {
      gridModeEnabled: true,
      viewBackgroundColor: "#ffffff",
    },
    files: {},
  };
};
