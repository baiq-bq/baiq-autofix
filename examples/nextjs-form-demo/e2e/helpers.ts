import type { Page } from "@playwright/test";

export async function fillBaseValidRegistration(page: Page) {
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Start date").fill("2026-06-10");
  await page.getByLabel("End date").fill("2026-06-10");
}

export async function submit(page: Page) {
  await page.getByTestId("submit-button").click();
}
