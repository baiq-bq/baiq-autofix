"use server";

import { parseAndValidateRegistration } from "../lib/validation";

export type ActionState =
  | { ok: null }
  | { ok: false; errors: Record<string, string> }
  | { ok: true; message: string; data: { finalPriceCents: number } };

export async function submitRegistrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseAndValidateRegistration(formData);

  if (!parsed.ok) {
    const errors = parsed.errors;
    if (errors.startDate && errors.startDate.includes("must be on or after")) {
      errors.endDate = errors.startDate;
      delete errors.startDate;
    }
    return {
      ok: false,
      errors: errors,
    };
  }

  return {
    ok: true,
    message: "Registration submitted",
    data: { finalPriceCents: parsed.data.finalPriceCents },
  };
}
