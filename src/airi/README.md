# airi capabilities merged into amica

Framework-agnostic TypeScript ported from apps/airi (MIT, https://github.com/moeru-ai/airi) so $NPC
gains airi's capabilities without a Vue→React rewrite. Each is copied in and made self-contained.

| dir | from airi package | what | verified |
|---|---|---|---|
| `../utils/airiQueue.ts` | stream-kit | async processing queue | wired into the game wake pipeline |
| `motion/` | motion-driver-magic | AR-HMM/VAR procedural VRM motion | model test 3/3 |
| `gamepad/` | input-gamepad | Standard Gamepad input | tests 5/5 |
| `dualsense/` | input-playstation-dualsense-5 | DualSense 5 HID input | tests 9/9 |
| `i18n/` | i18n | locale message catalog (zh/ja/ko/ru/vi/fr/es/…) | data |
| `plugin-protocol/` | plugin-protocol | the VTuber-control event contract (72 typed events) | loads, 72 descriptors |

See ../../../../AIRI-MERGE.md for the full strategy and remaining catalog.
