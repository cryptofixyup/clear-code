# ADR-001: On-Device Attribution vs. Remote SHAP Server

**Status:** Accepted  
**Date:** 2024-11-15  
**Deciders:** Platform Architecture, ML Engineering, Security

---

## Context

The interpretability system needed to choose a runtime model for attribution computation. The two primary candidates were:

1. A remote SHAP server (cloud-hosted or self-hosted), called via HTTP from the Android application after each inference.
2. An on-device attribution engine running within the Android application process, requiring no network calls.

Four specific alternatives were evaluated in the remote-server category:

- **AWS SageMaker Clarify** — Managed SHAP service, integrated with SageMaker endpoints. Requires model deployment on SageMaker infrastructure.
- **Google Vertex Explainable AI** — Managed attribution service on Google Cloud. Supports Integrated Gradients and XRAI. Requires model deployment on Vertex AI.
- **Azure Responsible AI Dashboard** — Azure ML-integrated explainability tooling with SHAP and LIME. Requires Azure ML workspace.
- **Self-hosted SHAP server** — Open-source SHAP library (Lundberg & Lee, 2017) deployed as a Python FastAPI service on infrastructure controlled by the team.

The decision was driven by four constraints surfaced during the requirements phase:

1. Several target deployments (clinical tablets, POS terminals) operate in environments with intermittent or no connectivity.
2. Two enterprise prospects in HealthTech explicitly required that model inputs not leave the device, citing HIPAA BAA compliance complexity.
3. The target hardware tier (mid-range Android) needed sub-100ms p50 explanation latency for the UX to be acceptable in interactive workflows.
4. The architecture needed to be defensible to PCI QSAs and EU AI Act auditors without relying on third-party contractual coverage.

---

## Decision

The interpretability engine runs entirely on-device as a structured Kotlin coroutine within the host application process. No network call is made at the interpretability tier. The attribution algorithm is Integrated Gradients (50 steps), approximating full Shapley values with >0.94 rank correlation.

---

## Consequences

### Positive

- **Zero data egress.** Model inputs never leave the device for explanation purposes. No BAA is required for the interpretability tier. No PCI scope expansion. GDPR Article 22 artifacts are generated locally without a cross-border data transfer.
- **No network dependency.** Attribution works identically in offline environments, on flaky LTE, and in airplane mode. The offline failure mode of remote SHAP — returning no explanation at all — is eliminated.
- **Sub-40ms p50 latency on mid-range hardware.** Measured on Samsung Galaxy A54 (Exynos 1380) with a 128-feature tabular model. Remote SHAP baseline adds 180ms median network RTT under ideal conditions.
- **Audit artifacts generated locally.** Each explanation artifact is written to an encrypted on-device audit log at the moment of generation, without a subsequent sync operation that could fail.
- **No third-party service dependency.** There is no vendor SLA, no API rate limit, no authentication credential to rotate, and no external service outage that can affect explanation availability.

### Negative

- **Approximation quality.** Integrated Gradients at 50 steps achieves >0.94 SHAP rank correlation, not 1.0. For use cases where exact Shapley values are required by regulation or contract, this is insufficient. No such requirement has been identified in the target verticals to date.
- **Limited to gradient-based methods.** The engine cannot run KernelSHAP (which treats the model as a black box) or TreeSHAP (optimized for tree ensemble models). Models that are not differentiable through their inference framework (some rule-based or ensemble models deployed via ONNX) fall back to finite-difference approximation, which is slower.
- **APK size increase.** The library adds approximately 8 MB to the APK. For applications in markets where APK size affects install conversion rates, this is a meaningful cost. Mitigated by offering an AAB split where the attribution engine is included only in builds targeting API 29+.
- **Attribution latency increases with model complexity.** A 50-step Integrated Gradients pass requires 100 model evaluations (50 forward, 50 backward). For large models (vision transformers, BERT-class NLP), this produces attribution latency in the 200–600ms range, which may be unacceptable for real-time UX. For those models, step count must be reduced or attribution must be decoupled from the primary inference path.

---

## Rejected Alternatives

**AWS SageMaker Clarify**
Rejected because: (1) requires model re-deployment on SageMaker infrastructure, creating a migration requirement for existing TFLite/ONNX deployments; (2) offline requirement cannot be met; (3) BAA coverage available but PHI still leaves the device, which was a hard requirement for two enterprise prospects.

**Google Vertex Explainable AI**
Rejected because: same offline and data egress constraints as SageMaker Clarify; additionally, the target deployments use TFLite models, and Vertex Explainable AI integration with on-device TFLite models requires a custom serving pipeline that eliminates the managed-service simplicity argument.

**Azure Responsible AI Dashboard**
Rejected because: targeted at post-hoc batch analysis and developer tooling, not production per-prediction explanations. Not suitable as a real-time attribution layer in a customer-facing mobile application.

**Self-Hosted SHAP Server**
Rejected because: (1) offline requirement cannot be met; (2) for deployments where model inputs contain PHI, the self-hosted server is still a data processor — it receives PHI, requiring either a BAA with the organization hosting the server or internal legal treatment as a covered component; (3) network latency adds 150–300ms in realistic LTE conditions; (4) introduces operational burden (server uptime, security patching, scaling) with no differentiated benefit over the managed cloud alternatives.
