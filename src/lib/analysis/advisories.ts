/**
 * Deterministic dependency advisory check. A small embedded advisory catalog
 * is used offline; when network egress is permitted this same interface is
 * backed by OSV/GitHub Advisory Database. Versions are compared semver-ish.
 */
import type { ChangedFile, FindingInput } from "../types";

export interface Advisory {
  package: string;
  ecosystem: "npm" | "pypi";
  vulnerableBelow: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  cve?: string;
  recommendation: string;
}

/** Curated, well-known advisories used for deterministic offline matching. */
export const ADVISORIES: Advisory[] = [
  { package: "lodash", ecosystem: "npm", vulnerableBelow: "4.17.21", severity: "HIGH", title: "Prototype pollution / command injection in lodash <4.17.21", cve: "CVE-2021-23337", recommendation: "Upgrade lodash to 4.17.21 or later." },
  { package: "minimist", ecosystem: "npm", vulnerableBelow: "1.2.6", severity: "CRITICAL", title: "Prototype pollution in minimist <1.2.6", cve: "CVE-2021-44906", recommendation: "Upgrade minimist to >=1.2.6." },
  { package: "jsonwebtoken", ecosystem: "npm", vulnerableBelow: "9.0.0", severity: "HIGH", title: "jwt.verify() accepts insecure signature types in jsonwebtoken <9", cve: "CVE-2022-23529", recommendation: "Upgrade jsonwebtoken to >=9.0.0 and pin allowed algorithms." },
  { package: "axios", ecosystem: "npm", vulnerableBelow: "1.6.0", severity: "HIGH", title: "SSRF / credential leakage in axios <1.6.0", cve: "CVE-2023-45857", recommendation: "Upgrade axios to >=1.6.0." },
  { package: "express", ecosystem: "npm", vulnerableBelow: "4.17.3", severity: "HIGH", title: "DoS via untrusted input in express <4.17.3", recommendation: "Upgrade express to >=4.17.3." },
  { package: "semver", ecosystem: "npm", vulnerableBelow: "7.5.2", severity: "HIGH", title: "ReDoS in semver <7.5.2", recommendation: "Upgrade semver to >=7.5.2." },
  { package: "word-wrap", ecosystem: "npm", vulnerableBelow: "1.2.4", severity: "HIGH", title: "ReDoS in word-wrap <1.2.4", recommendation: "Upgrade word-wrap to >=1.2.4." },
  { package: "tough-cookie", ecosystem: "npm", vulnerableBelow: "4.1.3", severity: "MEDIUM", title: "Prototype pollution in tough-cookie <4.1.3", recommendation: "Upgrade tough-cookie to >=4.1.3." },
];

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/[^\d.]/g, "").split(".").map(Number);
  const pb = b.replace(/[^\d.]/g, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function cleanVersion(v: string): string {
  const m = /(\d+\.\d+\.\d+)/.exec(v);
  return m?.[1] ?? v.replace(/^[~^>=<\sv]/g, "");
}

/** Inspect manifest diffs. Also compares the full manifests for version changes. */
export function auditDependencies(
  files: ChangedFile[],
  baseTree: Record<string, string>,
  headTree: Record<string, string>,
): FindingInput[] {
  const findings: FindingInput[] = [];
  const manifests = files.filter(
    (f) => /package\.json$/.test(f.path) || /requirements.*\.txt$/.test(f.path) || /pyproject\.toml$/.test(f.path),
  );

  for (const mf of manifests) {
    if (mf.path.endsWith("package.json")) {
      const headRaw = headTree[mf.path];
      if (!headRaw) continue;
      let head: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      try {
        head = JSON.parse(headRaw);
      } catch {
        continue;
      }
      const baseRaw = baseTree[mf.path];
      let baseDeps = new Set<string>();
      if (baseRaw) {
        try {
          const base = JSON.parse(baseRaw);
          baseDeps = new Set([...Object.keys(base.dependencies ?? {}), ...Object.keys(base.devDependencies ?? {})]);
        } catch {
          /* ignore */
        }
      }
      for (const section of ["dependencies", "devDependencies"] as const) {
        for (const [pkg, range] of Object.entries(head[section] ?? {})) {
          const advisory = ADVISORIES.find((a) => a.package === pkg && a.ecosystem === "npm");
          const isNew = !baseDeps.has(pkg);
          if (advisory && compareSemver(cleanVersion(range), advisory.vulnerableBelow) < 0) {
            const addedLine = mf.hunks.flatMap((h) => h.lines).find((l) => l.type === "add" && l.text.includes(pkg));
            findings.push({
              severity: advisory.severity,
              category: "DEPENDENCIES",
              title: `Vulnerable dependency: ${pkg} ${range}`,
              description: `${advisory.title}${advisory.cve ? ` (${advisory.cve})` : ""}. ${isNew ? "This PR introduces the vulnerable version." : "The PR retains a vulnerable version in the manifest."}`,
              file: mf.path,
              lineStart: addedLine?.newNo ?? 1,
              lineEnd: addedLine?.newNo ?? 1,
              confidence: 0.95,
              detector: "DETERMINISTIC",
              agent: "dependency_auditor",
              evidence: [
                { kind: "dependency", label: "Manifest entry", detail: `"${pkg}": "${range}" (${section})`, file: mf.path, line: addedLine?.newNo ?? undefined },
                { kind: "static_tool", label: "Advisory match", detail: `${advisory.title}${advisory.cve ? ` — ${advisory.cve}` : ""}; fixed in ${advisory.vulnerableBelow}` },
                ...(isNew ? [{ kind: "changed_line" as const, label: "Newly added in this PR", detail: `+ "${pkg}": "${range}"` }] : []),
              ],
              impact: "Known vulnerabilities are reachable through dependency code at install/runtime; supply-chain risk applies to every environment that builds this PR.",
              recommendation: `${advisory.recommendation} Prefer an exact, pinned upgrade and refresh the lockfile in the same PR.`,
            });
          }
        }
      }
    }
  }
  return findings;
}
