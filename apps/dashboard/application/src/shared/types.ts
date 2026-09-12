export type ArtifactKind =
  "requirement" | "run_plan" | "work_package" | "system_plan";
export type ArtifactStatus =
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "draft"
  | "missing"
  | "blocked"
  | "complete"
  | "invalid"
  | "superseded";
export type PromptMode = "standard" | "goal";
export type ReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type QualityGate =
  | "dashboard_verify"
  | "product_lint"
  | "product_test"
  | "product_build"
  | "manifest_validation"
  | "lint"
  | "clean_install"
  | "production_snapshot_upgrade"
  | "unit_tests"
  | "browser_tests"
  | "targeted_validation";

export interface ArtifactSummary {
  id: string;
  title: string;
  kind: ArtifactKind;
  path: string;
  extension: string;
  revision: number;
  digest: string;
  status: ArtifactStatus;
  updatedAt: string;
  relatedRequirementId?: string;
  phaseCount?: number;
  taskCount?: number;
}

export interface ArtifactDocument {
  artifact: ArtifactSummary;
  content: string | null;
  contentType: string;
  previewable: boolean;
}

export interface PromptProfile {
  taskType:
    "work_package_sequencing" | "run_plan_generation" | "run_plan_execution";
  label: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  promptMode: PromptMode;
  adapter?: "codex_app_server" | "fake" | "manual_codex";
}

export interface PromptPacket {
  taskType: PromptProfile["taskType"];
  promptMode: PromptMode;
  model: string;
  reasoningEffort: ReasoningEffort;
  templateVersion: string;
  redactionApplied: boolean;
  inputArtifacts: Array<{
    id: string;
    revision: number;
    path: string;
    digest: string;
  }>;
  prompt: string;
  executionContext?: {
    cwd: string;
    writableRoots: string[];
    readOnlyRoots: string[];
  };
}

export interface SystemHealthItem {
  label: string;
  status: "healthy" | "warning" | "blocked" | "offline";
  detail: string;
}

export interface Snapshot {
  generatedAt: string;
  system: {
    id: string;
    name: string;
    branch: string;
    deliveryPath: string;
    lockStatus: string;
    repositories?: Record<string, string>;
    directories?: Record<string, string>;
    productHead?: string;
  };
  health: SystemHealthItem[];
  artifacts: ArtifactSummary[];
  approvals: ApprovalSummary[];
  activeRun: ActiveRun | null;
  latestRun?: ActiveRun | null;
  promptProfiles: PromptProfile[];
  blockers: string[];
  events?: WorkflowEventSummary[];
  evidence?: EvidenceSummary[];
  dispositions?: DispositionSummary[];
  runtimeActions?: Array<{
    actionId: string;
    actionType: string;
    payload: unknown;
    createdAt: string;
  }>;
  validationErrors?: Array<{
    source: string;
    schemaId: string;
    path: string;
    message: string;
  }>;
}

export interface ApprovalSummary {
  id: string;
  type: "requirement" | "run_plan" | "work_package";
  title: string;
  artifactId: string;
  source: string;
  requestedBy: string;
  requestedAt: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "approved" | "rejected";
  revision?: number;
  bindingDigest?: string;
}

export interface WorkflowEventSummary {
  eventId: string;
  eventType: string;
  sequence: number;
  occurredAt: string;
  gateId?: string;
  approvalId?: string;
  artifactId?: string;
  decision?: string;
}

export interface EvidenceSummary {
  evidenceId: string;
  runId: string;
  path: string;
  outcome: "passed" | "failed" | "blocked" | "partial";
  updatedAt: string;
}

export interface DispositionSummary {
  dispositionId: string;
  runId: string;
  decision: "accepted" | "exception_accepted" | "rejected" | "replan";
  reason: string;
  issuedAt: string;
}

export interface RunPlanAnalysis {
  runPlanId: string;
  requirementId?: string;
  requirementRevision?: number;
  requirementDigest?: string;
  affectedModules: string[];
  allowedPaths: string[];
  forbiddenPaths: string[];
  dependencies: string[];
  databaseConcerns: string[];
  conflicts: string[];
  productBaseline?: string;
}

export interface RunPlanAnalysisResult {
  plans: RunPlanAnalysis[];
  pathOverlaps: Array<{
    left: string;
    right: string;
    paths: string[];
  }>;
  dependencyEdges: Array<{
    from: string;
    to: string;
    reason: string;
  }>;
  dependencyCycles: string[][];
  productBaselines: string[];
}

export interface ExecutionProgress {
  schema_version: 1;
  run_id: string;
  work_package_id: string;
  run_plan_id: string;
  run_plan_revision: number;
  status:
    "ready" | "in_progress" | "blocked" | "complete" | "failed" | "cancelled";
  current_phase_id?: string;
  current_task_id?: string;
  phases?: Array<{
    phase_id: string;
    status: "not_started" | "in_progress" | "blocked" | "complete" | "deferred";
    note?: string;
  }>;
  tasks: Array<{
    task_id: string;
    status: "not_started" | "in_progress" | "blocked" | "complete" | "deferred";
    note?: string;
  }>;
  updated_at?: string;
}

export interface ExecutionQuestion {
  id: string;
  status: "open" | "answered";
  blocking: true;
  question: string;
  reason: string;
  answer_type: "text" | "single_choice";
  options?: string[];
  recommended_answer?: string;
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
}

export interface ExecutionQuestionnaire {
  schema_version: 1;
  questionnaire_id: string;
  run_id: string;
  work_package_id: string;
  run_plan_id: string;
  run_plan_revision: number;
  phase_id: string;
  task_id: string;
  status: "awaiting_input" | "answered" | "resumed";
  revision: number;
  created_at: string;
  updated_at: string;
  resumed_at?: string;
  questions: ExecutionQuestion[];
}

export interface ActiveRun {
  runId: string;
  workPackageId: string;
  title: string;
  startedAt?: string;
  lastHeartbeatAt?: string;
  sequence: number;
  total: number;
  currentPhase: string;
  currentTask: string;
  progress: number;
  status:
    "ready" | "in_progress" | "blocked" | "complete" | "cancelled" | "failed";
  model: string;
  reasoningEffort: ReasoningEffort;
  taskId?: string;
  adapter?: string;
  baseCommit?: string;
  branch?: string;
  worktreePath?: string;
  acceptedSequence?: number;
}

export interface PreflightResult {
  ready: boolean;
  checks: Array<{
    name: string;
    status: "ready" | "blocked" | "warning";
    detail: string;
  }>;
  blockers: string[];
}
