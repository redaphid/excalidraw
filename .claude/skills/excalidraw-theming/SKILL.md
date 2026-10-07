---
name: excalidraw-theming
description: Generate and refine a theme for the Excalidraw fork's css prop from a text vibe, a palette or a reference image. Use when the user says "make a theme", "theme the board", "css for excalidraw", "make it look like <X>", "match this image", "restyle the editor" or "fix a theme". Covers the token file, generateThemeCss, and the apply, screenshot, judge and adjust loop.
---

# Excalidraw theming

A theme is one CSS string passed to `<Excalidraw css={...}>`. It restyles the DOM UI, and it sets custom properties that the editor reads to paint the canvas and to choose the stroke character of new elements. Write a theme as a small JSON token file and let `generateThemeCss` from `@excalidraw/common` derive the CSS. It fills in panels, states, shades, swatches and palettes, and enforces WCAG contrast. Then look at the result until it is right.

- Token reference and the JSON Schema: `references/tokens.md`.
- Lessons paid for in earlier passes: `references/pitfalls.md`. Read it before hand-editing CSS.
- Variable reference for library consumers: `docs/theming.md` in the excalidraw repo.

## 1. Turn the input into tokens

Start from the closest sample. `packages/excalidraw/themes/index.json` (shipped in the package as `@excalidraw/excalidraw/themes/index.json`) lists the 18 sample themes with their look, mode, pen and caveats. They are meant to be read and adapted. For a generated one, copy its `<name>.tokens.json`. For a hand-written one, read its `<name>.css` for the choices and write tokens that make them. The draw MCP server will serve the same files as `theme://index`, `theme://<name>/css` and `theme://<name>/tokens` (planned, not yet available).

- **From a vibe** ("Westworld title card"): name the instrument and the material first. What draws (technical pen, pencil, marker, phosphor trace)? On what (paper, film, screen, slate)? Pick a canvas, one ink, one accent and four to six palette colors that belong to that world. Fewer colors read as more deliberate.
- **From a palette:** assign canvas (the most common, quietest color), ink (the darkest), accent (the one meant to catch the eye), and put the rest in `palette`.
- **From a reference image:** extract its flat colors, then judge them against the image. In the excalidraw repo:
  ```sh
  node scripts/theme-gen/palette-from-image.mjs <image> --name "Theme Name"
  ```
  It prints each color with its share of the image and a starter token file that already passes the generator's contrast checks. The role guesses are mechanical: look at the image and correct them. Drop colors that come from lighting (shadow tints, highlights). Keep the colors of the objects. Thin outlines get averaged with their surroundings, so read the outline color off the image by eye. Without the script, name five to eight flat colors yourself.

Each palette color does two jobs: at full strength it is a stroke swatch, and mixed about 32% into the canvas it is the fill wash under labels. On a mid-tone canvas those washes turn gray, so pick hues deeper and more saturated than the fills you want to see.

Decide the stroke character with the same care as the colors. Colors alone leave the default blunt whiteboard look.

| Instrument | stroke width, roughness, roundness | arrowhead | canvas font | pen (pressure, width, thinning, taper) |
| --- | --- | --- | --- | --- |
| Technical pen | `thin`, `0`, `sharp` | `arrow` or `bar` | `Liberation Sans` | yes, `0.2`, `0.2`, `4` |
| CAD trace | `thin`, `0`, `sharp` | `triangle` | `Cascadia` | no, `0.4` |
| Illustration outline | `medium`, `0`, `round` | `arrow` | `Nunito` | yes, `0.35`, `0.3`, `3` |
| Pencil | `medium`, `2`, `round` | `arrow` | `Excalifont` | yes, `0.35`, `0.75`, `6` |
| Marker | `bold`, `0`, `sharp` | `triangle` | `Cascadia` | no, `2.5` |
| Pixel pencil | `thin`, `0`, `sharp` | `arrow` | `Liberation Sans` | no, `0.5`, streamline `0` |

Freedraw widths are small numbers. A constant pen draws about 2.8 times its width in pixels and a pressure pen up to about 4.25 times: `0.2` is a hairline, `2.5` a fat marker.

## 2. The loop: apply, screenshot, judge, adjust

1. **Apply.** Generate the CSS from the tokens and put it on an editor.
2. **Screenshot.** Capture the scene with a selection, the color picker, the help dialog and the pen at 2.5x, on desktop and phone.
3. **Judge.** Read the images themselves, against the checklist below. A green command proves nothing about how a theme looks.
4. **Adjust.** Fix the biggest failure in the tokens, not in the CSS, and go back to 1. Small independent fixes (a hint color, one swatch) can ride along with it; change only one structural thing (palette, stroke character, surface style) per iteration, so the next sheet shows what it did.

Every warning from `generateThemeCss` is `{token, from, to, reason}`: a color it had to move so text or ink stays legible, a color dark mode cannot display, or a `mode` that fights the canvas. Prefer changing the token over accepting the move.

Stop when a full pass of the checklist finds nothing worth fixing. Keep a count of iterations and one line per iteration on what changed and why.

### Running the loop locally (excalidraw repo, Playwright)

```sh
yarn theme:gen <id>
node scripts/theme-screenshots/shoot.mjs --themes <id> --viewports desktop,phone --states selected,colorpicker,dialog,pen --out theme-screenshots/<id>/iter<N> --sheet
```

`yarn theme:gen` (or `corepack yarn theme:gen` where `yarn` is not on the PATH) writes `packages/excalidraw/themes/<id>.css` from `<id>.tokens.json` beside it and prints the warnings. A new theme also needs an entry in `themes/index.json`; `sampleThemes.test.ts` fails until the index and the files agree. The `pen` state writes both the 100% shot and the 2.5x close-up, `penzoom`. The harness drives the playground in the installed Chromium and tiles every shot into `theme-screenshots/<id>/iter<N>/<id>/sheet.png`: read that one image. To check for twins, shoot the theme beside its nearest neighbours and read the contact sheet:

```sh
node scripts/theme-screenshots/shoot.mjs --themes <id>,<neighbour>,<neighbour> --viewports desktop --states selected --out theme-screenshots/<id>/contact --contact selected
```

When the loop is done, shoot every viewport and state once into `theme-screenshots/<id>/final` (drop `--viewports` and `--states`, add `--video` for a live pen recording), and check one state in Firefox and WebKit with `--browser firefox` and `--browser webkit`.

Optional, this machine only: `node D:/projects/_scratch/excalidraw-theme-gallery/publish.mjs` copies the screenshots to the gallery the user reads on a phone. Elsewhere, attach the sheet to the PR instead.

### Running the loop on a draw board (planned)

The draw MCP is planned to grow a theme tool that takes the tokens, calls `generateThemeCss` and applies the CSS to the open board, returning the warnings. With it, the loop is: the theme tool, then draw's existing `screenshot` tool on the board, then judge and adjust the tokens. Until that tool exists, use the local harness.

## 3. The checklist

- **Structural, not decorative.** For every element on screen, ask whether it does a job. Remove texture, grain, vignettes, glows that carry nothing, and borders that only frame. A drafting or museum theme must "look at home in a high-prestige title sequence".
- **Identity at thumbnail size.** Would this theme be mistaken for another one in the set? Compare contact sheets. Twins get merged or cut.
- **The pen is the instrument.** Read the 2.5x pen shot. A technical pen is hairline with a faint taper, a pencil thins and tapers hard, a marker is fat and even. If it looks like the default marker, the pen tokens are wrong.
- **Labels read.** Text on every fill, the selected tool's icon, panel headings, dialog keycaps, the hint under the toolbar.
- **Popovers are opaque.** The color picker must not show the scene through it.
- **Frames sit behind content.** A frame drawn heavier than the shapes inside it is wrong.
- **The grid carries the theme, quietly.** Judge it at 100% zoom. Graph paper wants solid minors at about 0.15 to 0.2 alpha and majors at about 0.45.
- **Menus and dialogs.** The main menu, the help dialog and its keycaps, the color picker.
- **Phone is not an afterthought.** The bottom toolbar, the stacked scene, the picker at phone width.

The sample scene outlines each shape in its palette color. A theme built on one dark outline around colored fills shows that outline only in shapes drawn after the theme applies; judge the outline in the pen and hint shots, or draw a shape by hand.

## Dark themes

In dark mode the editor shows element colors through a lightness-inverting filter, so scenes stay portable between modes. Write `"mode": "dark"` and give displayed colors: the generator stores their inverse and warns about any it cannot display (white tops out at `#ededed`, no bright yellow, cyan turns teal, green stops at `#6fc76f`). UI and canvas colors are not filtered, so neon belongs there.

A dark canvas needs `"mode": "dark"`. A board is shared, and ink drawn under other themes is black by default: on a dark canvas in light mode it is invisible. The generator warns on `mode` whenever the canvas and the mode disagree. Terminal accepts dark mode's `#6fc76f` for its element greens and keeps full phosphor in its UI text for this reason.
