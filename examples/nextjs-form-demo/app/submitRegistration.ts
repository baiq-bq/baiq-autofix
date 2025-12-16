"use server";

import { parseAndValidateRegistration } from "../lib/validation";

export type ActionState =
  | { ok: null }
  | { ok: false; errors: Record<string, string> }
  | { ok: true; message: string; data: { finalPriceCents: number } };

export async function submitRegistrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseAndValidateRegistration(formData);

  if (!parsed.ok) {
    const errors = { ...parsed.errors };
    const startDateError = errors.startDate;

    // Move the cross-field date range error to the endDate field for correct UI highlighting.
    if (
      typeof startDateError === "string" &&
      !("endDate" in errors) &&
      startDateError.toLowerCase().includes("end date") &&
      startDateError.toLowerCase().includes("start date")
    ) {
      errors.endDate = startDateError;
      delete errors.startDate;
    }

    return {
      ok: false,
      errors,
    };
  }

  return {
    ok: true,
    message: "Registration submitted",
    data: { finalPriceCents: parsed.data.finalPriceCents },
  };
}
