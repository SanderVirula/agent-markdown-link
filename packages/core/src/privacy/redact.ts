const TURN_TOKEN_PATTERN = /(?<![A-Za-z0-9_-])aml1_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/gu;

export function redactTurnTokens(text: string): string {
  return text.replace(TURN_TOKEN_PATTERN, "[REDACTED_TOKEN]");
}
