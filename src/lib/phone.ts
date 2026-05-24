export type NameErrorKey =
  | "checkout.valNameRequired"
  | "checkout.valNameShort"
  | "checkout.valNameLong"
  | "checkout.valNameInvalid";

export type AddressErrorKey =
  | "checkout.valAddressRequired"
  | "checkout.valAddressShort"
  | "checkout.valAddressLong";

export type PhoneErrorKey =
  | "checkout.valPhoneRequired"
  | "checkout.valPhoneInvalid";

export interface PhoneResult {
  ok: boolean;
  phone?: string;
  errorKey?: PhoneErrorKey;
}

export function normalizePhone(raw: string): PhoneResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, errorKey: "checkout.valPhoneRequired" };
  }

  let candidate = raw.replace(/\D/g, "");

  if (candidate.length === 0) {
    return { ok: false, errorKey: "checkout.valPhoneRequired" };
  }

  if (candidate.startsWith("00212")) {
    candidate = candidate.slice(2);
  }

  if (candidate.startsWith("0") && candidate.length === 10) {
    candidate = "212" + candidate.slice(1);
  }

  if (candidate.length === 9 && /^[67]/.test(candidate)) {
    candidate = "212" + candidate;
  }

  if (/^212[67]\d{8}$/.test(candidate)) {
    return { ok: true, phone: candidate };
  }

  return { ok: false, errorKey: "checkout.valPhoneInvalid" };
}

export interface NameResult {
  ok: boolean;
  name?: string;
  errorKey?: NameErrorKey;
}

export interface AddressResult {
  ok: boolean;
  address?: string;
  errorKey?: AddressErrorKey;
}

export function validateName(raw: string): NameResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, errorKey: "checkout.valNameRequired" };
  }
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < 3) {
    return { ok: false, errorKey: "checkout.valNameShort" };
  }
  if (trimmed.length > 80) {
    return { ok: false, errorKey: "checkout.valNameLong" };
  }
  if (/^(.)\1+$/.test(trimmed.replace(/\s/g, ""))) {
    return { ok: false, errorKey: "checkout.valNameInvalid" };
  }
  return { ok: true, name: trimmed };
}

export function validateAddress(raw: string): AddressResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, errorKey: "checkout.valAddressRequired" };
  }
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < 8) {
    return { ok: false, errorKey: "checkout.valAddressShort" };
  }
  if (trimmed.length > 200) {
    return { ok: false, errorKey: "checkout.valAddressLong" };
  }
  return { ok: true, address: trimmed };
}
