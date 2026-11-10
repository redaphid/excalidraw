import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { knobName, MidiConfig } from "../components/MidiConfig/MidiConfig";
import { TWISTER_LAYOUT } from "../midi";
import { MIDI_STORAGE_KEYS } from "../midiSettings";

import type { MidiBinding } from "../midi";

/** the knob the hand reached for, as the booth's Twister reports it */
let speak: ((bytes: number[]) => void) | null = null;

const stored = <T,>(key: string): T =>
  JSON.parse(localStorage.getItem(key) ?? "null");

const bindings = () => stored<MidiBinding[] | null>(MIDI_STORAGE_KEYS.bindings);

const search = () => screen.getByLabelText("Search properties");

const turnKnob = (channel: number, cc: number, value = 65) =>
  act(() => speak!([0xb0 | (channel - 1), cc, value]));

const connect = async () => {
  fireEvent.click(screen.getByText("Connect"));
  await waitFor(() => expect(speak).not.toBeNull());
};

describe("midi:config", () => {
  beforeEach(() => {
    localStorage.clear();
    speak = null;
    const input = {
      id: "in-1",
      name: "Midi Fighter Twister",
      state: "connected",
      addEventListener: (
        _: string,
        listener: (event: { data: Uint8Array }) => void,
      ) => {
        speak = (bytes) => listener({ data: new Uint8Array(bytes) });
      },
    };
    Object.defineProperty(window.navigator, "requestMIDIAccess", {
      configurable: true,
      value: () =>
        Promise.resolve({
          inputs: new Map([["in-1", input]]),
          outputs: new Map(),
          onstatechange: null,
        }),
    });
  });

  afterEach(() => {
    delete (window.navigator as any).requestMIDIAccess;
  });

  it("names knobs by bank on a Twister and by channel elsewhere", () => {
    expect(knobName({ channel: 1, cc: 0 })).toBe("B1·1");
    expect(knobName({ channel: 1, cc: 20 })).toBe("B2·5");
    expect(knobName({ channel: 3, cc: 7 })).toBe("ch3·CC7");
  });

  it("shows the Twister layout until something is learned", async () => {
    render(<MidiConfig />);
    expect(screen.getByTestId("knob-1:1").textContent).toContain("Opacity");
    expect(screen.getByTestId("knob-1:15").textContent).toContain("Select");
  });

  it("binds a turned knob to the property typed for it", async () => {
    render(<MidiConfig />);
    await connect();

    // the twentieth knob: bank 2, fifth along
    turnKnob(1, 20);
    expect(screen.getByRole("status").textContent).toContain("B2·5");
    expect(screen.getByTestId("knob-1:20").className).toContain("is-armed");

    fireEvent.change(search(), { target: { value: "bg light" } });
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(bindings()).toContainEqual({
      channel: 1,
      cc: 20,
      target: "backgroundLightness",
    });
    expect(screen.getByRole("status").textContent).toBe(
      "B2·5 → Background lightness",
    );
    expect(screen.getByTestId("knob-1:20").textContent).toContain(
      "Background lightness",
    );
  });

  it("learns the next knob for a property picked first", async () => {
    render(<MidiConfig />);
    await connect();

    fireEvent.change(search(), { target: { value: "undo" } });
    fireEvent.click(
      screen.getByTestId("row-history").querySelector(".midi-config__bind")!,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Turn a knob to bind Undo / redo",
    );

    turnKnob(1, 47);
    expect(bindings()).toContainEqual({
      channel: 1,
      cc: 47,
      target: "history",
    });
  });

  it("takes a knob's press as that knob, not its switch", async () => {
    render(<MidiConfig />);
    await connect();

    act(() => speak!([0xb1, 33, 127]));
    expect(screen.getByRole("status").textContent).toContain("B3·2");
  });

  it("unbinds a knob", async () => {
    render(<MidiConfig />);
    fireEvent.change(search(), { target: { value: "opacity" } });
    fireEvent.click(screen.getByLabelText("Unbind B1·2"));
    expect(bindings()).toEqual(
      TWISTER_LAYOUT.filter((binding) => binding.cc !== 1),
    );
  });

  it("filters properties and preferences alike", async () => {
    render(<MidiConfig />);
    fireEvent.change(search(), { target: { value: "accel" } });
    expect(screen.queryByTestId("row-opacity")).toBeNull();
    expect(screen.getByTestId("pref-acceleration")).not.toBeNull();
  });

  it("edits a step in place and marks it changed, about:config style", async () => {
    render(<MidiConfig />);
    const input = screen.getByLabelText("Opacity step");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);

    expect(
      stored<{ steps: Record<string, number> }>(MIDI_STORAGE_KEYS.settings)
        .steps.opacity,
    ).toBe(5);
    expect(screen.getByTestId("row-opacity").className).toContain(
      "is-modified",
    );

    fireEvent.click(screen.getByLabelText("Reset Opacity step"));
    expect(screen.getByTestId("row-opacity").className).not.toContain(
      "is-modified",
    );
  });

  it("flips a true/false preference on a double click", async () => {
    render(<MidiConfig />);
    fireEvent.doubleClick(screen.getByTestId("pref-acceleration"));
    expect(
      stored<{ acceleration: boolean }>(MIDI_STORAGE_KEYS.settings)
        .acceleration,
    ).toBe(false);
  });
});
