import { test, expect, type BrowserContext } from "@playwright/test";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createGame(ctx: BrowserContext, name: string) {
  const page = await ctx.newPage();
  await page.goto("/game/create");
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Create Game" }).click();
  await page.waitForURL("**/game/**/lobby");
  return page;
}

async function joinGame(ctx: BrowserContext, lobbyUrl: string, name: string) {
  const page = await ctx.newPage();
  await page.goto(lobbyUrl);
  await page.getByRole("button", { name: "Play" }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  // Wait until this player's own name appears in their player list
  await expect(page.getByText(name).first()).toBeVisible();
  return page;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("home page shows MESA title and create game link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "MESA" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New Game" })).toBeVisible();
});

test("create game shows display name form then redirects to lobby", async ({
  page,
}) => {
  await page.goto("/game/create");
  await expect(page.getByLabel("Display name")).toBeVisible();
  await page.getByLabel("Display name").fill("Alice");
  await page.getByRole("button", { name: "Create Game" }).click();
  await page.waitForURL("**/game/**/lobby");
  await expect(page).toHaveURL(/\/game\/.+\/lobby/);
});

test("lobby shows game id and copy link button", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await createGame(ctx, "Alice");

  const url = page.url();
  const gameId = url.match(/\/game\/([^/]+)\/lobby/)?.[1];
  expect(gameId).toBeTruthy();

  // Truncated game ID shown in header
  await expect(
    page.getByText(gameId!.slice(0, 8).toUpperCase())
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Link" })).toBeVisible();

  await ctx.close();
});

test("second player joins via invite link and appears in both views", async ({
  browser,
}) => {
  const hostCtx = await browser.newContext();
  const p2Ctx = await browser.newContext();

  const hostPage = await createGame(hostCtx, "Alice");
  const lobbyUrl = hostPage.url();

  const p2Page = await joinGame(p2Ctx, lobbyUrl, "Bob");

  // Bob appears in his own view
  await expect(p2Page.getByText("Bob").first()).toBeVisible();

  // Bob appears in Alice's view via Realtime — allow extra time for propagation
  await expect(hostPage.getByText("Bob")).toBeVisible({ timeout: 30_000 });

  await hostCtx.close();
  await p2Ctx.close();
});

test("start game button enables when 6 players have joined", async ({
  browser,
}) => {
  const contexts: BrowserContext[] = [];

  const hostCtx = await browser.newContext();
  contexts.push(hostCtx);
  const hostPage = await createGame(hostCtx, "Player 1");
  const lobbyUrl = hostPage.url();

  const startBtn = hostPage.getByRole("button", { name: "Start Game" });
  await expect(startBtn).toBeVisible();
  await expect(startBtn).toBeDisabled();

  for (let i = 2; i <= 6; i++) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    await joinGame(ctx, lobbyUrl, `Player ${i}`);
    // Wait for the host to see the new player before the next one joins
    await expect(hostPage.getByText(`Player ${i}`)).toBeVisible();
  }

  await expect(startBtn).toBeEnabled();

  for (const ctx of contexts) await ctx.close();
});
