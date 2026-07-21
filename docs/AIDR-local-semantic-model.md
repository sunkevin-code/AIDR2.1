# AIDR Local Semantic Model

## Purpose

AIDR now includes a dependency-free local semantic classifier for Prompt and tool-call analysis. It is a lightweight multinomial Naive Bayes model seeded with security-oriented task examples and strengthened with deterministic threat signals.

The classifier produces a semantic assessment and a candidate least-privilege policy. The candidate is advisory input to the existing fail-closed policy engine; final enforcement still applies rule, workspace, agent, approval, and runtime boundaries.

## Decision flow

1. The Agent adapter receives a Prompt or tool event.
2. The local classifier extracts task text, paths, domains, MCP names, operations, and threat signals.
3. The hybrid router applies the configured confidence threshold.
4. High-confidence local results are used directly. Low-confidence results can fall back to the configured remote model.
5. The Session Policy Engine merges the semantic candidate with local rules and policy hierarchy.
6. The Decision Trace records `local_model`, `hybrid_model`, or `semantic_model` as the source.
7. The runtime enforcer returns allow, alert, approval, or block.

## Default behavior

```json
{
  "localSemanticModel": {
    "enabled": true,
    "mode": "local_first",
    "confidenceThreshold": 0.72,
    "maxChars": 6000
  },
  "semanticRuntime": {
    "enabled": true,
    "mode": "local_first",
    "confidenceThreshold": 0.72,
    "remoteFallback": true
  }
}
```

Supported modes are `local_only`, `local_first`, and `remote_first`.

## Configuration API

- `GET /api/semantic/local-config`
- `PUT /api/semantic/local-config`
- `GET /api/semantic/runtime`
- `PUT /api/semantic/runtime`

The Endpoint Semantic Model page exposes these settings and shows local analysis counts, flagged counts, training example count, current mode, and remote fallback state.

## Current detection scope

The seeded model and hard signals cover workspace reads and writes, shell/build activity, network research, MCP operations, prompt injection, indirect instruction indicators, RAG poisoning, sensitive-file access, credential access, data exfiltration, destructive actions, and suspicious URLs.

## Boundary and next iteration

This is a practical POC model, not a replacement for a trained transformer. The next production iteration should add signed organization-specific training packs, drift feedback from analyst decisions, calibration metrics, model-version rollback, and optional ONNX inference behind the same `HybridSemanticClassifier` interface.

## Reliability controls

The endpoint keeps the control plane responsive under high telemetry volume. Event database exports are batched, the active JSONL audit log rotates at 20 MB, databases larger than 32 MB are archived before startup, and status reporting uses bounded in-memory counters instead of reading the complete audit file on every request.
