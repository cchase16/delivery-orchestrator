# Manual Subscription-Backed Pilot

The first dashboard workflow will support manually operated Codex tasks using a ChatGPT subscription.

For each ready agent task, the dashboard will prepare a task packet containing:

- Run, requirement, phase, and task identifiers.
- Authorized repository and file boundaries.
- Versioned agent instructions.
- Requested model and reasoning effort.
- Exact input documents and hashes.
- Required outputs and validation criteria.
- Required stop condition.

The operator will create the Codex task, select the requested model, and provide the task packet. Completion will be recorded and validated before the workflow advances.

A future execution adapter may automate the same contract through an API without changing the workflow or artifact schemas.
