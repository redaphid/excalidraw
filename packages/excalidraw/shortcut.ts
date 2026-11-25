import { isDarwin } from "@excalidraw/common";

export const getShortcutKey = (shortcut: string): string =>
  shortcut
    .replace(/\b(Opt(?:ion)?|Alt)\b/i, isDarwin ? "Option" : "Alt")
    .replace(/\bShift\b/i, "Shift")
    .replace(/\b(Enter|Return)\b/i, "Enter")
    .replace(/\b(Ctrl|Cmd|Command|CtrlOrCmd)\b/gi, isDarwin ? "Cmd" : "Ctrl")
    .replace(/\b(Esc(?:ape)?)\b/i, "Esc")
    .replace(/\b(Space(?:bar)?)\b/i, "Space")
    .replace(/\b(Del(?:ete)?)\b/i, "Delete");
