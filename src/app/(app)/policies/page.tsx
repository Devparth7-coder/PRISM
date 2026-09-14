import { requireUser } from "@/lib/auth";
import { listRepositoriesForUser } from "@/lib/db/repo/repositories";
import { getPolicyForRepo, listRules, listMemory, type PolicyRow, type RuleRow, type MemoryRow } from "@/lib/db/repo/governance";
import { PolicyEditor } from "@/components/policies/PolicyEditor";

export const dynamic = "force-dynamic";

export interface RepoPolicyBundle {
  repoId: string | null;
  fullName: string;
  policy: PolicyRow;
  rules: RuleRow[];
  memory: MemoryRow[];
}

export default function PoliciesPage() {
  const user = requireUser();
  const repos = listRepositoriesForUser(user.id);

  const global: RepoPolicyBundle = {
    repoId: null,
    fullName: "Global defaults (all repositories)",
    policy: getPolicyForRepo(null),
    rules: [],
    memory: [],
  };

  const bundles: RepoPolicyBundle[] = [
    global,
    ...repos.map((r) => ({
      repoId: r.id,
      fullName: r.full_name,
      policy: getPolicyForRepo(r.id),
      rules: listRules(r.id),
      memory: listMemory(r.id),
    })),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Policies, rules & memory</h1>
        <p className="text-xs text-graphite-400">
          Policies map severity to publication behavior, gate merges and route paths to specialist agents. Rules and
          memory feed the context engine before agents run.
        </p>
      </div>
      <PolicyEditor bundles={bundles} />
    </div>
  );
}
