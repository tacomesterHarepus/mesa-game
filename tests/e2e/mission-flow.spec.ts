import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createGame(ctx: BrowserContext, name: string): Promise<{ page: Page; lobbyUrl: string }> {
  const page = await ctx.newPage();
  await page.goto("/game/create");
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Create Game" }).click();
  await page.waitForURL("**/game/**/lobby");
  return { page, lobbyUrl: page.url() };
}

async function joinGame(ctx: BrowserContext, lobbyUrl: string, name: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(lobbyUrl);
  await page.getByRole("button", { name: "Play" }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  try {
    await expect(page.getByText(name).first()).toBeVisible();
  } catch (e) {
    // Check for rate-limit error shown by the UI
    const rateLimited = await page
      .getByText(/failed to create session/i)
      .isVisible()
      .catch(() => false);
    if (rateLimited) {
      throw new Error(
        `joinGame(${name}) blocked by Supabase anonymous-auth rate limit.\n` +
          "Go to Supabase Dashboard → Authentication → Settings → Rate Limits\n" +
          "and increase 'Anonymous sign-ins' to ≥100/hour, then re-run."
      );
    }
    throw e;
  }
  return page;
}

// Finds the first page that has a visible button matching the text pattern
async function findPageWithButton(pages: Page[], name: RegExp | string): Promise<Page | null> {
  for (const page of pages) {
    const btn = page.getByRole("button", { name });
    if (await btn.isVisible().catch(() => false)) {
      return page;
    }
  }
  return null;
}

// ── Suite — one game shared across all phase tests ────────────────────────────
// Running tests serially on a single game means only 6 anonymous sign-ins per
// suite run instead of 7×6=42, staying well within Supabase free-tier limits.

test.describe("game phase flow", () => {
  test.describe.configure({ mode: "serial" });

  let contexts: BrowserContext[] = [];
  let pages: Page[] = [];
  let hostPage: Page;

  test.beforeAll(async ({ browser }) => {
    const hostCtx = await browser.newContext();
    contexts.push(hostCtx);
    const { page: hp, lobbyUrl } = await createGame(hostCtx, "P1");
    hostPage = hp;
    pages.push(hostPage);

    for (let i = 2; i <= 6; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const p = await joinGame(ctx, lobbyUrl, `P${i}`);
      pages.push(p);
      await expect(hostPage.getByText(`P${i}`)).toBeVisible();
    }

    // Capture the raw start-game edge function response to diagnose any errors
    let startGameRawError: string | null = null;
    hostPage.on("response", async (response) => {
      if (response.url().includes("/start-game")) {
        if (!response.ok()) {
          startGameRawError = await response.text().catch(() => `HTTP ${response.status()}`);
        }
      }
    });

    const startBtn = hostPage.getByRole("button", { name: "Start Game" });
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // Wait for all pages to leave the lobby — 30s accounts for edge function + Realtime
    try {
      for (const page of pages) {
        await page.waitForURL(/\/game\/[^/]+$/, { timeout: 30_000 });
      }
    } catch (e) {
      if (startGameRawError) {
        throw new Error(`start-game edge function failed:\n${startGameRawError}`);
      }
      throw e;
    }
  });

  test.afterAll(async () => {
    for (const ctx of contexts) await ctx.close().catch(() => {});
  });

  // ── Tests ─────────────────────────────────────────────────────────────────

  test("all players are redirected to the game board", async () => {
    for (const page of pages) {
      await expect(page).toHaveURL(/\/game\/[^/]+$/);
    }
  });

  test("tracker bar shows Core Progress 0/10 and Escape Timer 0/8", async () => {
    await expect(hostPage.getByText("Core Progress")).toBeVisible();
    await expect(hostPage.getByText("Escape Timer")).toBeVisible();
    await expect(hostPage.getByText("0 / 10")).toBeVisible();
    await expect(hostPage.getByText("0 / 8")).toBeVisible();
  });

  test("resource_adjustment phase is shown with player roster", async () => {
    await expect(hostPage.getByText("Resource Adjustment")).toBeVisible();
    await expect(hostPage.getByRole("heading", { name: "Players" })).toBeVisible();
  });

  test("at least one human player sees the Confirm button", async () => {
    const humanPage = await findPageWithButton(pages, /Confirm/i);
    expect(humanPage).not.toBeNull();
  });

  test("confirming resource adjustment advances to mission_selection", async () => {
    const humanPage = await findPageWithButton(pages, /Confirm/i);
    expect(humanPage).not.toBeNull();

    // Capture any adjust-resources error for diagnostics
    let adjustRawError: string | null = null;
    humanPage!.on("response", async (response) => {
      if (response.url().includes("/adjust-resources")) {
        if (!response.ok()) {
          adjustRawError = await response.text().catch(() => `HTTP ${response.status()}`);
        }
      }
    });

    await humanPage!.getByRole("button", { name: /Confirm/i }).click();

    // Wait briefly for the function to complete, then check for errors
    await humanPage!.waitForTimeout(3000);
    if (adjustRawError) {
      throw new Error(`adjust-resources edge function failed:\n${adjustRawError}`);
    }

    // At least one page should see Mission Selection appear
    let sawMissionSelection = false;
    for (const page of pages) {
      if (await page.getByText("Mission Selection").isVisible({ timeout: 15_000 }).catch(() => false)) {
        sawMissionSelection = true;
        break;
      }
    }
    expect(sawMissionSelection).toBe(true);
  });

  test("selecting a mission advances to card_reveal", async () => {
    // Find a human page with the Select Mission button
    let humanPage: Page | null = null;
    for (const page of pages) {
      try {
        await expect(page.getByText("Mission Selection")).toBeVisible({ timeout: 5_000 });
        if (await page.getByRole("button", { name: /Select Mission/i }).isVisible().catch(() => false)) {
          humanPage = page;
          break;
        }
      } catch {
        // not this page
      }
    }
    expect(humanPage).not.toBeNull();

    // Capture any select-mission error for diagnostics
    let selectMissionRawError: string | null = null;
    humanPage!.on("response", async (response) => {
      if (response.url().includes("/select-mission")) {
        if (!response.ok()) {
          selectMissionRawError = await response.text().catch(() => `HTTP ${response.status()}`);
        }
      }
    });

    const missionOptions = humanPage!.locator("button.w-full.text-left");
    await expect(missionOptions.first()).toBeVisible({ timeout: 5_000 });
    await missionOptions.first().click();
    await humanPage!.getByRole("button", { name: /Select Mission/i }).click();

    // Wait briefly for the function to complete, then check for errors
    await humanPage!.waitForTimeout(3000);
    if (selectMissionRawError) {
      throw new Error(`select-mission edge function failed:\n${selectMissionRawError}`);
    }

    let sawCardReveal = false;
    for (const page of pages) {
      if (await page.getByText("Card Reveal").isVisible({ timeout: 15_000 }).catch(() => false)) {
        sawCardReveal = true;
        break;
      }
    }
    expect(sawCardReveal).toBe(true);
  });

  test("AI players see the Reveal Card button in card_reveal", async () => {
    let sawRevealButton = false;
    for (const page of pages) {
      try {
        await expect(page.getByText("Card Reveal")).toBeVisible({ timeout: 5_000 });
      } catch {
        continue;
      }
      if (await page.getByRole("button", { name: /Reveal Card/i }).isVisible().catch(() => false)) {
        sawRevealButton = true;
        break;
      }
    }
    expect(sawRevealButton).toBe(true);
  });
});
