/**
 * Canonical domain types shared across ingestion, analysis, orchestration,
 * persistence and the HTTP layer.
 */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type Confidence = number; // 0..1 — model/detector confidence indicator, NOT scientific certainty
export type Detector = "DETERMINISTIC" | "AI-DETECTED" | "HYBRID";
export type FindingStatus = "OPEN" | "FIXED" | "DISMISSED" | "ACCEPTED_RISK" | "STALE";
export type CriticVerdict = "CONFIRMED" | "WEAK" | "FALSE_POSITIVE" | "UNCERTAIN";
export type Recommendation = "APPROVE" | "APPROVE_WITH_WARNINGS" | "REQUEST_CHANGES" | "BLOCK";
export type ReviewStatus =
  | "QUEUED"
  | "INGESTING"
  | "CONTEXT"
  | "STATIC_ANALYSIS"
  | "AGENTS"
  | "CRITIC"
  | "VERIFICATION"
  | "RISK"
  | "SYNTHESIS"
  | "PUBLISHING"
  | "COMPLETED"
  | "FAILED"
  | "STALE";

export type ReviewMode = "fast" | "standard" | "deep" | "security" | "test";
export type AgentKey =
  | "context"
  | "static"
  | "bug_hunter"
  | "security_reviewer"
  | "performance_reviewer"
  | "maintainability_reviewer"
  | "test_reviewer"
  | "api_contract_reviewer"
  | "dependency_reviewer"
  | "critic"
  | "evidence"
  | "risk"
  | "synthesizer";

export interface EvidenceItem {
  kind:
    | "changed_line"
    | "related_code"
    | "caller"
    | "callee"
    | "test"
    | "config"
    | "static_tool"
    | "dependency"
    | "convention"
    | "graph";
  label: string;
  detail: string;
  file?: string;
  line?: number;
}

/** Structured finding — the only accepted shape for agent output. */
export interface FindingInput {
  severity: Severity;
  category: string; // SECURITY | CORRECTNESS | PERFORMANCE | MAINTAINABILITY | TESTS | API_CONTRACT | DEPENDENCIES
  title: string;
  description: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  confidence: Confidence;
  evidence: EvidenceItem[];
  impact?: string;
  recommendation: string;
  suggestedPatch?: { current: string; proposed: string; explanation: string };
  detector: Detector;
  agent: string;
}

export interface Finding extends FindingInput {
  id: string;
  reviewId: string;
  fingerprint: string;
  criticVerdict?: CriticVerdict;
  criticNotes?: string;
  status: FindingStatus;
  regression?: "NEW" | "PERSISTENT" | "FIXED";
  mergedFrom?: string[];
  previousFindingId?: string;
  createdAt: string;
}

export interface CodeSymbol {
  kind: "function" | "class" | "interface" | "type" | "test" | "route" | "config" | "db_entity" | "import" | "export";
  name: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  language: string;
  detail?: string;
}

export interface CodeEdge {
  from: string; // node id `${file}::${name}`
  to: string;
  type: "IMPORTS" | "CALLS" | "IMPLEMENTS" | "EXTENDS" | "TESTS" | "DEPENDS_ON" | "MODIFIES";
  detail?: string;
}

export type GraphNode = { id: string } & Omit<CodeSymbol, "kind"> & {
  kind: CodeSymbol["kind"] | "file";
};

export interface CodeGraph {
  nodes: GraphNode[];
  edges: CodeEdge[];
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  language: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "add" | "del" | "hunk";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface RepoProfile {
  languages: Record<string, number>;
  framework?: string;
  packageManager?: string;
  testFramework?: string;
  ci?: string;
  linters: string[];
  architectureHints: string[];
  manifests: string[];
}

export interface RiskBreakdown {
  security: number;
  correctness: number;
  performance: number;
  maintainability: number;
  testing: number;
  scope: number;
  dependencies: number;
}

export interface RiskResult {
  score: number; // 0..100, higher = riskier
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  breakdown: RiskBreakdown;
  reasons: string[];
}

export interface AgentResult {
  agent: AgentKey;
  decisionSummary: string;
  findings: FindingInput[];
  toolCalls: string[];
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
}

export interface ToolResult {
  tool: string;
  status: "success" | "skipped" | "error" | "timeout";
  summary: string;
  findings?: FindingInput[];
  durationMs: number;
}
