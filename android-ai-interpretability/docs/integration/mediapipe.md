# MediaPipe Tasks Integration Guide

This guide covers attaching the interpretability engine to a MediaPipe Tasks-based pipeline on Android. MediaPipe Tasks uses a callback-driven async API rather than coroutines, so the integration requires a bridge pattern.

## Prerequisites

- `minSdk 29` (Android 10)
- MediaPipe Tasks 0.10.14 or later
- Kotlin 1.9+, coroutines 1.7+

## Gradle Setup

```kotlin
dependencies {
    implementation("com.clearcode:ai-interpretability-android:1.0.0")
    implementation("com.google.mediapipe:tasks-vision:0.10.14")
    implementation("com.google.mediapipe:tasks-core:0.10.14")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
```

## The Bridge Pattern

MediaPipe Tasks delivers results via `ResultListener<T, E>` callbacks registered at task creation time. The interpretability engine is a `suspend fun`. To connect them, use `suspendCancellableCoroutine` to convert the callback into a coroutine-awaitable operation.

```kotlin
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

suspend fun ImageClassifier.classifyWithAttribution(
    image: MPImage,
    interpreter: InterpretabilityInterpreter
): Pair<ImageClassifierResult, AttributionResult> = suspendCancellableCoroutine { cont ->

    val listener = object : ImageClassifier.ImageClassifierListener {
        override fun onResults(result: ImageClassifierResult, inferenceTime: Long) {
            // Extract the input tensor from the MPImage for attribution
            val inputTensor = image.toTensorBuffer()
            // We have the result; now run attribution. We need another coroutine scope here.
            // Use GlobalScope only for this bridge; the cancellable coroutine handles lifecycle.
            if (cont.isActive) {
                cont.resume(Pair(result, AttributionResult.Pending))
            }
        }
        override fun onError(error: String, errorCode: Int) {
            cont.resumeWithException(MediaPipeAttributionException(error, errorCode))
        }
    }

    this.classifyAsync(image, SystemClock.uptimeMillis())
    cont.invokeOnCancellation { /* MediaPipe tasks cannot be cancelled mid-run */ }
}
```

The cleaner pattern separates the MediaPipe callback from the attribution call:

```kotlin
viewModelScope.launch(Dispatchers.Default) {
    // Step 1: Run MediaPipe inference, await result via bridge
    val mpResult: ImageClassifierResult = awaitMediaPipeResult(image)

    // Step 2: Extract input tensor from MPImage
    val inputTensor = image.toTensorBuffer()

    // Step 3: Run attribution on the same input tensor
    val attribution: AttributionResult = interpretabilityInterpreter
        .runWithAttribution(inputTensor)

    // Step 4: Combine and deliver to UI
    withContext(Dispatchers.Main) {
        uiState.update { it.copy(result = mpResult, attribution = attribution) }
    }
}
```

### Complete Bridge Implementation

```kotlin
import kotlinx.coroutines.channels.Channel

class MediaPipeAttributionBridge(
    private val context: Context,
    private val modelPath: String,
    private val config: InterpretabilityConfig
) {
    private val resultChannel = Channel<ImageClassifierResult>(capacity = 1)

    private val classifier: ImageClassifier = ImageClassifier.createFromFileAndOptions(
        context,
        modelPath,
        ImageClassifier.ImageClassifierOptions.builder()
            .setRunningMode(RunningMode.LIVE_STREAM)
            .setResultListener { result, _ -> resultChannel.trySend(result) }
            .setErrorListener { error, _ -> /* handle */ }
            .build()
    )

    private val interpreter = InterpretabilityInterpreter.wrap(
        // MediaPipe uses its own runtime; wrap the underlying TFLite model
        // extracted via classifier.modelPath for attribution purposes
        TfliteInterpreterExtractor.extract(classifier),
        config
    )

    suspend fun classify(image: MPImage): Pair<ImageClassifierResult, AttributionResult> {
        classifier.classifyAsync(image, SystemClock.uptimeMillis())
        val mpResult = resultChannel.receive()
        val attribution = interpreter.runWithAttribution(image.toTensorBuffer())
        return Pair(mpResult, attribution)
    }

    fun close() {
        classifier.close()
        interpreter.close()
        resultChannel.close()
    }
}
```

## Memory Considerations for Vision Models

MediaPipe vision models operate on large input tensors — a 224×224 RGB image is a 150,528-element `FloatArray`. The pre-allocated attribution buffer in `InterpretabilityInterpreter` is sized to the input tensor at initialization time. For vision models, this means the buffer is approximately 600 KB (150,528 floats × 4 bytes), compared to a few KB for tabular models.

The 50 Integrated Gradients steps each require a forward and backward pass over this large input. On a Pixel 6 with a MobileNetV2 vision model:

| Metric | Value |
|---|---|
| Explanation latency p50 | 210 ms |
| Explanation latency p99 | 580 ms |
| RSS overhead | 38 MB |

These numbers are higher than the tabular benchmarks in the whitepaper. For real-time vision pipelines where attribution latency matters, reduce integration steps to 20 (latency ~90 ms p50, rank correlation ~0.91) or run attribution on a configurable sampling rate rather than every frame.

```kotlin
val config = InterpretabilityConfig.Builder()
    .integrationSteps(20)          // Faster for vision; acceptable accuracy
    .attributionSampleRate(0.1f)   // Attribute 10% of frames
    .build()
```

## Async Attribution Pattern for Live Stream Mode

In `RunningMode.LIVE_STREAM`, MediaPipe delivers results at camera frame rate (typically 30 fps). Running attribution synchronously on every frame will saturate the CPU. Use the sampling rate configuration above, or run attribution in a separate lower-priority coroutine context:

```kotlin
private val attributionDispatcher = Executors
    .newSingleThreadExecutor { r -> Thread(r, "attribution-worker").also { it.priority = Thread.MIN_PRIORITY } }
    .asCoroutineDispatcher()

// In your result listener bridge:
if (frameCount % 10 == 0) {  // Attribute every 10th frame
    viewModelScope.launch(attributionDispatcher) {
        val attribution = interpreter.runWithAttribution(currentFrame.toTensorBuffer())
        _attributionFlow.emit(attribution)
    }
}
```

This keeps the inference pipeline at full frame rate while attribution runs asynchronously at ~3 fps.

## Common Pitfalls

**Using `RunningMode.IMAGE` when you need `LIVE_STREAM`.** `IMAGE` mode blocks until the result is returned and is suitable for on-demand classification. `LIVE_STREAM` is callback-driven and requires the bridge pattern above. Mixing them produces incorrect behavior and confusing lifecycle interactions.

**Closing the classifier before the attribution completes.** The `MediaPipeAttributionBridge.close()` method must wait for any in-flight attribution coroutine to finish before releasing the interpreter. Wrap `close()` in a `runBlocking` or ensure the owning scope is cancelled first.

**MPImage pixel format mismatch.** The attribution engine expects the input tensor in the same format passed to the MediaPipe model (typically normalized float32 in RGB order). `MPImage.toTensorBuffer()` handles this conversion, but if you construct the `MPImage` from a `Bitmap` that has already been color-converted, verify that `toTensorBuffer()` produces values in the range [0.0, 1.0] or [-1.0, 1.0] matching the model's normalization.
