# Reddit and Android Weekly Distribution Copy

---

## r/androiddev

**Title:**
```
We built an on-device AI interpretability library for Android (Integrated Gradients, 
<40ms p50, HIPAA-compatible) — and an ADR explaining why we rejected remote SHAP
```

**Body:**

We've been working on a production problem: Android ML apps handling regulated data (clinical, payment, field inspection) that need per-prediction explanations but can't send model inputs to a remote SHAP server for compliance reasons.

The result is an open-source library that runs Integrated Gradients entirely within the Android process as a structured Kotlin coroutine. No network call at the interpretability tier. Works offline.

**The architecture decision record is probably the most interesting read:**
→ https://github.com/cryptofixyup/clear-code/tree/main/android-ai-interpretability/docs/adr/001-on-device-vs-cloud.md

It documents why we rejected SageMaker Clarify (340ms p50, requires model re-deployment), Vertex Explainable AI (same egress problem), and self-hosted SHAP (offline requirement fails, still a data transmission to a processor under HIPAA). The on-device approach has real tradeoffs — the approximation quality is 0.94 rank correlation with full SHAP, not 1.0, and we can't run KernelSHAP on non-differentiable models.

**Technical design choices that might be worth discussing:**

1. **Why `SupervisorJob` over a fixed thread pool** — structured concurrency releases the continuation on `onCleared()`, eliminating the `Activity` reference leak pattern that thread pools cause when a `Runnable` captures a `Context`

2. **Memory watchdog** — polls `android.os.Debug.MemoryInfo` at 500ms and triggers graceful degradation (returns cached attribution) before the OOM killer terminates the process mid-attribution. An in-flight attribution killed by the OOM killer produces no audit artifact, which is worse than a cached one.

3. **Pre-allocated attribution buffer** — sized to input feature count at initialization, eliminating GC pressure in the hot path. Tabular models: ~2KB. Vision models: ~600KB. The buffer survives for the interpreter's lifetime; creating one per call would trigger GC on every attribution at scale.

Benchmarks on three device tiers (Pixel 6 / Galaxy A54 / Redmi 10C) are in the repo. Mid-range (A54) p50 is 38ms; remote SHAP adds 180ms median under ideal LTE and nothing offline.

Full repo: https://github.com/cryptofixyup/clear-code/tree/main/android-ai-interpretability

---

**Posting guidance:**
- Lead with the ADR link, not the README — r/androiddev responds better to engineering reasoning than feature lists
- Post Tuesday–Thursday morning; avoid weekend posts (low engagement for library announcements)
- Flair: "Library / Plugin"

---

## r/MachineLearning

**Title:**
```
[Project] On-device Integrated Gradients for Android — addressing the compliance gap 
in mobile AI interpretability (no egress, <40ms, >0.94 SHAP rank correlation)
```

**Body:**

We built an on-device attribution library for Android that targets a compliance gap in production mobile ML: current SHAP/LIME tooling requires model inputs to be transmitted to a remote server, which is a HIPAA BAA and GDPR data transfer problem when inputs contain regulated data.

**Algorithm:** Integrated Gradients (Sundararajan et al., 2017) at 50 Riemann steps. We evaluated full KernelSHAP first — it's model-agnostic and would generalize better to non-differentiable models, but the O(n_features × n_samples) cost is too high for real-time mobile inference. Integrated Gradients requires the model to be differentiable through the inference framework (TFLite `SignatureDef`, ONNX gradient session, MediaPipe — we fall back to finite-difference for non-differentiable models), but for the tabular and vision models in our target deployments, the gradient path is available.

**Rank correlation with full SHAP:** >0.94 on a 128-feature tabular model (500 random test inputs, Spearman). Drops to ~0.91 at 20 steps for vision models where we reduce step count to stay within latency budget. This is our main quality caveat — the approximation is acceptable for operator-facing explanations and regulatory audit, but not for use cases requiring exact Shapley attribution.

**Android memory model interaction:** The OOM killer on Android doesn't negotiate. A foreground process under memory pressure gets terminated with no warning if it's allocating aggressively. We use an RSS watchdog coroutine that polls `android.os.Debug.MemoryInfo` at 500ms and triggers graceful degradation before the threshold — the engine returns the last cached attribution rather than allocating a new buffer. The alternative (no watchdog, let the OOM killer fire) produces no audit record for the in-flight prediction, which is a worse compliance outcome than a stale attribution.

**Repo with whitepaper and integration guides:** https://github.com/cryptofixyup/clear-code/tree/main/android-ai-interpretability

Happy to discuss the approximation methodology, the step count / quality tradeoff curve, or the compliance architecture.

---

**Posting guidance:**
- r/MachineLearning requires flair `[Project]` — use it or the post will be removed
- The audience here cares about methodology and the rank correlation figure; lead with the algorithm, not the compliance angle
- Expect questions about KernelSHAP, LIME comparison, and whether Integrated Gradients is appropriate for tree-based models — the ADR covers this but be ready to discuss in comments

---

## Android Weekly

**Submission text** (paste into the Android Weekly submission form at androidweekly.net/issues/submit):

**Title:** On-device AI Interpretability for Android — Integrated Gradients with zero data egress

**URL:** https://github.com/cryptofixyup/clear-code/tree/main/android-ai-interpretability

**Category:** Libraries & Code

**Description:**
Open-source library implementing Integrated Gradients attribution entirely within the Android process — no network call, works offline, <40ms p50 on mid-range hardware. Built for regulated deployments (HIPAA, GDPR, EU AI Act) where sending model inputs to a remote SHAP server creates data egress compliance exposure. Supports TFLite, MediaPipe Tasks, and ONNX Runtime. Includes a technical whitepaper, three framework-specific integration guides, and a compliance architecture document mapping the design to HIPAA, GDPR Article 22, EU AI Act Article 13, and PCI-DSS. Apache 2.0.

---

**Submission guidance:**
- Android Weekly editors review submissions manually; the description above is factual and specific enough to be featured without edits
- Do not submit the same URL to multiple consecutive issues — if it doesn't appear in the next issue, wait one week before resubmitting
- The library category is correct; do not submit as "News & Articles" even though the whitepaper is long-form content
