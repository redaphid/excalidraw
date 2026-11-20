import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import { defaultLang, languages } from "@excalidraw/excalidraw/i18n";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  screen,
  fireEvent,
  waitFor,
  render,
} from "@excalidraw/excalidraw/tests/test-utils";

import { LanguageList } from "../app-language/LanguageList";
import { useAppLangCode } from "../app-language/language-state";
import { Provider } from "../app-jotai";

const TEST_LANG_CODE = "fr-FR";

const TestApp = () => {
  const [langCode] = useAppLangCode();

  return (
    <Excalidraw langCode={langCode}>
      <MainMenu>
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.ItemCustom>
          <LanguageList />
        </MainMenu.ItemCustom>
      </MainMenu>
    </Excalidraw>
  );
};

describe("Test LanguageList", () => {
  it("rerenders UI on language change", async () => {
    expect(languages.some((lang) => lang.code === TEST_LANG_CODE)).toBe(true);

    await render(
      <Provider>
        <TestApp />
      </Provider>,
    );

    // open the main menu, which holds the language picker
    API.setAppState({ openMenu: "canvas" });
    // english lang should display the `Reset the canvas` label
    expect(screen.queryByText(/reset the canvas/i)).not.toBeNull();

    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: TEST_LANG_CODE },
    });
    // switching to French, `Reset the canvas` label should no longer exist
    await waitFor(() => expect(screen.queryByText(/reset the canvas/i)).toBeNull());
    // reset language
    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: defaultLang.code },
    });
    // switching back to English
    await waitFor(() => expect(screen.queryByText(/reset the canvas/i)).not.toBeNull());
  });
});
