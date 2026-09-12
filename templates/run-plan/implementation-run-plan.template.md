# {{REQUIREMENT_NAME}} Implementation Run Plan

## Document status

**Plan status:** `DRAFT`

**Execution status:** `NOT STARTED`

**Source requirement:** {{REQUIREMENT_ID_AND_REVISION}}

**Product baseline:** `{{PRODUCT_BASELINE_COMMIT}}`

{{ONE_PARAGRAPH_SCOPE_AND_OUTCOME_SUMMARY}}

## Updating this plan

The approved plan is immutable. During implementation, update progress through the execution record keyed to the stable phase and task identifiers. Allowed execution statuses are `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `COMPLETE`, and `DEFERRED`. Record the reason whenever work is blocked or deferred, and attach completion evidence before marking work complete.

## Architecture

### Platform and languages

{{PLATFORM_LANGUAGES_FRAMEWORKS_AND_VERSION_CONSTRAINTS}}

### Components and responsibilities

{{COMPONENTS_MODULES_PACKAGES_AND_RESPONSIBILITY_BOUNDARIES}}

### Naming convention

- **Convention source:** {{EXPLICIT_DESIGN_CONVENTION_OR_SYSTEM_DEFAULT}}
- **Generic prefix:** `{{GENERIC_PREFIX}}`
- **System name:** `{{RESOLVED_SYSTEM_NAME}}`
- **Technical name:** `{{RESOLVED_IMPLEMENTATION_TECHNICAL_NAME}}`
- **Legacy exceptions:** {{LEGACY_NAMES_OR_NONE}}

### Data and integrations

{{DATA_MODEL_MIGRATION_API_SECURITY_AND_EXTERNAL_INTEGRATION_CHOICES}}

### Repository and delivery constraints

- **Run-plan dependencies:**
  - {{RUN_PLAN_ID_OR_NONE}}
- **Affected modules:**
  - {{AFFECTED_MODULE_OR_NONE}}
- **Allowed product paths:**
  - `{{PLAN_LEVEL_ALLOWED_PRODUCT_PATH}}`
- **Forbidden paths:**
  - `{{PLAN_LEVEL_FORBIDDEN_PATH}}`
- **Database concerns:**
  - {{DATABASE_CONCERN_OR_NONE}}
- **Known conflicts:**
  - {{CONFLICT_OR_NONE}}
- **Deployment and rollback:** {{DEPLOYMENT_AND_ROLLBACK_APPROACH}}

## Implementation principles

- {{REQUIREMENT_SPECIFIC_PRINCIPLE}}
- {{ARCHITECTURE_OR_SECURITY_PRINCIPLE}}
- {{TESTING_OR_DELIVERY_PRINCIPLE}}

## Phased implementation plan

<!-- Repeat this complete phase section for each phase. Remove this comment from the finished plan. -->

## {{PHASE_ID}} {{PHASE_TITLE}}

**Status:** `NOT STARTED`

**Depends on:** {{PRIOR_PHASE_IDS_OR_NONE}}

**Objective:** {{PHASE_OBJECTIVE_AND_OBSERVABLE_OUTCOME}}

### Development tasks

- [ ] **{{TASK_ID}} {{TASK_TITLE}}**
  - **Action:** {{CONCRETE_IMPLEMENTATION_ACTION}}
  - **Deliverable:** {{CODE_CONFIGURATION_DOCUMENTATION_OR_OTHER_OUTPUT}}
  - **Allowed paths:**
    - `{{SPECIFIC_PRODUCT_REPOSITORY_PATH}}`
  - **Verification:**
    - {{TASK_SPECIFIC_AUTOMATED_OR_MANUAL_CHECK}}

### Tests and verification

- {{PHASE_LEVEL_TEST_OR_QUALITY_GATE}}
- {{REQUIREMENT_ACCEPTANCE_CHECK}}

### Exit criteria

- {{MEASURABLE_PHASE_COMPLETION_CONDITION}}
- {{REQUIRED_EVIDENCE_OR_REVIEW_CONDITION}}

## Acceptance criteria traceability

| Requirement criterion | Planned implementation | Verification | Phase and tasks |
| --- | --- | --- | --- |
| {{CRITERION_ID_AND_SUMMARY}} | {{IMPLEMENTATION_APPROACH}} | {{EVIDENCE_OR_TEST}} | {{PHASE_AND_TASK_IDS}} |

## Risks and responses

| Risk or assumption | Impact | Response or validation task | Owner | Status |
| --- | --- | --- | --- | --- |
| {{RISK_OR_ASSUMPTION}} | {{IMPACT}} | {{MITIGATION_OR_TASK_ID}} | Unassigned | Open |

## Completion rule

The implementation is complete only when every required task and phase is `COMPLETE`, every exit criterion and requirement acceptance criterion has passing evidence, all required reviews and approvals are recorded, deployment checks have passed when applicable, and rollback readiness has been verified. Deferred work must have explicit approval and must not invalidate the approved requirement.
