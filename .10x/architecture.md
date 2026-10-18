# Architecture decision

Status: accepted

Implement the feature as an out-of-tree Cordis plugin with Host and Web Client faces. The Host face owns configuration, orchestration, route selection, escalation policy, receipts, and tool guards. The Client face uses the supported `conversation.session.header.actions` slot and the existing model catalog/settings APIs. The first root `agent/pre-step` handler awaits orchestration and returns an empty first entry so the root LLM is not called. Child activations receive explicit provider, model, preset, and depth. Completion is accepted only after the controller has durable review receipts.

The built-in experimental Agent Team is not used because its activation request does not forward model route or preset fields.
