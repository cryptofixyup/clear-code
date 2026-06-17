# Reference Demo Application

This demo is a standalone Android application demonstrating the on-device interpretability engine end-to-end. It runs a pre-trained fraud detection model on synthetic transaction data, generates real-time feature attributions, visualizes them in a bar chart, and writes all decisions to an encrypted local audit log — with no network calls at any stage.

## What the Demo Demonstrates

- Loading a TFLite FlatBuffer model from `assets/`
- Wrapping the `Interpreter` with `InterpretabilityInterpreter`
- Generating feature attributions for each inference call
- Displaying a live ranked bar chart of the top 10 most influential features
- Showing live RSS memory usage from the watchdog coroutine
- Writing every decision (inference output + attribution + input hash) to an encrypted audit log
- Exporting the audit log as JSON via a share sheet
- Graceful degradation: a red banner appears when the memory watchdog enters degraded mode

## Model

The demo uses a pre-trained MobileNetV2-equivalent tabular classification model with 128 input features representing synthetic payment transaction attributes:

- `amount_usd`: Transaction amount (normalized)
- `merchant_category_code`: MCC (one-hot encoded, 10 categories in demo)
- `velocity_1h` / `velocity_24h`: Transaction count in the past 1h / 24h
- `device_age_days`: Days since device first seen
- `hour_of_day` / `day_of_week`: Time features (cyclical encoding)
- ... (remaining 118 features are synthetic noise features for benchmark realism)

The model is not trained on real payment data. It is a demonstration artifact with plausible decision behavior. The demo generates synthetic random feature vectors as inputs.

## Requirements

- **Android Studio Hedgehog** (2023.1.1) or later
- **JDK 17** (bundled with Android Studio Hedgehog)
- **Android Gradle Plugin** 8.2.0 or later
- **Minimum SDK**: API 29 (Android 10)
- **Target SDK**: API 34 (Android 14)
- Physical device or emulator with at least 2 GB RAM (4 GB recommended for reliable memory watchdog demonstration)

## Build Instructions

1. Open the `demo/` directory as a project in Android Studio (not the root `clear-code` directory — the demo is a standalone Android project).
2. Android Studio will prompt to sync Gradle. Accept and wait for the sync to complete.
3. The `ai-interpretability-android` AAR is included as a local dependency in `demo/libs/`. No separate library build is required.
4. Select a run target (physical device or emulator) and click **Run**.

## Running on an Emulator

An API 29+ emulator with x86_64 architecture is required. The TFLite model runs on the CPU execution provider; NNAPI is not available in most emulator configurations and is automatically disabled.

Memory watchdog behavior is more visible on a device with constrained RAM. To demonstrate degraded mode on an emulator, use the "Memory Pressure" tool in Android Studio's **Profiler** tab: set memory pressure to **Critical** while the demo is running. The interpretability engine will enter degraded mode and the UI will display the red degradation banner within two watchdog polling cycles (~1 second).

## Running on a Physical Device

Enable USB debugging on the device (`Settings → Developer Options → USB Debugging`). Connect via USB and select the device in Android Studio's run target dropdown.

On physical devices with 4 GB or more RAM, the memory watchdog will not enter degraded mode during normal demo operation. To see degraded mode behavior, open several other memory-intensive apps in the background before launching the demo.

## What to Look For

**On launch:**  
The demo immediately begins generating synthetic transaction feature vectors at approximately 2 per second. Each vector is passed through inference and attribution. The bar chart updates live with the top 10 features ranked by absolute attribution magnitude.

**Feature attribution chart:**  
Green bars indicate features that pushed the model toward "not fraud." Red bars indicate features that pushed toward "fraud." Feature names are displayed on the y-axis. The bar length is proportional to attribution magnitude.

**Memory indicator:**  
The top-right corner shows live RSS in MB, updated at the watchdog's 500 ms polling interval. On a 6 GB device, expect approximately 180–195 MB total RSS including the base application.

**Audit log:**  
Tap the **Export Audit Log** button to generate a JSON file containing all attribution records from the current session. The file is shareable via the system share sheet. Each record contains:

```json
{
  "record_id": "uuid-v4",
  "timestamp_utc": "2024-11-15T14:22:31.441Z",
  "input_hash": "sha256:a3f9...",
  "model_version": "fraud-detection-v1.2",
  "inference_output": { "fraud_probability": 0.847 },
  "attribution": [
    { "feature_index": 3, "feature_name": "velocity_1h", "magnitude": 0.341, "ci": 0.021 },
    ...
  ],
  "degraded": false
}
```

**Degraded mode banner:**  
If the watchdog enters degraded mode (visible by inducing memory pressure as described above), a persistent red banner appears at the top of the screen: *"Explanation quality reduced: memory pressure detected. Showing cached attribution."* The banner dismisses automatically when the watchdog exits degraded mode.

## Project Structure

```
demo/
├── app/
│   ├── src/main/
│   │   ├── java/com/clearcode/demo/
│   │   │   ├── MainActivity.kt          — Entry point, ViewModel binding
│   │   │   ├── InferenceViewModel.kt    — Model + interpreter lifecycle
│   │   │   ├── SyntheticDataGenerator.kt — Random feature vector generation
│   │   │   ├── AttributionChartView.kt  — Custom View bar chart
│   │   │   └── AuditExportHelper.kt     — JSON export and share intent
│   │   ├── assets/
│   │   │   └── fraud_detection_v1.2.tflite
│   │   └── res/layout/
│   │       └── activity_main.xml
│   └── build.gradle.kts
├── libs/
│   └── ai-interpretability-android-1.0.0.aar
└── build.gradle.kts
```
