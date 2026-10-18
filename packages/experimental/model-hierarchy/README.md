# Adaptive model hierarchy

This experimental Host and Web plugin routes a root turn through confirmed model tiers. The header editor uses Harness model catalog entries; provider and model names are configuration, not hardcoded capability claims.

The supervisor plans independent assignments. For every assignment, every available read-only worker produces an independent candidate, then the successful workers compare all candidates against a production-readiness rubric covering correctness, security, stability, testability, maintainability, compatibility, rollback and observability. A candidate proceeds when all participating workers support it. Workers get at most two consensus rounds; deadlocks, a single successful worker, and reported security or data-loss risks go to the supervisor for a recorded decision. A separate supervisor activation integrates the selected proposals and runs checks, and another read-only supervisor activation inspects the result. Architecture, security, multiple-subsystem changes, project completion, discretionary escalation and two rejected attempts require the chief. Worker calls run in bounded batches. Unavailable workers do not block the remaining comparison; when every worker route is unavailable, execution falls back to confirmed supervisor routes without a monetary ceiling.

## Configuration

Install the plugin as entry `model-hierarchy`. `enabled` defaults to true; `confirmed` stays false until the user accepts the tier assignments. `disabledProjects` contains exact creation-directory paths. `workers`, `supervisors` and `chief` contain provider/model routes. The optional `free` flag prioritizes workers; `reasoningEffort` forwards the provider-owned value. Presets, read tool allowlist, attempt limit and parallelism are editable deployment settings. The `spawn` provider must support explicit routes, presets, structured output and depth limits.

## Model Experience

The root model is bypassed. Each ordinary task makes a planning call, one independent proposal call per usable worker and assignment, up to two peer-assessment rounds, a proposal review, an integration activation and an independent acceptance review. Supervisor selection adds a call for deadlock, single-success, or safety-risk cases. Chief review adds calls only when required. Each child has a fresh context containing the task and relevant proposals; independent children do not share a KV cache. Worker and reviewer tool guards enforce read-only access, while the integration activation retains normal Harness tool approval and sandbox policies. Receipts record peer assessments and supervisor decisions without exposing hidden reasoning.

## Known Limitations and Deferred Work

Receipt SHA256 values identify reviewed proposal text and the integration report, not a complete filesystem tree. Independent final reviewers inspect actual files, but a filesystem evidence manifest is needed for strict stale-artifact rejection. Process interruption rejects the active run; automatic resume of an interrupted integration is not implemented. Images in root requests are not forwarded by the current text-only task carrier. Failed mutation-bearing integration activations stop without automatic fallback because their side effects may have occurred. These limits must be resolved before claiming the full reviewed-plan guarantees.
