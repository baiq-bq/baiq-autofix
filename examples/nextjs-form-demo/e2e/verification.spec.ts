import { expect, test } from "@playwright/test";

import { fillBaseValidRegistration, submit } from "./helpers";

test.describe("verification (expected to fail until bugs are fixed)", () => {
  test("TC-1: invalid date range shows endDate error", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Full name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Start date").fill("2026-06-10");
    await page.getByLabel("End date").fill("2026-06-09");

    await submit(page);

    await expect(page.getByTestId("result-errors")).toBeVisible();
    await expect(page.getByTestId("error-endDate")).toBeVisible();
  });

  test("TC-2: when needsInvoice=true, billingPostalCode is required", async ({ page }) => {
    await page.goto("/");

    await fillBaseValidRegistration(page);
    await page.getByLabel("Needs invoice").check();

    // Leave billing fields empty.
    await submit(page);

    await expect(page.getByTestId("result-errors")).toBeVisible();
    await expect(page.getByTestId("error-billingPostalCode")).toBeVisible();
  });

  test("TC-3: business + EU country requires VAT", async ({ page }) => {
    await page.goto("/");

    await fillBaseValidRegistration(page);
    await page.getByLabel("Ticket type").selectOption("business");
    await page.getByLabel("Company name (business only)").fill("BQ");
    await page.getByLabel("Country code (2-letter)").fill("ES");

    // Leave VAT number empty.
    await submit(page);

    await expect(page.getByTestId("result-errors")).toBeVisible();
    await expect(page.getByTestId("error-vatNumber")).toBeVisible();
  });

  test("TC-4: SAVE10 applies 10% discount to standard ticket", async ({ page }) => {
    await page.goto("/");

    await fillBaseValidRegistration(page);
    await page.getByLabel("Ticket type").selectOption("standard");
    await page.getByLabel("Discount code").fill("SAVE10");

    await submit(page);

    await expect(page.getByTestId("result-success")).toBeVisible();
    // Standard is 19900, expected discounted is 17910.
    await expect(page.getByTestId("result-final-price")).toContainText("17910");
  });
});
