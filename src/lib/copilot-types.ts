export interface CopilotCitation {
  kind: "finding" | "review" | "run" | "repo";
  id: string;
  label: string;
}
export interface CopilotAnswer {
  answer: string;
  citations: CopilotCitation[];
  suggestions: string[];
}
