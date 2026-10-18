# Adaptive model hierarchy

This experimental Host and Web plugin routes a root turn through confirmed model tiers. The header editor uses Harness model catalog entries; provider and model names are configuration, not hardcoded capability claims.

The supervisor plans independent assignments, read-only workers propose changes, and a supervisor reviews proposals before a separate supervisor activation integrates them and runs checks. Another read-only supervisor activation inspects the integrated result. Architecture, security, multiple-subsystem changes, project completion, discretionary escalation and two rejected attempts require the chief. Independent worker assignments run in bounded batches. Unavailable workers fall back through confirmed worker routes and then supervisor routes, without a monetary ceiling.

## Configuration

Install the plugin as entry `model-hierarchy`. `enabled` defaults to true; `confirmed` stays false until the user accepts the tier assignments. `disabledProjects` contains exact creation-directory paths. `workers`, `supervisors` and `chief` contain provider/model routes. The optional `free` flag prioritizes workers; `reasoningEffort` forwards the provider-owned value. Presets, read tool allowlist, attempt limit and parallelism are editable deployment settings. The `spawn` provider must support explicit routes, presets, structured output and depth limits.

## Model Experience

The root model is bypassed. Each ordinary task makes a planning call, at least one worker call, a proposal review, an integration activation and an independent acceptance review. Chief review adds calls only when required. Each child has a fresh context containing the task and relevant proposals; independent children do not share a KV cache. Worker and reviewer tool guards enforce read-only access, while the integration activation retains normal Harness tool approval and sandbox policies.

## Known Limitations and Deferred Work

Receipt SHA256 values identify reviewed proposal text and the integration report, not a complete filesystem tree. Independent final reviewers inspect actual files, but a filesystem evidence manifest is needed for strict stale-artifact rejection. Process interruption rejects the active run; automatic resume of an interrupted integration is not implemented. Images in root requests are not forwarded by the current text-only task carrier. Failed mutation-bearing integration activations stop without automatic fallback because their side effects may have occurred. These limits must be resolved before claiming the full reviewed-plan guarantees.
