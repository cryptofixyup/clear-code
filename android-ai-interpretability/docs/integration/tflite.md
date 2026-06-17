# TensorFlow Lite Integration Guide

This guide covers attaching the on-device interpretability engine to an existing TensorFlow Lite model in an Android application.

## Prerequisites

- `minSdk 29` (Android 10)
- TensorFlow Lite 2.13 or later
- Kotlin 1.9+, coroutines 1.7+
- Jetpack Security 1.1+ (for encrypted audit log)

## Gradle Setup

In your module-level `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.clearcode:ai-interpretability-android:1.0.0")
    implementation("org.tensorflow:tensorflow-lite:2.14.0")
    implementation("org.tensorflow:tensorflow-lite-support:0.4.4")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
```

The interpretability library declares `tensorflow-lite` as a `compileOnly` dependency, so your version declaration controls which TFLite runtime is included.

## Step 1: Initialize the Wrapped Interpreter

Replace your direct `Interpreter` instantiation with `InterpretabilityInterpreter.wrap()`. The wrapper requires a `SignatureDef`-enabled TFLite model (any model exported via `tf.saved_model.save()` or TFLite Model Maker includes this by default).

```kotlin
import com.clearcode.interpretability.InterpretabilityInterpreter
import com.clearcode.interpretability.InterpretabilityConfig
import org.tensorflow.lite.Interpreter

val tfliteOptions = Interpreter.Options().apply {
    numThreads = 4
}
val baseInterpreter = Interpreter(modelBuffer, tfliteOptions)

val config = InterpretabilityConfig.Builder()
    .baselineStrategy(BaselineStrategy.ZERO_VECTOR)
    .integrationSteps(50)
    .memoryThresholdPercent(80)
    .auditLogPath(context.filesDir.resolve("interpretability_audit.db").absolutePath)
    .build()

val interpreter = InterpretabilityInterpreter.wrap(baseInterpreter, config)
```

Call this once at startup — during `ViewModel.init {}` or `Application.onCreate()` — and retain the instance for the lifecycle of the model. Creating one instance per inference call allocates the attribution buffer unnecessarily and will trigger frequent GC.

## Step 2: Run Inference with Attribution

`runWithAttribution` is a `suspend fun`. Call it from a coroutine scope tied to your `ViewModel` or `LifecycleOwner`.

```kotlin
import com.clearcode.interpretability.AttributionResult

viewModelScope.launch(Dispatchers.Default) {
    val result: AttributionResult = interpreter.runWithAttribution(inputTensor)

    when (result) {
        is AttributionResult.Success -> handleSuccess(result)
        is AttributionResult.Degraded -> handleDegraded(result)
        is AttributionResult.Error -> handleError(result)
    }
}
```

`Dispatchers.Default` is appropriate for CPU-bound attribution work. Do not call `runWithAttribution` on `Dispatchers.Main` — it will execute 50 forward/backward passes through the model and will trigger an ANR on the main thread.

## Step 3: Parse the AttributionResult

```kotlin
fun handleSuccess(result: AttributionResult.Success) {
    // Full attribution vector, one Float per input feature
    val attributions: List<FeatureAttribution> = result.attributions

    // Sort by absolute magnitude to get most influential features
    val topFeatures = attributions
        .sortedByDescending { it.magnitude }
        .take(5)

    topFeatures.forEach { attr ->
        Log.d("Attribution", "Feature ${attr.featureIndex}: ${attr.magnitude} " +
              "(±${attr.confidenceInterval})")
    }

    // The raw inference output is also available
    val inferenceOutput: TensorBuffer = result.inferenceOutput
}

fun handleDegraded(result: AttributionResult.Degraded) {
    // Memory pressure triggered graceful degradation.
    // result.cachedAttribution contains the most recent successful attribution.
    // result.inferenceOutput contains the current inference result (always computed).
    // The inference itself succeeded; only the new attribution was skipped.
    showWarning("Explanation based on prior input due to memory pressure")
}
```

`FeatureAttribution` has three fields:
- `featureIndex: Int` — zero-based index into the input tensor
- `magnitude: Float` — signed attribution (positive = pushed toward predicted class)
- `confidenceInterval: Float` — standard deviation across the 50 integration steps; higher values indicate the attribution is sensitive to the integration path

## Step 4: Write to the Audit Log

```kotlin
import com.clearcode.interpretability.AuditLogger

// Call after handling the result
AuditLogger.record(result, context)
```

`AuditLogger.record()` is a non-suspending call that writes asynchronously to the encrypted SQLite database specified in the config. The audit record contains: SHA-256 hash of the input tensor (not reversible to the original values), the attribution vector, model version extracted from the TFLite metadata, UTC timestamp, and device identifier. The database is encrypted with AES-256-GCM via Jetpack Security.

To export audit records for compliance review:

```kotlin
val records: List<AuditRecord> = AuditLogger.exportJson(context)
```

## Common Pitfalls

**Not releasing the interpreter.** `InterpretabilityInterpreter` holds a reference to the underlying `Interpreter` and the pre-allocated attribution buffer. Call `interpreter.close()` when the owning component is destroyed. If used in a `ViewModel`, override `onCleared()`:

```kotlin
override fun onCleared() {
    super.onCleared()
    interpreter.close()
}
```

**Calling on the main thread.** `runWithAttribution` internally calls `check(!Looper.getMainLooper().isCurrentThread)` and throws `IllegalStateException` if called on the main thread. Always dispatch to `Dispatchers.Default`.

**Not handling `AttributionResult.Error`.** `AttributionResult.Error` carries an `AttributionException` with a `cause`. The most common causes are `ModelIncompatible` (the model lacks gradient support in its `SignatureDef`) and `TimeoutExpired` (attribution exceeded the 5-second default timeout, configurable via `InterpretabilityConfig.timeoutMs`).

**Creating a new `InterpretabilityInterpreter` per inference call.** The pre-allocated buffer is the memory safety mechanism. Discarding it on every call defeats the optimization and reintroduces GC pressure.

## Performance Tuning

**Thread count.** The `numThreads` setting on `Interpreter.Options` controls both the inference and gradient passes. Four threads is optimal for mid-range and flagship devices; reduce to two on budget devices (Helio G85 class) to avoid thermal throttling during sustained attribution workloads.

**NNAPI delegate interaction.** The NNAPI delegate accelerates inference but does not provide gradient access through the standard `SignatureDef` API. If NNAPI is enabled on the base interpreter, `InterpretabilityInterpreter` will fall back to CPU for the backward passes only, running inference on NNAPI and gradients on CPU. This is the correct behavior and requires no configuration. Total latency in this mode is approximately 15–20% higher than CPU-only for the attribution, offset by faster inference.

**Integration steps.** Reducing `integrationSteps` from 50 to 20 cuts attribution latency roughly in half with approximately 0.03 reduction in SHAP rank correlation. For UX contexts where rough feature attribution is sufficient (e.g., a "why was this flagged?" tooltip), 20 steps is an acceptable tradeoff.
