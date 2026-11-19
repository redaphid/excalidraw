import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

/** the playground's handle on the editor, and the stubbed controller */
type Playground = Window & {
  excalidrawAPI?: {
    getAppState: () => {
      activeTool: { type: string };
      currentItemStrokeColor: string;
    };
    midi: { connect: () => Promise<boolean> };
    radialPalette: {
      state: () => {
        open: boolean;
        ring: string;
        index: number;
        items: readonly { id: string }[];
      };
    };
  };
  twister?: { send: (bytes: number[]) => void; sent: number[][] };
};

/** knobs of a Midi Fighter Twister at factory settings, bank 1 */
const KNOB = { tools: 4, colors: 6 } as const;

/** a Twister on the browser's MIDI ports, as Web MIDI hands it over: no
 * runner has one plugged in */
const plugInTwister = (page: Page) =>
  page.addInitScript(() => {
    type Listener = (event: { data: Uint8Array }) => void;
    const listeners = new Set<Listener>();
    const sent: number[][] = [];
    const name = "Midi Fighter Twister";
    const input = {
      id: "in-1",
      name,
      state: "connected",
      addEventListener: (_: string, listener: Listener) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: Listener) =>
        listeners.delete(listener),
    };
    const output = {
      id: "out-1",
      name,
      state: "connected",
      send: (bytes: number[]) => sent.push([...bytes]),
    };
    const access = {
      inputs: new Map([["in-1", input]]),
      outputs: new Map([["out-1", output]]),
      onstatechange: null,
    };
    Object.defineProperty(Navigator.prototype, "requestMIDIAccess", {
      configurable: true,
      value: () => Promise.resolve(access),
    });
    (window as Window & { twister?: unknown }).twister = {
      send: (bytes: number[]) =>
        listeners.forEach((listener) =>
          listener({ data: new Uint8Array(bytes) }),
        ),
      sent,
    };
  });

const send = (page: Page, bytes: number[]) =>
  page.evaluate((bytes) => (window as Playground).twister!.send(bytes), bytes);

/** the knob's push switch, one channel above it: down, then up */
const press = async (page: Page, cc: number) => {
  await send(page, [0xb1, cc, 127]);
  await send(page, [0xb1, cc, 0]);
};

/** clicks clockwise in the Twister's relative mode (65 a click) */
const turn = async (page: Page, cc: number, clicks: number) => {
  for (let i = 0; i < clicks; i++) {
    await send(page, [0xb0, cc, 65]);
  }
};

const appState = (page: Page) =>
  page.evaluate(() => (window as Playground).excalidrawAPI!.getAppState());

const palette = (page: Page) =>
  page.evaluate(() =>
    (window as Playground).excalidrawAPI!.radialPalette.state(),
  );

test.beforeEach(async ({ page }) => {
  await plugInTwister(page);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as Playground).excalidrawAPI);
  await page.evaluate(() =>
    (window as Playground).excalidrawAPI!.midi.connect(),
  );
});

test("a knob opens the tools, turns to one and chooses it", async ({
  page,
}) => {
  await press(page, KNOB.tools);
  await expect
    .poll(async () => (await palette(page)).open, "the press opens the ring")
    .toBe(true);
  await expect(page.locator(".RadialPalette__backdrop")).toBeVisible();

  // four clicks a slice, in relative mode once the knob has repeated itself
  await turn(page, KNOB.tools, 8);
  const { items, index } = await palette(page);
  const highlighted = items[index].id;
  expect(highlighted, "the turn moved off the select tool").not.toBe(
    "selection",
  );

  await press(page, KNOB.tools);
  await expect
    .poll(async () => (await appState(page)).activeTool.type)
    .toBe(highlighted);
  expect((await palette(page)).open, "choosing closes the ring").toBe(false);
});

test("a knob opens the colours, turns to one and chooses it", async ({
  page,
}) => {
  await turn(page, KNOB.colors, 8);
  const { items, index, ring } = await palette(page);
  expect(ring, "turning opens the colours").toBe("colors");

  await press(page, KNOB.colors);
  await expect
    .poll(async () => (await appState(page)).currentItemStrokeColor)
    .toBe(items[index].id);
});
