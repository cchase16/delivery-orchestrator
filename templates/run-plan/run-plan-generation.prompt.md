Create an implementation plan to build "{{REQUIREMENT_NAME}}" as described in {{REQUIREMENT_REFERENCE}}. Include specific development tasks and use as many phases as the work requires.

Use the supplied canonical Markdown template. Preserve its section order and required field labels, replace every placeholder, and repeat the phase section for every phase. Do not copy template instructions or placeholder text into the finished plan.

Ground the plan in the approved requirement and supplied system context:

- State a concise architecture decision covering the platform, languages, frameworks, module or package boundaries, data or integration choices, and important technical constraints.
- Do not invent repository paths, installed modules, APIs, versions, dependencies, or acceptance criteria. Record a concrete discovery task, assumption, or blocker when the supplied material does not settle a necessary detail.
- Break implementation into dependency-ordered phases. Give every phase a unique stable identifier in the form `PH-01`, `PH-02`, and so on.
- Give every development task a unique stable identifier in the form `TASK-01-01`, `TASK-01-02`, and so on. A task must describe a concrete action and its observable deliverable, not merely restate a heading.
- Initialize the overall plan, every phase, and every task to `NOT STARTED`. Do not claim that implementation, testing, review, deployment, or approval has already occurred.
- For every task, specify allowed product-repository paths and task-specific verification as nested lists. Use the plan-level forbidden paths for boundaries that apply to all tasks.
- Include phase-level tests and verification, exit criteria, acceptance-criteria traceability, risks, deployment or release steps when applicable, and rollback expectations.
- Keep progress notes, evidence, dates, owners, and approvals empty or explicitly unassigned until a person or execution process supplies them.

Return exactly one `markdown` fenced block containing the complete implementation run plan and no prose outside it. Do not create JSON or a sidecar. The dashboard validates the Markdown and deterministically derives the sidecar after generation.

The generated Markdown must support deterministic indexing:

- Keep the exact template labels and heading levels.
- Use the supplied Git commit identifier in `Product baseline`.
- Represent empty plan-level lists with `None`.
- Put each dependency, affected module, forbidden path, database concern, conflict, task allowed path, and task verification step in its own nested list item.
- Keep all phase and task titles on the same line as their stable identifiers.
