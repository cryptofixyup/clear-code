# Hacker News: Show HN Post

**Title:**
```
Show HN: On-device AI interpretability for Android – zero egress, HIPAA/GDPR-compatible
```

**Submission URL:**
```
https://github.com/cryptofixyup/clear-code/tree/main/android-ai-interpretability
```

**First comment (post immediately after submitting — establishes technical credibility before others comment):**

---

The motivation here is a compliance gap that's largely unacknowledged in production Android ML deployments:

Every major interpretability tool — SHAP servers, Vertex Explainable AI, SageMaker Clarify — requires sending model inputs to a remote endpoint. When those inputs contain Protected Health Information or payment-linked features, every explanation request is a regulated data transmission. Most teams haven't scoped the BAA (HIPAA) or assessed the lawful basis (GDPR) for this transmission, partly because the interpretability vendor relationship is easy to overlook.

The library is an Integrated Gradients implementation that runs entirely within the Android application process as a structured Kotlin coroutine. No network call at the interpretability tier, ever. Key design decisions that might be interesting to discuss:

**Algorithm choice:** Full Shapley values are O(2^n) — intractable on mobile for any real feature count. Integrated Gradients at 50 Riemann steps achieves >0.94 rank correlation with full SHAP on the models we've tested (tabular, 128 features). For vision models the step count needs to drop to 20 to keep latency reasonable; rank correlation falls to ~0.91, which is acceptable for operator-facing explanations but not for high-stakes automated decisions.

**Memory safety:** Android's OOM killer doesn't warn before terminating a foreground process under severe memory pressure. If an attribution is in-flight when the kill happens, you get no explanation artifact in the audit log — a worse outcome than a degraded one. The watchdog coroutine polls `android.os.Debug.MemoryInfo` at 500ms and sets a degradation flag before the threshold is crossed, causing subsequent calls to return the last cached attribution rather than allocating new buffers.

**Why coroutines over thread pools:** `Executors.newFixedThreadPool()` leaks `Activity` references when a `Runnable` holds a `Context` and the `Activity` is destroyed mid-computation. Kotlin structured concurrency with a `SupervisorJob` tied to the `ViewModel` lifecycle cancels in-flight coroutines immediately on `onCleared()`, releasing the continuation object and all references it holds.

Benchmarks are in the whitepaper (link in the repo README). p50 on a Galaxy A54 is 38ms; remote SHAP baseline on the same network adds ~180ms median and returns nothing offline.

Happy to discuss the approximation quality tradeoffs, the compliance architecture mapping to HIPAA/EU AI Act Article 13, or the memory model in detail.

---

**Timing guidance:**
- Post Tuesday–Thursday, 8–10am US Eastern (peak HN technical audience window)
- Do not post on Monday (lower engagement) or Friday afternoon (drops off the front page before weekend readers arrive)
- Do not submit to "Ask HN" — "Show HN" is correct because this is a working repo with code samples, not a question

**What makes this HN-ready:**
- The repo has an ADR (`docs/adr/001-on-device-vs-cloud.md`) — HN readers respect published decision reasoning
- The whitepaper has citations and benchmark methodology — it will survive scrutiny
- The compliance claims are architectural, not marketing ("no BAA required because no transmission occurs" is verifiable; "HIPAA compliant" is not)
- The "rejected alternatives" section in the ADR shows the team evaluated cloud alternatives seriously — this defuses the "why not just use X" comment thread
