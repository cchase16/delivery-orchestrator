import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Code2,
  FileCheck2,
  FileText,
  GitBranch,
  HardDrive,
  History,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Menu,
  Package,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  ApprovalSummary,
  ArtifactSummary,
  ExecutionProgress,
  PromptProfile,
  QualityGate,
  ReasoningEffort,
  RunPlanAnalysisResult,
  Snapshot,
} from "../shared/types";

type Page =
  | "Overview"
  | "Requirements"
  | "Planning"
  | "Run Plans"
  | "Work Packages"
  | "Approvals"
  | "Active Runs"
  | "Validation"
  | "History"
  | "Settings";
type PackageMemberSummary = {
  run_plan_id: string;
  revision: number;
  path: string;
  sequence: number;
};
type PromptTaskMonitor = {
  taskId: string;
  taskType: string;
  status: string;
  output: string;
  events: Array<Record<string, unknown>>;
  adapter: string;
  model: string;
  reasoningEffort: string;
  startedAt: string;
};
type DashboardCapabilities = {
  models: string[];
  reasoningEfforts: ReasoningEffort[];
  adapters: Array<{ id: string; status: string; detail: string }>;
};
const fallbackCapabilities: DashboardCapabilities = {
  models: ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"],
  reasoningEfforts: ["low", "medium", "high", "xhigh"],
  adapters: [],
};
const pageIcons: Record<Page, typeof LayoutDashboard> = {
  Overview: LayoutDashboard,
  Requirements: FileText,
  Planning: GitBranch,
  "Run Plans": ListChecks,
  "Work Packages": Package,
  Approvals: ShieldCheck,
  "Active Runs": TerminalSquare,
  Validation: ClipboardCheck,
  History,
  Settings: SettingsIcon,
};

const demoSnapshot: Snapshot = {
  generatedAt: new Date().toISOString(),
  system: {
    id: "customer-odoo",
    name: "Customer Odoo",
    branch: "main",
    deliveryPath: "customer-odoo-delivery",
    lockStatus: "resolved",
  },
  health: [
    { label: "Delivery repository", status: "healthy", detail: "Connected" },
    { label: "Product repository", status: "healthy", detail: "Connected" },
    { label: "Git", status: "healthy", detail: "Ready" },
    { label: "Codex App Server", status: "healthy", detail: "Authenticated" },
  ],
  artifacts: [
    {
      id: "REQ-ODOO-CONTEXT-MENU",
      title: "Context menu customization",
      kind: "requirement",
      path: "requirements/context-menu.md",
      extension: "md",
      revision: 2,
      digest: "f3b90b1c9d73",
      status: "approved",
      updatedAt: "2026-09-05T14:05:00Z",
    },
    {
      id: "RP-ODOO-CONTEXT-MENU",
      title: "Context menu implementation run plan",
      kind: "run_plan",
      path: "run-plans/context-menu.md",
      extension: "md",
      revision: 1,
      digest: "d07b1f46a27a",
      status: "approved",
      updatedAt: "2026-09-06T08:40:00Z",
      relatedRequirementId: "REQ-ODOO-CONTEXT-MENU",
      phaseCount: 5,
      taskCount: 18,
    },
    {
      id: "RP-ODOO-MAIN-TABLE",
      title: "Go to main table run plan",
      kind: "run_plan",
      path: "run-plans/main-table.md",
      extension: "md",
      revision: 1,
      digest: "4d7fa102f9c1",
      status: "draft",
      updatedAt: "2026-09-06T08:05:00Z",
      phaseCount: 4,
      taskCount: 14,
    },
    {
      id: "WP-SHARED-UX-01",
      title: "Shared UX foundation work package",
      kind: "work_package",
      path: "work-packages/shared-ux-01.json",
      extension: "json",
      revision: 1,
      digest: "a1b2c3d4e5f6",
      status: "approved",
      updatedAt: "2026-09-06T08:55:00Z",
    },
  ],
  approvals: [
    {
      id: "APR-RP-014",
      type: "run_plan",
      title: "Run plan approval",
      artifactId: "RP-ODOO-MAIN-TABLE",
      source: "run-plans/main-table.md",
      requestedBy: "Alex Rivera",
      requestedAt: "2026-09-06T08:05:00Z",
      priority: "high",
      status: "pending",
    },
    {
      id: "APR-WP-008",
      type: "work_package",
      title: "Work package review",
      artifactId: "WP-SHARED-UX-01",
      source: "work-packages/shared-ux-01.md",
      requestedBy: "Maya Chen",
      requestedAt: "2026-09-06T07:48:00Z",
      priority: "medium",
      status: "pending",
    },
  ],
  activeRun: {
    runId: "RUN-20260906-01",
    workPackageId: "WP-SHARED-UX-01",
    title: "Shared UX foundation",
    sequence: 1,
    total: 2,
    currentPhase: "Phase 2 · Module scaffolding",
    currentTask: "Add reusable context-menu service",
    progress: 42,
    status: "in_progress",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
  },
  promptProfiles: [
    {
      taskType: "work_package_sequencing",
      label: "Work-package sequencing",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      promptMode: "standard",
    },
    {
      taskType: "run_plan_generation",
      label: "Run-plan generation",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      promptMode: "standard",
    },
    {
      taskType: "run_plan_execution",
      label: "Run-plan execution",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      promptMode: "goal",
    },
  ],
  blockers: [],
};
const demoPackageMembers: Record<string, PackageMemberSummary[]> = {
  "WP-SHARED-UX-01": [
    {
      run_plan_id: "RP-ODOO-CONTEXT-MENU",
      revision: 1,
      path: "run-plans/context-menu.md",
      sequence: 1,
    },
    {
      run_plan_id: "RP-ODOO-MAIN-TABLE",
      revision: 1,
      path: "run-plans/main-table.md",
      sequence: 2,
    },
  ],
};

function formatTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}
function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}
function extractJsonObject(output: string): Record<string, unknown> | null {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? output.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    const value = JSON.parse(candidate) as unknown;
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
function extractRunPlanOutput(output: string): string | null {
  const fenced = output.match(/```(?:markdown|md)\s*([\s\S]*?)```/i)?.[1];
  if (fenced?.trim()) return fenced.trim();
  const plain = output.trim();
  return plain.startsWith("# ") ? plain : null;
}
function StatusMark({ status }: { status: string }) {
  const icon =
    status === "healthy" || status === "approved" || status === "complete" ? (
      <Check size={13} />
    ) : status === "blocked" || status === "rejected" ? (
      <X size={13} />
    ) : (
      <CircleDot size={11} />
    );
  return (
    <span
      className={"status-mark " + status}
      role="img"
      aria-label={`Status: ${status.replaceAll("_", " ")}`}
    >
      {icon}
    </span>
  );
}
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={"status-badge " + status}>
      <StatusMark status={status} />
      {status.replaceAll("_", " ")}
    </span>
  );
}
function PromptTaskActivity({
  tasks,
  currentTaskId,
  onInterrupt,
}: {
  tasks: PromptTaskMonitor[];
  currentTaskId?: string;
  onInterrupt: (taskId: string) => void;
}) {
  const visibleTasks = tasks.filter((task) => task.taskId !== currentTaskId);
  if (visibleTasks.length === 0) return null;
  return (
    <section className="prompt-task-list" aria-live="polite">
      <div>
        <span className="section-kicker">GENERATION ACTIVITY</span>
        <h3>Recent run-plan tasks</h3>
        <p>
          Running tasks update automatically. Output is available while the
          dashboard process owns the task.
        </p>
      </div>
      {visibleTasks.map((task) => {
        const isActive = [
          "starting",
          "queued",
          "running",
          "inprogress",
        ].includes(task.status.toLowerCase());
        return (
          <article className="prompt-task-row" key={task.taskId}>
            <div className="prompt-task-row-heading">
              <div>
                <strong>{task.taskId}</strong>
                <small>
                  {task.adapter} · {task.model} · {task.reasoningEffort}{" "}
                  reasoning · {new Date(task.startedAt).toLocaleString()}
                </small>
              </div>
              <StatusBadge status={task.status} />
            </div>
            {task.output && (
              <pre className="task-output">{task.output.slice(-4000)}</pre>
            )}
            <div className="prompt-task-row-footer">
              <span>{task.events.length} events received</span>
              {isActive && (
                <button
                  className="danger-button"
                  onClick={() => onInterrupt(task.taskId)}
                >
                  <XCircle size={14} />
                  Interrupt
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

export default function App() {
  const isDemo = new URLSearchParams(window.location.search).has("demo");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page>("Overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [focusedArtifactId, setFocusedArtifactId] = useState<string | null>(
    null,
  );
  const [capabilities, setCapabilities] =
    useState<DashboardCapabilities>(fallbackCapabilities);

  async function loadSnapshot() {
    setLoading(true);
    try {
      const response = await fetch("/api/snapshot");
      if (!response.ok)
        throw new Error("Dashboard API returned " + response.status);
      setSnapshot((await response.json()) as Snapshot);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Dashboard API unavailable",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadSnapshot();
    if (!isDemo)
      void fetch("/api/capabilities")
        .then(async (response) => {
          if (!response.ok) throw new Error("Capabilities unavailable");
          const value =
            (await response.json()) as Partial<DashboardCapabilities>;
          if (
            !Array.isArray(value.models) ||
            !Array.isArray(value.reasoningEfforts) ||
            !Array.isArray(value.adapters)
          )
            throw new Error("Capabilities response is incomplete");
          return value as DashboardCapabilities;
        })
        .then((value) => setCapabilities(value))
        .catch(() => setCapabilities(fallbackCapabilities));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function decide(
    artifact: ArtifactSummary | ApprovalSummary,
    decision: "approved" | "rejected",
  ) {
    const kind = "kind" in artifact ? artifact.kind : artifact.type;
    const artifactId =
      "artifactId" in artifact ? artifact.artifactId : artifact.id;
    const reason =
      decision === "rejected"
        ? window.prompt("Reason for rejection")
        : undefined;
    if (decision === "rejected" && !reason?.trim()) return;
    try {
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactId,
          kind,
          decision,
          reason,
          revision: "revision" in artifact ? artifact.revision : undefined,
          digest: "kind" in artifact ? artifact.digest : artifact.bindingDigest,
        }),
      });
      if (!response.ok)
        throw new Error("Decision was rejected by the dashboard API");
      setNotice(
        decision === "approved" ? "Approval recorded" : "Rejection recorded",
      );
      await loadSnapshot();
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Unable to record decision",
      );
    }
  }

  async function controlRun(
    runId: string,
    action: "pause" | "resume" | "cancel" | "complete" | "retry" | "replan",
  ) {
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/control`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { error?: string }).error ??
            "Run control was rejected",
        );
      setNotice(`Run ${action} requested`);
      await loadSnapshot();
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Unable to control run",
      );
    }
  }

  const data = isDemo ? demoSnapshot : snapshot;
  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        mobileOpen={mobileNavOpen}
        approvalCount={
          data?.approvals.filter((item) => item.status === "pending").length ??
          0
        }
        onNavigate={(nextPage) => {
          setPage(nextPage);
          setMobileNavOpen(false);
        }}
      />
      {mobileNavOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <div className="app-main">
        <TopBar
          snapshot={data}
          onRefresh={() => void loadSnapshot()}
          onMenu={() => setMobileNavOpen((open) => !open)}
          mobileNavOpen={mobileNavOpen}
        />
        <main className="content" aria-busy={loading}>
          {data && (
            <DataStatusBanner snapshot={data} loading={loading} error={error} />
          )}
          {loading && !data ? (
            <LoadingState />
          ) : error && !data ? (
            <ErrorState message={error} onRetry={() => void loadSnapshot()} />
          ) : data ? (
            <PageContent
              page={page}
              snapshot={data}
              capabilities={capabilities}
              onNavigate={setPage}
              onOpenArtifact={(artifactId, targetPage) => {
                setFocusedArtifactId(artifactId);
                setPage(targetPage);
              }}
              focusedArtifactId={focusedArtifactId}
              onRefresh={loadSnapshot}
              onDecision={decide}
              onRunControl={controlRun}
              onProfileUpdate={async (profile) => {
                const response = await fetch("/api/prompt-profiles", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(profile),
                });
                if (!response.ok)
                  throw new Error("Unable to save prompt profile");
                setNotice("Prompt profile saved");
              }}
              onResetRepository={async () => {
                if (
                  !window.confirm(
                    "Reset all approval decisions and workflow gates? Requirements, run plans, work packages, system plans, evidence, and releases will be kept.",
                  )
                )
                  return;
                try {
                  const response = await fetch("/api/repository/reset", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ confirm: true }),
                  });
                  if (!response.ok) {
                    const result = (await response.json()) as {
                      error?: string;
                    };
                    throw new Error(
                      result.error ?? "Unable to reset repository decisions",
                    );
                  }
                  setNotice("Repository decisions and gates reset");
                  await loadSnapshot();
                } catch (cause) {
                  setNotice(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to reset repository decisions",
                  );
                }
              }}
            />
          ) : null}
        </main>
        <footer className="footer">
          <span>All times shown in your local timezone</span>
          <span className="footer-sync">
            <span className="live-dot" />
            Auto refresh: On{" "}
            <button
              onClick={() => void loadSnapshot()}
              aria-label="Refresh now"
            >
              <RefreshCw size={14} />
            </button>
          </span>
        </footer>
      </div>
      {notice && (
        <div className="toast">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}

function Sidebar({
  page,
  onNavigate,
  mobileOpen,
  approvalCount,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  mobileOpen: boolean;
  approvalCount: number;
}) {
  const items: Page[] = [
    "Overview",
    "Requirements",
    "Planning",
    "Run Plans",
    "Work Packages",
    "Approvals",
    "Active Runs",
    "Validation",
    "History",
    "Settings",
  ];
  return (
    <aside className={mobileOpen ? "sidebar mobile-open" : "sidebar"}>
      <div className="brand">
        <div className="brand-mark">
          <Code2 size={18} />
        </div>
        <span>
          Factory
          <br />
          <strong>Dashboard</strong>
        </span>
      </div>
      <nav aria-label="Primary navigation">
        {items.map((item) => {
          const Icon = pageIcons[item];
          return (
            <button
              key={item}
              className={page === item ? "nav-item active" : "nav-item"}
              onClick={() => onNavigate(item)}
              aria-current={page === item ? "page" : undefined}
              aria-label={item}
            >
              <Icon size={18} />
              <span>{item}</span>
              {item === "Approvals" && approvalCount > 0 && (
                <span className="nav-count">{approvalCount}</span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="operator">
          <div className="avatar">CO</div>
          <div>
            <strong>Local operator</strong>
            <span>localhost session</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <button className="collapse" aria-label="Collapse navigation">
          <ChevronLeft size={16} />
        </button>
      </div>
    </aside>
  );
}
function TopBar({
  snapshot,
  onRefresh,
  onMenu,
  mobileNavOpen,
}: {
  snapshot: Snapshot | null;
  onRefresh: () => void;
  onMenu: () => void;
  mobileNavOpen: boolean;
}) {
  return (
    <header className="topbar">
      <button
        className="mobile-menu"
        aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={mobileNavOpen}
        onClick={onMenu}
      >
        <Menu size={20} />
      </button>
      <div className="crumb">
        <strong>{snapshot?.system.name ?? "Customer Odoo"}</strong>
        <span className="divider" />
        <span>Local delivery orchestrator</span>
      </div>
      <div className="top-actions">
        <span className="repo-label">
          <GitBranch size={14} />
          {snapshot?.system.branch ?? "main"}
        </span>
        <span className="health-pill">
          <span className="live-dot" />
          {snapshot?.health.find((item) => item.label === "Delivery repository")
            ?.detail ?? "Connecting"}
        </span>
        <span className="sync-label">
          Last sync {snapshot ? formatTime(snapshot.generatedAt) : "—"}
        </span>
        <button
          className="icon-button"
          onClick={onRefresh}
          aria-label="Refresh dashboard"
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </header>
  );
}
function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow ?? "CONTROL SURFACE"}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function DataStatusBanner({
  snapshot,
  loading,
  error,
}: {
  snapshot: Snapshot;
  loading: boolean;
  error: string | null;
}) {
  if (error)
    return (
      <div className="data-banner error" role="alert">
        <AlertTriangle size={17} />
        <div>
          <strong>Refresh failed; showing the last snapshot</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  if (loading)
    return (
      <div className="data-banner stale" role="status" aria-live="polite">
        <RefreshCw className="spin" size={16} />
        <div>
          <strong>Refreshing dashboard state</strong>
          <span>Some values may be stale until reconciliation completes.</span>
        </div>
      </div>
    );
  const offline = snapshot.health.find((item) => item.status === "offline");
  if (offline)
    return (
      <div className="data-banner error" role="alert">
        <AlertTriangle size={17} />
        <div>
          <strong>Repository unavailable</strong>
          <span>
            {offline.label}: {offline.detail}
          </span>
        </div>
      </div>
    );
  if (snapshot.validationErrors?.length)
    return (
      <div className="data-banner warning" role="status">
        <AlertTriangle size={17} />
        <div>
          <strong>Partial data: validation issues detected</strong>
          <span>
            {snapshot.validationErrors.length} indexed record
            {snapshot.validationErrors.length === 1 ? "" : "s"} need review.
          </span>
        </div>
      </div>
    );
  return null;
}
function PageContent({
  page,
  snapshot,
  capabilities,
  onNavigate,
  onOpenArtifact,
  focusedArtifactId,
  onRefresh,
  onDecision,
  onRunControl,
  onProfileUpdate,
  onResetRepository,
}: {
  page: Page;
  snapshot: Snapshot;
  capabilities: DashboardCapabilities;
  onNavigate: (page: Page) => void;
  onOpenArtifact: (artifactId: string, targetPage: Page) => void;
  focusedArtifactId: string | null;
  onRefresh: () => Promise<void>;
  onDecision: (
    artifact: ArtifactSummary | ApprovalSummary,
    decision: "approved" | "rejected",
  ) => void;
  onRunControl: (
    runId: string,
    action: "pause" | "resume" | "cancel" | "complete" | "retry" | "replan",
  ) => Promise<void>;
  onProfileUpdate: (profile: PromptProfile) => Promise<void>;
  onResetRepository: () => Promise<void>;
}) {
  if (page === "Settings")
    return (
      <SettingsPage
        profiles={snapshot.promptProfiles}
        capabilities={capabilities}
        onUpdate={onProfileUpdate}
        onResetRepository={onResetRepository}
      />
    );
  if (page === "Requirements")
    return (
      <ArtifactPage
        title="Requirements"
        description="Review exact requirement revisions before planning."
        kind="requirement"
        snapshot={snapshot}
        initialArtifactId={focusedArtifactId}
        onRefresh={onRefresh}
        onDecision={onDecision}
        onOpenArtifact={onOpenArtifact}
      />
    );
  if (page === "Planning") return <PlanningPage snapshot={snapshot} />;
  if (page === "Run Plans")
    return (
      <ArtifactPage
        title="Run Plans"
        description="Full phased implementation plans created from approved requirements."
        kind="run_plan"
        snapshot={snapshot}
        initialArtifactId={focusedArtifactId}
        onRefresh={onRefresh}
        onDecision={onDecision}
        onOpenArtifact={onOpenArtifact}
      />
    );
  if (page === "Work Packages")
    return (
      <WorkPackagesPage
        snapshot={snapshot}
        onDecision={onDecision}
        onOpenArtifact={onOpenArtifact}
        onRefresh={onRefresh}
      />
    );
  if (page === "Approvals")
    return <ApprovalsPage snapshot={snapshot} onDecision={onDecision} />;
  if (page === "Active Runs")
    return <ActiveRunsPage snapshot={snapshot} onRunControl={onRunControl} />;
  if (page === "Validation") return <ValidationPage snapshot={snapshot} />;
  if (page === "History") return <HistoryPage snapshot={snapshot} />;
  return (
    <OverviewPage
      snapshot={snapshot}
      onNavigate={onNavigate}
      onDecision={onDecision}
    />
  );
}
function OverviewPage({
  snapshot,
  onNavigate,
  onDecision,
}: {
  snapshot: Snapshot;
  onNavigate: (page: Page) => void;
  onDecision: (
    artifact: ArtifactSummary | ApprovalSummary,
    decision: "approved" | "rejected",
  ) => void;
}) {
  const pending = snapshot.approvals.filter(
    (item) => item.status === "pending",
  );
  const plans = snapshot.artifacts.filter((item) => item.kind === "run_plan");
  return (
    <>
      <PageHeader
        eyebrow="DELIVERY CONTROL"
        title="Overview"
        description="End-to-end view of requirements, plans, approvals, and active execution."
        action={
          <button
            className="primary-button"
            onClick={() => onNavigate("Run Plans")}
          >
            <Zap size={16} />
            Create run plan
            <ChevronDown size={15} />
          </button>
        }
      />
      <div className="stat-grid">
        <Stat
          icon={<FileCheck2 />}
          label="Approved requirements"
          value={String(
            snapshot.artifacts.filter(
              (item) =>
                item.kind === "requirement" && item.status === "approved",
            ).length || "—",
          )}
          action="View requirements"
          onClick={() => onNavigate("Requirements")}
        />
        <Stat
          icon={<ListChecks />}
          label="Run plans"
          value={String(plans.length || "—")}
          action="View run plans"
          onClick={() => onNavigate("Run Plans")}
        />
        <Stat
          icon={<Activity />}
          label="Active runs"
          value={snapshot.activeRun ? "1" : "—"}
          action="View active runs"
          onClick={() => onNavigate("Active Runs")}
        />
        <Stat
          icon={<ShieldCheck />}
          label="Pending approvals"
          value={String(pending.length || "—")}
          action="View approvals"
          onClick={() => onNavigate("Approvals")}
        />
      </div>
      <div className="overview-grid">
        <SystemStatus snapshot={snapshot} />
        <SequencePanel snapshot={snapshot} onNavigate={onNavigate} />
      </div>
      <ReviewQueue
        approvals={pending}
        onNavigate={onNavigate}
        onDecision={onDecision}
      />
    </>
  );
}
function Stat({
  icon,
  label,
  value,
  action,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="stat">
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <span>{label}</span>
        <strong>{value}</strong>
        <button onClick={onClick}>
          {action}
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}
function SystemStatus({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="panel system-status">
      <div className="panel-title">
        <div>
          <span className="section-kicker">SYSTEM STATUS</span>
          <h2>Environment health</h2>
        </div>
        <HardDrive size={19} />
      </div>
      <div className="health-list">
        <div className="health-row">
          <StatusMark status="healthy" />
          <span>Schema registry</span>
          <small>Loaded</small>
        </div>
        <div className="health-row">
          <StatusMark
            status={
              snapshot.system.lockStatus === "resolved" ? "healthy" : "blocked"
            }
          />
          <span>Delivery lock</span>
          <small>{snapshot.system.lockStatus}</small>
        </div>
        <div className="health-row">
          <StatusMark
            status={
              snapshot.artifacts.some(
                (artifact) => artifact.kind === "system_plan",
              )
                ? "healthy"
                : "blocked"
            }
          />
          <span>System plan</span>
          <small>
            {snapshot.artifacts.some(
              (artifact) => artifact.kind === "system_plan",
            )
              ? "Present"
              : "Missing"}
          </small>
        </div>
        {snapshot.health.map((item) => (
          <div className="health-row" key={item.label}>
            <StatusMark status={item.status} />
            <span>{item.label}</span>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
      {snapshot.blockers.length > 0 && (
        <div className="blocker-note">
          <AlertTriangle size={16} />
          <div>
            <strong>
              {snapshot.blockers.length} blocker
              {snapshot.blockers.length > 1 ? "s" : ""}
            </strong>
            <span>{snapshot.blockers[0]}</span>
          </div>
        </div>
      )}
    </section>
  );
}
function SequencePanel({
  snapshot,
  onNavigate,
}: {
  snapshot: Snapshot;
  onNavigate: (page: Page) => void;
}) {
  const plans = snapshot.artifacts.filter((item) => item.kind === "run_plan");
  return (
    <section className="panel sequence-panel">
      <div className="panel-title">
        <div>
          <span className="section-kicker">WORK PACKAGE SEQUENCE</span>
          <h2>{snapshot.activeRun?.title ?? "No work package assembled"}</h2>
        </div>
        <button
          className="quiet-button"
          onClick={() => onNavigate("Work Packages")}
        >
          Work packages <ArrowRight size={14} />
        </button>
      </div>
      {snapshot.activeRun ? (
        <div className="active-summary">
          <div>
            <span className="muted-label">Active run plan</span>
            <strong>{snapshot.activeRun.currentPhase}</strong>
            <span>{snapshot.activeRun.currentTask}</span>
          </div>
          <div className="progress-wrap">
            <span>{snapshot.activeRun.progress}%</span>
            <div className="progress-bar">
              <i style={{ width: snapshot.activeRun.progress + "%" }} />
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-sequence">
          <div className="empty-icon">
            <Package size={20} />
          </div>
          <strong>Build a work package from approved run plans</strong>
          <span>
            Select one or more approved plans, then suggest their implementation
            sequence.
          </span>
          <button
            className="secondary-button"
            onClick={() => onNavigate("Run Plans")}
          >
            View available run plans <ArrowRight size={14} />
          </button>
        </div>
      )}
      {plans.length > 0 && (
        <div className="sequence-table">
          <div className="sequence-head">
            <span>Seq</span>
            <span>Run plan</span>
            <span>Model</span>
            <span>Status</span>
          </div>
          {plans.slice(0, 5).map((plan, index) => (
            <div className="sequence-row" key={plan.id}>
              <span className="sequence-number">{index + 1}</span>
              <div>
                <strong>{plan.title}</strong>
                <small>
                  {plan.id} · revision {plan.revision}
                </small>
              </div>
              <span className="model-text">
                {index === 0 ? "GPT-5.6 Sol" : "GPT-5.6 Luna · High"}
              </span>
              <StatusBadge status={plan.status} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function ReviewQueue({
  approvals,
  onNavigate,
  onDecision,
}: {
  approvals: ApprovalSummary[];
  onNavigate: (page: Page) => void;
  onDecision: (
    artifact: ApprovalSummary,
    decision: "approved" | "rejected",
  ) => void;
}) {
  return (
    <section className="panel review-queue">
      <div className="panel-title">
        <div>
          <span className="section-kicker">REVIEW QUEUE</span>
          <h2>
            Decisions waiting for you{" "}
            <span className="count-badge">{approvals.length}</span>
          </h2>
        </div>
        <button
          className="quiet-button"
          onClick={() => onNavigate("Approvals")}
        >
          View all approvals <ArrowRight size={14} />
        </button>
      </div>
      {approvals.length === 0 ? (
        <div className="empty-inline">
          <CheckCircle2 size={18} />
          No decisions are waiting for review.
        </div>
      ) : (
        <div className="review-table">
          <div className="review-head">
            <span>Type</span>
            <span>Artifact</span>
            <span>Requested by</span>
            <span>Priority</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {approvals.map((approval) => (
            <div className="review-row" key={approval.id}>
              <span className="type-cell">
                <FileText size={15} />
                {approval.title}
              </span>
              <div>
                <strong>{approval.artifactId}</strong>
                <small>{approval.source}</small>
              </div>
              <span>
                {approval.requestedBy}
                <small>{formatTime(approval.requestedAt)}</small>
              </span>
              <span className={"priority " + approval.priority}>
                {approval.priority}
              </span>
              <StatusBadge status={approval.status} />
              <button
                className="review-button"
                onClick={() => onDecision(approval, "approved")}
              >
                Approve
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function PlanningPage({ snapshot }: { snapshot: Snapshot }) {
  const systemPlans = snapshot.artifacts.filter(
    (artifact) => artifact.kind === "system_plan",
  );
  const approvedRequirements = snapshot.artifacts.filter(
    (artifact) =>
      artifact.kind === "requirement" && artifact.status === "approved",
  );
  const approvedRunPlans = snapshot.artifacts.filter(
    (artifact) =>
      artifact.kind === "run_plan" && artifact.status === "approved",
  );
  const linkedRunPlans = snapshot.artifacts.filter(
    (artifact) =>
      artifact.kind === "run_plan" &&
      !["rejected", "invalid", "missing", "superseded"].includes(
        artifact.status,
      ),
  );
  const requirementIdsWithPlans = new Set(
    linkedRunPlans
      .map((plan) => plan.relatedRequirementId)
      .filter((id): id is string => Boolean(id)),
  );
  const requirementsAwaitingPlans = approvedRequirements.filter(
    (requirement) => !requirementIdsWithPlans.has(requirement.id),
  );
  return (
    <>
      <PageHeader
        eyebrow="PLANNING"
        title="Planning"
        description="See the system context and the artifacts waiting for the next planning gate."
      />
      <div className="planning-layout">
        <section className="panel package-builder">
          <div className="panel-title">
            <div>
              <span className="section-kicker">SYSTEM PLAN</span>
              <h2>System context</h2>
            </div>
            <StatusBadge status={systemPlans.length ? "complete" : "blocked"} />
          </div>
          {systemPlans.length === 0 ? (
            <EmptyData label="Add a valid system plan to unlock governed execution" />
          ) : (
            systemPlans.map((plan) => (
              <div className="inbox-row" key={plan.id}>
                <div className="inbox-icon">
                  <GitBranch size={18} />
                </div>
                <div className="inbox-main">
                  <strong>{plan.title}</strong>
                  <span>
                    {plan.id} · revision {plan.revision}
                  </span>
                  <small>
                    {plan.path} · SHA-256 {plan.digest}
                  </small>
                </div>
                <StatusBadge status={plan.status} />
              </div>
            ))
          )}
        </section>
        <section className="panel package-rationale">
          <span className="section-kicker">NEXT GATES</span>
          <h2>Planning queue</h2>
          <div className="rationale-empty">
            <ListChecks size={22} />
            <strong>
              {requirementsAwaitingPlans.length} approved requirement
              {requirementsAwaitingPlans.length === 1 ? "" : "s"} awaiting a run
              plan
            </strong>
            <span>
              {approvedRunPlans.length} approved run plan
              {approvedRunPlans.length === 1 ? "" : "s"} available for
              work-package assembly.
            </span>
          </div>
        </section>
      </div>
      <section className="panel full-panel package-review">
        <div className="panel-title">
          <div>
            <span className="section-kicker">APPROVED REQUIREMENTS</span>
            <h2>Requirements awaiting run plans</h2>
          </div>
          <span>{requirementsAwaitingPlans.length}</span>
        </div>
        {requirementsAwaitingPlans.length === 0 ? (
          <EmptyData label="Every approved requirement has an indexed run plan" />
        ) : (
          requirementsAwaitingPlans.map((requirement) => (
            <div className="inbox-row" key={requirement.id}>
              <div className="inbox-icon">
                <FileText size={18} />
              </div>
              <div className="inbox-main">
                <strong>{requirement.title}</strong>
                <span>
                  {requirement.id} · revision {requirement.revision}
                </span>
                <small>
                  {requirement.path} · SHA-256 {requirement.digest}
                </small>
              </div>
              <StatusBadge status="approved" />
            </div>
          ))
        )}
      </section>
    </>
  );
}

function ArtifactPage({
  title,
  description,
  kind,
  snapshot,
  initialArtifactId,
  onRefresh,
  onDecision,
  onOpenArtifact,
}: {
  title: string;
  description: string;
  kind: ArtifactSummary["kind"];
  snapshot: Snapshot;
  initialArtifactId?: string | null;
  onRefresh: () => Promise<void>;
  onDecision: (
    artifact: ArtifactSummary,
    decision: "approved" | "rejected",
  ) => void;
  onOpenArtifact: (artifactId: string, targetPage: Page) => void;
}) {
  const artifacts = snapshot.artifacts.filter((item) => item.kind === kind);
  const [statusFilter, setStatusFilter] = useState("all");
  const visibleArtifacts = artifacts.filter(
    (artifact) => statusFilter === "all" || artifact.status === statusFilter,
  );
  const [selected, setSelected] = useState<ArtifactSummary | null>(
    artifacts.find((artifact) => artifact.id === initialArtifactId) ??
      artifacts[0] ??
      null,
  );
  useEffect(() => {
    setSelected((current) => {
      const preferred = initialArtifactId
        ? artifacts.find((artifact) => artifact.id === initialArtifactId)
        : undefined;
      return (
        preferred ??
        (current
          ? artifacts.find((artifact) => artifact.id === current.id)
          : undefined) ??
        artifacts[0] ??
        null
      );
    });
  }, [initialArtifactId, kind, snapshot.generatedAt]);
  const selectedRequirement =
    kind === "requirement" && selected?.status === "approved" ? selected : null;
  const [promptPreview, setPromptPreview] = useState<{
    requirementId: string;
    model: string;
    promptMode: string;
    reasoningEffort: string;
    templateVersion: string;
    redactionApplied: boolean;
    prompt: string;
  } | null>(null);
  const [promptTask, setPromptTask] = useState<{
    taskId: string;
    requirementId: string;
    adapter: string;
    actualModel: string;
    actualReasoningEffort: string;
  } | null>(null);
  const [promptTaskSnapshot, setPromptTaskSnapshot] = useState<{
    status: string;
    output: string;
    events: Array<Record<string, unknown>>;
  } | null>(null);
  const [isStartingRunPlan, setIsStartingRunPlan] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [draftSaved, setDraftSaved] = useState<string | null>(null);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [isSavingRunPlan, setIsSavingRunPlan] = useState(false);
  const [supersedesRunPlanId, setSupersedesRunPlanId] = useState("");
  const [promptTasks, setPromptTasks] = useState<PromptTaskMonitor[]>([]);
  useEffect(() => {
    if (
      !["requirement", "run_plan"].includes(kind) ||
      new URLSearchParams(window.location.search).has("demo")
    )
      return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch("/api/prompt-tasks");
        const result = (await response.json()) as {
          tasks?: PromptTaskMonitor[];
        };
        if (!response.ok) throw new Error("Task list is unavailable.");
        if (!cancelled) setPromptTasks(result.tasks ?? []);
      } catch {
        // The current-task monitor reports connection errors in context.
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [kind]);
  useEffect(() => {
    if (
      kind !== "requirement" ||
      !promptTask?.taskId ||
      new URLSearchParams(window.location.search).has("demo")
    )
      return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/prompt-tasks/${encodeURIComponent(promptTask.taskId)}`,
        );
        const result = (await response.json()) as {
          status?: string;
          output?: string;
          events?: Array<Record<string, unknown>>;
        };
        if (!response.ok) throw new Error("Task output is unavailable.");
        setPromptTaskSnapshot({
          status: result.status ?? "unknown",
          output: result.output ?? "",
          events: result.events ?? [],
        });
        let extracted: string | null = null;
        if (result.output) {
          extracted = extractRunPlanOutput(result.output);
          if (extracted) {
            setDraftMarkdown(extracted);
            setPromptError(null);
          }
        }
        const normalizedStatus = result.status?.toLowerCase() ?? "unknown";
        const terminal = [
          "completed",
          "complete",
          "succeeded",
          "failed",
          "error",
          "interrupted",
          "cancelled",
          "canceled",
          "unknown",
        ].includes(normalizedStatus);
        const succeeded = ["completed", "complete", "succeeded"].includes(
          normalizedStatus,
        );
        if (terminal && !succeeded) {
          setPromptError(
            normalizedStatus === "unknown"
              ? "The task state is no longer available. The dashboard process or its App Server process may have stopped. Start a new generation task."
              : `The generation task ended with status ${result.status ?? "unknown"}${result.output ? ". Review the task output below." : " without producing output."}`,
          );
        } else if (terminal && !extracted) {
          setPromptError(
            "The task completed without a parseable Markdown plan; review the output below and enter the canonical draft manually.",
          );
        }
        if (!cancelled && !terminal)
          timer = window.setTimeout(() => void poll(), 1500);
      } catch (cause) {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 2500);
        if (!cancelled && cause instanceof Error) {
          setPromptTaskSnapshot((current) => ({
            status: "connection_error",
            output: current?.output ?? "",
            events: current?.events ?? [],
          }));
          setPromptError(cause.message);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [kind, promptTask?.taskId]);
  async function prepareRunPlanPrompt() {
    const requirement = selectedRequirement;
    if (!requirement) {
      setPromptError(
        "Select an approved requirement revision before creating its run plan.",
      );
      return;
    }
    try {
      const response = await fetch("/api/prompts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskType: "run_plan_generation",
          artifactIds: [requirement.id],
        }),
      });
      const result = (await response.json()) as {
        model?: string;
        promptMode?: string;
        reasoningEffort?: string;
        templateVersion?: string;
        redactionApplied?: boolean;
        prompt?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Unable to prepare prompt.");
      setPromptPreview({
        requirementId: requirement.id,
        model: result.model ?? "gpt-5.6-sol",
        promptMode: result.promptMode ?? "standard",
        reasoningEffort: result.reasoningEffort ?? "medium",
        templateVersion: result.templateVersion ?? "run-plan-generation.v3",
        redactionApplied: result.redactionApplied ?? false,
        prompt: result.prompt ?? "",
      });
      setPromptTask(null);
      setPromptTaskSnapshot(null);
      setPromptError(null);
    } catch (cause) {
      setPromptError(
        cause instanceof Error ? cause.message : "Unable to prepare prompt.",
      );
    }
  }
  async function startRunPlanGeneration() {
    const requirement = selectedRequirement;
    const profile = snapshot.promptProfiles.find(
      (item) => item.taskType === "run_plan_generation",
    );
    if (!requirement || !profile) {
      setPromptError(
        "An approved requirement and generation profile are required.",
      );
      return;
    }
    setIsStartingRunPlan(true);
    setPromptTask(null);
    setPromptTaskSnapshot(null);
    setPromptError(null);
    try {
      const response = await fetch("/api/prompt-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskType: "run_plan_generation",
          artifactIds: [requirement.id],
          model: promptPreview?.model ?? profile.model,
          reasoningEffort:
            promptPreview?.reasoningEffort ?? profile.reasoningEffort,
          adapter: new URLSearchParams(window.location.search).has("demo")
            ? "fake"
            : profile.adapter,
        }),
      });
      const result = (await response.json()) as {
        taskId?: string;
        adapter?: string;
        actualModel?: string;
        actualReasoningEffort?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Unable to start generation.");
      setPromptTask({
        taskId: result.taskId ?? "—",
        requirementId: requirement.id,
        adapter: result.adapter ?? profile.adapter ?? "fake",
        actualModel: result.actualModel ?? profile.model,
        actualReasoningEffort:
          result.actualReasoningEffort ?? profile.reasoningEffort,
      });
      setPromptTaskSnapshot({ status: "starting", output: "", events: [] });
      setDraftSaved(null);
      setPromptError(null);
    } catch (cause) {
      setPromptError(
        cause instanceof Error ? cause.message : "Unable to start generation.",
      );
    } finally {
      setIsStartingRunPlan(false);
    }
  }
  async function interruptPromptTask(taskId: string) {
    try {
      const response = await fetch(
        `/api/prompt-tasks/${encodeURIComponent(taskId)}/interrupt`,
        { method: "POST" },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Unable to interrupt generation.");
      setPromptError(null);
      setPromptTasks((tasks) =>
        tasks.map((task) =>
          task.taskId === taskId ? { ...task, status: "interrupted" } : task,
        ),
      );
    } catch (cause) {
      setPromptError(
        cause instanceof Error
          ? cause.message
          : "Unable to interrupt generation.",
      );
    }
  }
  async function saveGeneratedRunPlan() {
    const requirement = snapshot.artifacts.find(
      (item) =>
        item.id === promptTask?.requirementId &&
        item.kind === "requirement" &&
        item.status === "approved",
    );
    if (!requirement) {
      setDraftSaveError(
        "An approved requirement is required to save a run plan.",
      );
      return;
    }
    setIsSavingRunPlan(true);
    setDraftSaveError(null);
    setDraftSaved(null);
    try {
      const response = await fetch("/api/run-plans/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requirementId: requirement.id,
          markdown: draftMarkdown,
          ...(supersedesRunPlanId ? { supersedesRunPlanId } : {}),
        }),
      });
      const result = (await response.json()) as {
        id?: string;
        path?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Unable to save run-plan draft.");
      setDraftSaved(result.path ?? result.id ?? "draft");
      setDraftSaveError(null);
      setPromptError(null);
      await onRefresh();
    } catch (cause) {
      setDraftSaveError(
        cause instanceof Error
          ? cause.message
          : "Unable to validate and save the run-plan Markdown.",
      );
    } finally {
      setIsSavingRunPlan(false);
    }
  }
  const promptRequirement = snapshot.artifacts.find(
    (item) => item.id === promptTask?.requirementId,
  );
  const runPlanPromptTasks = promptTasks.filter(
    (task) => task.taskType === "run_plan_generation",
  );
  const activePromptTask = runPlanPromptTasks.find((task) =>
    ["starting", "queued", "running", "inprogress"].includes(
      task.status.toLowerCase(),
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow={
          kind === "run_plan" ? "IMPLEMENTATION PLANS" : "REQUIREMENT INTAKE"
        }
        title={title}
        description={description}
        action={
          kind === "requirement" ? (
            <button
              className="primary-button"
              onClick={() => void prepareRunPlanPrompt()}
              disabled={!selectedRequirement}
              title={
                selectedRequirement
                  ? `Create a run plan for ${selectedRequirement.id}`
                  : "Select an approved requirement first"
              }
            >
              <Zap size={16} />
              Create run plan
            </button>
          ) : undefined
        }
      />
      <div className="split-view">
        <section className="panel artifact-list">
          <div className="list-toolbar">
            <span>
              {visibleArtifacts.length} artifact
              {visibleArtifacts.length === 1 ? "" : "s"}
            </span>
            <label className="filter-button">
              <span className="sr-only">Filter artifacts by status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter artifacts by status"
              >
                <option value="all">All statuses</option>
                <option value="awaiting_review">Awaiting review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="invalid">Invalid</option>
                <option value="superseded">Superseded</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
          {visibleArtifacts.length === 0 ? (
            <EmptyData
              label={
                statusFilter === "all"
                  ? "No " + kind.replace("_", " ") + " artifacts found"
                  : "No artifacts match this status"
              }
            />
          ) : (
            visibleArtifacts.map((artifact) => (
              <button
                className={
                  "artifact-row " +
                  (selected?.id === artifact.id ? "selected" : "")
                }
                key={artifact.id}
                onClick={() => setSelected(artifact)}
              >
                <div className="artifact-type">
                  <FileText size={16} />
                  <span>{artifact.extension.toUpperCase()}</span>
                </div>
                <div>
                  <strong>{artifact.title}</strong>
                  <small>
                    {artifact.id} · rev {artifact.revision}
                  </small>
                </div>
                <StatusBadge status={artifact.status} />
              </button>
            ))
          )}
        </section>
        <ArtifactDetail
          artifact={selected}
          alternatives={artifacts}
          relatedArtifacts={snapshot.artifacts}
          approvals={snapshot.approvals}
          onDecision={onDecision}
          onOpenArtifact={onOpenArtifact}
        />
      </div>
      {promptError && (
        <div className="blocker-note page-note">
          <AlertTriangle size={16} />
          <div>
            <strong>Run-plan generation is not ready</strong>
            <span>{promptError}</span>
          </div>
        </div>
      )}
      <PromptTaskActivity
        tasks={runPlanPromptTasks}
        currentTaskId={promptTask?.taskId}
        onInterrupt={(taskId) => void interruptPromptTask(taskId)}
      />
      {promptPreview &&
        promptPreview.requirementId === selectedRequirement?.id && (
          <section className="panel prompt-preview">
            <div className="panel-title">
              <div>
                <span className="section-kicker">PROMPT PREVIEW</span>
                <h2>Run-plan generation packet</h2>
              </div>
              <StatusBadge status="ready" />
            </div>
            <div className="detail-meta">
              <span title={selectedRequirement?.title}>
                <FileText size={14} />
                {promptPreview.requirementId}
              </span>
              <span>
                <Zap size={14} />
                {promptPreview.model}
              </span>
              <span>
                <CircleDot size={14} />
                {promptPreview.promptMode} prompt
              </span>
              <span>
                <SlidersHorizontal size={14} />
                {promptPreview.reasoningEffort} reasoning
              </span>
              <span>
                <ShieldCheck size={14} />
                No goal created
              </span>
              {promptPreview.redactionApplied && (
                <span>
                  <ShieldCheck size={14} />
                  Sensitive values redacted
                </span>
              )}
            </div>
            <div className="prompt-controls">
              <label>
                Effective model
                <select
                  value={promptPreview.model}
                  onChange={(event) =>
                    setPromptPreview({
                      ...promptPreview,
                      model: event.target.value,
                    })
                  }
                >
                  <option>gpt-5.6-sol</option>
                  <option>gpt-5.6-luna</option>
                  <option>gpt-5.6-terra</option>
                </select>
              </label>
              <label>
                Effective reasoning
                <select
                  value={promptPreview.reasoningEffort}
                  onChange={(event) =>
                    setPromptPreview({
                      ...promptPreview,
                      reasoningEffort: event.target.value,
                    })
                  }
                >
                  <option>low</option>
                  <option>medium</option>
                  <option>high</option>
                  <option>xhigh</option>
                </select>
              </label>
            </div>
            <div className="detail-actions">
              <button
                className="primary-button"
                onClick={() => void startRunPlanGeneration()}
                disabled={isStartingRunPlan || Boolean(activePromptTask)}
                aria-busy={isStartingRunPlan}
              >
                {isStartingRunPlan || activePromptTask ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <Play size={15} />
                )}
                {isStartingRunPlan
                  ? "Starting…"
                  : activePromptTask
                    ? "Generation already running"
                    : "Start standard prompt"}
              </button>
              <span className="muted-label">
                Template {promptPreview.templateVersion}
              </span>
            </div>
            {(isStartingRunPlan || promptTask || promptError) && (
              <div
                className="progress-overlay prompt-task-progress"
                role="status"
                aria-live="polite"
              >
                <div className="panel-title">
                  <div>
                    <span className="section-kicker">CODEX TASK</span>
                    <h2>
                      {isStartingRunPlan
                        ? "Starting App Server and task…"
                        : (promptTask?.taskId ?? "Generation could not start")}
                    </h2>
                  </div>
                  {isStartingRunPlan ||
                  ["starting", "inprogress"].includes(
                    promptTaskSnapshot?.status.toLowerCase() ?? "",
                  ) ? (
                    <Loader2 className="spin" size={18} />
                  ) : (
                    <StatusBadge
                      status={
                        promptTaskSnapshot?.status ??
                        (promptError ? "error" : "started")
                      }
                    />
                  )}
                </div>
                {promptTask && (
                  <small className="muted-label prompt-task-meta">
                    {promptTask.adapter} · {promptTask.actualModel} ·{" "}
                    {promptTask.actualReasoningEffort} reasoning ·{" "}
                    {promptTaskSnapshot?.events.length ?? 0} events received
                  </small>
                )}
                {promptTaskSnapshot?.output && (
                  <pre className="task-output">
                    {promptTaskSnapshot.output.slice(-4000)}
                  </pre>
                )}
                {promptTask &&
                  ["starting", "queued", "running", "inprogress"].includes(
                    promptTaskSnapshot?.status.toLowerCase() ?? "starting",
                  ) && (
                    <div className="prompt-task-row-footer">
                      <span>Output updates automatically.</span>
                      <button
                        className="danger-button"
                        onClick={() =>
                          void interruptPromptTask(promptTask.taskId)
                        }
                      >
                        <XCircle size={14} />
                        Interrupt
                      </button>
                    </div>
                  )}
                {promptError && (
                  <p className="prompt-task-error">{promptError}</p>
                )}
              </div>
            )}
            <pre>{promptPreview.prompt}</pre>
            {promptTask &&
              !new URLSearchParams(window.location.search).has("demo") && (
                <div className="draft-output">
                  <div>
                    <span className="section-kicker">CANONICAL OUTPUT</span>
                    <h3>Save the reviewed model output</h3>
                    <p>
                      Review the complete Markdown plan. The dashboard validates
                      its template structure, derives the JSON sidecar, and
                      writes a new draft revision only after validation
                      succeeds.
                    </p>
                  </div>
                  <label>
                    Revision request
                    <select
                      value={supersedesRunPlanId}
                      onChange={(event) =>
                        setSupersedesRunPlanId(event.target.value)
                      }
                    >
                      <option value="">Create a new run-plan revision</option>
                      {snapshot.artifacts
                        .filter(
                          (candidate) =>
                            candidate.kind === "run_plan" &&
                            candidate.relatedRequirementId ===
                              promptRequirement?.id,
                        )
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            Supersede {candidate.id} · rev {candidate.revision}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Run-plan Markdown
                    <textarea
                      value={draftMarkdown}
                      onChange={(event) => {
                        setDraftMarkdown(event.target.value);
                        setDraftSaved(null);
                        setDraftSaveError(null);
                      }}
                      placeholder="Paste the complete canonical Markdown run plan here."
                      rows={10}
                    />
                  </label>
                  <div className="detail-actions">
                    <button
                      className="primary-button"
                      onClick={() => void saveGeneratedRunPlan()}
                      disabled={!draftMarkdown.trim() || isSavingRunPlan}
                      aria-busy={isSavingRunPlan}
                    >
                      {isSavingRunPlan ? (
                        <Loader2 className="spin" size={15} />
                      ) : (
                        <FileCheck2 size={15} />
                      )}
                      {isSavingRunPlan
                        ? "Validating and saving…"
                        : "Validate and save draft"}
                    </button>
                    {draftSaved && (
                      <span className="muted-label">Saved {draftSaved}</span>
                    )}
                  </div>
                  {draftSaveError && (
                    <div className="draft-save-error" role="alert">
                      <AlertTriangle size={15} />
                      <span>{draftSaveError}</span>
                    </div>
                  )}
                </div>
              )}
          </section>
        )}
    </>
  );
}
function ArtifactDetail({
  artifact,
  alternatives,
  relatedArtifacts,
  approvals,
  onDecision,
  onOpenArtifact,
}: {
  artifact: ArtifactSummary | null;
  alternatives: ArtifactSummary[];
  relatedArtifacts: ArtifactSummary[];
  approvals: ApprovalSummary[];
  onDecision: (
    artifact: ArtifactSummary,
    decision: "approved" | "rejected",
  ) => void;
  onOpenArtifact: (artifactId: string, targetPage: Page) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [compareId, setCompareId] = useState("");
  const [comparison, setComparison] = useState<{
    changed: boolean;
    diff: string;
  } | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  useEffect(() => {
    if (!artifact) return;
    setContent(null);
    setCompareId("");
    setComparison(null);
    setComparisonError(null);
    if (new URLSearchParams(window.location.search).has("demo")) return;
    if (
      !["md", "markdown", "yaml", "yml", "json", "txt"].includes(
        artifact.extension,
      )
    )
      return;
    setContentLoading(true);
    fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}`)
      .then(async (response) => {
        if (response.ok)
          setContent(
            ((await response.json()) as { content?: string }).content ?? null,
          );
      })
      .catch(() => undefined)
      .finally(() => setContentLoading(false));
  }, [artifact]);
  async function compare() {
    if (!artifact || !compareId) return;
    try {
      const response = await fetch(
        `/api/artifacts/${encodeURIComponent(artifact.id)}/compare/${encodeURIComponent(compareId)}`,
      );
      const result = (await response.json()) as {
        changed?: boolean;
        diff?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Comparison failed.");
      setComparison({
        changed: result.changed ?? false,
        diff: result.diff ?? "",
      });
      setComparisonError(null);
    } catch (cause) {
      setComparisonError(
        cause instanceof Error ? cause.message : "Comparison failed.",
      );
    }
  }
  if (!artifact)
    return (
      <section className="panel artifact-detail">
        <EmptyData label="Select an artifact to review" />
      </section>
    );
  const preview =
    content ??
    "## Artifact preview\n\nSelect an indexed text artifact to load its current content.\n\nThe dashboard keeps the source artifact unchanged.";
  const decisionHistory = approvals.filter(
    (approval) => approval.artifactId === artifact.id,
  );
  const linkedRunPlans = relatedArtifacts.filter(
    (candidate) =>
      artifact.kind === "requirement" &&
      candidate.kind === "run_plan" &&
      candidate.relatedRequirementId === artifact.id &&
      !["rejected", "invalid", "missing", "superseded"].includes(
        candidate.status,
      ),
  );
  return (
    <section className="panel artifact-detail">
      <div className="detail-header">
        <div>
          <span className="section-kicker">
            {artifact.kind.replace("_", " ").toUpperCase()}
          </span>
          <h2>{artifact.title}</h2>
          <span className="detail-id">
            {artifact.id} · Revision {artifact.revision}
          </span>
        </div>
        <StatusBadge status={artifact.status} />
      </div>
      <div className="detail-meta">
        <span>
          <FileText size={14} />
          {artifact.path}
        </span>
        <span>
          <Clock3 size={14} />
          Updated {formatTime(artifact.updatedAt)}
        </span>
        <span>
          <ShieldCheck size={14} />
          SHA-256 {artifact.digest}
        </span>
      </div>
      {decisionHistory.length > 0 && (
        <div className="decision-history">
          <span className="muted-label">Decision history</span>
          {decisionHistory.map((decision) => (
            <span key={decision.id}>
              {decision.status} · {decision.id} ·{" "}
              {formatTime(decision.requestedAt)}
            </span>
          ))}
        </div>
      )}
      <div className="document-preview">
        {contentLoading ? (
          <div className="empty-inline">
            <Loader2 className="spin" size={18} />
            Loading current artifact…
          </div>
        ) : artifact.extension === "md" || artifact.extension === "markdown" ? (
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {preview}
          </ReactMarkdown>
        ) : artifact.extension === "yaml" ||
          artifact.extension === "yml" ||
          artifact.extension === "json" ||
          artifact.extension === "txt" ? (
          <pre>{preview}</pre>
        ) : (
          <>
            <FileText size={28} />
            <strong>
              Open this {artifact.extension.toUpperCase()} document locally
            </strong>
            <span>The dashboard keeps the source artifact unchanged.</span>
          </>
        )}
      </div>
      <div className="detail-actions">
        {linkedRunPlans.map((runPlan) => (
          <button
            className="secondary-button"
            key={runPlan.id}
            onClick={() => onOpenArtifact(runPlan.id, "Run Plans")}
          >
            <ListChecks size={15} />
            View run plan {runPlan.id}
          </button>
        ))}
        {artifact.kind === "run_plan" && artifact.relatedRequirementId && (
          <button
            className="secondary-button"
            onClick={() =>
              onOpenArtifact(artifact.relatedRequirementId!, "Requirements")
            }
          >
            <FileText size={15} />
            View source requirement
          </button>
        )}
        <button
          className="secondary-button"
          onClick={() =>
            window.open(
              `/api/artifacts/${encodeURIComponent(artifact.id)}/raw`,
              "_blank",
              "noopener,noreferrer",
            )
          }
        >
          <FileText size={15} />
          Open source
        </button>
        {artifact.status !== "approved" && (
          <>
            <button
              className="reject-button"
              onClick={() => onDecision(artifact, "rejected")}
            >
              <XCircle size={15} />
              Reject
            </button>
            <button
              className="primary-button"
              onClick={() => onDecision(artifact, "approved")}
            >
              <CheckCircle2 size={15} />
              Approve exact revision
            </button>
          </>
        )}
      </div>
      {alternatives.length > 1 && (
        <div className="comparison-controls">
          <label>
            Compare with revision
            <select
              value={compareId}
              onChange={(event) => setCompareId(event.target.value)}
            >
              <option value="">
                Select another {artifact.kind.replace("_", " ")}
              </option>
              {alternatives
                .filter((candidate) => candidate.id !== artifact.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.id} · rev {candidate.revision}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="secondary-button"
            onClick={() => void compare()}
            disabled={!compareId}
          >
            Compare
          </button>
        </div>
      )}
      {comparisonError && <div className="error-note">{comparisonError}</div>}
      {comparison && (
        <div className="comparison-result">
          <div className="panel-title">
            <h3>{comparison.changed ? "Changes found" : "No changes"}</h3>
            <StatusBadge status={comparison.changed ? "warning" : "complete"} />
          </div>
          <pre>{comparison.diff}</pre>
        </div>
      )}
    </section>
  );
}
function WorkPackagesPage({
  snapshot,
  onDecision,
  onOpenArtifact,
  onRefresh,
}: {
  snapshot: Snapshot;
  onDecision: (
    artifact: ArtifactSummary,
    decision: "approved" | "rejected",
  ) => void;
  onOpenArtifact: (artifactId: string, targetPage: Page) => void;
  onRefresh: () => Promise<void>;
}) {
  const plans = snapshot.artifacts.filter(
    (item) => item.kind === "run_plan" && item.status === "approved",
  );
  const packages = snapshot.artifacts.filter(
    (item) => item.kind === "work_package",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    plans.slice(0, 1).map((plan) => plan.id),
  );
  const [order, setOrder] = useState<string[]>(plans.map((plan) => plan.id));
  const [rationale, setRationale] = useState(
    "Operator-selected approved run plans; sequencing prompt not yet run.",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sequenceTask, setSequenceTask] = useState<{
    taskId: string;
    model: string;
    reasoningEffort: string;
  } | null>(null);
  const [analysis, setAnalysis] = useState<RunPlanAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const isDemoPage = new URLSearchParams(window.location.search).has("demo");
  const [packageMembers, setPackageMembers] = useState<
    Record<string, PackageMemberSummary[]>
  >(isDemoPage ? demoPackageMembers : {});
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  useEffect(() => {
    if (isDemoPage) return;
    let cancelled = false;
    void Promise.all(
      packages.map(async (pkg) => {
        const response = await fetch(
          `/api/artifacts/${encodeURIComponent(pkg.id)}`,
        );
        if (!response.ok) return [pkg.id, []] as const;
        const document = (await response.json()) as { content?: string | null };
        try {
          const value = JSON.parse(document.content ?? "") as {
            members?: Array<{
              run_plan_id?: string;
              revision?: number;
              path?: string;
              sequence?: number;
            }>;
          };
          return [
            pkg.id,
            (value.members ?? []).map((member) => ({
              run_plan_id: String(member.run_plan_id ?? ""),
              revision: Number(member.revision ?? 0),
              path: String(member.path ?? ""),
              sequence: Number(member.sequence ?? 0),
            })),
          ] as const;
        } catch {
          return [pkg.id, []] as const;
        }
      }),
    )
      .then((entries) => {
        if (!cancelled) setPackageMembers(Object.fromEntries(entries));
      })
      .catch((cause) => {
        if (!cancelled)
          setMessage(
            cause instanceof Error
              ? `Package membership unavailable: ${cause.message}`
              : "Package membership unavailable; refresh and try again.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [isDemoPage, packages.map((pkg) => `${pkg.id}:${pkg.digest}`).join("|")]);
  useEffect(() => {
    if (isDemoPage || !sequenceTask?.taskId || selectedIds.length === 0) return;
    let cancelled = false;
    let timer: number | undefined;
    let handled = false;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/prompt-tasks/${encodeURIComponent(sequenceTask.taskId)}`,
        );
        const task = (await response.json()) as {
          status?: string;
          output?: string;
        };
        if (!response.ok)
          throw new Error("Sequencing task output is unavailable.");
        if (task.output) {
          const proposal = extractJsonObject(task.output);
          if (proposal) {
            const validationResponse = await fetch(
              "/api/work-packages/sequence/validate",
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  runPlanIds: selectedIds,
                  proposal,
                }),
              },
            );
            const validated = (await validationResponse.json()) as {
              orderedRunPlanIds?: string[];
              rationale?: string;
              error?: string;
            };
            if (!validationResponse.ok)
              throw new Error(
                validated.error ?? "Sequencing proposal failed validation.",
              );
            if (!cancelled) {
              handled = true;
              setOrder(validated.orderedRunPlanIds ?? selectedIds);
              setRationale(validated.rationale ?? "Validated model proposal.");
              setMessage("Validated sequence suggestion ready for review");
            }
          }
        }
        const terminal = [
          "completed",
          "complete",
          "succeeded",
          "failed",
          "error",
          "cancelled",
          "canceled",
        ].includes(task.status?.toLowerCase() ?? "");
        if (terminal && !handled && task.output)
          setMessage(
            "Sequencing task completed without a valid proposal; deterministic order remains available for review.",
          );
        if (!cancelled && !handled && !terminal)
          timer = window.setTimeout(() => void poll(), 1500);
      } catch (cause) {
        if (!cancelled)
          setMessage(
            cause instanceof Error
              ? `${cause.message} Deterministic order remains available for review.`
              : "Sequencing proposal unavailable; deterministic order remains available for review.",
          );
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isDemoPage, selectedIds.join("|"), sequenceTask?.taskId]);
  useEffect(() => {
    if (
      selectedIds.length === 0 ||
      new URLSearchParams(window.location.search).has("demo")
    ) {
      setAnalysis(null);
      setAnalysisError(null);
      return;
    }
    let cancelled = false;
    void fetch("/api/work-packages/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runPlanIds: selectedIds }),
    })
      .then(async (response) => {
        const result = (await response.json()) as RunPlanAnalysisResult & {
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Analysis failed.");
        if (!cancelled) {
          setAnalysis(result);
          setAnalysisError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled)
          setAnalysisError(
            cause instanceof Error
              ? cause.message
              : "Dependency analysis unavailable.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [selectedIds.join("|")]);
  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }
  function moveSelected(id: string, delta: -1 | 1) {
    const selectedOrder = order.filter((value) => selectedIds.includes(value));
    const index = selectedOrder.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= selectedOrder.length) return;
    [selectedOrder[index], selectedOrder[target]] = [
      selectedOrder[target],
      selectedOrder[index],
    ];
    setOrder([
      ...selectedOrder,
      ...order.filter((value) => !selectedIds.includes(value)),
    ]);
  }
  async function suggest() {
    const next = plans
      .filter((plan) => selectedIds.includes(plan.id))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((plan) => plan.id);
    setOrder(next);
    let promptLabel = "Deterministic preview";
    if (!new URLSearchParams(window.location.search).has("demo")) {
      try {
        const response = await fetch("/api/prompts/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taskType: "work_package_sequencing",
            artifactIds: selectedIds,
          }),
        });
        const result = (await response.json()) as {
          model?: string;
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            result.error ?? "Unable to prepare sequencing prompt.",
          );
        const profile = snapshot.promptProfiles.find(
          (candidate) => candidate.taskType === "work_package_sequencing",
        );
        const taskResponse = await fetch("/api/prompt-tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taskType: "work_package_sequencing",
            artifactIds: selectedIds,
            model: result.model ?? profile?.model,
            reasoningEffort: profile?.reasoningEffort,
            adapter: profile?.adapter,
          }),
        });
        const task = (await taskResponse.json()) as {
          taskId?: string;
          actualModel?: string;
          actualReasoningEffort?: string;
          error?: string;
        };
        if (!taskResponse.ok)
          throw new Error(task.error ?? "Unable to start sequencing prompt.");
        setSequenceTask({
          taskId: task.taskId ?? "—",
          model: task.actualModel ?? result.model ?? "configured model",
          reasoningEffort:
            task.actualReasoningEffort ?? profile?.reasoningEffort ?? "—",
        });
        promptLabel = `Sequencing task ${task.taskId ?? "started"} · review the proposed order before saving`;
      } catch (cause) {
        setSequenceTask(null);
        setMessage(
          cause instanceof Error
            ? `${cause.message} Deterministic order remains available for review.`
            : "Sequencing prompt unavailable; deterministic order remains available for review.",
        );
        /* retain the deterministic preview and surface it for operator review */
      }
    }
    setRationale(
      `${promptLabel}: alphabetical tie-break after dependency context is gathered. Review before saving.`,
    );
    setMessage("Sequence suggestion ready");
  }
  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/work-packages/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: order
            .filter((id) => selectedIds.includes(id))
            .map((runPlanId, index) => ({ runPlanId, sequence: index + 1 })),
          rationale,
          ...(editingPackageId
            ? { supersedesWorkPackageId: editingPackageId }
            : {}),
        }),
      });
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { error?: string }).error ??
            "Unable to save draft",
        );
      setMessage(
        editingPackageId
          ? "Work-package revision draft saved"
          : "Work-package draft saved",
      );
      setEditingPackageId(null);
      await onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to save draft",
      );
    } finally {
      setSaving(false);
    }
  }
  async function startImplementation(pkg: ArtifactSummary) {
    const profile = snapshot.promptProfiles.find(
      (candidate) => candidate.taskType === "run_plan_execution",
    );
    if (!profile) {
      setMessage("Run-plan execution profile is not configured.");
      return;
    }
    const adapter = new URLSearchParams(window.location.search).has("demo")
      ? "fake"
      : profile.adapter;
    try {
      if (!new URLSearchParams(window.location.search).has("demo")) {
        const preflightQuery = new URLSearchParams({
          workPackageId: pkg.id,
          model: profile.model,
          reasoningEffort: profile.reasoningEffort,
          ...(adapter ? { adapter } : {}),
        });
        const preflightResponse = await fetch(
          `/api/preflight?${preflightQuery.toString()}`,
        );
        const preflight = (await preflightResponse.json()) as {
          ready?: boolean;
          blockers?: string[];
          error?: string;
        };
        if (!preflightResponse.ok)
          throw new Error(
            preflight.error ?? "Unable to run implementation preflight.",
          );
        if (!preflight.ready)
          throw new Error(
            `Preflight blocked: ${(preflight.blockers ?? ["Readiness checks failed."]).join("; ")}`,
          );
      }
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workPackageId: pkg.id,
          title: pkg.title,
          model: profile.model,
          reasoningEffort: profile.reasoningEffort,
          adapter,
        }),
      });
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { error?: string }).error ??
            "Preflight blocked implementation",
        );
      setMessage("Implementation run started");
      await onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Unable to start implementation",
      );
    }
  }
  function editPackage(pkg: ArtifactSummary) {
    const members = [...(packageMembers[pkg.id] ?? [])].sort(
      (left, right) => left.sequence - right.sequence,
    );
    if (members.length === 0) {
      setMessage("Package members are unavailable; refresh and try again.");
      return;
    }
    const ids = members.map((member) => member.run_plan_id);
    setSelectedIds(ids);
    setOrder(ids);
    setRationale(`Revision of ${pkg.id}; operator sequence edit.`);
    setEditingPackageId(pkg.id);
    setMessage(`Editing ${pkg.id} as a new immutable revision`);
  }
  return (
    <>
      <PageHeader
        eyebrow="PLANNING"
        title="Work Packages"
        description="Assemble approved run plans, then suggest and approve their implementation sequence."
        action={
          <button
            className="primary-button"
            onClick={save}
            disabled={selectedIds.length === 0 || saving}
          >
            <Package size={16} />
            {saving
              ? "Saving…"
              : editingPackageId
                ? "Save new revision"
                : "Assemble work package"}
          </button>
        }
      />
      <div className="planning-layout">
        <section className="panel package-builder">
          <div className="panel-title">
            <div>
              <span className="section-kicker">PACKAGE BUILDER</span>
              <h2>Selected run plans</h2>
            </div>
            <span className="selection-count">
              {selectedIds.length} selected
            </span>
          </div>
          {plans.length === 0 ? (
            <EmptyData label="Approved run plans will appear here" />
          ) : (
            plans.map((plan) => (
              <button
                className="plan-selection"
                key={plan.id}
                onClick={() => toggle(plan.id)}
              >
                <div
                  className={
                    selectedIds.includes(plan.id)
                      ? "check-box checked"
                      : "check-box"
                  }
                >
                  {selectedIds.includes(plan.id) && <Check size={13} />}
                </div>
                <div className="sequence-number muted-number">
                  {Math.max(1, order.indexOf(plan.id) + 1)}
                </div>
                <div>
                  <strong>{plan.title}</strong>
                  <small>
                    {plan.id} · {plan.taskCount ?? "—"} tasks ·{" "}
                    {plan.phaseCount ?? "—"} phases
                  </small>
                </div>
                <StatusBadge status={plan.status} />
              </button>
            ))
          )}
          {selectedIds.length > 0 && (
            <div className="sequence-editor" aria-label="Editable sequence">
              <span className="muted-label">Editable sequence</span>
              {order
                .filter((id) => selectedIds.includes(id))
                .map((id, index, selectedOrder) => {
                  const plan = plans.find((candidate) => candidate.id === id);
                  return (
                    <div className="sequence-editor-row" key={id}>
                      <span className="sequence-number">{index + 1}</span>
                      <strong>{plan?.title ?? id}</strong>
                      <button
                        className="quiet-button"
                        aria-label={`Move ${plan?.title ?? id} up`}
                        disabled={index === 0}
                        onClick={() => moveSelected(id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="quiet-button"
                        aria-label={`Move ${plan?.title ?? id} down`}
                        disabled={index === selectedOrder.length - 1}
                        onClick={() => moveSelected(id, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
          <div className="builder-actions">
            <button
              className="secondary-button"
              onClick={suggest}
              disabled={selectedIds.length === 0}
            >
              <SlidersHorizontal size={15} />
              Suggest sequence
            </button>
            <button
              className="primary-button"
              onClick={save}
              disabled={selectedIds.length === 0 || saving}
            >
              Save draft
            </button>
          </div>
          {message && (
            <div className="empty-inline">
              <CheckCircle2 size={17} />
              {message}
            </div>
          )}
          {sequenceTask && (
            <div className="empty-inline">
              <CheckCircle2 size={17} />
              Task {sequenceTask.taskId} started through the sequencing profile
              · {sequenceTask.model} · {sequenceTask.reasoningEffort} reasoning
            </div>
          )}
        </section>
        <section className="panel package-rationale">
          <span className="section-kicker">SEQUENCE RATIONALE</span>
          <h2>Why this order?</h2>
          <div className="rationale-empty">
            <GitBranch size={22} />
            <strong>{rationale}</strong>
            <span>
              Production sequencing will include dependencies, shared Odoo
              modules, path overlap, database concerns, conflicts, and product
              baseline.
            </span>
          </div>
          {analysisError && (
            <div className="blocker-note page-note">
              <AlertTriangle size={15} />
              <span>{analysisError}</span>
            </div>
          )}
          {analysis && (
            <div className="planning-analysis">
              <div>
                <span className="muted-label">Dependency context</span>
                <strong>
                  {analysis.plans.reduce(
                    (total, plan) => total + plan.affectedModules.length,
                    0,
                  )}{" "}
                  module references · {analysis.pathOverlaps.length} path
                  overlap{analysis.pathOverlaps.length === 1 ? "" : "s"}
                </strong>
              </div>
              {analysis.dependencyEdges.length > 0 && (
                <div className="analysis-list">
                  <span className="muted-label">Dependency graph</span>
                  {analysis.dependencyEdges.map((edge) => (
                    <span key={`${edge.from}:${edge.to}`}>
                      {edge.from} <ArrowRight size={12} /> {edge.to}
                    </span>
                  ))}
                </div>
              )}
              {analysis.dependencyCycles.length > 0 && (
                <div className="analysis-list blocker-text">
                  <span className="muted-label">Dependency cycles</span>
                  {analysis.dependencyCycles.map((cycle) => (
                    <span key={cycle.join(":")}>{cycle.join(" → ")}</span>
                  ))}
                </div>
              )}
              {analysis.pathOverlaps.length > 0 && (
                <div className="analysis-list">
                  <span className="muted-label">Path conflicts</span>
                  {analysis.pathOverlaps.map((overlap) => (
                    <span key={`${overlap.left}:${overlap.right}`}>
                      {overlap.left} · {overlap.right} ·{" "}
                      {overlap.paths.join(", ")}
                    </span>
                  ))}
                </div>
              )}
              {analysis.productBaselines.length > 0 && (
                <div className="analysis-list">
                  <span className="muted-label">Product baseline(s)</span>
                  {analysis.productBaselines.map((baseline) => (
                    <span key={baseline}>{baseline}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      <section className="panel full-panel package-review">
        <div className="panel-title">
          <div>
            <span className="section-kicker">REVIEW</span>
            <h2>Saved work packages</h2>
          </div>
          <span>{packages.length}</span>
        </div>
        {packages.length === 0 ? (
          <EmptyData label="Save a package draft to review its exact membership and sequence" />
        ) : (
          packages.map((pkg) => (
            <div key={pkg.id} className="package-review-block">
              <div className="inbox-row">
                <div className="inbox-icon">
                  <Package size={18} />
                </div>
                <div className="inbox-main">
                  <strong>{pkg.title}</strong>
                  <span>
                    {pkg.id} · {pkg.path}
                  </span>
                  <small>
                    Revision {pkg.revision} · SHA-256 {pkg.digest}
                  </small>
                </div>
                <StatusBadge status={pkg.status} />
                {pkg.status !== "approved" && (
                  <>
                    <button
                      className="reject-button"
                      onClick={() => onDecision(pkg, "rejected")}
                    >
                      <X size={15} />
                      Reject
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => onDecision(pkg, "approved")}
                    >
                      <Check size={15} />
                      Approve sequence
                    </button>
                  </>
                )}
                <button
                  className="secondary-button"
                  onClick={() => editPackage(pkg)}
                >
                  <GitBranch size={15} />
                  Create revision
                </button>
                {pkg.status === "approved" && (
                  <button
                    className="primary-button"
                    onClick={() => void startImplementation(pkg)}
                  >
                    <Play size={15} />
                    Start implementation
                  </button>
                )}
              </div>
              {(packageMembers[pkg.id] ?? []).length > 0 && (
                <div className="package-members" aria-label="Package sequence">
                  {[...(packageMembers[pkg.id] ?? [])]
                    .sort((left, right) => left.sequence - right.sequence)
                    .map((member) => {
                      const plan = snapshot.artifacts.find(
                        (artifact) => artifact.id === member.run_plan_id,
                      );
                      const activeRun =
                        snapshot.activeRun?.workPackageId === pkg.id
                          ? snapshot.activeRun
                          : null;
                      const executionStatus = activeRun
                        ? member.sequence < activeRun.sequence
                          ? "complete"
                          : member.sequence === activeRun.sequence
                            ? activeRun.status
                            : "awaiting_review"
                        : null;
                      return (
                        <div
                          className="package-member"
                          key={member.run_plan_id}
                        >
                          <span className="sequence-number">
                            {member.sequence}
                          </span>
                          <div className="inbox-main">
                            <strong>{plan?.title ?? member.run_plan_id}</strong>
                            <span>
                              {plan?.relatedRequirementId ??
                                "Requirement unavailable"}
                              · revision {member.revision}
                            </span>
                            <small>
                              {member.path} ·{" "}
                              {activeRun &&
                              member.sequence === activeRun.sequence
                                ? `${activeRun.currentPhase} · ${activeRun.currentTask}`
                                : "Not started"}
                            </small>
                          </div>
                          <div className="package-member-statuses">
                            <span>
                              <small>Approval</small>
                              <StatusBadge status={plan?.status ?? "missing"} />
                            </span>
                            {executionStatus && (
                              <span>
                                <small>Execution</small>
                                <StatusBadge status={executionStatus} />
                              </span>
                            )}
                          </div>
                          <button
                            className="secondary-button"
                            onClick={() =>
                              onOpenArtifact(member.run_plan_id, "Run Plans")
                            }
                          >
                            <FileText size={15} />
                            View plan
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </>
  );
}
function ApprovalsPage({
  snapshot,
  onDecision,
}: {
  snapshot: Snapshot;
  onDecision: (
    artifact: ArtifactSummary | ApprovalSummary,
    decision: "approved" | "rejected",
  ) => void;
}) {
  const pending = snapshot.approvals.filter(
    (item) => item.status === "pending",
  );
  return (
    <>
      <PageHeader
        eyebrow="HUMAN CONTROL"
        title="Approval Inbox"
        description="Every decision is bound to the exact artifact revision you reviewed."
      />
      <section className="panel full-panel">
        <div className="inbox-toolbar">
          <div className="tabs">
            <button className="tab active">
              Pending <span>{pending.length}</span>
            </button>
            <button className="tab">All decisions</button>
          </div>
          <button className="filter-button">
            All gate types <ChevronDown size={14} />
          </button>
        </div>
        {pending.length === 0 ? (
          <EmptyData label="Approval inbox is clear" />
        ) : (
          pending.map((approval) => (
            <div className="inbox-row" key={approval.id}>
              <div className="inbox-icon">
                <ShieldCheck size={18} />
              </div>
              <div className="inbox-main">
                <strong>{approval.title}</strong>
                <span>
                  {approval.artifactId} · requested by {approval.requestedBy}
                </span>
                <small>
                  {approval.source} · {formatTime(approval.requestedAt)}
                </small>
              </div>
              <span className={"priority " + approval.priority}>
                {approval.priority}
              </span>
              <button
                className="secondary-button"
                onClick={() =>
                  window.open(
                    `/api/artifacts/${encodeURIComponent(approval.artifactId)}/raw`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                Review
              </button>
              <button
                className="primary-button"
                onClick={() => onDecision(approval, "approved")}
              >
                <Check size={15} />
                Approve
              </button>
            </div>
          ))
        )}
      </section>
    </>
  );
}
function ActiveRunsPage({
  snapshot,
  onRunControl,
}: {
  snapshot: Snapshot;
  onRunControl: (
    runId: string,
    action: "pause" | "resume" | "cancel" | "complete" | "retry" | "replan",
  ) => Promise<void>;
}) {
  const [progress, setProgress] = useState<ExecutionProgress | null>(null);
  const [changedFiles, setChangedFiles] = useState<
    Array<{ path: string; change: string; classification: string }>
  >([]);
  const [now, setNow] = useState(() => Date.now());
  const [taskSnapshot, setTaskSnapshot] = useState<{
    taskId: string;
    status: string;
    output: string;
    events: Array<Record<string, unknown>>;
  } | null>(null);
  useEffect(() => {
    const runId = snapshot.activeRun?.runId;
    if (!runId || new URLSearchParams(window.location.search).has("demo")) {
      setProgress(null);
      setTaskSnapshot(null);
      setChangedFiles([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const progressResponse = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/progress`,
      );
      if (!cancelled && progressResponse.ok)
        setProgress((await progressResponse.json()) as ExecutionProgress);
      const taskId = snapshot.activeRun?.taskId;
      if (!taskId) return;
      const taskResponse = await fetch(
        `/api/prompt-tasks/${encodeURIComponent(taskId)}`,
      );
      if (!cancelled && taskResponse.ok)
        setTaskSnapshot((await taskResponse.json()) as typeof taskSnapshot);
      if (snapshot.activeRun?.baseCommit) {
        const diffResponse = await fetch("/api/diff/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId,
            baseCommit: snapshot.activeRun.baseCommit,
            allowedPaths: [],
            forbiddenPaths: [],
          }),
        });
        if (!cancelled && diffResponse.ok) {
          const diff = (await diffResponse.json()) as {
            entries?: Array<{
              path: string;
              change: string;
              classification: string;
            }>;
          };
          setChangedFiles(diff.entries ?? []);
        }
      }
    };
    void refresh().catch(() => {
      if (!cancelled) {
        setProgress(null);
        setTaskSnapshot(null);
      }
    });
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1500);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [snapshot.activeRun?.runId, snapshot.activeRun?.taskId]);
  const startedAt = snapshot.activeRun?.startedAt
    ? new Date(snapshot.activeRun.startedAt).getTime()
    : undefined;
  const elapsed =
    startedAt && !Number.isNaN(startedAt)
      ? formatElapsed(Math.max(0, now - startedAt))
      : "—";
  const attentionRequests =
    taskSnapshot?.events.filter((event) =>
      /request|permission|approval|input/i.test(String(event.method ?? "")),
    ).length ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="EXECUTION"
        title="Active Runs"
        description="Monitor the current Codex task without making the dashboard the execution engine."
      />
      {snapshot.activeRun ? (
        <section className="panel active-run-panel">
          <div className="run-hero">
            <div className="run-orb">
              <TerminalSquare size={25} />
            </div>
            <div>
              <span className="section-kicker">{snapshot.activeRun.runId}</span>
              <h2>{snapshot.activeRun.title}</h2>
              <p>
                Sequence {snapshot.activeRun.sequence} of{" "}
                {snapshot.activeRun.total} · {snapshot.activeRun.model} ·{" "}
                {snapshot.activeRun.reasoningEffort} reasoning
              </p>
            </div>
            <StatusBadge status={snapshot.activeRun.status} />
          </div>
          <div className="big-progress">
            <div>
              <span>Run plan progress</span>
              <strong>{snapshot.activeRun.progress}%</strong>
            </div>
            <div className="progress-bar">
              <i style={{ width: snapshot.activeRun.progress + "%" }} />
            </div>
          </div>
          <div className="run-grid">
            <div>
              <span className="muted-label">Current phase</span>
              <strong>{snapshot.activeRun.currentPhase}</strong>
            </div>
            <div>
              <span className="muted-label">Current task</span>
              <strong>{snapshot.activeRun.currentTask}</strong>
            </div>
            <div>
              <span className="muted-label">Execution mode</span>
              <strong>Goal prompt</strong>
            </div>
            <div>
              <span className="muted-label">Task adapter</span>
              <strong>{snapshot.activeRun.adapter ?? "—"}</strong>
            </div>
            <div>
              <span className="muted-label">Implementation branch</span>
              <strong>{snapshot.activeRun.branch ?? "—"}</strong>
            </div>
            <div>
              <span className="muted-label">Worktree</span>
              <strong title={snapshot.activeRun.worktreePath}>
                {snapshot.activeRun.worktreePath ?? "—"}
              </strong>
            </div>
            <div>
              <span className="muted-label">Elapsed</span>
              <strong>{elapsed}</strong>
            </div>
            <div>
              <span className="muted-label">Changed files</span>
              <strong>{changedFiles.length}</strong>
            </div>
          </div>
          {taskSnapshot && (
            <div className="progress-overlay">
              <div className="panel-title">
                <div>
                  <span className="section-kicker">CODEX TASK</span>
                  <h2>{taskSnapshot.taskId}</h2>
                </div>
                <StatusBadge status={taskSnapshot.status} />
              </div>
              {taskSnapshot.output && (
                <pre className="task-output">{taskSnapshot.output}</pre>
              )}
              <small className="muted-label">
                {taskSnapshot.events.length} execution events received
                {attentionRequests > 0
                  ? ` · ${attentionRequests} operator attention request(s)`
                  : ""}
              </small>
            </div>
          )}
          {changedFiles.length > 0 && (
            <div className="progress-overlay changed-files">
              <div className="panel-title">
                <div>
                  <span className="section-kicker">WORKTREE SUMMARY</span>
                  <h2>Changed files</h2>
                </div>
                <GitBranch size={18} />
              </div>
              {changedFiles.slice(0, 20).map((file) => (
                <div className="check-row" key={`${file.change}:${file.path}`}>
                  <StatusMark
                    status={
                      file.classification === "allowed"
                        ? "complete"
                        : file.classification
                    }
                  />
                  <span>{file.path}</span>
                  <small>
                    {file.change} · {file.classification}
                  </small>
                </div>
              ))}
              {changedFiles.length > 20 && (
                <small className="muted-label changed-files-more">
                  Showing the first 20 of {changedFiles.length} files
                </small>
              )}
            </div>
          )}
          {progress && (
            <div className="progress-overlay">
              <div className="panel-title">
                <div>
                  <span className="section-kicker">EXECUTION OVERLAY</span>
                  <h2>Phase and task progress</h2>
                </div>
                <StatusBadge status={progress.status} />
              </div>
              {progress.tasks.map((task) => (
                <div className="check-row" key={task.task_id}>
                  <StatusMark status={task.status} />
                  <span>{task.task_id}</span>
                  <small>{task.status.replaceAll("_", " ")}</small>
                </div>
              ))}
            </div>
          )}
          <div className="detail-actions">
            <button className="secondary-button">
              <TerminalSquare size={15} />
              Open task
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                void onRunControl(
                  snapshot.activeRun!.runId,
                  snapshot.activeRun!.status === "blocked" ? "resume" : "pause",
                )
              }
            >
              <Play size={15} />
              {snapshot.activeRun.status === "blocked"
                ? "Resume run"
                : "Pause run"}
            </button>
            <button
              className="reject-button"
              onClick={() =>
                void onRunControl(snapshot.activeRun!.runId, "cancel")
              }
            >
              <X size={15} />
              Cancel run
            </button>
            {snapshot.activeRun.status === "blocked" && (
              <>
                <button
                  className="secondary-button"
                  onClick={() =>
                    void onRunControl(snapshot.activeRun!.runId, "retry")
                  }
                >
                  Retry task
                </button>
                <button
                  className="secondary-button"
                  onClick={() =>
                    void onRunControl(snapshot.activeRun!.runId, "replan")
                  }
                >
                  Request replan
                </button>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="panel">
          <EmptyData label="No active Codex runs" />
        </section>
      )}
    </>
  );
}
function ValidationPage({ snapshot }: { snapshot: Snapshot }) {
  const activeRun = snapshot.activeRun;
  const [baseCommit, setBaseCommit] = useState(
    activeRun?.baseCommit ?? snapshot.system.productHead ?? "",
  );
  const [allowedPaths, setAllowedPaths] = useState("");
  const [diffReview, setDiffReview] = useState<{
    entries: Array<{
      path: string;
      change: string;
      classification: "allowed" | "unexpected" | "forbidden";
    }>;
    automaticAcceptance: "allowed" | "blocked";
    patch: string;
  } | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{
    evidenceId: string;
    path: string;
    outcome: string;
    checks: Array<{ name: string; status: string; exitCode: number }>;
  } | null>(null);
  const [disposition, setDisposition] = useState<string | null>(null);
  const [traceabilityContext, setTraceabilityContext] = useState<{
    requirement: { id: string; revision: number };
    runPlan: { id: string; revision: number };
    criteria: Array<{
      criterionId: string;
      statement: string;
      taskIds: string[];
    }>;
  } | null>(null);
  const [traceabilityJson, setTraceabilityJson] = useState("");
  const [traceabilityResult, setTraceabilityResult] = useState<string | null>(
    null,
  );
  const [selectedQualityGates, setSelectedQualityGates] = useState<
    QualityGate[]
  >(["dashboard_verify"]);
  useEffect(() => {
    if (!activeRun || new URLSearchParams(window.location.search).has("demo")) {
      setTraceabilityContext(null);
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/runs/${encodeURIComponent(activeRun.runId)}/traceability-context`,
    )
      .then(async (response) => {
        const result = (await response.json()) as {
          requirement?: { id: string; revision: number };
          runPlan?: { id: string; revision: number };
          criteria?: Array<{
            criterionId: string;
            statement: string;
            taskIds: string[];
          }>;
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error ?? "Traceability context unavailable.");
        if (cancelled || !result.requirement || !result.runPlan) return;
        const context = {
          requirement: result.requirement,
          runPlan: result.runPlan,
          criteria: result.criteria ?? [],
        };
        setTraceabilityContext(context);
        setTraceabilityJson(
          JSON.stringify(
            {
              criteria: context.criteria.map((criterion) => ({
                criterionId: criterion.criterionId,
                statement: criterion.statement,
                taskIds: criterion.taskIds.slice(0, 1),
                checkNames: ["Repository and schema validation"],
              })),
            },
            null,
            2,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setTraceabilityContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRun?.runId, activeRun?.sequence]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("demo")) return;
    let cancelled = false;
    void fetch("/api/quality-gates")
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { required?: string[] };
        const known: QualityGate[] = [
          "dashboard_verify",
          "product_lint",
          "product_test",
          "product_build",
          "manifest_validation",
          "lint",
          "clean_install",
          "production_snapshot_upgrade",
          "unit_tests",
          "browser_tests",
          "targeted_validation",
        ];
        const required = (result.required ?? []).filter(
          (gate): gate is QualityGate => known.includes(gate as QualityGate),
        );
        if (!cancelled)
          setSelectedQualityGates((current) => [
            ...new Set([...current, ...required]),
          ]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  async function reviewDiff() {
    try {
      const response = await fetch("/api/diff/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: activeRun?.runId,
          baseCommit,
          allowedPaths: allowedPaths
            .split(/\r?\n|,/)
            .map((value) => value.trim())
            .filter(Boolean),
          forbiddenPaths: [
            "delivery/**",
            "orchestrator/**",
            "requirements-factory/**",
          ],
        }),
      });
      const result = (await response.json()) as {
        entries?: Array<{
          path: string;
          change: string;
          classification: "allowed" | "unexpected" | "forbidden";
        }>;
        automaticAcceptance?: "allowed" | "blocked";
        patch?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Unable to review product diff.");
      setDiffReview({
        entries: result.entries ?? [],
        automaticAcceptance: result.automaticAcceptance ?? "blocked",
        patch: result.patch ?? "",
      });
      setDiffError(null);
      setEvidence(null);
    } catch (cause) {
      setDiffError(
        cause instanceof Error
          ? cause.message
          : "Unable to review product diff.",
      );
      setDiffReview(null);
    }
  }
  async function recordEvidence() {
    if (!activeRun || !diffReview) return;
    try {
      const response = await fetch("/api/validation/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: activeRun.runId,
          baseCommit,
          allowedPaths: allowedPaths
            .split(/\r?\n|,/)
            .map((value) => value.trim())
            .filter(Boolean),
          forbiddenPaths: [
            "delivery/**",
            "orchestrator/**",
            "requirements-factory/**",
          ],
          ...(selectedQualityGates.length
            ? { qualityGates: selectedQualityGates }
            : {}),
        }),
      });
      const result = (await response.json()) as {
        evidenceId?: string;
        path?: string;
        outcome?: string;
        checks?: Array<{ name: string; status: string; exitCode: number }>;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Unable to record evidence.");
      setEvidence({
        evidenceId: result.evidenceId ?? "—",
        path: result.path ?? "—",
        outcome: result.outcome ?? "blocked",
        checks: result.checks ?? [],
      });
      setDisposition(null);
      setDiffError(null);
    } catch (cause) {
      setDiffError(
        cause instanceof Error ? cause.message : "Unable to record evidence.",
      );
    }
  }
  async function recordDisposition(
    decision: "accepted" | "exception_accepted" | "rejected" | "replan",
  ) {
    if (!activeRun || !evidence) return;
    const reason = window.prompt("Reason for this result disposition");
    if (!reason?.trim()) return;
    try {
      const response = await fetch("/api/validation/disposition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: activeRun.runId,
          decision,
          evidenceIds: [evidence.evidenceId],
          reason,
        }),
      });
      const result = (await response.json()) as {
        dispositionId?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Unable to record disposition.");
      setDisposition(`${result.dispositionId ?? "Disposition"} · ${decision}`);
      setDiffError(null);
    } catch (cause) {
      setDiffError(
        cause instanceof Error
          ? cause.message
          : "Unable to record disposition.",
      );
    }
  }
  async function recordTraceability() {
    if (!activeRun || !evidence || !traceabilityContext) return;
    try {
      const parsed = JSON.parse(traceabilityJson) as {
        criteria?: Array<{
          criterionId: string;
          statement: string;
          taskIds: string[];
          checkNames: string[];
        }>;
      };
      const response = await fetch("/api/validation/traceability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: activeRun.runId,
          requirementId: traceabilityContext.requirement.id,
          runPlanId: traceabilityContext.runPlan.id,
          evidenceIds: [evidence.evidenceId],
          criteria: parsed.criteria ?? [],
        }),
      });
      const result = (await response.json()) as {
        traceabilityId?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Unable to record traceability.");
      setTraceabilityResult(
        `${result.traceabilityId ?? "Traceability record"} recorded`,
      );
      setDiffError(null);
    } catch (cause) {
      setDiffError(
        cause instanceof Error
          ? cause.message
          : "Unable to record acceptance traceability.",
      );
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="QUALITY"
        title="Validation & Release"
        description="Review diff boundaries, quality gates, evidence, and release readiness."
      />
      <div className="validation-grid">
        <section className="panel validation-card">
          <div className="panel-title">
            <div>
              <span className="section-kicker">PREFLIGHT</span>
              <h2>Readiness checks</h2>
            </div>
            <ShieldCheck size={19} />
          </div>
          {[
            "Schema validation",
            "Repository paths",
            "Approval bindings",
            "Product baseline",
            "Allowed paths",
            "Codex availability",
          ].map((label, index) => (
            <div className="check-row" key={label}>
              <StatusMark
                status={
                  (index === 0 &&
                    (snapshot.validationErrors?.length ?? 0) > 0) ||
                  (index === 5 && snapshot.health[3]?.status !== "healthy")
                    ? "warning"
                    : "complete"
                }
              />
              <span>{label}</span>
              <small>
                {index === 0 && (snapshot.validationErrors?.length ?? 0) > 0
                  ? `${snapshot.validationErrors?.length} validation error(s)`
                  : index === 5 && snapshot.health[3]?.status !== "healthy"
                    ? "Capability check pending"
                    : "Ready"}
              </small>
            </div>
          ))}
        </section>
        <section className="panel validation-card">
          <div className="panel-title">
            <div>
              <span className="section-kicker">RESULTS</span>
              <h2>Evidence</h2>
            </div>
            <FileCheck2 size={19} />
          </div>
          {(snapshot.evidence?.length ?? 0) === 0 ? (
            <EmptyData label="Validation evidence will appear after execution" />
          ) : (
            snapshot.evidence?.slice(0, 5).map((item) => (
              <div className="check-row" key={item.evidenceId}>
                <StatusMark
                  status={item.outcome === "passed" ? "complete" : item.outcome}
                />
                <span>
                  <a
                    href={`/api/evidence/${encodeURIComponent(item.evidenceId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.evidenceId}
                  </a>{" "}
                  · {item.runId}
                  <small>{item.path}</small>
                </span>
                <StatusBadge status={item.outcome} />
              </div>
            ))
          )}
          {evidence && (
            <div className="empty-inline">
              <StatusMark
                status={evidence.outcome === "passed" ? "complete" : "blocked"}
              />
              <a
                href={`/api/evidence/${encodeURIComponent(evidence.evidenceId)}`}
                target="_blank"
                rel="noreferrer"
              >
                {evidence.evidenceId}
              </a>{" "}
              · {evidence.outcome} · {evidence.path}
            </div>
          )}
          {evidence && evidence.checks.length > 0 && (
            <div className="evidence-checks">
              <span className="muted-label">Executed checks</span>
              {evidence.checks.map((check) => (
                <div className="check-row" key={check.name}>
                  <StatusMark
                    status={check.status === "passed" ? "complete" : "blocked"}
                  />
                  <span>{check.name}</span>
                  <small>
                    {check.status} · exit {check.exitCode}
                  </small>
                </div>
              ))}
            </div>
          )}
          {evidence && activeRun && (
            <div className="detail-actions">
              <button
                className="primary-button"
                onClick={() => void recordDisposition("accepted")}
                disabled={evidence.outcome !== "passed"}
              >
                Accept result
              </button>
              <button
                className="secondary-button"
                onClick={() => void recordDisposition("exception_accepted")}
              >
                Accept exception
              </button>
              <button
                className="reject-button"
                onClick={() => void recordDisposition("rejected")}
              >
                Reject result
              </button>
              <button
                className="secondary-button"
                onClick={() => void recordDisposition("replan")}
              >
                Request replan
              </button>
              {disposition && (
                <span className="muted-label">{disposition}</span>
              )}
            </div>
          )}
        </section>
      </div>
      <section className="panel full-panel traceability-panel">
        <div className="panel-title">
          <div>
            <span className="section-kicker">ACCEPTANCE TRACEABILITY</span>
            <h2>Map criteria to implementation evidence</h2>
          </div>
          <FileCheck2 size={19} />
        </div>
        {traceabilityContext && evidence ? (
          <>
            <p>
              Review the generated mapping, then submit it to bind each
              requirement criterion to stable implementation tasks and passing
              validation checks.
            </p>
            <div className="detail-meta">
              <span>
                Requirement {traceabilityContext.requirement.id} · revision{" "}
                {traceabilityContext.requirement.revision}
              </span>
              <span>
                Run plan {traceabilityContext.runPlan.id} · revision{" "}
                {traceabilityContext.runPlan.revision}
              </span>
            </div>
            <label>
              Traceability criteria JSON
              <textarea
                value={traceabilityJson}
                onChange={(event) => setTraceabilityJson(event.target.value)}
                rows={8}
                spellCheck={false}
              />
            </label>
            <div className="detail-actions">
              <button
                className="primary-button"
                onClick={() => void recordTraceability()}
                disabled={!traceabilityJson.trim()}
              >
                <FileCheck2 size={15} />
                Validate traceability
              </button>
              {traceabilityResult && (
                <span className="muted-label">{traceabilityResult}</span>
              )}
            </div>
          </>
        ) : (
          <EmptyData
            label={
              activeRun
                ? "Record passing evidence to review acceptance traceability"
                : "Acceptance traceability is available after execution"
            }
          />
        )}
      </section>
      <section className="panel full-panel release-readiness">
        <div className="panel-title">
          <div>
            <span className="section-kicker">RELEASE READINESS</span>
            <h2>Governed result disposition</h2>
          </div>
          <StatusBadge
            status={
              snapshot.blockers.length === 0 &&
              (snapshot.evidence?.some((item) => item.outcome === "passed") ??
                false)
                ? "complete"
                : "blocked"
            }
          />
        </div>
        <div className="run-grid">
          <div>
            <span className="muted-label">Approval gates</span>
            <strong>
              {
                snapshot.approvals.filter((item) => item.status === "approved")
                  .length
              }{" "}
              approved ·{" "}
              {
                snapshot.approvals.filter((item) => item.status === "pending")
                  .length
              }{" "}
              pending
            </strong>
          </div>
          <div>
            <span className="muted-label">Passing evidence</span>
            <strong>
              {snapshot.evidence?.filter((item) => item.outcome === "passed")
                .length ?? 0}
            </strong>
          </div>
          <div>
            <span className="muted-label">Release state</span>
            <strong>
              {snapshot.blockers.length === 0
                ? "Ready for human review"
                : "Blocked by repository readiness"}
            </strong>
          </div>
        </div>
      </section>
      <section className="panel full-panel diff-review-panel">
        <div className="panel-title">
          <div>
            <span className="section-kicker">DIFF BOUNDARY</span>
            <h2>Review product changes</h2>
          </div>
          <GitBranch size={19} />
        </div>
        <div className="prompt-controls diff-controls">
          <label>
            Base commit
            <input
              value={baseCommit}
              onChange={(event) => setBaseCommit(event.target.value)}
              placeholder="Git commit SHA"
            />
          </label>
          <label>
            Allowed paths, one per line
            <textarea
              value={allowedPaths}
              onChange={(event) => setAllowedPaths(event.target.value)}
              rows={2}
              placeholder="addons/custom_module/**"
            />
          </label>
          <fieldset className="quality-gates">
            <legend>Quality gates for evidence</legend>
            {(
              [
                ["dashboard_verify", "Dashboard verify"],
                ["product_lint", "Product lint"],
                ["product_test", "Product tests"],
                ["product_build", "Product build"],
                ["manifest_validation", "Odoo manifest validation"],
                ["lint", "Odoo lint"],
                ["unit_tests", "Odoo unit tests"],
                ["browser_tests", "Odoo browser tests"],
                ["clean_install", "Clean install"],
                ["production_snapshot_upgrade", "Snapshot upgrade rehearsal"],
                ["targeted_validation", "Targeted validation"],
              ] as const
            ).map(([gate, label]) => (
              <label key={gate} className="quality-gate-toggle">
                <input
                  type="checkbox"
                  checked={selectedQualityGates.includes(gate)}
                  onChange={(event) =>
                    setSelectedQualityGates((current) =>
                      event.target.checked
                        ? [...new Set([...current, gate])]
                        : current.filter((value) => value !== gate),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <button className="primary-button" onClick={() => void reviewDiff()}>
            <ShieldCheck size={15} />
            Review diff
          </button>
        </div>
        {diffError && (
          <div className="blocker-note page-note">
            <AlertTriangle size={16} />
            <span>{diffError}</span>
          </div>
        )}
        {diffReview && (
          <div className="diff-results">
            <div className="empty-inline">
              <StatusMark
                status={
                  diffReview.automaticAcceptance === "allowed"
                    ? "complete"
                    : "blocked"
                }
              />
              {diffReview.entries.length} changed path
              {diffReview.entries.length === 1 ? "" : "s"} · automatic
              acceptance {diffReview.automaticAcceptance}
            </div>
            {diffReview.entries.length > 0 &&
              diffReview.entries.map((entry) => (
                <div
                  className="check-row"
                  key={`${entry.change}:${entry.path}`}
                >
                  <StatusMark
                    status={
                      entry.classification === "allowed"
                        ? "complete"
                        : entry.classification
                    }
                  />
                  <span>
                    {entry.change} · {entry.path}
                  </span>
                  <small>{entry.classification}</small>
                </div>
              ))}
            {diffReview.patch && (
              <pre className="diff-patch">{diffReview.patch}</pre>
            )}
            <div className="detail-actions">
              <button
                className="secondary-button"
                onClick={() => void recordEvidence()}
                disabled={!activeRun}
              >
                <FileCheck2 size={15} />
                Record evidence manifest
              </button>
              {!activeRun && (
                <span className="muted-label">
                  Start a governed run to bind evidence to its isolated
                  worktree.
                </span>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
function HistoryPage({ snapshot }: { snapshot: Snapshot }) {
  const events = snapshot.events ?? [];
  const runtimeActions = snapshot.runtimeActions ?? [];
  return (
    <>
      <PageHeader
        eyebrow="AUDIT TRAIL"
        title="History"
        description="Immutable commands, decisions, workflow events, and evidence."
      />
      <section className="panel history-panel">
        {events.length === 0 ? (
          <>
            <div className="history-line">
              <div className="history-dot approved" />
              <div>
                <strong>Dashboard snapshot reconstructed</strong>
                <span>{formatTime(snapshot.generatedAt)} · local operator</span>
              </div>
              <StatusBadge status="complete" />
            </div>
            <EmptyData label="More events will appear as workflow actions are recorded" />
          </>
        ) : (
          events.map((event) => (
            <div className="history-line" key={event.eventId}>
              <div
                className={
                  event.eventType === "gate_satisfied"
                    ? "history-dot approved"
                    : "history-dot"
                }
              />
              <div>
                <strong>{event.eventType.replaceAll("_", " ")}</strong>
                <span>
                  {event.artifactId ?? event.approvalId ?? event.eventId} ·{" "}
                  {formatTime(event.occurredAt)}
                </span>
              </div>
              <StatusBadge
                status={
                  event.eventType === "gate_satisfied" ? "approved" : "rejected"
                }
              />
            </div>
          ))
        )}
        {runtimeActions.length > 0 && (
          <div className="runtime-history">
            <span className="muted-label">Local execution actions</span>
            {runtimeActions.slice(0, 20).map((action) => {
              const payload =
                typeof action.payload === "object" && action.payload !== null
                  ? (action.payload as Record<string, unknown>)
                  : {};
              const actual =
                typeof payload.actual === "object" && payload.actual !== null
                  ? (payload.actual as Record<string, unknown>)
                  : {};
              return (
                <div
                  className="history-line runtime-action"
                  key={action.actionId}
                >
                  <div className="history-dot" />
                  <div>
                    <strong>{action.actionType.replaceAll("_", " ")}</strong>
                    <span>
                      {String(
                        actual.taskId ?? payload.runId ?? action.actionId,
                      )}{" "}
                      · {formatTime(action.createdAt)}
                    </span>
                  </div>
                  <StatusBadge status="complete" />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
function SettingsPage({
  profiles,
  capabilities,
  onUpdate,
  onResetRepository,
}: {
  profiles: PromptProfile[];
  capabilities: DashboardCapabilities;
  onUpdate: (profile: PromptProfile) => Promise<void>;
  onResetRepository: () => Promise<void>;
}) {
  return (
    <>
      <PageHeader
        eyebrow="CONFIGURATION"
        title="Prompt profiles"
        description="Choose the model and reasoning effort used for each prompt-based task."
      />
      <section className="panel settings-panel">
        <div className="settings-intro">
          <div className="settings-icon">
            <SlidersHorizontal size={20} />
          </div>
          <div>
            <h2>Task execution profiles</h2>
            <p>
              The prompt mode is fixed by task type. Every effective selection
              is recorded with the resulting artifact or run.
            </p>
          </div>
        </div>
        {capabilities.adapters.length > 0 && (
          <div className="capability-note" role="status">
            Active adapters:{" "}
            {capabilities.adapters
              .map((adapter) => `${adapter.id} (${adapter.status})`)
              .join(", ")}
          </div>
        )}
        {profiles.map((profile) => (
          <ProfileEditor
            key={profile.taskType}
            profile={profile}
            capabilities={capabilities}
            onUpdate={onUpdate}
          />
        ))}
        <div className="settings-danger-zone">
          <div>
            <span className="section-kicker">DESTRUCTIVE ACTION</span>
            <h2>Reset decisions and gates</h2>
            <p>
              Removes approval, rejection, workflow-event, disposition, and
              command records while keeping requirements, run plans, work
              packages, system plans, evidence, and releases.
            </p>
          </div>
          <button
            className="danger-button"
            onClick={() => void onResetRepository()}
          >
            <RefreshCw size={15} />
            Reset repository
          </button>
        </div>
      </section>
    </>
  );
}
function ProfileEditor({
  profile,
  capabilities,
  onUpdate,
}: {
  profile: PromptProfile;
  capabilities: DashboardCapabilities;
  onUpdate: (profile: PromptProfile) => Promise<void>;
}) {
  const [draft, setDraft] = useState(profile);
  return (
    <div className="profile-row">
      <div className="profile-copy">
        <strong>{profile.label}</strong>
        <span>
          {profile.promptMode === "goal" ? "Goal prompt" : "Standard prompt"}
        </span>
      </div>
      <label>
        Model
        <select
          value={draft.model}
          onChange={(event) =>
            setDraft({ ...draft, model: event.target.value })
          }
        >
          {capabilities.models.map((model) => (
            <option key={model}>{model}</option>
          ))}
        </select>
      </label>
      <label>
        Reasoning
        <select
          value={draft.reasoningEffort}
          onChange={(event) =>
            setDraft({
              ...draft,
              reasoningEffort: event.target
                .value as PromptProfile["reasoningEffort"],
            })
          }
        >
          {capabilities.reasoningEfforts.map((effort) => (
            <option key={effort}>{effort}</option>
          ))}
        </select>
      </label>
      <button
        className="secondary-button save-profile"
        onClick={() => void onUpdate(draft)}
      >
        <Check size={15} />
        Save
      </button>
    </div>
  );
}
function EmptyData({ label }: { label: string }) {
  return (
    <div className="empty-data">
      <div className="empty-icon">
        <FileText size={19} />
      </div>
      <span>{label}</span>
    </div>
  );
}
function LoadingState() {
  return (
    <div className="page-state">
      <Loader2 className="spin" size={26} />
      <strong>Reconstructing dashboard state…</strong>
    </div>
  );
}
function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="page-state error-state" role="alert">
      <AlertTriangle size={26} />
      <strong>Dashboard unavailable</strong>
      <span>{message}</span>
      <button className="secondary-button" onClick={onRetry}>
        <RefreshCw size={15} />
        Try again
      </button>
    </div>
  );
}
