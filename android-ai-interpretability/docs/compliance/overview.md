# Compliance Architecture: HIPAA, GDPR, EU AI Act, and PCI-DSS

## Executive Summary

This document describes how the on-device AI interpretability engine's architecture satisfies requirements under four regulatory frameworks: HIPAA, GDPR, the EU AI Act, and PCI-DSS. It is written for technical and legal decision-makers evaluating whether to deploy the library in regulated environments.

The central compliance property is architectural: the engine creates no data transmission events at the interpretability tier. There is no network call, no third-party processor, and no external storage dependency. Model inputs used to generate explanations remain within the application process on the device where inference was performed. This eliminates a category of compliance exposure that is structurally present in all cloud-based interpretability services and cannot be patched with contractual controls alone.

> **Note:** This document describes technical architecture and its mapping to regulatory requirements. It is not legal advice. Engage qualified legal counsel for formal compliance determinations specific to your deployment context, data types, and jurisdiction.

---

## HIPAA

### The BAA Problem with Cloud Interpretability

Under 45 CFR §164.308(b), a covered entity must enter into a Business Associate Agreement with any vendor that creates, receives, maintains, or transmits Protected Health Information on its behalf. When a mobile clinical AI application sends model input features to a remote SHAP or LIME server, and those features are derived from PHI (lab values, vitals, ICD codes, device readings), the interpretability vendor receives PHI. A BAA is required.

In practice, major cloud interpretability services — AWS SageMaker Clarify, Google Vertex Explainable AI, Azure Responsible AI — do provide BAA coverage under their enterprise agreements, but:

1. The BAA must be in place *before* the first explanation request. Retroactive BAA coverage does not remediate prior disclosures.
2. BAA coverage only addresses the contractual requirement; it does not protect against a breach at the third-party provider.
3. For self-hosted remote SHAP servers (common in regulated enterprises), no commercial BAA process exists — the data transmission is simply unscoped PHI disclosure.

### How On-Device Eliminates This

The interpretability engine executes within the application process. There is no data transmission to a third party. There is no business associate relationship for the interpretability tier. The vendor providing the library ships software, not a service that receives data.

### Audit Log and the Security Rule

HIPAA Security Rule §164.312(b) requires covered entities to "implement hardware, software, and/or procedural mechanisms that record and examine activity in information systems that contain or use ePHI."

The engine's audit log satisfies this requirement for the AI decision pathway:

- **Storage**: `EncryptedSharedPreferences` backed by AES-256-GCM (Jetpack Security 1.1+)
- **Content**: Input feature hash (SHA-256), attribution vector, model version, timestamp (UTC), device ID
- **Integrity**: Each record is HMAC-verified on read; tampered records are flagged as `AuditRecord.Integrity.COMPROMISED`
- **No raw PHI in the log**: The input hash is one-way; original feature values are not recoverable from the audit record

### Data Flow Diagram

```
Device Memory (Application Process)
┌──────────────────────────────────────────────────────────┐
│  Clinical AI App                                         │
│  ┌─────────────────┐   ┌────────────────────────────┐   │
│  │  Model Input    │──▶│  InterpretabilityEngine    │   │
│  │  (PHI features) │   │  (attribution, no egress)  │   │
│  └─────────────────┘   └──────────────┬─────────────┘   │
│                                        │                 │
│                         ┌──────────────▼─────────────┐  │
│                         │  EncryptedSharedPreferences │  │
│                         │  Audit Log (hashed, no PHI) │  │
│                         └────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         │ NO DATA LEAVES THIS BOUNDARY
         ▼
    [No network call. No third-party service.]
```

---

## GDPR Article 22: Right to Explanation

Article 22(1) prohibits solely automated decisions that produce legal or similarly significant effects. When Article 22(3) applies (consent, necessity, or Union/Member State law as the basis), controllers must implement "suitable measures to safeguard the data subject's rights," including the right to obtain human intervention and to contest the decision. Recital 71 specifies that controllers must provide "meaningful information about the logic involved."

### How On-Device Satisfies Article 22

The engine generates a per-decision feature attribution vector for every inference call. This vector constitutes the "meaningful information about the logic involved" required by Recital 71. Because it is generated locally and stored in the audit log:

1. **Availability for subject access requests**: The explanation artifact for any past decision is available immediately from the device's audit log, without querying a third-party service or waiting for a cloud API response.
2. **No Article 46 transfer mechanism required**: The attribution computation involves no transfer of personal data to a third country. Cloud-based explainability services may trigger Chapter V transfer requirements; on-device does not.
3. **Data minimization (Article 5(1)(c))**: The audit log stores a hash of the input, not the input itself. The explanation artifact (the attribution vector) does not constitute personal data in isolation — it describes the model's behavior, not the individual's data.

---

## EU AI Act Article 13: Transparency

### Scope

The EU AI Act classifies AI systems used in medical devices, critical infrastructure, employment decisions, access to essential services, and law enforcement as high-risk under Annex III. High-risk AI systems deployed on Android — clinical decision support, fraud scoring, field inspection — fall within this scope.

### Article 13(1) Requirement

> "High-risk AI systems shall be designed and developed in such a way to ensure that their operation is sufficiently transparent to enable deployers to interpret the system's output and use it appropriately."

### How On-Device Satisfies Article 13

**Per-decision explanations**: The attribution vector produced for each inference call provides a machine-readable explanation of which input features drove the output. This is the technical implementation of "sufficiently transparent operation."

**Article 13(3)(b) — Accuracy and robustness information**: The attribution result's `confidenceInterval` field provides a per-prediction measure of explanation stability. High confidence intervals indicate the attribution is sensitive to the integration path, signaling lower explanation reliability for that specific input. This maps directly to Article 13(3)(b)'s requirement for information about the "level of accuracy, robustness and cybersecurity."

**Article 13(3)(d) — Operational constraints**: The `AttributionResult.Degraded` return type explicitly surfaces the condition where memory pressure caused the explanation to fall back to a cached result. This is a machine-readable signal that the system's operational constraint (memory threshold) affected the explanation for that inference. Deployers can log, alert on, and report this condition.

### Article 13 Compliance Checklist

| Requirement | How System Satisfies It | Evidence Artifact |
|---|---|---|
| Sufficiently transparent operation (Art. 13(1)) | Per-decision feature attribution vector | `AttributionResult.attributions` |
| Meaningful information about logic (Recital 71) | Signed magnitude attribution per input feature | `FeatureAttribution.magnitude` |
| Accuracy and robustness information (Art. 13(3)(b)) | Confidence interval per attribution | `FeatureAttribution.confidenceInterval` |
| Operational constraint disclosure | Degraded result flag when memory threshold hit | `AttributionResult.Degraded` |
| Audit trail | Encrypted local audit log per decision | `AuditLogger` records |
| Human oversight enablement | Attribution artifacts readable by human operators | JSON export via `AuditLogger.exportJson()` |

---

## PCI-DSS

### The Scope Expansion Risk

PCI-DSS 4.0 applies to systems that store, process, or transmit cardholder data (CHD) or sensitive authentication data (SAD). For fraud-scoring AI running on Android POS terminals, the model's input feature vector may include:

- Transaction amounts and velocity windows (derived from cardholder transaction history)
- Merchant category codes associated with specific cardholders
- Device fingerprints tied to cardholder accounts

PCI-DSS Requirement 3 (protect stored account data) and Requirement 4 (protect cardholder data in transit) do not explicitly define "cardholder data" to include model features, but in audit practice, QSAs examine all data flows touching payment systems. A network call from the POS terminal to a remote SHAP server during a payment decision is a data flow that a QSA will scope. If the features transmitted include any account-linked data, the interpretability server enters PCI scope.

### How On-Device Contains Scope

There is no network call from the interpretability layer. The attribution computation is local to the terminal. No cardholder-adjacent features are transmitted to a third-party service. QSAs reviewing the system can confirm the interpretability tier is entirely within the terminal's existing PCI boundary with no new scope expansion.

The audit log is stored locally on the terminal in an encrypted file. Transmission of audit logs for compliance review can be scoped to an existing encrypted channel (the terminal's existing secure log shipping mechanism) rather than creating a new data pathway.

---

## Compliance Checklist

| Regulatory Requirement | Architecture Property | Evidence |
|---|---|---|
| HIPAA: No PHI to business associates without BAA | No network call at interpretability tier | Network traffic analysis: zero external calls |
| HIPAA: Audit controls (§164.312(b)) | Encrypted local audit log per decision | `AuditLogger` database |
| GDPR Art. 22: Right to explanation | Per-decision attribution artifact | `AttributionResult.attributions` |
| GDPR Art. 5: Data minimization | Input hash only in audit log | `AuditRecord.inputHash` is SHA-256 |
| EU AI Act Art. 13(1): Transparent operation | Attribution vector per inference | `AttributionResult.attributions` |
| EU AI Act Art. 13(3)(b): Accuracy information | Confidence interval per attribution | `FeatureAttribution.confidenceInterval` |
| PCI-DSS: No new scope expansion | Zero external data transmission | Network traffic analysis |
| PCI-DSS: Encrypted audit storage | AES-256-GCM audit log | Jetpack Security `EncryptedSharedPreferences` |

---

## Getting a Legal Opinion

This document describes the technical architecture and maps it to regulatory requirements at a structural level. It does not constitute legal advice. The determination of whether a specific deployment satisfies HIPAA, GDPR, EU AI Act, or PCI-DSS requirements depends on:

- The specific data types in the model input features
- The jurisdictions in which the application operates
- The organizational role of the deploying entity (covered entity, controller, operator)
- Any additional regulatory requirements specific to the vertical (FDA SaMD, MDR, financial regulation)

Engage qualified healthcare privacy counsel (for HIPAA/GDPR clinical deployments), a PCI QSA (for payment terminals), or an EU AI Act compliance specialist for formal determinations. The technical properties described here are inputs to that legal analysis, not a substitute for it.
