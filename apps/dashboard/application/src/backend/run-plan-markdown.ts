export interface DerivedRunPlanTask {
  task_id: string;
  title: string;
  status: "not_started";
  allowed_paths: string[];
  validation: string[];
}

export interface DerivedRunPlanPhase {
  phase_id: string;
  title: string;
  status: "not_started";
  tasks: DerivedRunPlanTask[];
}

export interface DerivedRunPlanSidecar {
  planning: {
    dependencies: string[];
    affected_modules: string[];
    forbidden_paths: string[];
    database_concerns: string[];
    conflicts: string[];
    product_baseline: string;
  };
  phases: DerivedRunPlanPhase[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanValue(value: string): string {
  return value
    .trim()
    .replace(/`([^`]*)`/g, "$1")
    .trim();
}

function inlineValues(value: string): string[] {
  const cleaned = cleanValue(value);
  if (!cleaned || /^(?:none|not applicable|n\/a)$/i.test(cleaned)) return [];
  return cleaned
    .split(/\s*;\s*/)
    .map(cleanValue)
    .filter(Boolean);
}

function fieldValues(lines: string[], label: string): string[] | null {
  const pattern = new RegExp(
    `^(\\s*)(?:-\\s+)?\\*\\*${escapeRegExp(label)}:\\*\\*\\s*(.*)$`,
    "i",
  );
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) continue;
    if (match[2].trim()) return inlineValues(match[2]);
    const parentIndent = match[1].length;
    const values: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      if (!lines[child].trim()) continue;
      const item = lines[child].match(/^(\s*)-\s+(.+)$/);
      if (!item || item[1].length <= parentIndent) break;
      values.push(cleanValue(item[2]));
    }
    return values.filter(
      (value) => value && !/^(?:none|not applicable|n\/a)$/i.test(value),
    );
  }
  return null;
}

function requiredFieldValues(lines: string[], label: string): string[] {
  const values = fieldValues(lines, label);
  if (values === null)
    throw new Error(`Run-plan Markdown must include the ${label} field.`);
  return values;
}

function requireSingleValue(lines: string[], label: string): string {
  const values = requiredFieldValues(lines, label);
  if (values.length !== 1)
    throw new Error(
      `Run-plan Markdown ${label} must contain exactly one value.`,
    );
  return values[0];
}

function hasListUnderHeading(lines: string[], heading: string): boolean {
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === heading.toLowerCase(),
  );
  if (start < 0) return false;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{2,3}\s+/.test(lines[index])) break;
    if (/^\s*-\s+\S/.test(lines[index])) return true;
  }
  return false;
}

export function deriveRunPlanSidecar(markdown: string): DerivedRunPlanSidecar {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (!markdown.trim()) throw new Error("Run-plan Markdown is required.");
  if (/{{[A-Z0-9_]+}}/.test(markdown))
    throw new Error("Run-plan Markdown contains unresolved template fields.");
  for (const heading of [
    "## Document status",
    "## Architecture",
    "## Phased implementation plan",
    "## Acceptance criteria traceability",
    "## Risks and responses",
    "## Completion rule",
  ]) {
    if (
      !lines.some((line) => line.trim().toLowerCase() === heading.toLowerCase())
    )
      throw new Error(`Run-plan Markdown must include ${heading}.`);
  }
  if (requireSingleValue(lines, "Plan status").toUpperCase() !== "DRAFT")
    throw new Error("Run-plan Markdown Plan status must be DRAFT.");
  if (
    requireSingleValue(lines, "Execution status").toUpperCase() !==
    "NOT STARTED"
  )
    throw new Error("Run-plan Markdown Execution status must be NOT STARTED.");
  const productBaseline = requireSingleValue(lines, "Product baseline");
  if (!/^[A-Fa-f0-9]{7,64}$/.test(productBaseline))
    throw new Error(
      "Run-plan Markdown Product baseline must be a Git commit identifier.",
    );

  const planning = {
    dependencies: requiredFieldValues(lines, "Run-plan dependencies"),
    affected_modules: requiredFieldValues(lines, "Affected modules"),
    forbidden_paths: requiredFieldValues(lines, "Forbidden paths"),
    database_concerns: requiredFieldValues(lines, "Database concerns"),
    conflicts: requiredFieldValues(lines, "Known conflicts"),
    product_baseline: productBaseline,
  };

  const phaseStarts = lines
    .map((line, index) => {
      const match = line.match(
        /^(##)\s+(PH-[A-Za-z0-9][A-Za-z0-9._-]*)\s+(.+)$/,
      );
      return match
        ? { index, phaseId: match[2], title: match[3].trim() }
        : null;
    })
    .filter(
      (value): value is { index: number; phaseId: string; title: string } =>
        value !== null,
    );
  if (!phaseStarts.length)
    throw new Error(
      "Run-plan Markdown must include at least one phase heading with a stable PH- identifier.",
    );

  const phaseIds = new Set<string>();
  const taskIds = new Set<string>();
  const phases = phaseStarts.map((phase, phaseIndex) => {
    if (phaseIds.has(phase.phaseId))
      throw new Error(`Duplicate run-plan phase identifier: ${phase.phaseId}`);
    phaseIds.add(phase.phaseId);
    const nextPhase = phaseStarts[phaseIndex + 1]?.index ?? lines.length;
    const phaseLines = lines.slice(phase.index + 1, nextPhase);
    if (
      requireSingleValue(phaseLines, "Status").toUpperCase() !== "NOT STARTED"
    )
      throw new Error(`${phase.phaseId} status must be NOT STARTED.`);
    requiredFieldValues(phaseLines, "Depends on");
    requireSingleValue(phaseLines, "Objective");
    if (!hasListUnderHeading(phaseLines, "### Tests and verification"))
      throw new Error(
        `${phase.phaseId} must include at least one Tests and verification item.`,
      );
    if (!hasListUnderHeading(phaseLines, "### Exit criteria"))
      throw new Error(
        `${phase.phaseId} must include at least one Exit criteria item.`,
      );

    const developmentStart = phaseLines.findIndex(
      (line) => line.trim().toLowerCase() === "### development tasks",
    );
    const testsStart = phaseLines.findIndex(
      (line) => line.trim().toLowerCase() === "### tests and verification",
    );
    if (developmentStart < 0 || testsStart <= developmentStart)
      throw new Error(
        `${phase.phaseId} must include Development tasks before Tests and verification.`,
      );
    const developmentLines = phaseLines.slice(developmentStart + 1, testsStart);
    const taskStarts = developmentLines
      .map((line, index) => {
        const match = line.match(
          /^\s*-\s+\[ \]\s+\*\*(TASK-[A-Za-z0-9][A-Za-z0-9._-]*)\s+(.+?)\*\*\s*$/,
        );
        return match
          ? { index, taskId: match[1], title: match[2].trim() }
          : null;
      })
      .filter(
        (value): value is { index: number; taskId: string; title: string } =>
          value !== null,
      );
    if (!taskStarts.length)
      throw new Error(
        `${phase.phaseId} must include at least one unchecked task with a stable TASK- identifier.`,
      );
    const tasks = taskStarts.map((task, taskIndex) => {
      if (taskIds.has(task.taskId))
        throw new Error(`Duplicate run-plan task identifier: ${task.taskId}`);
      taskIds.add(task.taskId);
      const nextTask =
        taskStarts[taskIndex + 1]?.index ?? developmentLines.length;
      const taskLines = developmentLines.slice(task.index + 1, nextTask);
      requireSingleValue(taskLines, "Action");
      requireSingleValue(taskLines, "Deliverable");
      const allowedPaths = requiredFieldValues(taskLines, "Allowed paths");
      if (!allowedPaths.length)
        throw new Error(
          `${task.taskId} must include at least one allowed path.`,
        );
      const validation = requiredFieldValues(taskLines, "Verification");
      if (!validation.length)
        throw new Error(
          `${task.taskId} must include at least one verification step.`,
        );
      return {
        task_id: task.taskId,
        title: task.title,
        status: "not_started" as const,
        allowed_paths: allowedPaths,
        validation,
      };
    });
    return {
      phase_id: phase.phaseId,
      title: phase.title,
      status: "not_started" as const,
      tasks,
    };
  });

  return { planning, phases };
}
