# Model hierarchy editor

This experimental browser plugin adds **Model hierarchy** beside the preset label in the conversation header. Its modal edits the host-owned `model-hierarchy` settings namespace: global enablement, the current project override, and model pools for workers, supervisors, and the chief reviewer. It reads the current provider catalog through `session.modelCatalog`; provider and model identifiers remain opaque.

Each tier accepts multiple routes. Users explicitly mark free worker routes because the catalog has no pricing metadata. Confirm and save writes all edited fields atomically with the revision captured when the editor opened. A rejected write leaves the draft visible; Reload fetches the accepted preferences again. Cancel discards the draft. Changes apply to the next task, as enforced by the host controller.

## Model Experience

This plugin makes no model requests and contributes no prompt text or tools. Token and KV-cache effects are none. The host hierarchy plugin owns execution and model routing.

## Known Limitations and Deferred Work

The host plugin must expose writable `model-hierarchy` preferences. This editor does not infer model quality or price from model names. Russian and English dictionaries are included; unsupported locales use the locale service fallback. Project overrides use the current session's working-directory identity.
