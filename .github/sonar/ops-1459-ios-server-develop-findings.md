# OPS-1459 iOS Sonar Server finding ledger

Authenticated self-hosted Sonar Server `toggly-sdks-ios` `develop` export supplied by the
programme orchestrator on 2026-09-27; latest analysis reported as 2026-09-25.
The API export contains exactly 77 unresolved issues (77 `OPEN`, 0 `CONFIRMED`).
Its JSON does not include the request URL or branch metadata, so the project/branch
provenance and analysis date rely on the authenticated capture record; the SHA-256
below identifies the exact local API export used for this ledger. This is a
source-level disposition, not a post-change Server scan. Historical line numbers
refer to `develop`, not the candidate branch.

The SonarCloud `develop` overview at
<https://sonarcloud.io/project/overview?id=toggly-sdks-ios&branch=develop>
returned a permission error (`User with id null does not have permission to access
this page`); Cloud `develop` findings and coverage remain **unknown**. The public
Cloud default-branch view is a different branch and is not used to close Server
findings.

| Rule | Server open | Source-addressed in candidate | Residual |
| --- | ---: | ---: | ---: |
| `SwiftLint:cyclomatic_complexity` | 7 | 0 | 7 |
| `SwiftLint:file_length` | 4 | 0 | 4 |
| `SwiftLint:force_try` | 2 | 0 | 2 |
| `SwiftLint:function_body_length` | 3 | 0 | 3 |
| `SwiftLint:identifier_name` | 21 | 15 | 6 |
| `SwiftLint:large_tuple` | 1 | 0 | 1 |
| `SwiftLint:line_length` | 31 | 31 | 0 |
| `SwiftLint:statement_position` | 5 | 5 | 0 |
| `SwiftLint:type_body_length` | 3 | 0 | 3 |
| **Total** | **77** | **51** | **26** |

Source-addressed means the reported line/name was changed in the candidate and
requires a fresh exact-head Server analysis to confirm closure. Residual findings
remain visible; no exclusion, suppression, or quality-gate change was made. The
structural findings should be split into focused follow-up work with independent
behavior tests instead of being hidden by mechanical extraction in this slice.

API export SHA-256: `abdea58774d5b385e5e22f4dcaed87a61f96d4746110d5d983d71c03e7ca7a04`.

| Server issue key | Severity | Rule | `develop` path:line | Disposition | Reason |
| --- | --- | --- | --- | --- | --- |
| `8a10ca0e-180a-4cf3-bdab-fd7178dbd687` | MAJOR | `SwiftLint:line_length` | `TogglyCombine/Sources/TogglyEventPublisher.swift:26` | Source-addressed | Formatting changed; hosted rescan pending. |
| `df6da428-93df-4da8-89b9-2a7b2600168d` | MAJOR | `SwiftLint:line_length` | `TogglyCombine/Sources/TogglyEventPublisher.swift:96` | Source-addressed | Formatting changed; hosted rescan pending. |
| `35d2be8d-bc2d-4936-b39c-74f0075087da` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Models/EntityGate.swift:6` | Residual | Public API/JWK field or initializer label; rename needs compatibility review. |
| `4e19136b-a89b-4e73-8c2d-d83436b9daa3` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Models/EntityGate.swift:10` | Residual | Public API/JWK field or initializer label; rename needs compatibility review. |
| `e66e4c85-e303-403b-9ecd-d43c9820326d` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Models/EntityGate.swift:196` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `1a810d54-0a97-40c1-9c33-a92a8334226f` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Models/EntityGate.swift:222` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `3ee5f15f-8687-4ddb-8d22-2741cbdda626` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Models/EntityGate.swift:267` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `4735a80e-3881-4427-b1c8-7649b8513c6b` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Models/EntityGate.swift:283` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `93df2d1a-f58f-48a2-9f31-ec570b04e801` | MAJOR | `SwiftLint:file_length` | `TogglyCore/Sources/Models/EntityGate.swift:410` | Residual | Entity-gate module split needs parser and public-contract review. |
| `a5075dee-e886-4f3f-93c9-d8b256217b8f` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Models/TogglyEvents.swift:81` | Source-addressed | Formatting changed; hosted rescan pending. |
| `165984a3-7c29-4340-99ff-0f0e759414de` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Models/VariantResult.swift:51` | Source-addressed | Formatting changed; hosted rescan pending. |
| `a265a145-9d56-4fec-ab19-e352f08a32c7` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:86` | Residual | Public API/JWK field or initializer label; rename needs compatibility review. |
| `a9d4458c-e6d3-49bf-893c-c1a5c6cbcc80` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:87` | Residual | Public API/JWK field or initializer label; rename needs compatibility review. |
| `440e5942-1227-4a79-9b66-4204ffeef711` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:95` | Residual | Public API/JWK field or initializer label; rename needs compatibility review. |
| `49ccb569-2154-456d-8ecd-00c13d4e2bdf` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:96` | Residual | Public API/JWK field or initializer label; rename needs compatibility review. |
| `8461a49d-37bb-4ebd-be79-48c587d1f825` | MAJOR | `SwiftLint:type_body_length` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:124` | Residual | Crypto/parser extraction needs signed-envelope fixture and DER/P1363 parity review. |
| `1b99b4ca-b1cb-4bc0-89db-1f204ba4a2cb` | CRITICAL | `SwiftLint:cyclomatic_complexity` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:128` | Residual | Crypto/parser extraction needs signed-envelope fixture and DER/P1363 parity review. |
| `909c3d9e-bce1-4095-b52f-2e844a067b52` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:227` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `ab49d30c-30ed-4d90-b45e-c2028eafde4c` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:227` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `136c4689-e6b7-495c-9e0b-6fafc9916ec3` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:281` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `95255622-d1c6-41cb-a825-954515604585` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:281` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `8bd0d655-4f0d-478c-80bd-82465dadce58` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:311` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `dd93b9ec-d852-4889-b668-4c0eadd77a3f` | CRITICAL | `SwiftLint:cyclomatic_complexity` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:343` | Residual | Crypto/parser extraction needs signed-envelope fixture and DER/P1363 parity review. |
| `09ce44da-2d90-4333-8a9d-3864d9f65dd7` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:422` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `4725f287-221e-4618-84b8-53666609999d` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:422` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `80a71b28-e8c0-4918-904b-fadda80ac762` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:455` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `332e726a-6a10-4a7a-9b22-f98a91efe03c` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:456` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `1f9177a3-30bd-4ba4-a8b2-a2bac4bd2fd4` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:476` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `d97094cc-9534-4995-af17-c79bef9a7789` | MINOR | `SwiftLint:identifier_name` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:478` | Source-addressed | Internal identifier renamed; hosted rescan pending. |
| `13141b68-850a-4442-823d-590f3ae40f3e` | MAJOR | `SwiftLint:file_length` | `TogglyCore/Sources/Services/SignedDefsVerify.swift:545` | Residual | Crypto/parser extraction needs signed-envelope fixture and DER/P1363 parity review. |
| `1868dd71-cbd1-4c6a-967b-d343e8772473` | MAJOR | `SwiftLint:type_body_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:6` | Residual | Telemetry actor extraction needs packetization, retry, and attribution state-machine proof. |
| `ab73c88e-4ee0-42c3-98b4-0b9495569eb6` | MINOR | `SwiftLint:statement_position` | `TogglyCore/Sources/Services/TelemetryReporter.swift:18` | Source-addressed | Formatting changed; hosted rescan pending. |
| `6ca5b0b2-e8e1-4238-beb4-fb214e0bea47` | MINOR | `SwiftLint:statement_position` | `TogglyCore/Sources/Services/TelemetryReporter.swift:19` | Source-addressed | Formatting changed; hosted rescan pending. |
| `3fa2faef-7f22-4a57-8db6-0aa3523023da` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:75` | Source-addressed | Formatting changed; hosted rescan pending. |
| `c9de5baf-c31e-49bf-9423-2991ce5bdf37` | CRITICAL | `SwiftLint:cyclomatic_complexity` | `TogglyCore/Sources/Services/TelemetryReporter.swift:316` | Residual | Telemetry actor extraction needs packetization, retry, and attribution state-machine proof. |
| `569ab489-dd08-4bab-9740-7783a36b8978` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:317` | Source-addressed | Formatting changed; hosted rescan pending. |
| `7477bc7e-ee78-4075-8d04-784df5bb4a07` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:332` | Source-addressed | Formatting changed; hosted rescan pending. |
| `ca422b08-b6bc-4c94-9c6d-b3a58169e57f` | MINOR | `SwiftLint:statement_position` | `TogglyCore/Sources/Services/TelemetryReporter.swift:334` | Source-addressed | Formatting changed; hosted rescan pending. |
| `184b6726-39ff-48d0-9524-4175a7899d3c` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:335` | Source-addressed | Formatting changed; hosted rescan pending. |
| `eb1954fa-9989-4642-9b61-77dc8dd53520` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:339` | Source-addressed | Formatting changed; hosted rescan pending. |
| `7d78c0c6-1e20-44e9-8e1c-1f044a716b62` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:340` | Source-addressed | Formatting changed; hosted rescan pending. |
| `736bac07-1893-4384-865c-b7a1205ea164` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:341` | Source-addressed | Formatting changed; hosted rescan pending. |
| `dbdae325-6ac6-4f01-bb2d-88816e9597bb` | CRITICAL | `SwiftLint:cyclomatic_complexity` | `TogglyCore/Sources/Services/TelemetryReporter.swift:448` | Residual | Telemetry actor extraction needs packetization, retry, and attribution state-machine proof. |
| `1a9e27bd-a501-48e7-a18b-944036c66370` | CRITICAL | `SwiftLint:cyclomatic_complexity` | `TogglyCore/Sources/Services/TelemetryReporter.swift:496` | Residual | Telemetry actor extraction needs packetization, retry, and attribution state-machine proof. |
| `2e479749-d44e-4ac8-bedf-beef6dd44ec1` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:503` | Source-addressed | Formatting changed; hosted rescan pending. |
| `4046e70f-35b8-4825-9563-04a2449be926` | MINOR | `SwiftLint:statement_position` | `TogglyCore/Sources/Services/TelemetryReporter.swift:534` | Source-addressed | Formatting changed; hosted rescan pending. |
| `9370b93d-1e0d-4bb7-9227-dd8b326e1601` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:534` | Source-addressed | Formatting changed; hosted rescan pending. |
| `66f3a370-de26-4043-93bd-2304078fb841` | MINOR | `SwiftLint:statement_position` | `TogglyCore/Sources/Services/TelemetryReporter.swift:540` | Source-addressed | Formatting changed; hosted rescan pending. |
| `9af7436b-6c58-4564-b229-ec93259d3d1a` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:540` | Source-addressed | Formatting changed; hosted rescan pending. |
| `20f26e98-64e8-4237-96b1-74db2e28433c` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:548` | Source-addressed | Formatting changed; hosted rescan pending. |
| `85bd1ec3-3b3b-46e4-a027-29b2e241f943` | MINOR | `SwiftLint:large_tuple` | `TogglyCore/Sources/Services/TelemetryReporter.swift:548` | Residual | Private packetization result shape is shared by callers; extraction needs packetization contract tests. |
| `c34c4693-dd91-4832-aa20-31d7a6746b36` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:562` | Source-addressed | Formatting changed; hosted rescan pending. |
| `cc2d83f0-cbac-4206-b9a5-386b574e6a4e` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:570` | Source-addressed | Formatting changed; hosted rescan pending. |
| `2ec782ac-3beb-47d7-9b05-2b19821f59c0` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:578` | Source-addressed | Formatting changed; hosted rescan pending. |
| `f8891ceb-e67f-4825-91a3-28b0e792cb12` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:588` | Source-addressed | Formatting changed; hosted rescan pending. |
| `29ba6fe8-a54b-41ad-8313-d4d7de567a07` | CRITICAL | `SwiftLint:cyclomatic_complexity` | `TogglyCore/Sources/Services/TelemetryReporter.swift:611` | Residual | Telemetry actor extraction needs packetization, retry, and attribution state-machine proof. |
| `f62f6139-6ddb-49ef-abbb-b5936673e615` | MAJOR | `SwiftLint:function_body_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:611` | Residual | Telemetry actor extraction needs packetization, retry, and attribution state-machine proof. |
| `a07eacb4-8530-4762-99b5-5eaf98c71167` | MAJOR | `SwiftLint:file_length` | `TogglyCore/Sources/Services/TelemetryReporter.swift:707` | Residual | Telemetry actor extraction needs packetization, retry, and attribution state-machine proof. |
| `bd530f6a-4e9e-4d06-9858-d529b0cbb5e9` | MAJOR | `SwiftLint:type_body_length` | `TogglyCore/Sources/Services/TogglyService.swift:6` | Residual | Service extraction needs cache, identity, and concurrent-generation behavior proof. |
| `93a86a7d-4f0c-4ba6-a666-fd7f28783a0d` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TogglyService.swift:95` | Source-addressed | Formatting changed; hosted rescan pending. |
| `6548674e-7dc5-4c03-ba15-107905bb38a8` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TogglyService.swift:336` | Source-addressed | Formatting changed; hosted rescan pending. |
| `15a87fd2-12c6-4c69-bdcd-1801486773dd` | CRITICAL | `SwiftLint:cyclomatic_complexity` | `TogglyCore/Sources/Services/TogglyService.swift:592` | Residual | Service extraction needs cache, identity, and concurrent-generation behavior proof. |
| `f6613817-8305-407c-b9cc-f5c1b6841f36` | MAJOR | `SwiftLint:function_body_length` | `TogglyCore/Sources/Services/TogglyService.swift:592` | Residual | Service extraction needs cache, identity, and concurrent-generation behavior proof. |
| `a2bad11b-511b-46d6-b561-ae0dec45e239` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TogglyService.swift:641` | Source-addressed | Formatting changed; hosted rescan pending. |
| `70bd6a01-9a3d-4c88-83e5-fd3b5233ac58` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TogglyService.swift:678` | Source-addressed | Formatting changed; hosted rescan pending. |
| `efe0039f-3751-451a-8728-68dd48f90b83` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TogglyService.swift:705` | Source-addressed | Formatting changed; hosted rescan pending. |
| `f964b084-f6d5-4100-aafc-db97a3b63dd5` | MAJOR | `SwiftLint:force_try` | `TogglyCore/Sources/Services/TogglyService.swift:705` | Residual | Cache identity encoding is non-throwing for string arrays in practice; replacing the trap needs a collision-safe failure contract and cache tests. |
| `99f1b033-2956-472b-bdf2-616d9e510cba` | MAJOR | `SwiftLint:force_try` | `TogglyCore/Sources/Services/TogglyService.swift:709` | Residual | Cache identity encoding is non-throwing for string arrays in practice; replacing the trap needs a collision-safe failure contract and cache tests. |
| `1d3d9fd0-4d95-4e8c-81a0-0e286e5139fc` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TogglyService.swift:719` | Source-addressed | Formatting changed; hosted rescan pending. |
| `b7044e7d-1ff9-43a0-afdf-179664ab026b` | MAJOR | `SwiftLint:function_body_length` | `TogglyCore/Sources/Services/TogglyService.swift:724` | Residual | Service extraction needs cache, identity, and concurrent-generation behavior proof. |
| `3932917e-4e8f-4a02-9445-c849b2ecf7f7` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TogglyService.swift:917` | Source-addressed | Formatting changed; hosted rescan pending. |
| `1960d9a6-bfac-4979-9c5e-3407bacefd80` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TogglyService.swift:928` | Source-addressed | Formatting changed; hosted rescan pending. |
| `b62ab62e-c537-4fe2-b36a-98941a618b8a` | MAJOR | `SwiftLint:line_length` | `TogglyCore/Sources/Services/TogglyService.swift:948` | Source-addressed | Formatting changed; hosted rescan pending. |
| `a53a815f-4e3d-4605-8df5-409a5d1a519a` | MAJOR | `SwiftLint:file_length` | `TogglyCore/Sources/Services/TogglyService.swift:1370` | Residual | Service extraction needs cache, identity, and concurrent-generation behavior proof. |
| `ea27159b-883e-40d1-8540-00654e84afab` | MAJOR | `SwiftLint:line_length` | `TogglyUIKit/Sources/UIViewExtensions.swift:30` | Source-addressed | Formatting changed; hosted rescan pending. |
| `70c2789f-ac63-4862-8eeb-7a791649c749` | MAJOR | `SwiftLint:line_length` | `TogglyUIKit/Sources/UIViewExtensions.swift:35` | Source-addressed | Formatting changed; hosted rescan pending. |
| `9cd0588d-9d61-4cd1-afc9-4f9bf8594a58` | MAJOR | `SwiftLint:line_length` | `TogglyUIKit/Sources/UIViewExtensions.swift:40` | Source-addressed | Formatting changed; hosted rescan pending. |
