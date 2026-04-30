import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fillLobby(ctx: BrowserContext, hostName = "Bot1"): Promise<{ page: Page; gameId: string }> {
  const page = await ctx.newPage();
  await page.goto("/game/create");
  await page.getByLabel("Display name").fill(hostName);
  await page.getByRole("button", { name: "Dev Mode: Fill Lobby" }).click();
  await page.waitForURL("**/game/**/lobby?dev_mode=true");
  const match = page.url().match(/\/game\/([^/]+)\/lobby/);
  const gameId = match?.[1] ?? "";
  return { page, gameId };
}

async function startDevGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start Game" }).click();
  // Wait for the game board URL — not the lobby — with dev_mode=true.
  // The server component may briefly redirect back to lobby if it fetches the game
  // before start-game commits; the lobby re-navigates here once the phase updates.
  await page.waitForURL(
    (url) =>
      url.pathname.match(/\/game\/[^/]+$/) !== null &&
      url.searchParams.get("dev_mode") === "true",
    { timeout: 30000 }
  );
  // Let any pending server redirects finish before callers start asserting content.
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("Fill Lobby button is visible on create page in dev environment", async ({ page }) => {
  await page.goto("/game/create");
  await expect(page.getByRole("button", { name: "Dev Mode: Fill Lobby" })).toBeVisible();
});

test("Fill Lobby creates 6 players owned by same user and lands on lobby with dev_mode=true", async ({
  context,
}) => {
  const { page, gameId } = await fillLobby(context, "TestHost");

  // URL must contain dev_mode=true
  expect(page.url()).toContain("dev_mode=true");

  // All 6 bot names visible in player list
  for (const name of ["TestHost", "Bot2", "Bot3", "Bot4", "Bot5", "Bot6"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }

  expect(gameId).toMatch(/^[0-9a-f-]{36}$/);
});

test("PlayerSwitcher renders with all 6 player buttons after game starts", async ({
  context,
}) => {
  const { page } = await fillLobby(context);
  await startDevGame(page);

  // DEV MODE banner is visible
  await expect(page.getByText("DEV MODE — single-user testing")).toBeVisible();

  // All 6 player buttons visible in the switcher
  for (const name of ["Bot1", "Bot2", "Bot3", "Bot4", "Bot5", "Bot6"]) {
    await expect(page.getByRole("button", { name: new RegExp(name) }).first()).toBeVisible();
  }
});

test("Clicking a player button in the switcher highlights it as active", async ({
  context,
}) => {
  const { page } = await fillLobby(context);
  await startDevGame(page);

  // Find the Bot2 button in the switcher panel (fixed top-right area)
  const switcherPanel = page.locator(".fixed.top-7");
  const bot2Button = switcherPanel.getByRole("button", { name: /Bot2/ });
  await bot2Button.click();

  // After clicking, Bot2 button should have the amber ring (border-amber class)
  await expect(bot2Button).toHaveClass(/border-amber/);
});

test("DEV MODE banner is full-width and prominently visible", async ({
  context,
}) => {
  const { page } = await fillLobby(context);
  await startDevGame(page);

  const banner = page.locator(".fixed.top-0.left-0.right-0");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("DEV MODE");

  // Banner should span the full viewport width
  const box = await banner.boundingBox();
  expect(box).not.toBeNull();
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(box!.width).toBeCloseTo(viewportWidth, -1);
});

// Tests 6-7 share one game setup to avoid hitting Supabase anonymous-auth rate limits.
// All 5 independent tests above already consumed 5 sessions; a shared describe uses 1 more.
test.describe("dev mode shared game — phase content and chat", () => {
  test.describe.configure({ mode: "serial" });

  let sharedCtx: BrowserContext;
  let sharedPage: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    sharedCtx = await browser.newContext();
    const result = await fillLobby(sharedCtx);
    sharedPage = result.page;
    await startDevGame(sharedPage);
    // Wait for the DevModeOverlay — confirms the game board loaded in dev mode.
    await expect(sharedPage.getByText("DEV MODE — single-user testing")).toBeVisible({ timeout: 30000 });
    // Wait for game board to land on the first game phase (mission_selection).
    // The page might briefly redirect to lobby if server-renders before start-game commits;
    // if that happens, LobbyPhase will re-navigate to the game board within its 2s poll.
    await sharedPage.getByRole("heading", { name: "Mission Selection" }).waitFor({ state: "visible", timeout: 30000 });
  });

  test.afterAll(async () => {
    await sharedCtx.close().catch(() => {});
  });

  test("Switching to Bot3 highlights it as active in the switcher", async () => {
    const switcherPanel = sharedPage.locator(".fixed.top-7");
    const bot3 = switcherPanel.getByRole("button", { name: /Bot3/ });
    await expect(bot3).toBeVisible();
    await bot3.click();
    await expect(bot3).toHaveClass(/border-amber/);
  });

  test("Human can post in public chat during mission_selection; AI input is read-only", async () => {
    const switcherPanel = sharedPage.locator(".fixed.top-7");
    const playerButtons = switcherPanel.getByRole("button");
    const count = await playerButtons.count();

    // Find a human player (role badge "H") and switch to them.
    let humanFound = false;
    for (let i = 0; i < count; i++) {
      await playerButtons.nth(i).click();
      await sharedPage.waitForTimeout(300);
      const label = await playerButtons.nth(i).textContent();
      if (label?.includes("H")) { humanFound = true; break; }
    }
    // Roles are randomly assigned; skip gracefully if no human appears in this run.
    if (!humanFound) { test.skip(); return; }

    // Open the CHAT tab so the input is in the active view.
    await sharedPage.getByRole("button", { name: "CHAT" }).click();
    await sharedPage.waitForTimeout(200);

    // Human: public chat input must be enabled (canPost=true renders an <input>).
    const chatInput = sharedPage.locator('[placeholder="Message…"]');
    await expect(chatInput).not.toBeDisabled();

    // Switch to an AI player (aligned or misaligned)
    for (let i = 0; i < count; i++) {
      await playerButtons.nth(i).click();
      await sharedPage.waitForTimeout(300);
      const label = await playerButtons.nth(i).textContent();
      if (label?.includes("A") || label?.includes("M")) { break; }
    }

    // AI: canPost=false renders "// LOCKED" instead of an input field.
    await expect(sharedPage.getByText("// LOCKED")).toBeVisible();
  });
});
