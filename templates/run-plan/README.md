# Implementation Run Plan Template

`implementation-run-plan.template.md` is the canonical structure used by the dashboard's standard run-plan generation prompt. It is intentionally Markdown so the reviewed source can be rendered directly in the dashboard today and transformed into DOCX later without maintaining a separate human-authored plan.

`run-plan-generation.prompt.md` is the standard instruction applied to one approved requirement. The dashboard substitutes the requirement name and exact artifact reference, appends the canonical template, and supplies the approved requirement plus system and product context. The LLM returns only Markdown.

The generated Markdown is the human-readable source of truth. The dashboard validates its template structure and deterministically generates the JSON sidecar index for stable identifiers, path boundaries, dependencies, and execution overlays. A future DOCX generator should reuse the same parsed Markdown and derive summaries, phase trackers, task tables, risks, traceability, and completion records from it rather than accepting separately edited DOCX content.
