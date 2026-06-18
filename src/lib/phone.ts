// E.164-ish: optional leading +, then 8–15 digits, first digit non-zero.
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

export function isValidPhone(value: string): boolean {
  return PHONE_RE.test(value.trim());
}

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}