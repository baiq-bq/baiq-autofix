"use client";

import { useActionState } from "react";

import type { ActionState } from "./submitRegistration";
import { submitRegistrationAction } from "./submitRegistration";

const initialState: ActionState = { ok: null };

export function RegistrationFormClient() {
  const [state, formAction, isPending] = useActionState(submitRegistrationAction, initialState);

  return (
    <>
      <form action={formAction} className="formGrid" data-testid="registration-form">
        <label className="field fullRow">
          <span className="label">Full name</span>
          <input name="fullName" required placeholder="Ada Lovelace" />
        </label>

        <label className="field fullRow">
          <span className="label">Email</span>
          <input name="email" type="email" required placeholder="ada@example.com" />
        </label>

        <label className="field">
          <span className="label">Ticket type</span>
          <select name="ticketType" defaultValue="standard">
            <option value="standard">Standard</option>
            <option value="business">Business</option>
          </select>
          <span className="hint">Business requires company details.</span>
        </label>

        <label className="field">
          <span className="label">Company name (business only)</span>
          <input name="companyName" placeholder="BQ" />
        </label>

        <label className="field">
          <span className="label">Country code (2-letter)</span>
          <input name="countryCode" defaultValue="ES" placeholder="ES" />
        </label>

        <label className="field">
          <span className="label">VAT number (business + EU only)</span>
          <input name="vatNumber" placeholder="ESX12345678" />
        </label>

        <fieldset className="fullRow">
          <legend>Dates</legend>
          <div className="fieldsetGrid">
            <label className="field">
              <span className="label">Start date</span>
              <input name="startDate" type="date" required />
            </label>

            <label className="field">
              <span className="label">End date</span>
              <input name="endDate" type="date" required />
            </label>
          </div>
        </fieldset>

        <label className="toggleRow fullRow">
          <span>
            <span className="title">Needs invoice</span>
            <span className="subtitle">Adds billing fields and extra validation.</span>
          </span>
          <input name="needsInvoice" type="checkbox" />
        </label>

        <fieldset className="fullRow">
          <legend>Billing (only if invoice is needed)</legend>
          <div className="fieldsetGrid">
            <label className="field fullRow">
              <span className="label">Address line 1</span>
              <input name="billingAddress1" placeholder="C/ Example, 123" />
            </label>

            <label className="field">
              <span className="label">City</span>
              <input name="billingCity" placeholder="Barcelona" />
            </label>

            <label className="field">
              <span className="label">Postal code</span>
              <input name="billingPostalCode" placeholder="08001" />
            </label>

            <label className="field">
              <span className="label">Billing country code</span>
              <input name="billingCountryCode" defaultValue="ES" placeholder="ES" />
            </label>
          </div>
        </fieldset>

        <label className="field fullRow">
          <span className="label">Discount code</span>
          <input name="discountCode" placeholder="SAVE10" />
          <span className="hint">Try SAVE10 (also intentionally buggy).</span>
        </label>

        <div className="actions fullRow">
          <button type="reset" className="secondaryButton">
            Reset
          </button>
          <button type="submit" className="button" disabled={isPending} data-testid="submit-button">
            {isPending ? "Submitting…" : "Submit registration"}
          </button>
        </div>
      </form>

      <div className="resultPanel" data-testid="result">
        {state.ok === true ? (
          <div className="resultSuccess" data-testid="result-success">
            <div className="resultTitle">Success</div>
            <div className="resultBody">
              <div data-testid="result-message">{state.message}</div>
              <div data-testid="result-final-price">Final price: {state.data.finalPriceCents} cents</div>
            </div>
          </div>
        ) : null}

        {state.ok === false ? (
          <div className="resultError" data-testid="result-errors">
            <div className="resultTitle">Validation errors</div>
            <ul className="errorList">
              {Object.entries(state.errors).map(([field, message]) => (
                <li key={field} data-testid={`error-${field}`}>
                  <span className="errorField">{field}</span>
                  <span className="errorMessage">{String(message)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.ok === null ? (
          <div className="resultEmpty" data-testid="result-empty">
            Submit the form to see server validation results.
          </div>
        ) : null}
      </div>
    </>
  );
}
