/**
 * Evidence verification layer — structural grounding applied to EVERY
 * finding before it can appear in a review:
 *  - file must exist at the reviewed commit
 *  - line must intersect the diff (AI findings snapping to nearby added line)
 *  - claims referencing files/tests that don't exist are rejected
 * Deterministic refutations from the critic feed back into confidence.
 */
import type { ChangedFile, FindingInput } from "../types";
import { addedLineNumbers } from "../code/diff";

export interface VerifiedFinding {
  finding: FindingInput;
  anchorOk: boolean;
  notes: string[];
  drop: boolean;
}

export function verifyFinding(finding: FindingInput, files: ChangedFile[], headTree: Record<string, string>): VerifiedFinding {
  const notes: string[] = [];
  const file = files.find((f) => f.path === finding.file);
  const existsAtHead = headTree[finding.file] !== undefined;
  let drop = false;

  if (!existsAtHead) {
    if (finding.detector === "AI-DETECTED") {
      drop = true;
      notes.push(`Rejected: AI cited file ${finding.file} which does not exist at the reviewed commit.`);
    } else {
      notes.push(`Warning: cited file missing from snapshot.`);
    }
    return { finding, anchorOk: false, notes, drop };
  }
  if (!finding.evidence.length) {
    notes.push("Finding shipped without evidence; confidence capped.");
    finding.confidence = Math.min(finding.confidence, 0.5);
  }
  // Validate evidence references.
  finding.evidence = finding.evidence.filter((e) => {
    if (e.file && headTree[e.file] === undefined) {
      notes.push(`Stripped evidence referencing missing file ${e.file}.`);
      return false;
    }
    return true;
  });

  let anchorOk = true;
  if (file) {
    const added = addedLineNumbers(file);
    const intersects = [...added].some((n) => n >= Math.max(1, finding.lineStart - 2) && n <= finding.lineEnd + 2);
    if (!intersects) {
      // Snap to nearest added line within a small window.
      const sorted = [...added].sort((a, b) => Math.abs(a - finding.lineStart) - Math.abs(b - finding.lineStart));
      const nearest = sorted[0];
      if (nearest !== undefined && Math.abs(nearest - finding.lineStart) <= 6) {
        notes.push(`Anchor snapped from line ${finding.lineStart} to changed line ${nearest}.`);
        finding.lineStart = nearest;
        finding.lineEnd = nearest;
      } else if (finding.detector === "AI-DETECTED") {
        notes.push("AI finding did not anchor to any changed line; treated as out-of-scope and removed.");
        drop = true;
        anchorOk = false;
      } else {
        // Deterministic cross-cutting findings (e.g. test gap) may anchor loosely.
        anchorOk = false;
        notes.push("Finding references the changed module but no specific changed line.");
      }
    }
  }

  finding.lineEnd = Math.max(finding.lineEnd, finding.lineStart);
  return { finding, anchorOk, notes, drop };
}

export function verifyAll(findings: FindingInput[], files: ChangedFile[], headTree: Record<string, string>) {
  const kept: FindingInput[] = [];
  const rejected: { finding: FindingInput; notes: string[] }[] = [];
  for (const f of findings) {
    const result = verifyFinding(f, files, headTree);
    if (result.drop) rejected.push({ finding: f, notes: result.notes });
    else kept.push(f);
  }
  return { kept, rejected };
}
