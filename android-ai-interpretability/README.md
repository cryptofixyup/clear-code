<div align="center">

# On-Device AI Interpretability for Android

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%2010%2B-green.svg)](https://developer.android.com)
[![API Level](https://img.shields.io/badge/API%20Level-29%2B-brightgreen.svg)](https://developer.android.com/about/versions/10)
[![Build Status](https://img.shields.io/badge/Build-passing-success.svg)](https://github.com/clearcode/ai-interpretability-android/actions)

</div>

Cloud-based AI interpretability is a compliance liability: every SHAP or LIME explanation request forwards raw model inputs — potentially PHI, PAN data, or biometric features — to a remote server outside your security perimeter. This library eliminates that pathway entirely. The attribution engine runs as a structured Kotlin coroutine directly inside your Android process, producing gradient-based feature attributions with zero egress, bounded RSS overhead (<12 MB), and a fault isolation model that degrades gracefully under OOM pressure rather than crashing. Explanation artifacts are written to `EncryptedSharedPreferences` for on-device audit log retention, satisfying HIPAA, GDPR, and EU AI Act transparency requirements without a Business Associate Agreement for the interpretability tier.

---

## Why On-Device?

- **HIPAA/GDPR data residency** — Model inputs never leave the device. When those inputs contain Protected Health Information or personal data under GDPR Article 4, sending them to a remote SHAP server creates a data-sharing event that requires a BAA (HIPAA) or a lawful basis determination (GDPR). On-device attribution eliminates this pathway entirely; there is no network transmission to scope.

- **Zero-latency explanations** — Attribution runs as a synchronous coroutine call within the same process that performed inference. Median explanation latency on mid-range hardware is under 40 ms. Remote SHAP servers add a median network round-trip of 180 ms in ideal conditions and fail completely when connectivity drops.

- **Offline reliability** — Medical tablets in rural clinics, logistics scanners in warehouses, and POS terminals in connectivity-constrained environments all need interpretability to function regardless of network state. The attribution engine has no runtime dependencies on external services; it works identically with full bars or no signal.

- **Audit-ready** — Every explanation artifact — feature attribution vector, confidence interval, input hash, timestamp, model version — is written atomically to an `EncryptedSharedPreferences`-backed audit log stored locally. Audit records survive app restarts, are accessible for regulatory inspection without a network request to a third-party log aggregator, and can be exported in structured JSON for compliance review.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              Your Application Layer                  │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│              Inference Layer                         │
│   TensorFlow Lite 2.13+ | MediaPipe Tasks | ORT     │
│   Wrapped by InterpretabilityInterpreter adapter    │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│           Interpretability Engine                    │
│   Gradient-based saliency attribution               │
│   Runs as structured Kotlin coroutine               │
│   Bounded memory: pre-allocated attribution buffer  │
│   >0.94 rank correlation with full Shapley values   │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│            Memory Safety Layer                       │
│   RSS watchdog coroutine polls android.os.Debug     │
│   Triggers graceful degradation before OOM kill     │
│   GC pressure monitoring via Runtime.totalMemory()  │
│   Returns cached partial attribution on threshold   │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│            Fault Isolation Layer                     │
│   Each request isolated in coroutineScope{}         │
│   SupervisorJob: one failure doesn't cancel others  │
│   Structured error reporting: AttributionException  │
│   Attribution failures never propagate to inference │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

Add the dependency to your module-level `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.clearcode:ai-interpretability-android:1.0.0")
}
```

Attach the interpretability layer to an existing TFLite model and retrieve feature attributions:

```kotlin
val interpreter = InterpretabilityInterpreter.wrap(tfliteInterpreter, config)
val result: AttributionResult = interpreter.runWithAttribution(inputTensor)
val topFeatures = result.attributions.sortedByDescending { it.magnitude }.take(5)
AuditLogger.record(result, context)
```

The entire call is a `suspend fun`; run it from your existing coroutine scope. No new threads, no global state, no retained references to the input tensor after the call returns.

---

## Integration Guides

| Framework | Guide |
|---|---|
| TensorFlow Lite | [docs/integration/tflite.md](docs/integration/tflite.md) |
| MediaPipe Tasks | [docs/integration/mediapipe.md](docs/integration/mediapipe.md) |
| ONNX Runtime Mobile | [docs/integration/onnx.md](docs/integration/onnx.md) |

---

## Compliance & Regulatory

Full compliance architecture covering HIPAA, GDPR Article 22, EU AI Act Article 13, and PCI-DSS, including data flow diagrams, evidence artifact mapping, and a compliance checklist:

[docs/compliance/overview.md](docs/compliance/overview.md)

---

## Technical Whitepaper

[docs/whitepaper.md](docs/whitepaper.md) — "Memory-Safe AI Interpretability at the Edge: Architecture, Fault Isolation, and Compliance Implications for Android Deployments." Covers the attribution algorithm, Android memory model, benchmark data across three device tiers, and a full compliance architecture analysis.

---

## Target Use Cases

**FinTech — Transaction Fraud Models on Android POS Terminals**
Payment processors deploying fraud scoring on Android-based point-of-sale hardware need explanations for declined transaction decisions to meet card network dispute requirements. Sending transaction feature vectors (amount, merchant category, velocity) to a remote SHAP server may expand PCI-DSS scope. On-device attribution keeps cardholder-adjacent data within the terminal's existing PCI boundary.

**HealthTech — Clinical Decision Support on Medical Android Tablets**
Clinical AI tools running on Android tablets in hospitals and clinics must explain model outputs to clinicians under FDA Software as a Medical Device (SaMD) guidance and the EU Medical Device Regulation. If model inputs contain PHI (lab values, vitals, diagnosis codes), off-device attribution requires a BAA with the interpretability provider. On-device attribution eliminates this requirement.

**Field Operations — Offline AI in Logistics and Inspection Applications**
Inspection apps used in manufacturing plants, utility substations, and warehouses frequently operate in connectivity-dead zones. An interpretability layer that requires a network call provides zero value in these environments. On-device attribution delivers consistent, auditable explanations regardless of network state, enabling reliable operator override workflows.

---

## Memory & Performance

Benchmarked on Pixel 6 (Tensor G1, Android 13) with a 128-feature tabular classification model.

| Metric | Value |
|---|---|
| RSS overhead | <12 MB |
| Explanation latency p50 | <40 ms |
| Explanation latency p99 | <120 ms |
| GC pressure | Negligible (pre-allocated attribution buffer) |
| Minimum API level | 29 (Android 10) |
| SHAP rank correlation | >0.94 |
| Offline capable | Yes |

---

## License

Copyright 2024 ClearCode, Inc.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full license text.
