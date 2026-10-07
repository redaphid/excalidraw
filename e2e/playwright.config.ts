import { defineConfig } from "@playwright/test";

import type { PlaywrightTestOptions } from "@playwright/test";

const BROWSERS = ["chromium", "firefox", "webkit"] as const;

const FORM_FACTORS: Record<string, Partial<PlaywrightTestOptions>> = {
  desktop: { viewport: { width: 1440, height: 900 }, hasTouch: false },
  tablet: {
    viewport: { width: 1024, height: 1366 },
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  phone: {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    deviceScaleFactor: 3,
  },
};

const browsers = process.env.E2E_BROWSER
  ? [process.env.E2E_BROWSER as typeof BROWSERS[number]]
  : BROWSERS;

const PORT = 4173;

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 3,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `http-server ../playground/dist -p ${PORT} -a 127.0.0.1 -s`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
  projects: browsers.flatMap((browserName) =>
    Object.entries(FORM_FACTORS).map(([formFactor, options]) => ({
      name: `${browserName}-${formFactor}`,
      use: { browserName, ...options },
    })),
  ),
});
