# Odoo Form Context Menu Customization Implementation Run Plan

## Document status

**Plan status:** `DRAFT`

**Execution status:** `NOT STARTED`

**Source requirement:** `REQ-ODOO-FORM-CONTEXT-MENU-CUSTOMIZATION-DESIGN revision 1`

**Product baseline:** `17a0c505e645d47babbf429528da3df2edbb5f1b`

This plan delivers a standalone Odoo Community Edition add-on that replaces the browser context menu only inside supported backend form views, supplies safe Odoo-aware navigation commands, and exposes a documented registry contract for third-party commands. The first release also contributes `Go to the Main Table form` through that public contract; selecting it opens the required one-action modal and performs no navigation. Implementation remains gated on confirming the deployed Odoo 19.0 Community environment, resolving the product factory lock, and naming the supported desktop-browser matrix.

## Updating this plan

The approved plan is immutable. During implementation, update progress through the execution record keyed to the stable phase and task identifiers. Allowed execution statuses are `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `COMPLETE`, and `DEFERRED`. Record the reason whenever work is blocked or deferred, and attach completion evidence before marking work complete.

## Architecture

### Platform and languages

Implement a new installable Odoo Community Edition add-on named `web_form_context_menu` under `addons/`, using Odoo 19.0's Owl-based web client, JavaScript modules, XML/QWeb templates, SCSS, Odoo registries and services, HOOT, and Odoo web test helpers. The manifest depends only on `web`. Odoo 19.0 is the approved reference design, but execution must verify the deployed major version and isolate every release-sensitive import and controller call in one form adapter before feature work proceeds.

### Components and responsibilities

The add-on contains a release adapter for form-controller lifecycle and navigation, a coordinator service that owns the single open menu and global closing behavior, a dedicated menu-item registry and stable service facade, an Owl menu component with template and styles, a navigation provider, and an independent Main Table placeholder provider. Providers register declarative definitions and trusted callbacks; the coordinator, component, and adapter contain no Main Table identifier branch. Module-local tests cover contracts and components, while `tests/web_form_context_menu/` holds repository-level browser, installation, and compatibility scenarios. Extension guidance lives in `docs/web_form_context_menu/`, and environment-independent rollout and rollback procedures live in `deployment/web_form_context_menu/`.

### Data and integrations

The release adds no Odoo model, database table, migration, controller, endpoint, or external integration. Menu opening and synchronous visibility/enabled predicates perform no RPC. Handlers use only the documented facade over Odoo dialog, notification, action, ORM, and adapter navigation services; server access controls and record rules remain authoritative. Labels, reasons, and messages render as text, executable source is never stored or evaluated, and custom logs must not contain form values or record caches.

### Repository and delivery constraints

- **Run-plan dependencies:**
  - None
- **Affected modules:**
  - `web_form_context_menu` (new Odoo add-on)
- **Allowed product paths:**
  - `addons/web_form_context_menu/**`
  - `tests/web_form_context_menu/**`
  - `docs/web_form_context_menu/**`
  - `deployment/web_form_context_menu/**`
- **Forbidden paths:**
  - `.git/**`
  - `factory.yaml`
  - `factory.lock`
  - `requirements/**`
  - `addons/**` except `addons/web_form_context_menu/**`
  - `tests/**` except `tests/web_form_context_menu/**`
  - `docs/**` except `docs/web_form_context_menu/**`
  - `deployment/**` except `deployment/web_form_context_menu/**`
  - `../customer-odoo-delivery/**`
  - `../requirements-factory/**`
  - `../Odoo-development-factory/**`
  - Odoo core source and Enterprise-only modules
- **Database concerns:**
  - No persistent model or migration is permitted; clean install, module update, and uninstall must still be rehearsed on disposable nonproduction databases.
  - Dirty and new-record navigation must delegate to Odoo guards and must never clear dirty state or discard edits directly.
- **Known conflicts:**
  - `factory.lock` is unresolved at the product baseline, so governed execution cannot begin until the deterministic bootstrap process resolves it outside this plan's write boundary.
  - The organization's supported desktop-browser matrix is not supplied and must be recorded before browser acceptance execution.
  - Third-party add-ons may also intercept `contextmenu` events or alter form-controller internals; nearest-form ownership, event precedence, and representative compatibility tests are required.
- **Deployment and rollback:** Install and update the module first in a disposable nonproduction database, rebuild backend assets, run automated and human acceptance checks, then deploy through the normal Odoo add-on process with staged monitoring. Roll back by disabling or uninstalling the module and rebuilding assets; verify that native browser context menus return and that no data migration is required.

## Implementation principles

- Cancel a form `contextmenu` event only after the nearest registered form root produces a valid menu model; preserve the native browser menu everywhere else and whenever initialization fails.
- Keep release-sensitive controller access in the adapter, item behavior in providers, and shared lifecycle, ordering, rendering, and execution behavior in reusable contracts.
- Require automated evidence for security, accessibility, localization, performance, lifecycle cleanup, clean install/update/uninstall, and every acceptance criterion before completion.

## Phased implementation plan

## PH-01 Confirm compatibility and establish the add-on

**Status:** `NOT STARTED`

**Depends on:** None

**Objective:** Establish an installable module and freeze verified Odoo 19.0 adapter, browser, and test contracts without changing governed factory configuration.

### Development tasks

- [ ] **TASK-01-01 Record execution compatibility decisions**
  - **Status:** `NOT STARTED`
  - **Action:** Inspect the isolated product worktree and target deployment, verify the exact Odoo Community major version and safe form-controller, pager, action-stack, reload, dialog, notification, and lifecycle APIs, record the supported desktop browsers, and block later phases if Odoo 19.0, the browser matrix, or a resolved factory lock is unavailable.
  - **Deliverable:** A compatibility note mapping verified Odoo APIs and browser targets to the release adapter and documenting any disabled navigation operation.
  - **Allowed paths:**
    - `docs/web_form_context_menu/compatibility.md`
  - **Verification:**
    - Confirm the note identifies the deployed Odoo commit or release, Community-only dependency boundary, browser versions/policy, and each adapter API used.
    - Confirm `factory.lock` reports `resolved` before governed implementation proceeds, without modifying it in this run.

- [ ] **TASK-01-02 Scaffold the standalone add-on and asset bundles**
  - **Status:** `NOT STARTED`
  - **Action:** Create the module manifest, initialization files, backend asset entries, frontend test asset entries, translation scaffold, and directories for adapter, coordinator, registry, component, providers, templates, styles, and tests, with `web` as the only Odoo dependency.
  - **Deliverable:** An installable `web_form_context_menu` skeleton whose assets load without console or manifest errors.
  - **Allowed paths:**
    - `addons/web_form_context_menu/**`
  - **Verification:**
    - Install the skeleton on a disposable Odoo Community database and load a backend form with no missing-module, asset, template, or JavaScript errors.
    - Assert the manifest declares no Enterprise dependency, server model, access-control CSV, controller, or data migration.

- [ ] **TASK-01-03 Establish deterministic frontend and browser test harnesses**
  - **Status:** `NOT STARTED`
  - **Action:** Add HOOT helpers for mounted main-area and dialog forms, mocked services, event-path targets, viewport anchors, async handlers, and an independent extension fixture, plus repository-level install and browser scenario entry points.
  - **Deliverable:** Runnable module-local and repository-level test suites that initially exercise module loading and fixture setup.
  - **Allowed paths:**
    - `addons/web_form_context_menu/static/tests/**`
    - `tests/web_form_context_menu/**`
  - **Verification:**
    - Run the targeted frontend suite and confirm the main-form, dialog-form, non-form, independent-provider, and mocked-service fixtures initialize successfully.

### Tests and verification

- Validate module installation and backend asset loading against the exact product baseline plus only the allowed-path changes.
- Review the compatibility mapping and confirm unresolved version, browser, or factory-lock readiness is recorded as a blocker rather than assumed.

### Exit criteria

- The add-on skeleton installs, both test harness layers run, and the adapter API map is tied to confirmed Odoo 19.0 Community behavior.
- The supported browser matrix and resolved factory lock are available, with command output and review evidence attached to PH-01.

## PH-02 Build the reusable menu framework

**Status:** `NOT STARTED`

**Depends on:** `PH-01`

**Objective:** Deliver the registry, coordinator, form adapter, and accessible Owl menu shell with deterministic lifecycle, placement, focus, and failure behavior.

### Development tasks

- [ ] **TASK-02-01 Implement the registry and service facade contracts**
  - **Status:** `NOT STARTED`
  - **Action:** Implement the dedicated registry category, definition validation, defaults, group ordering, sequence-then-identifier sorting, duplicate and reserved-identifier policy, synchronous predicates, late-update behavior, and the documented service facade.
  - **Deliverable:** Reusable registry and facade modules with extension-author contract tests.
  - **Allowed paths:**
    - `addons/web_form_context_menu/static/src/**`
    - `addons/web_form_context_menu/static/tests/**`
  - **Verification:**
    - Run HOOT cases for defaults, deterministic ordering, groups, empty-group removal, hidden and disabled entries, duplicate identifiers, reserved identifiers, registry updates, and facade service exposure.
    - Prove predicates cannot require an RPC in the supported contract and raw HTML/source evaluation is absent.

- [ ] **TASK-02-02 Implement coordinator lifecycle and execution**
  - **Status:** `NOT STARTED`
  - **Action:** Implement nearest-form registration, one-open-menu state, valid-model-before-cancel handling, context snapshots, global close triggers, close-before-execute behavior, exactly-once sync/async execution, focus restoration, cleanup, and standard error routing.
  - **Deliverable:** A coordinator service with deterministic lifecycle and failure isolation.
  - **Allowed paths:**
    - `addons/web_form_context_menu/static/src/**`
    - `addons/web_form_context_menu/static/tests/**`
  - **Verification:**
    - Run HOOT cases for nested roots, second right click, selection, Escape, outside click, route change, form destruction, resize, scroll, async completion, predicate/handler failure, listener cleanup, and future menu reopening.
    - Verify handled openings issue no RPC and unexpected custom logs contain no record values or caches.

- [ ] **TASK-02-03 Implement the Odoo 19 form adapter**
  - **Status:** `NOT STARTED`
  - **Action:** Patch or hook the verified form controller narrowly, register and unregister form roots, derive short-lived context snapshots, map targets through the composed event path, and expose safe navigation availability and operations without leaking controller internals.
  - **Deliverable:** The sole release-sensitive adapter with focused compatibility tests.
  - **Allowed paths:**
    - `addons/web_form_context_menu/static/src/**`
    - `addons/web_form_context_menu/static/tests/**`
  - **Verification:**
    - Confirm main-area, dialog, embedded, and nested form roots resolve correctly and non-form or failed initialization paths preserve the browser menu.
    - Confirm a static review or import-boundary test finds no version-sensitive controller imports or calls outside the adapter.

- [ ] **TASK-02-04 Implement the accessible Owl menu component**
  - **Status:** `NOT STARTED`
  - **Action:** Render themed groups, generated separators, text-only labels/reasons, disabled state, visible focus, viewport-aware placement, dialog-safe stacking, RTL behavior, mouse interaction, Context Menu key and Shift+F10 opening, arrow/Home/End traversal, Enter/Space activation, and Escape restoration.
  - **Deliverable:** Owl component, XML template, and SCSS with component tests.
  - **Allowed paths:**
    - `addons/web_form_context_menu/static/src/**`
    - `addons/web_form_context_menu/static/tests/**`
  - **Verification:**
    - Run component tests for ARIA menu semantics, disabled reachability, every keyboard command, focus restoration, each viewport edge, dialogs, RTL, high-contrast focus, and browser zoom through 200 percent.

### Tests and verification

- Run the full module frontend suite with listener-leak, exactly-once execution, no-RPC-on-open, and non-form fail-safe assertions.
- Demonstrate one custom menu at the requested pointer or keyboard anchor on both main and dialog forms while outside-form context menus remain native.

### Exit criteria

- Framework contracts, adapter isolation, menu rendering, placement, keyboard operation, closing triggers, focus restoration, and failure isolation pass automated tests.
- Review evidence shows no Main Table-specific branch exists in the registry, coordinator, adapter, or component.

## PH-03 Implement navigation and extension providers

**Status:** `NOT STARTED`

**Depends on:** `PH-02`

**Objective:** Supply safe navigation entries and the exact Main Table placeholder as ordinary, removable registry contributions.

### Development tasks

- [ ] **TASK-03-01 Implement the navigation provider**
  - **Status:** `NOT STARTED`
  - **Action:** Register Back, Previous record, Next record, and Refresh record in the Navigation group using only adapter facade operations, visible disabled states, translated reasons, persisted-record and pager eligibility, and standard dirty-form guards.
  - **Deliverable:** Navigation provider and state-matrix tests for new, existing, dirty, first, middle, and last records.
  - **Allowed paths:**
    - `addons/web_form_context_menu/static/src/**`
    - `addons/web_form_context_menu/static/tests/**`
  - **Verification:**
    - Prove each supported command delegates to the verified Odoo API and unavailable commands remain visible but disabled where practical.
    - Prove no browser history, whole-window reload, simulated pager click, direct route mutation, dirty-flag clearing, or silent discard path exists.

- [ ] **TASK-03-02 Implement the Main Table placeholder provider**
  - **Status:** `NOT STARTED`
  - **Action:** Register a stable namespaced Custom-group item labeled exactly `Go to the Main Table form` and use the dialog facade to open a modal whose body is exactly the same source-locale text and whose only action is `Close`, without navigation.
  - **Deliverable:** Independent provider, translation entry, and focused registry-through-execution tests.
  - **Allowed paths:**
    - `addons/web_form_context_menu/**`
  - **Verification:**
    - Assert exact source label and body, one Close action, discovery and execution through the public registry/coordinator, always-enabled supported-form visibility, and zero navigation calls.
    - Remove the provider from the test asset set and prove only this item disappears while navigation and independent extensions still pass.

- [ ] **TASK-03-03 Prove third-party extension compatibility**
  - **Status:** `NOT STARTED`
  - **Action:** Implement a test-only independent add-on or provider that registers visible, hidden, enabled, disabled, synchronous, asynchronous, existing-group, and namespaced-group commands without editing base framework modules.
  - **Deliverable:** Cross-addon extension fixture and integration tests demonstrating the public contract.
  - **Allowed paths:**
    - `tests/web_form_context_menu/**`
    - `addons/web_form_context_menu/static/tests/**`
  - **Verification:**
    - Install or load the fixture independently and assert deterministic ordering, conditional behavior, service facade access, async completion, error isolation, and no competing menu shell.

### Tests and verification

- Execute the complete provider state matrix on clean, dirty, new, first, middle, and last records.
- Trace the Main Table provider from asset import through registry resolution, coordinator execution, exact modal output, and confirmed absence of navigation.

### Exit criteria

- All five initial commands appear in deterministic groups and order with safe availability behavior.
- The independent extension fixture works without base-module edits, and removing the Main Table provider changes no other behavior.

## PH-04 Harden quality, security, and compatibility

**Status:** `NOT STARTED`

**Depends on:** `PH-03`

**Objective:** Demonstrate every supported surface, browser, accessibility mode, localization direction, performance target, security boundary, and conflict response before rollout.

### Development tasks

- [ ] **TASK-04-01 Complete integration and browser acceptance coverage**
  - **Status:** `NOT STARTED`
  - **Action:** Automate right-click and keyboard scenarios for standard forms, dialog forms, inputs, text areas, relational fields, notebooks, empty form space, nested forms, and representative list and kanban exclusions across the recorded browser matrix.
  - **Deliverable:** Repeatable browser suite with screenshots, console capture, and pass/fail results by supported browser.
  - **Allowed paths:**
    - `tests/web_form_context_menu/**`
  - **Verification:**
    - Run every browser scenario and confirm handled form events show exactly one custom menu, while list, kanban, website/portal where present, and initialization-failure scenarios retain native behavior.
    - Verify dialog stacking and closure, route transitions, unsaved-change prompts, and no lost edits.

- [ ] **TASK-04-02 Validate accessibility, localization, and performance**
  - **Status:** `NOT STARTED`
  - **Action:** Add automated and manual checks for semantic roles, accessible names and disabled reasons, contrast, focus visibility, keyboard-only operation, screen-reader state, translations, RTL layout, 200 percent zoom, no-network opening, and normal-load latency.
  - **Deliverable:** Accessibility, localization, and performance tests plus documented measurement method.
  - **Allowed paths:**
    - `addons/web_form_context_menu/**`
    - `tests/web_form_context_menu/**`
    - `docs/web_form_context_menu/**`
  - **Verification:**
    - Show keyboard users can open, traverse, activate, dismiss, and regain focus; confirm layout remains usable in RTL and at 200 percent zoom.
    - Measure ordinary openings at no more than 100 milliseconds under the documented normal desktop load and assert zero menu-open RPC calls.

- [ ] **TASK-04-03 Review security, lifecycle, and addon conflicts**
  - **Status:** `NOT STARTED`
  - **Action:** Review and test authorization delegation, text rendering, absence of dynamic evaluation, log minimization, predicate cost, repeated activation, stale-context cleanup, event precedence, and representative third-party `contextmenu` interception.
  - **Deliverable:** Hardened implementation, conflict tests, and security review checklist mapped to the requirement controls.
  - **Allowed paths:**
    - `addons/web_form_context_menu/**`
    - `tests/web_form_context_menu/**`
    - `docs/web_form_context_menu/**`
  - **Verification:**
    - Static and runtime checks find no `eval`, dynamic function construction, raw HTML injection, direct network request, or client-only authorization decision.
    - Stress tests show registrations/listeners are removed, repeat activation is safe, failures stay item-scoped, and known interceptor precedence is deterministic or explicitly documented.

- [ ] **TASK-04-04 Publish extension and operational documentation**
  - **Status:** `NOT STARTED`
  - **Action:** Document registry properties, group and identifier rules, service facade, handler and predicate constraints, safe browser shortcuts replacing lost field context-menu commands, compatibility expectations, and provider replacement boundaries.
  - **Deliverable:** Developer and operator documentation sufficient to add a command without modifying the base add-on.
  - **Allowed paths:**
    - `docs/web_form_context_menu/**`
  - **Verification:**
    - Follow the documentation to recreate the independent extension fixture and confirm the example passes its tests without framework edits.

### Tests and verification

- Run all module and repository suites on the confirmed Odoo version and every supported desktop browser with no unexpected console errors, RPCs on open, or lifecycle leaks.
- Complete requirement, security, accessibility, localization, performance, and compatibility reviews; automated success is evidence and not approval.

### Exit criteria

- AC-01 through AC-11 have passing automated or documented manual evidence, including the 100 millisecond target and browser matrix.
- All high-impact security, dirty-data, lifecycle, adapter-compatibility, stacking, and addon-conflict findings are resolved or explicitly rejected by an authorized human without changing requirement scope.

## PH-05 Rehearse deployment and rollback

**Status:** `NOT STARTED`

**Depends on:** `PH-04`

**Objective:** Prove clean installation, upgrade safety, staged deployment, monitoring, and complete rollback without persistent-data work.

### Development tasks

- [ ] **TASK-05-01 Rehearse clean install and module update**
  - **Status:** `NOT STARTED`
  - **Action:** On disposable nonproduction databases derived from the declared baseline, install the module, rebuild assets, run the full suites, then update the module and repeat smoke and regression tests.
  - **Deliverable:** Reproducible install/update procedure and evidence manifest recorded by the delivery workflow.
  - **Allowed paths:**
    - `deployment/web_form_context_menu/**`
    - `tests/web_form_context_menu/**`
  - **Verification:**
    - Confirm clean install and update complete without schema creation, migration, missing assets, stale bundles, or regression failures.
    - Confirm the evidence binds the exact product commit, database lineage, Odoo version, browser matrix, commands, and results.

- [ ] **TASK-05-02 Rehearse rollback and finalize rollout checks**
  - **Status:** `NOT STARTED`
  - **Action:** Disable or uninstall the module, rebuild assets, verify native context-menu restoration and absence of persistent residue, then document staged rollout monitoring for frontend errors, command failures, and lost browser-menu capability reports.
  - **Deliverable:** Tested rollback procedure, rollout checklist, and rollback evidence recorded by the delivery workflow.
  - **Allowed paths:**
    - `deployment/web_form_context_menu/**`
    - `tests/web_form_context_menu/**`
  - **Verification:**
    - Confirm rollback restores native behavior inside forms, leaves non-form behavior unchanged, removes module assets, and requires no data migration.
    - Dry-run the rollout and rollback checklists and verify all human approval points remain open for authorized actors; the implementing agent records no approval.

### Tests and verification

- Execute install, update, uninstall, asset rebuild, smoke, browser, and rollback suites from the documented procedures on disposable nonproduction databases.
- Verify all evidence is stored as durable delivery workflow records and binds exact immutable inputs; do not edit plan, approval, or arbitrary status fields.

### Exit criteria

- Clean install, update, staged rollout checks, monitoring checks, and rollback rehearsal pass against exact recorded product and database baselines.
- The implementation result and evidence are ready for independent human review; no agent has self-approved the plan, exceptions, result, or release.

## Acceptance criteria traceability

| Requirement criterion | Planned implementation | Verification | Phase and tasks |
| --- | --- | --- | --- |
| AC-01 Supported form surfaces open one positioned Odoo-styled menu | Nearest-root adapter, coordinator, component, and dialog-safe placement | Browser scenarios for main, dialog, embedded, nested, field, and empty-space targets | PH-02 TASK-02-02 to TASK-02-04; PH-04 TASK-04-01 |
| AC-02 Browser menu suppression is scoped to handled forms | Valid-model-before-cancel and initialization fail-safe | Form events suppress native UI; list, kanban, other non-form, and failure paths retain it | PH-02 TASK-02-02 and TASK-02-03; PH-04 TASK-04-01 |
| AC-03 Initial commands have deterministic grouping and order | Registry ordering plus Navigation and Custom providers | Registry and browser assertions for Back, Previous, Next, Refresh, and Main Table | PH-02 TASK-02-01; PH-03 TASK-03-01 and TASK-03-02 |
| AC-04 Navigation is Odoo-aware and dirty-safe | Adapter facade and guarded navigation provider | State-matrix and integration tests for supported, unavailable, new, and dirty records | PH-02 TASK-02-03; PH-03 TASK-03-01; PH-04 TASK-04-01 |
| AC-05 Main Table opens the exact one-action modal with no navigation | Independent registry provider using dialog facade | Exact label/body/Close assertions, registry-through-coordinator trace, zero navigation calls | PH-03 TASK-03-02 |
| AC-06 Independent add-ons can contribute conditional executable commands | Public registry and stable service facade | Independent extension fixture with ordered, conditional, sync, and async commands | PH-02 TASK-02-01; PH-03 TASK-03-03; PH-04 TASK-04-04 |
| AC-07 Opening performs no RPC and meets 100 ms | Synchronous predicates and local model construction | RPC spy and documented normal-load timing across representative forms | PH-02 TASK-02-01 and TASK-02-02; PH-04 TASK-04-02 |
| AC-08 Complete keyboard operation and focus restoration | Owl keyboard model and coordinator focus policy | Context Menu/Shift+F10, traversal, activation, Escape, and focus tests | PH-02 TASK-02-02 and TASK-02-04; PH-04 TASK-04-02 |
| AC-09 Odoo services and server authorization remain authoritative | Constrained service facade, text rendering, and no dynamic evaluation | Security static review and runtime authorization/error-path tests | PH-02 TASK-02-01; PH-04 TASK-04-03 |
| AC-10 Automated tests pass for selected Odoo version and browsers | Confirmed compatibility contract and layered suites | Full HOOT, integration, browser, install/update, and rollback runs | PH-01 TASK-01-01 and TASK-01-03; PH-04 TASK-04-01; PH-05 TASK-05-01 and TASK-05-02 |
| AC-11 Removing Main Table provider affects only that item | No provider-specific framework branch | Provider-removal test with navigation and independent extensions still passing | PH-03 TASK-03-02 and TASK-03-03 |

## Risks and responses

| Risk or assumption | Impact | Response or validation task | Owner | Status |
| --- | --- | --- | --- | --- |
| Odoo 19.0 deployment and controller API are not yet proven in the product scaffold | High: adapter or navigation can fail | TASK-01-01 freezes verified APIs; TASK-02-03 isolates them | Unassigned | Open |
| `factory.lock` is unresolved | High: governed execution must reject the scaffold | Resolve through the authorized bootstrap process before PH-01 exit; do not edit it in this run | Unassigned | Open |
| Supported desktop browsers are unspecified | High: AC-10 cannot be completed | TASK-01-01 records the organization's browser policy before browser runs | Unassigned | Open |
| Dirty navigation could lose edits | High: user data loss | TASK-03-01 delegates to Odoo guards; TASK-04-01 tests dirty states | Unassigned | Open |
| Third-party add-ons may intercept right click or patch form behavior | High: duplicate menus or broken ownership | TASK-04-03 tests precedence and representative combinations | Unassigned | Open |
| Replacing field context menus removes browser editing and spelling commands | Medium: workflow regression | TASK-04-04 documents retained shortcuts; TASK-04-01 includes text-heavy forms | Unassigned | Open |
| Slow predicates or leaked listeners degrade the web client | Medium: latency or memory growth | TASK-02-02 and TASK-04-02 enforce synchronous evaluation, cleanup, and timing | Unassigned | Open |
| Dialog layering, RTL, zoom, or high-contrast themes hide controls | Medium: inaccessible menu | TASK-02-04 and TASK-04-02 cover placement, stacking, direction, zoom, and contrast | Unassigned | Open |
| Future Main Table navigation may tempt framework coupling | Medium: unstable extension contract | TASK-03-02 keeps behavior in one removable provider and tests absence of special cases | Unassigned | Open |

## Completion rule

The implementation is complete only when every required task and phase is `COMPLETE`, every exit criterion and requirement acceptance criterion has passing evidence, all required reviews and approvals are recorded, deployment checks have passed when applicable, and rollback readiness has been verified. Deferred work must have explicit approval and must not invalidate the approved requirement.
