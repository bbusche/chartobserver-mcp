/**
 * Central secret-redaction registry. Secrets are registered once at startup
 * (index.ts) and every string that can leave the process — tool error text,
 * the fatal handler — is passed through redactSecrets() as a backstop, so a
 * credential can never reach the model transcript even via an unexpected
 * error path.
 */

const secrets = new Set<string>();

export function registerSecret(value: string): void {
  if (value) secrets.add(value);
}

/** Test helper — the registry is module-global. */
export function clearSecrets(): void {
  secrets.clear();
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of secrets) {
    out = out.split(secret).join("***");
    out = out.split(encodeURIComponent(secret)).join("***");
  }
  return out;
}
