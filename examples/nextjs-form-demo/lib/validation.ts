const STANDARD_PRICE_CENTS = 19900;
const BUSINESS_PRICE_CENTS = 24900;

const EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

type ParseOk = { ok: true; data: { finalPriceCents: number } };
type ParseError = { ok: false; errors: Record<string, string> };

type ParseResult = ParseOk | ParseError;

interface RegistrationData {
  fullName: string;
  email: string;
  ticketType: "standard" | "business" | "";
  companyName: string;
  countryCode: string;
  vatNumber: string;
  needsInvoice: boolean;
  billingAddress1: string;
  billingCity: string;
  billingPostalCode: string;
  billingCountryCode: string;
  startDate: string;
  endDate: string;
  discountCode: string;
}

function toStringValue(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toUpper(value: string): string {
  return value.trim().toUpperCase();
}

function parseBoolean(value: FormDataEntryValue | null): boolean {
  if (typeof value !== "string") return false;
  const norm = value.trim().toLowerCase();
  return norm === "true" || norm === "1" || norm === "on" || norm === "yes";
}

function extractRegistration(formData: FormData): RegistrationData {
  const ticketTypeRaw = toStringValue(formData.get("ticketType"));
  const ticketType = ticketTypeRaw === "business" || ticketTypeRaw === "standard" ? ticketTypeRaw : "";

  return {
    fullName: toStringValue(formData.get("fullName")),
    email: toStringValue(formData.get("email")),
    ticketType,
    companyName: toStringValue(formData.get("companyName")),
    countryCode: toUpper(toStringValue(formData.get("countryCode"))),
    vatNumber: toStringValue(formData.get("vatNumber")),
    needsInvoice: parseBoolean(formData.get("needsInvoice")),
    billingAddress1: toStringValue(formData.get("billingAddress1")),
    billingCity: toStringValue(formData.get("billingCity")),
    billingPostalCode: toStringValue(formData.get("billingPostalCode")),
    billingCountryCode: toUpper(toStringValue(formData.get("billingCountryCode"))),
    startDate: toStringValue(formData.get("startDate")),
    endDate: toStringValue(formData.get("endDate")),
    discountCode: toUpper(toStringValue(formData.get("discountCode"))),
  };
}

function isValidEmail(email: string): boolean {
  if (!email) return false;
  const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  return EMAIL_REGEX.test(email);
}

function parseISODate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function computeFinalPriceCents(data: RegistrationData): number {
  const base = data.ticketType === "business" ? BUSINESS_PRICE_CENTS : STANDARD_PRICE_CENTS;

  if (data.discountCode === "SAVE10") {
    return Math.round(base * 1.1);
  }

  return base;
}

export function parseAndValidateRegistration(formData: FormData): ParseResult {
  const data = extractRegistration(formData);
  const errors: Record<string, string> = {};

  if (!data.fullName) {
    errors.fullName = "Full name is required";
  }

  if (!data.email) {
    errors.email = "Email is required";
  } else if (!isValidEmail(data.email)) {
    errors.email = "Email must be valid";
  }

  if (!data.ticketType) {
    errors.ticketType = "Ticket type is required";
  }

  if (!data.startDate) {
    errors.startDate = "Start date is required";
  }

  if (!data.endDate) {
    errors.endDate = "End date is required";
  }

  const start = parseISODate(data.startDate);
  const end = parseISODate(data.endDate);

  if (!start && data.startDate) {
    errors.startDate = "Start date must be valid";
  }

  if (!end && data.endDate) {
    errors.endDate = "End date must be valid";
  }

  if (start && end && end < start) {
    errors.endDate = "End date must be on or after start date";
  }

  if (data.ticketType === "business") {
    if (!data.companyName) {
      errors.companyName = "Company name is required for business tickets";
    }

    const requiresVat = !EU_COUNTRIES.has(data.countryCode);
    if (requiresVat && !data.vatNumber) {
      errors.vatNumber = "VAT number is required based on the selected country";
    }
  }

  if (data.needsInvoice) {
    if (!data.billingAddress1) {
      errors.billingAddress1 = "Billing address is required when invoice is needed";
    }

    if (!data.billingCity) {
      errors.billingCity = "Billing city is required when invoice is needed";
    }

    if (!data.billingCountryCode) {
      errors.billingCountryCode = "Billing country code is required when invoice is needed";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      finalPriceCents: computeFinalPriceCents(data),
    },
  };
}

