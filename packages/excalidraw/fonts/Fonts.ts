import {
  FONT_FAMILY,
  FONT_FAMILY_FALLBACKS,
  CJK_HAND_DRAWN_FALLBACK_FONT,
  WINDOWS_EMOJI_FALLBACK_FONT,
  getFontFamilyFallbacks,
  FONT_SIZES,
} from "@excalidraw/common";
import { getContainerElement } from "@excalidraw/element";
import { charWidth } from "@excalidraw/element";
import { containsCJK } from "@excalidraw/element";

import {
  FONT_METADATA,
  type FontMetadata,
  getFontInstanceFamily,
  getFontString,
  getFontVariationSettings,
  PromisePool,
  promiseTry,
} from "@excalidraw/common";

import { ShapeCache } from "@excalidraw/element";

import { isTextElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import type { ValueOf } from "@excalidraw/common/utility-types";

import type { Scene } from "@excalidraw/element";

import { CascadiaFontFaces } from "./Cascadia";
import { ComicShannsFontFaces } from "./ComicShanns";
import { EmojiFontFaces } from "./Emoji";
import {
  ExcalidrawFontFace,
  type FontFaceVariationDescriptors,
} from "./ExcalidrawFontFace";
import { ExcalifontFontFaces } from "./Excalifont";
import { HelveticaFontFaces } from "./Helvetica";
import { LiberationFontFaces } from "./Liberation";
import { LilitaFontFaces } from "./Lilita";
import { NunitoFontFaces } from "./Nunito";
import { RecentlyUsed } from "./RecentlyUsed";
import { ShantellSansFontFaces } from "./ShantellSans";
import { VirgilFontFaces } from "./Virgil";
import { XiaolaiFontFaces } from "./Xiaolai";

/**
 * How many instances of variable fonts a document keeps font faces for, beyond
 * those the elements last loaded draw with. Every instance is its own family
 * of faces, and a text's `fontAxes` can name thousands.
 */
const MAX_INSTANCE_FACES = 64;

export class Fonts {
  // it's ok to track fonts across multiple instances only once, so let's use
  // a static member to reduce memory footprint
  public static readonly loadedFontsCache = new Set<string>();

  /**
   * Characters whose font faces `document.fonts` confirmed loaded, per
   * document and font family. A loaded face stays loaded for the document's
   * lifetime, so later loads skip `fonts.check` for these characters.
   */
  private static readonly loadedChars = new WeakMap<
    Document,
    Map<ExcalidrawTextElement["fontFamily"], Set<string>>
  >();

  /** The font faces made for variable font instances, per document. */
  private static readonly instanceFaces = new WeakMap<
    Document,
    RecentlyUsed<FontFace[]>
  >();

  private static _registered:
    | Map<
        number,
        {
          metadata: FontMetadata;
          fontFaces: ExcalidrawFontFace[];
        }
      >
    | undefined;

  private static _initialized: boolean = false;

  public static get registered() {
    // lazy load the font registration
    if (!Fonts._registered) {
      Fonts._registered = Fonts.init();
    } else if (!Fonts._initialized) {
      // case when host app register fonts before they are lazy loaded
      // don't override whatever has been previously registered
      Fonts._registered = new Map([
        ...Fonts.init().entries(),
        ...Fonts._registered.entries(),
      ]);
    }

    return Fonts._registered;
  }

  public get registered() {
    return Fonts.registered;
  }

  private readonly scene: Scene;
  private readonly ownerDocument: Document;

  constructor(scene: Scene, ownerDocument: Document = document) {
    this.scene = scene;
    this.ownerDocument = ownerDocument;
  }

  /**
   * Get all the font families for the given scene.
   */
  public getSceneFamilies = () => {
    return Fonts.getUniqueFamilies(this.scene.getNonDeletedElements());
  };

  /**
   * if we load a (new) font, it's likely that text elements using it have
   * already been rendered using a fallback font. Thus, we want invalidate
   * their shapes and rerender. See #637.
   *
   * Invalidates text elements and rerenders scene, provided that at least one
   * of the supplied fontFaces has not already been processed.
   */
  public onLoaded = (fontFaces: readonly FontFace[]): void => {
    // bail if all fonts with have been processed. We're checking just a
    // subset of the font properties (though it should be enough), so it
    // can technically bail on a false positive.
    let shouldBail = true;

    for (const fontFace of fontFaces) {
      const sig = `${fontFace.family}-${fontFace.style}-${fontFace.weight}-${fontFace.unicodeRange}`;

      // make sure to update our cache with all the loaded font faces
      if (!Fonts.loadedFontsCache.has(sig)) {
        Fonts.loadedFontsCache.add(sig);
        shouldBail = false;
      }
    }

    if (shouldBail) {
      return;
    }

    let didUpdate = false;

    const elementsMap = this.scene.getNonDeletedElementsMap();

    for (const element of this.scene.getNonDeletedElements()) {
      if (isTextElement(element)) {
        didUpdate = true;
        ShapeCache.delete(element);

        // clear the width cache, so that we don't perform subsequent wrapping based on the stale fallback font metrics
        charWidth.clearCache(getFontString(element));

        const container = getContainerElement(element, elementsMap);
        if (container) {
          ShapeCache.delete(container);
        }
      }
    }

    if (didUpdate) {
      this.scene.triggerUpdate();
    }
  };

  /**
   * Load font faces for a given scene and trigger scene update.
   */
  public loadSceneFonts = async (): Promise<FontFace[]> => {
    const sceneFamilies = this.getSceneFamilies();
    const elements = this.scene.getNonDeletedElements();
    const charsPerFamily = Fonts.getCharsPerFamily(elements);

    const [fontFaces, instanceFaces] = await Promise.all([
      Fonts.loadFontFaces(sceneFamilies, charsPerFamily, this.ownerDocument),
      Fonts.loadInstanceFaces(elements, this.ownerDocument),
    ]);
    return [...fontFaces, ...instanceFaces];
  };

  /**
   * Load font faces for passed elements - use when the scene is unavailable (i.e. export).
   */
  public static loadElementsFonts = async (
    elements: readonly ExcalidrawElement[],
    ownerDocument: Document = document,
  ): Promise<FontFace[]> => {
    const fontFamilies = Fonts.getUniqueFamilies(elements);
    const charsPerFamily = Fonts.getCharsPerFamily(elements);

    const [fontFaces, instanceFaces] = await Promise.all([
      Fonts.loadFontFaces(fontFamilies, charsPerFamily, ownerDocument),
      Fonts.loadInstanceFaces(elements, ownerDocument),
    ]);
    return [...fontFaces, ...instanceFaces];
  };

  /**
   * The font instances the elements draw with, by the family name their
   * faces go under (see `getFontInstanceFamily`), with the characters drawn
   * in each: one for every distinct `fontAxes` of a variable family that is
   * off the family's regular instance.
   */
  public static getInstances(elements: ReadonlyArray<ExcalidrawElement>) {
    const instances = new Map<
      string,
      {
        fontFamily: ExcalidrawTextElement["fontFamily"];
        fontAxes: ExcalidrawTextElement["fontAxes"];
        variationSettings: string;
        chars: Set<string>;
      }
    >();

    for (const element of elements) {
      if (!isTextElement(element)) {
        continue;
      }
      const { fontFamily, fontAxes } = element;
      const family = getFontInstanceFamily(fontFamily, fontAxes);
      const variationSettings = getFontVariationSettings(fontFamily, fontAxes);
      if (!family || !variationSettings) {
        continue;
      }
      const instance = instances.get(family) ?? {
        fontFamily,
        fontAxes,
        variationSettings,
        chars: new Set<string>(),
      };
      for (const char of element.originalText) {
        instance.chars.add(char);
      }
      instances.set(family, instance);
    }

    return instances;
  }

  /**
   * Puts the faces of each font instance the elements draw with into
   * `document.fonts` and loads them, so text with `fontAxes` is measured and
   * drawn in its instance. The document keeps the faces of the instances
   * asked for most recently and lets go of the rest (`MAX_INSTANCE_FACES`).
   */
  private static async loadInstanceFaces(
    elements: ReadonlyArray<ExcalidrawElement>,
    ownerDocument: Document,
  ): Promise<FontFace[]> {
    const instances = Fonts.getInstances(elements);
    if (instances.size === 0) {
      return [];
    }

    let held = Fonts.instanceFaces.get(ownerDocument);
    if (!held) {
      held = new RecentlyUsed<FontFace[]>(MAX_INSTANCE_FACES, (fontFaces) => {
        for (const fontFace of fontFaces) {
          ownerDocument.fonts.delete(fontFace);
        }
      });
      Fonts.instanceFaces.set(ownerDocument, held);
    }

    for (const [family, { fontFamily, variationSettings }] of instances) {
      held.take(family, () => {
        const fontFaces = (
          Fonts.registered.get(fontFamily)?.fontFaces ?? []
        ).map((face) => face.instance(family, variationSettings));
        for (const fontFace of fontFaces) {
          ownerDocument.fonts.add(fontFace);
        }
        return fontFaces;
      });
    }
    held.trim(new Set(instances.keys()));

    const loaded = await Promise.all(
      Array.from(
        instances.values(),
        async ({ fontFamily, fontAxes, chars }) => {
          const font = getFontString({
            fontFamily,
            fontAxes,
            fontSize: FONT_SIZES.sm,
          });
          const text = Array.from(chars).join("");
          if (ownerDocument.fonts.check(font, text)) {
            return [];
          }
          try {
            return await ownerDocument.fonts.load(font, text);
          } catch (e) {
            // don't let it all fail if just one instance fails to load
            console.error(`Failed to load font "${font}"`, e);
            return [];
          }
        },
      ),
    );
    return loaded.flat();
  }

  /**
   * Generate CSS @font-face declarations for the given elements.
   */
  public static async generateFontFaceDeclarations(
    elements: readonly ExcalidrawElement[],
  ) {
    const families = Fonts.getUniqueFamilies(elements);
    const charsPerFamily = Fonts.getCharsPerFamily(elements);

    // for simplicity, assuming we have just one family with the CJK handdrawn fallback
    const familyWithCJK = families.find((x) =>
      getFontFamilyFallbacks(x).includes(CJK_HAND_DRAWN_FALLBACK_FONT),
    );

    if (familyWithCJK) {
      const characters = Fonts.getCharacters(charsPerFamily, familyWithCJK);

      if (containsCJK(characters)) {
        const family = FONT_FAMILY_FALLBACKS[CJK_HAND_DRAWN_FALLBACK_FONT];

        // adding the same characters to the CJK handrawn family
        charsPerFamily[family] = new Set(characters);

        // the order between the families and fallbacks is important, as fallbacks need to be defined first and in the reversed order
        // so that they get overriden with the later defined font faces, i.e. in case they share some codepoints
        families.unshift(FONT_FAMILY_FALLBACKS[CJK_HAND_DRAWN_FALLBACK_FONT]);
      }
    }

    // don't trigger hundreds of concurrent requests (each performing fetch, creating a worker, etc.),
    // instead go three requests at a time, in a controlled manner, without completely blocking the main thread
    // and avoiding potential issues such as rate limits
    const iterator = Fonts.fontFacesStylesGenerator(families, charsPerFamily);
    const concurrency = 3;
    const fontFaces = await new PromisePool(iterator, concurrency).all();

    // dedup just in case (i.e. could be the same font faces with 0 glyphs)
    return Array.from(new Set(fontFaces));
  }

  private static async loadFontFaces(
    fontFamilies: Array<ExcalidrawTextElement["fontFamily"]>,
    charsPerFamily: Record<number, Set<string>>,
    ownerDocument: Document,
  ) {
    // add all registered font faces into the `document.fonts` (if not added already)
    for (const { fontFaces, metadata } of Fonts.registered.values()) {
      // skip registering font faces for local fonts (i.e. Helvetica)
      if (metadata.local) {
        continue;
      }

      for (const { fontFace } of fontFaces) {
        if (!ownerDocument.fonts.has(fontFace)) {
          ownerDocument.fonts.add(fontFace);
        }
      }
    }

    // loading 10 font faces at a time, in a controlled manner
    const iterator = Fonts.fontFacesLoader(
      fontFamilies,
      charsPerFamily,
      ownerDocument,
    );
    const concurrency = 10;
    const fontFaces = await new PromisePool(iterator, concurrency).all();
    return fontFaces.flat().filter(Boolean);
  }

  private static loadedCharsOf(
    ownerDocument: Document,
    fontFamily: ExcalidrawTextElement["fontFamily"],
  ): Set<string> {
    let perFamily = Fonts.loadedChars.get(ownerDocument);
    if (!perFamily) {
      perFamily = new Map();
      Fonts.loadedChars.set(ownerDocument, perFamily);
    }
    let chars = perFamily.get(fontFamily);
    if (!chars) {
      chars = new Set();
      perFamily.set(fontFamily, chars);
    }
    return chars;
  }

  private static *fontFacesLoader(
    fontFamilies: Array<ExcalidrawTextElement["fontFamily"]>,
    charsPerFamily: Record<number, Set<string>>,
    ownerDocument: Document,
  ): Generator<Promise<void | readonly [number, FontFace[]]>> {
    for (const [index, fontFamily] of fontFamilies.entries()) {
      const font = getFontString({
        fontFamily,
        fontSize: FONT_SIZES.sm,
      });

      // WARN: without "text" param it does not have to mean that all font faces are loaded as it could be just one irrelevant font face!
      // instead, we are always checking chars used in the family, so that no required font faces remain unloaded
      const loaded = Fonts.loadedCharsOf(ownerDocument, fontFamily);
      const pending = Array.from(charsPerFamily[fontFamily] ?? []).filter(
        (char) => !loaded.has(char),
      );
      if (pending.length === 0) {
        continue;
      }
      const text = pending.join("");
      const confirmLoaded = () => {
        for (const char of pending) {
          loaded.add(char);
        }
      };

      if (ownerDocument.fonts.check(font, text)) {
        confirmLoaded();
      } else {
        yield promiseTry(async () => {
          try {
            // WARN: browser prioritizes loading only font faces with unicode ranges for characters which are present in the document (html & canvas), other font faces could stay unloaded
            // we might want to retry here, i.e.  in case CDN is down, but so far I didn't experience any issues - maybe it handles retry-like logic under the hood
            const fontFaces = await ownerDocument.fonts.load(font, text);
            confirmLoaded();

            return [index, fontFaces];
          } catch (e) {
            // don't let it all fail if just one font fails to load
            console.error(
              `Failed to load font "${font}" from urls "${Fonts.registered
                .get(fontFamily)
                ?.fontFaces.map((x) => x.urls)}"`,
              e,
            );
          }
        });
      }
    }
  }

  private static *fontFacesStylesGenerator(
    families: Array<number>,
    charsPerFamily: Record<number, Set<string>>,
  ): Generator<Promise<void | readonly [number, string]>> {
    for (const [familyIndex, family] of families.entries()) {
      const { fontFaces, metadata } = Fonts.registered.get(family) ?? {};

      if (!Array.isArray(fontFaces)) {
        console.error(
          `Couldn't find registered fonts for font-family "${family}"`,
          Fonts.registered,
        );
        continue;
      }

      if (metadata?.local) {
        // don't inline local fonts
        continue;
      }

      for (const [fontFaceIndex, fontFace] of fontFaces.entries()) {
        yield promiseTry(async () => {
          try {
            const characters = Fonts.getCharacters(charsPerFamily, family);
            const fontFaceCSS = await fontFace.toCSS(characters);

            if (!fontFaceCSS) {
              return;
            }

            // giving a buffer of 10K font faces per family
            const fontFaceOrder = familyIndex * 10_000 + fontFaceIndex;
            const fontFaceTuple = [fontFaceOrder, fontFaceCSS] as const;

            return fontFaceTuple;
          } catch (error) {
            console.error(
              `Couldn't transform font-face to css for family "${fontFace.fontFace.family}"`,
              error,
            );
          }
        });
      }
    }
  }

  /**
   * Register a new font.
   *
   * @param family font family
   * @param metadata font metadata
   * @param fontFacesDecriptors font faces descriptors
   */
  private static register(
    this:
      | Fonts
      | {
          registered: Map<
            number,
            { metadata: FontMetadata; fontFaces: ExcalidrawFontFace[] }
          >;
        },
    family: string,
    metadata: FontMetadata,
    ...fontFacesDecriptors: ExcalidrawFontFaceDescriptor[]
  ) {
    // TODO: likely we will need to abandon number value in order to support custom fonts
    const fontFamily =
      FONT_FAMILY[family as keyof typeof FONT_FAMILY] ??
      FONT_FAMILY_FALLBACKS[family as keyof typeof FONT_FAMILY_FALLBACKS];

    const registeredFamily = this.registered.get(fontFamily);

    if (!registeredFamily) {
      this.registered.set(fontFamily, {
        metadata,
        fontFaces: fontFacesDecriptors.map(
          ({ uri, descriptors }) =>
            new ExcalidrawFontFace(family, uri, descriptors),
        ),
      });
    }

    return this.registered;
  }

  /**
   * WARN: should be called just once on init, even across multiple instances.
   */
  private static init() {
    const fonts = {
      registered: new Map<
        ValueOf<typeof FONT_FAMILY | typeof FONT_FAMILY_FALLBACKS>,
        { metadata: FontMetadata; fontFaces: ExcalidrawFontFace[] }
      >(),
    };

    const init = (
      family: keyof typeof FONT_FAMILY | keyof typeof FONT_FAMILY_FALLBACKS,
      ...fontFacesDescriptors: ExcalidrawFontFaceDescriptor[]
    ) => {
      const fontFamily =
        FONT_FAMILY[family as keyof typeof FONT_FAMILY] ??
        FONT_FAMILY_FALLBACKS[family as keyof typeof FONT_FAMILY_FALLBACKS];

      // default to Excalifont metrics
      const metadata =
        FONT_METADATA[fontFamily] ?? FONT_METADATA[FONT_FAMILY.Excalifont];

      Fonts.register.call(fonts, family, metadata, ...fontFacesDescriptors);
    };

    init("Cascadia", ...CascadiaFontFaces);
    init("Comic Shanns", ...ComicShannsFontFaces);
    init("Excalifont", ...ExcalifontFontFaces);
    // keeping for backwards compatibility reasons, uses system font (Helvetica on MacOS, Arial on Win)
    init("Helvetica", ...HelveticaFontFaces);
    // used for server-side pdf & png export instead of helvetica (technically does not need metrics, but kept in for consistency)
    init("Liberation Sans", ...LiberationFontFaces);
    init("Lilita One", ...LilitaFontFaces);
    init("Nunito", ...NunitoFontFaces);
    init("Shantell Sans", ...ShantellSansFontFaces);
    init("Virgil", ...VirgilFontFaces);

    // fallback font faces
    init(CJK_HAND_DRAWN_FALLBACK_FONT, ...XiaolaiFontFaces);
    init(WINDOWS_EMOJI_FALLBACK_FONT, ...EmojiFontFaces);

    Fonts._initialized = true;

    return fonts.registered;
  }

  /**
   * Get all the unique font families for the given elements.
   */
  private static getUniqueFamilies(
    elements: ReadonlyArray<ExcalidrawElement>,
  ): Array<ExcalidrawTextElement["fontFamily"]> {
    return Array.from(
      elements.reduce((families, element) => {
        if (isTextElement(element)) {
          families.add(element.fontFamily);
        }
        return families;
      }, new Set<number>()),
    );
  }

  /**
   * Get all the unique characters per font family for the given scene.
   */
  private static getCharsPerFamily(
    elements: ReadonlyArray<ExcalidrawElement>,
  ): Record<number, Set<string>> {
    const charsPerFamily: Record<number, Set<string>> = {};

    for (const element of elements) {
      if (!isTextElement(element)) {
        continue;
      }

      // gather unique codepoints only when inlining fonts
      for (const char of element.originalText) {
        if (!charsPerFamily[element.fontFamily]) {
          charsPerFamily[element.fontFamily] = new Set();
        }

        charsPerFamily[element.fontFamily].add(char);
      }
    }

    return charsPerFamily;
  }

  /**
   * Get characters for a given family.
   */
  private static getCharacters(
    charsPerFamily: Record<number, Set<string>>,
    family: number,
  ) {
    return charsPerFamily[family]
      ? Array.from(charsPerFamily[family]).join("")
      : "";
  }

  /**
   * Get all registered font families.
   */
  private static getAllFamilies() {
    return Array.from(Fonts.registered.keys());
  }
}

export interface ExcalidrawFontFaceDescriptor {
  uri: string;
  descriptors?: FontFaceVariationDescriptors;
}
