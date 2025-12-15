import { expect, test } from "@playwright/test";

import { fillBaseValidRegistration, submit } from "./helpers";

test.describe("discovery", () => {
  test("home page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Conference registration" })).toBeVisible();
    await expect(page.getByTestId("result-empty")).toBeVisible();
  });

  test("standard registration succeeds", async ({ page }) => {
    await page.goto("/");

    await fillBaseValidRegistration(page);
    await submit(page);

    await expect(page.getByTestId("result-success")).toBeVisible();
    await expect(page.getByTestId("result-message")).toHaveText(/Registration submitted/);
    await expect(page.getByTestId("result-final-price")).toContainText("19900");
  });
});
