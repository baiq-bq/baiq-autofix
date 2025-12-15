"use server";

import { parseAndValidateRegistration } from "../lib/validation";

export type ActionState =
  | { ok: null }
  | { ok: false; errors: Record<string, string> }
  | { ok: true; message: string; data: { finalPriceCents: number } };

export async function submitRegistrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseAndValidateRegistration(formData);

  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors,
    };
  }

  return {
    ok: true,
    message: "Registration submitted",
    data: { finalPriceCents: parsed.data.finalPriceCents },
  };
}
