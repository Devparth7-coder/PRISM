/**
 * Deterministic secret scanner. Only ADDED lines are scanned so developers
 * aren't blamed for pre-existing tokens. Patterns and validation follow the
 * common provider formats (GitHub/AWS/Slack/Google/JWT/PEM).
 */
import type { ChangedFile, FindingInput } from "../types";

interface SecretRule {
  id: string;
  pattern: RegExp;
  label: string;
  validator?: (m: string) => boolean;
}

const RULES: SecretRule[] = [
  {
    id: "aws-access-key-id",
    pattern: /\b((?:AKIA|ASIA)[A-Z0-9]{16})\b/g,
    label: "AWS access key ID",
  },
  {
    id: "aws-secret-access-key",
    pattern: /(?:aws_secret_access_key|aws-secret-key)["'\s:=]+([A-Za-z0-9/+=]{40})/gi,
    label: "AWS secret access key",
  },
  {
    id: "github-token",
    pattern: /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/g,
    label: "GitHub personal/app token",
    validator: (m) => m.length >= 40,
  },
  {
    id: "github-old-token",
    pattern: /\b([a-f0-9]{40})\b/g,
    label: "40-character hexadecimal token (possible GitHub legacy token)",
    validator: (m) => !/^0+$|^f+$/.test(m),
  },
  {
    id: "slack-token",
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,72})\b/g,
    label: "Slack token",
  },
  {
    id: "google-api-key",
    pattern: /\b(AIza[0-9A-Za-z\-_]{35})\b/g,
    label: "Google API key",
  },
  {
    id: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    label: "PEM private key",
  },
  {
    id: "jwt",
    pattern: /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
    label: "JWT (verify it is not a long-lived secret)",
  },
  {
    id: "bearer-hardcoded",
    pattern: /["']Bearer\s+[A-Za-z0-9._\-]{20,}["']/g,
    label: "hardcoded Bearer credential",
  },
];

const ALLOW = /(example|placeholder|dummy|fake|sample|test-fixture|your[-_]?|xxxx|<|>\{\{|process\.env)/i;

export function scanSecrets(files: ChangedFile[], headTree: Record<string, string>): FindingInput[] {
  void headTree;
  const findings: FindingInput[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== "add" || line.newNo === null) continue;
        if (ALLOW.test(line.text)) continue;
        for (const rule of RULES) {
          rule.pattern.lastIndex = 0;
          const m = rule.pattern.exec(line.text);
          if (!m) continue;
          const secret = m[1] ?? m[0];
          if (rule.validator && !rule.validator(secret)) continue;
          findings.push({
            severity: rule.id === "github-old-token" ? "MEDIUM" : "CRITICAL",
            category: "SECURITY",
            title: `${rule.label} committed in ${file.path}`,
            description: `A credential matching the ${rule.label} format was introduced on an added line. Committed secrets must be considered compromised even if the commit is later amended.`,
            file: file.path,
            lineStart: line.newNo,
            lineEnd: line.newNo,
            confidence: rule.id === "github-old-token" ? 0.55 : 0.97,
            detector: "DETERMINISTIC",
            agent: "secret_scanner",
            evidence: [
              { kind: "changed_line", label: "Added line contains the secret format", detail: line.text.trim().slice(0, 160), file: file.path, line: line.newNo },
              { kind: "static_tool", label: "Detector", detail: `PRISM secret scanner rule ${rule.id}` },
            ],
            impact: "Anyone with repository read access (or CI logs, caches, forks) gains the credential's privileges.",
            recommendation:
              "Remove the secret, rotate/revoke it immediately, and load it from a secret manager or environment variable. Add the file pattern to .gitleaksignore / secret scanning allowlists only after rotation.",
          });
        }
      }
    }
  }
  return findings;
}
