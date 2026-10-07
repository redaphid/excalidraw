---
name: excalidraw-theming
description: This skill should be used when the user asks to "make a theme", "theme the board", "css for excalidraw", "make it look like <X>", "match this image", "make an Excalidraw theme", "restyle the editor", "change the grid", "make the pen look like <X>", or "fix a theme". It generates a theme for this Excalidraw fork's `css` prop from a text vibe, a palette or a reference image, through a token file and scripts/theme-gen, then runs the screenshot, read and fix loop until the theme holds up.
---

# Excalidraw theming

A theme is one CSS string passed to `<Excalidraw css={...}>`. It restyles the DOM UI, and it sets custom properties that the editor reads to paint the canvas and to choose the stroke character of new elements. Write a theme as a small token file and let `scripts/theme-gen` derive the CSS: it fills in panels, states, shades, swatches and palettes, and enforces WCAG contrast. Then look at the result until it is right.

- Token reference: `references/tokens.md`.
- Lessons paid for in earlier passes: `references/pitfalls.md`. Read it before hand-editing CSS.
- Variable reference for library consumers: `docs/theming.md`.

## 1. Turn the input into tokens

Create `playground/themes/tokens/<id>.json`. Copy the closest existing token file, then change it.

- **From a vibe** ("Westworld title card"): name the instrument and the material first. What draws (technical pen, pencil, marker, phosphor trace)? On what (paper, film, screen, slate)? Pick a canvas, one ink, one accent and four to six palette colors that belong to that world. Fewer colors read as more deliberate.
- **From a palette:** assign canvas (the most common, quietest color), ink (the darkest), accent (the one meant to catch the eye), and put the rest in `palette`.
- **From a reference image:** extract its flat colors, then judge them against the image:
  ```sh
  node scripts/theme-gen/palette-from-image.mjs <image> --name "Theme Name"
  ```
  It prints each color with its share of the image and a starter token file. The role guesses are mechanical: look at the image and correct them. Drop colors that come from lighting (shadow tints, highlights). Keep the colors of the objects.

Decide the stroke character with the same care as the colors. Colors alone leave the default blunt whiteboard look.

| Instrument | stroke width, roughness, roundness | arrowhead | canvas font | pen (pressure, width, thinning, taper) |
| --- | --- | --- | --- | --- |
| Technical pen | `thin`, `0`, `sharp` | `arrow` or `bar` | `Liberation Sans` | yes, `0.2`, `0.2`, `4` |
| CAD trace | `thin`, `0`, `sharp` | `triangle` | `Cascadia` | no, `0.4` |
| Illustration outline | `medium`, `0`, `round` | `arrow` | `Nunito` | yes, `0.35`, `0.3`, `3` |
| Pencil | `medium`, `2`, `round` | `arrow` | `Excalifont` | yes, `0.35`, `0.75`, `6` |
| Marker | `bold`, `0`, `sharp` | `triangle` | `Cascadia` | no, `2.5` |
| Pixel pencil | `thin`, `0`, `sharp` | `arrow` | `Liberation Sans` | no, `0.5`, streamline `0` |

Freedraw widths are small numbers: `0.2` is a hairline, `1` is about 3 px, `2.5` is a fat marker.

## 2. Generate

```sh
yarn theme:gen <id>
```

It writes `playground/themes/<id>.css` and prints every contrast fix it made, such as `secondary text: #7b7c7b -> #696969 (3.53 -> 4.62)`. A printed fix means a token is close to illegible. Prefer changing the token over accepting the nudge. Put component rules in the token's `extra`, each prefixed with `:scope `.

## 3. Shoot one theme

```sh
node scripts/theme-screenshots/shoot.mjs --themes <id> --viewports desktop,phone --states selected,colorpicker,dialog,pen --out theme-screenshots/<id>/iter<N> --sheet
```

`--sheet` tiles every shot into `theme-screenshots/<id>/iter<N>/<id>/sheet.png`. Number the iterations, so a later reader can see how the theme got where it is.

## 4. Read the sheet, then fix the biggest problem

Read the sheet image itself. A green command proves nothing about how a theme looks. Go through the checklist, write down every failure, fix the biggest one in the tokens, and go back to step 2.

- **Structural, not decorative.** For every element on screen, ask whether it does a job. Remove texture, grain, vignettes, glows that carry nothing, and borders that only frame. A drafting or museum theme must "look at home in a high-prestige title sequence".
- **Identity at thumbnail size.** Would this theme be mistaken for another one in the set? Compare it on a contact sheet (`--contact selected` over a directory of themes). Twins get merged or cut.
- **The pen is the instrument.** Read `penzoom`. A technical pen is hairline with a faint taper; a pencil thins and tapers hard; a marker is fat and even. If it looks like the default marker, the pen tokens are wrong.
- **Labels read.** Text on every fill, the selected tool's icon, panel headings, dialog keycaps, the hint text under the toolbar.
- **Popovers are opaque.** The color picker must not show the scene through it.
- **Frames sit behind content.** A frame drawn heavier than the shapes inside it is wrong.
- **The grid carries the theme, quietly.** Judge it at 100% zoom. Graph paper wants solid minors at about 0.15 to 0.2 alpha and majors at about 0.45.
- **Phone is not an afterthought.** The bottom toolbar, the stacked scene, the color picker at phone width.

Stop when a full pass of the checklist finds nothing worth fixing. Then shoot all viewports and states once (drop `--viewports` and `--states`, add `--video` for a live pen recording), and check one state in Firefox and WebKit with `--browser firefox` and `--browser webkit`.

## 5. Publish (optional, this machine only)

```sh
node D:/projects/_scratch/excalidraw-theme-gallery/publish.mjs
```

It copies `theme-screenshots` (except the baselines) to the Cloudflare gallery that the user reads on a phone. It exists only on this machine. Elsewhere, attach the sheet image to the PR instead.

## Dark themes

In dark mode the editor shows element colors through a lightness-inverting filter, so scenes stay portable between modes. Write `"mode": "dark"` and give displayed colors: the generator stores their inverse. The filter can't display saturated light colors (white tops out at `#ededed`, no bright yellow, cyan turns teal). For full-value neon on a dark canvas, use `"mode": "light"` with a dark `canvas`. The cost is that black ink drawn under another theme vanishes. The Terminal theme makes that trade.
