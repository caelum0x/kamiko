# airi, merged into amica

The framework-agnostic TypeScript of apps/airi (MIT, https://github.com/moeru-ai/airi), copied here
so $NPC gains airi's capabilities on the amica (React) foundation. Each package's `@proj-airi/*`
imports are repointed at the sibling merged copy; third-party deps are declared in
apps/vtuber-amica/package.json at airi's catalog versions.

Load-verified under bun: stream-kit (../utils/airiQueue.ts, wired into the game), motion/, gamepad/,
dualsense/, i18n/, plugin-protocol/ (72 events), server-shared/, live2d/ (tests 11/11), fonts/.

Copied + deps declared, build after `npm install`: plugin-sdk/, plugin-sdk-tamagotchi/, server-sdk/,
server-runtime/, better-ws/, pipelines-audio/, lipsync/, mediapipe/, ccc/, core-agent/,
memory-pgvector/.

NOT here (can't be): the Vue UI apps (Vue can't run in React) and pure build/test tooling.
See ../../../../AIRI-MERGE.md. Build: `cd apps/vtuber-amica && npm install && npm run build`.
