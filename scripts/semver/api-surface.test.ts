import fs from "fs";
import os from "os";
import path from "path";

import { surfaceBreaks } from "./api-surface";

const BEFORE = `
export type Props = {
  theme?: "light" | "dark";
  radialPalette?: boolean;
  onChange?: (value: number) => void;
};
export declare const Editor: (props: Props) => null;
export declare const VERSION: string;
`;

// Writes each version's declarations where the packed tarballs put them, so
// the comparison treats them as the packages' own.
const surface = (after: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-"));
  const write = (label: string, source: string) => {
    const file = path.join(
      dir,
      label,
      "node_modules",
      "@excalidraw",
      "excalidraw",
      "index.d.ts",
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    return file;
  };
  try {
    return surfaceBreaks({
      excalidraw: [write("before", BEFORE), write("after", after)],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe("surfaceBreaks", () => {
  it("passes an unchanged surface", () => {
    expect(surface(BEFORE)).toEqual([]);
  });

  it("passes an added export, an added optional prop and a widened prop", () => {
    expect(
      surface(
        BEFORE.replace('"light" | "dark"', '"light" | "dark" | "system"')
          .replace(
            "radialPalette?: boolean;",
            "radialPalette?: boolean;\n  pens?: string[];",
          )
          .concat("export declare const extra: number;\n"),
      ),
    ).toEqual([]);
  });

  it("fails a removed export", () => {
    expect(
      surface(BEFORE.replace("export declare const VERSION: string;", "")),
    ).toEqual(["@excalidraw/excalidraw VERSION was removed"]);
  });

  it("fails a removed prop, on the type and on the component", () => {
    expect(surface(BEFORE.replace("  radialPalette?: boolean;\n", ""))).toEqual(
      [
        "@excalidraw/excalidraw Editor(props).radialPalette was removed",
        "@excalidraw/excalidraw Props.radialPalette was removed",
      ],
    );
  });

  it("fails a prop that became required", () => {
    expect(surface(BEFORE.replace("theme?:", "theme:"))).toContain(
      "@excalidraw/excalidraw Props.theme became required",
    );
  });

  it("fails a narrowed prop", () => {
    expect(surface(BEFORE.replace('"light" | "dark"', '"light"'))).toContain(
      '@excalidraw/excalidraw Props.theme narrowed from "light" | "dark" | undefined to "light" | undefined',
    );
  });
});
