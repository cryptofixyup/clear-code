# ONNX Runtime Mobile Integration Guide

This guide covers attaching the interpretability engine to a model running under ONNX Runtime for Android (Microsoft ORT).

## Prerequisites

- `minSdk 29` (Android 10)
- ONNX Runtime for Android 1.17.0 or later
- Kotlin 1.9+, coroutines 1.7+
- Models must be exported with gradient-capable ops (see Section: Gradient Support)

## Gradle Setup

```kotlin
dependencies {
    implementation("com.clearcode:ai-interpretability-android:1.0.0")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.17.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
```

ONNX Runtime provides separate AAR packages for different execution providers. The above includes the CPU execution provider. For NNAPI acceleration, also add `onnxruntime-extensions-android`.

## OrtEnvironment and Session Lifecycle

`OrtEnvironment` is a process-global singleton managing the ONNX Runtime thread pool and logging. Create it once in `Application.onCreate()` and close it in `Application.onTerminate()`. Creating multiple `OrtEnvironment` instances in the same process causes a native crash.

```kotlin
class MyApplication : Application() {
    lateinit var ortEnvironment: OrtEnvironment

    override fun onCreate() {
        super.onCreate()
        ortEnvironment = OrtEnvironment.getEnvironment()
    }

    override fun onTerminate() {
        ortEnvironment.close()
        super.onTerminate()
    }
}
```

`OrtSession` objects are per-model and should be scoped to the `ViewModel` or component that owns the model lifecycle.

## Step 1: Create the Session and Wrap It

```kotlin
import com.clearcode.interpretability.InterpretabilityInterpreter
import com.clearcode.interpretability.InterpretabilityConfig
import ai.onnxruntime.OrtSession
import ai.onnxruntime.OrtEnvironment

val sessionOptions = OrtSession.SessionOptions().apply {
    setInterOpNumThreads(4)
    setIntraOpNumThreads(4)
    setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
}

val session: OrtSession = ortEnvironment.createSession(
    modelBytes,
    sessionOptions
)

val config = InterpretabilityConfig.Builder()
    .baselineStrategy(BaselineStrategy.FEATURE_MEAN)
    .integrationSteps(50)
    .memoryThresholdPercent(80)
    .auditLogPath(context.filesDir.resolve("ort_audit.db").absolutePath)
    .build()

val interpreter = InterpretabilityInterpreter.wrapOrtSession(session, ortEnvironment, config)
```

`InterpretabilityInterpreter.wrapOrtSession()` is the ONNX-specific entry point. It inspects the session's input and output info to size the pre-allocated attribution buffer correctly.

## Step 2: Prepare Input and Run Attribution

ONNX Runtime uses `OnnxTensor` objects rather than `TensorBuffer`. The interpretability library accepts both via the `InputAdapter` abstraction.

```kotlin
import ai.onnxruntime.OnnxTensor
import java.nio.FloatBuffer

// Create input tensor (example: 128-feature tabular input)
val inputData = FloatBuffer.wrap(featureVector)  // your float[] of shape [1, 128]
val shape = longArrayOf(1, 128)
val inputTensor = OnnxTensor.createTensor(ortEnvironment, inputData, shape)

// Map to the session's input name
val inputName = session.inputNames.iterator().next()

viewModelScope.launch(Dispatchers.Default) {
    val result = interpreter.runWithAttribution(
        inputs = mapOf(inputName to inputTensor)
    )

    when (result) {
        is AttributionResult.Success -> {
            val topFeatures = result.attributions
                .sortedByDescending { it.magnitude }
                .take(10)
            withContext(Dispatchers.Main) { updateUI(topFeatures) }
        }
        is AttributionResult.Degraded -> showDegradedWarning(result)
        is AttributionResult.Error -> logError(result.cause)
    }

    // Always close OnnxTensor after use to release native memory
    inputTensor.close()
}
```

**Always close `OnnxTensor` objects** after the attribution call returns. ONNX Runtime allocates tensor memory in the native heap. Unlike Java objects, these are not collected by GC — failing to close them is a native memory leak that will not show up in heap profilers but will appear as growing RSS.

## Step 3: Handle Dynamic Input Shapes

ONNX models frequently use dynamic axes (symbolic dimensions like `batch_size` or `sequence_length`). The interpretability engine handles dynamic shapes by deferring attribution buffer sizing to the first call:

```kotlin
// For a model with input shape [batch_size, sequence_length, feature_dim]
// where batch_size and sequence_length are dynamic:
val config = InterpretabilityConfig.Builder()
    .dynamicShapeHandling(DynamicShapeStrategy.INFER_ON_FIRST_CALL)
    // On first runWithAttribution call, the engine inspects the actual input shape
    // and allocates the buffer. Subsequent calls with different shapes trigger a
    // buffer resize, which is slower. For best performance, keep input shapes consistent.
    .build()
```

For sequence models (NLP, time-series), the attribution vector will have one value per token/timestep/feature depending on the model's input dimensionality. Use `result.attributions.groupBy { it.sequencePosition }` to aggregate by time step if the model has a sequence dimension.

## Gradient Support in ONNX Models

The interpretability engine's Integrated Gradients implementation requires backward-pass gradient access. ONNX Runtime supports this via the Training API gradient session, but only for models exported with the gradient graph included.

**Check if your model supports gradients:**

```kotlin
val supportsGradients = interpreter.supportsGradientAttribution()
// Returns false for inference-only models exported without gradient ops
```

If `supportsGradients` returns `false`, the engine falls back to finite-difference approximation: it perturbs each feature by a small epsilon and measures the output change. This is correct but approximately 2× slower than gradient-based attribution on large feature sets.

**Export a gradient-capable model from PyTorch:**

```python
import torch
import onnx
from onnxruntime.training import artifacts

# Export with gradient graph
torch.onnx.export(
    model,
    sample_input,
    "model_with_gradients.onnx",
    export_params=True,
    opset_version=17,
    training=torch.onnx.TrainingMode.TRAINING,  # Includes gradient ops
)
```

**Export from TensorFlow/Keras:**
TF→ONNX conversion via `tf2onnx` does not preserve gradient ops by default. Use the `--opset 17` flag and `--extra-opset ai.onnx.training:1` to include training ops.

## Memory Implications for Large Models

Large ONNX models (vision transformers, BERT-class NLP models) have input tensors orders of magnitude larger than tabular models. The attribution buffer for a BERT-base model with 512-token input and 768-dimensional embeddings is approximately 1.5 MB. For ViT-B/16, the image patch embedding input buffer is approximately 2.3 MB.

The watchdog threshold should be tuned down for large models:

```kotlin
val config = InterpretabilityConfig.Builder()
    .memoryThresholdPercent(70)  // More conservative threshold for large models
    .integrationSteps(20)        // Reduce steps for large models
    .build()
```

Check the memory class available to your app and size accordingly:

```kotlin
val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
val memoryClassMb = activityManager.memoryClass
// On a 4GB device: ~192 MB. On an 8GB device: ~512 MB.
// The watchdog threshold is a percentage of this value.
```

## OrtSession Lifecycle with ViewModel

```kotlin
class InferenceViewModel(application: Application) : AndroidViewModel(application) {
    private val ortEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    private val interpreter: InterpretabilityInterpreter

    init {
        val modelBytes = application.assets.open("model.onnx").readBytes()
        session = ortEnvironment.createSession(modelBytes, OrtSession.SessionOptions())
        val config = InterpretabilityConfig.Builder()
            .auditLogPath(application.filesDir.resolve("audit.db").absolutePath)
            .build()
        interpreter = InterpretabilityInterpreter.wrapOrtSession(session, ortEnvironment, config)
    }

    override fun onCleared() {
        interpreter.close()
        session.close()
        // Do NOT close ortEnvironment here if other ViewModels share it.
        // Close it in Application.onTerminate() instead.
        super.onCleared()
    }
}
```

## Common Pitfalls

**Closing `OrtEnvironment` before all sessions are closed.** Sessions hold a reference to the environment. Closing the environment first causes a native crash. Always close sessions before closing the environment.

**Not handling `OrtException` from session creation.** `OrtSession` creation fails if the model file is corrupt, the opset version is unsupported, or the model requires an execution provider that isn't loaded. Wrap session creation in a `try/catch(OrtException)` and surface the error to the user with the exception message, which is descriptive.

**Sharing a single `OrtSession` across threads without synchronization.** `OrtSession.run()` is not thread-safe. If you need concurrent inference, create one session per thread. The interpretability wrapper handles this internally when `runWithAttribution` is called concurrently — each call gets its own run context — but the underlying session must not be called directly from multiple threads simultaneously.
