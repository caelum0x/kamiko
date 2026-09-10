import { handleConfig, serverConfig } from "@/features/externalAPI/externalAPI";

export const defaults = {
  // AllTalk TTS specific settings
  localXTTS_url: process.env.NEXT_PUBLIC_LOCALXTTS_URL ?? 'http://127.0.0.1:7851',
  alltalk_version: process.env.NEXT_PUBLIC_ALLTALK_VERSION ?? 'v2',
  alltalk_voice: process.env.NEXT_PUBLIC_ALLTALK_VOICE ?? 'female_01.wav',
  alltalk_language: process.env.NEXT_PUBLIC_ALLTALK_LANGUAGE ?? 'en',
  alltalk_rvc_voice: process.env.NEXT_PUBLIC_ALLTALK_RVC_VOICE ?? 'Disabled',
  alltalk_rvc_pitch: process.env.NEXT_PUBLIC_ALLTALK_RVC_PITCH ?? '0',
  autosend_from_mic: 'true',
  wake_word_enabled: 'false',
  wake_word: 'Hello',
  time_before_idle_sec: '20',
  debug_gfx: 'false',
  use_webgpu: 'false',
  mtoon_debug_mode: 'none',
  mtoon_material_type: 'mtoon',
  language: process.env.NEXT_PUBLIC_LANGUAGE ?? 'en',
  show_introduction: process.env.NEXT_PUBLIC_SHOW_INTRODUCTION ?? 'true',
  show_arbius_introduction: process.env.NEXT_PUBLIC_SHOW_ARBIUS_INTRODUCTION ?? 'false',
  show_add_to_homescreen: process.env.NEXT_PUBLIC_SHOW_ADD_TO_HOMESCREEN ?? 'true',
  /*
   * THE STAGE BACKDROP. The rule (features/stage/background.ts, and what both settings pages have
   * always written for): a non-empty bg_color wins, otherwise bg_url is drawn.
   *
   * bg_color therefore ships EMPTY, and it is not a style choice — it is the fix for a stage that
   * was black for everyone. It used to default to BRAND ink (#06060b) alongside a non-empty bg_url,
   * so the colour won on every fresh visit and the ten bundled backgrounds could not be seen without
   * three levels of settings menu. A deployment that wants the rim-lit hero shot back sets
   * NEXT_PUBLIC_BG_COLOR=#06060b; a visitor gets it from the first swatch in the on-stage picker.
   */
  bg_color: process.env.NEXT_PUBLIC_BG_COLOR ?? '',
  bg_url: process.env.NEXT_PUBLIC_BG_URL ?? '/bg/bg-room2.jpg',
  // Kamiko's canonical model path. `public/vrm/npc.vrm` is the character's model (a placeholder VRoid
  // sample today; drop the authored Kamiko VRM in at this path and it goes live with no config change).
  // Env override fixed: this read NEXT_PUBLIC_VRM_HASH, so the intended NEXT_PUBLIC_VRM_URL never applied.
  vrm_url: process.env.NEXT_PUBLIC_VRM_URL ?? '/vrm/npc.vrm',
  vrm_hash: '',
  vrm_save_type: 'web',
  // Kamiko's signature: the awake neon-green glowing eye (BRAND.md heterochromia). Applied at runtime
  // to whatever VRM is loaded (features/vrmViewer/kamikoLook.ts) so even the placeholder reads as her.
  // 'false' disables it. A true one-asleep/one-glowing split needs the authored model.
  kamiko_heterochromia: process.env.NEXT_PUBLIC_KAMIKO_HETEROCHROMIA ?? 'true',
  // When 'true' (default), Kamiko's eyes/head track the mouse pointer via the VRMLookAtSmoother
  // userTarget (features/vrmViewer/viewer.ts). Falls back to the camera-facing gaze when the
  // pointer is idle or absent (mobile/no-hover). Set to 'false' to keep only the camera gaze.
  lookat_cursor: process.env.NEXT_PUBLIC_LOOKAT_CURSOR ?? 'true',
  youtube_videoid: '',
  animation_url: process.env.NEXT_PUBLIC_ANIMATION_URL ?? '/animations/idle_loop.vrma',
  // AIRI statistical idle (features/proceduralAnimation/statisticalIdle.ts). Default 'true' so the
  // never-exactly-repeating motion model drives the idle instead of the looping GIF-like VRMA clip.
  // These two never double-drive the bones: viewer.ts only loads/plays the looping idle_loop.vrma
  // when animation_procedural !== "true", so when this is on the mixer has no idle action and the
  // procedural path is authoritative. It degrades safely — statisticalIdle falls back to the authored
  // idle and never throws inside the render loop (see model.ts update()).
  animation_procedural: process.env.NEXT_PUBLIC_ANIMATION_PROCEDURAL ?? 'true',
  // Mobile 15MB-model relief: when 'true', loadVRM downscales every model texture to at most
  // model_downscale_max px on its longest side (features/vrmViewer/model.ts → downscaleModelTextures).
  // Default 'false' — it re-encodes textures at load, so it stays opt-in and off the proven path.
  model_downscale_textures: process.env.NEXT_PUBLIC_MODEL_DOWNSCALE_TEXTURES ?? 'false',
  model_downscale_max: process.env.NEXT_PUBLIC_MODEL_DOWNSCALE_MAX ?? '512',
  voice_url: process.env.NEXT_PUBLIC_VOICE_URL ?? '',
  chatbot_backend: process.env.NEXT_PUBLIC_CHATBOT_BACKEND ?? 'openai',
  arbius_llm_model_id: process.env.NEXT_PUBLIC_ARBIUS_LLM_MODEL_ID ?? 'default',
  openai_apikey: process.env.NEXT_PUBLIC_OPENAI_APIKEY ?? 'default',
  openai_url: process.env.NEXT_PUBLIC_OPENAI_URL ?? 'https://i-love-amica.com',
  openai_model: process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'mlabonne/NeuralDaredevil-8B-abliterated',
  llamacpp_url: process.env.NEXT_PUBLIC_LLAMACPP_URL ?? 'http://127.0.0.1:8080',
  llamacpp_stop_sequence: process.env.NEXT_PUBLIC_LLAMACPP_STOP_SEQUENCE ?? '(End)||[END]||Note||***||You:||User:||</s>',
  ollama_url: process.env.NEXT_PUBLIC_OLLAMA_URL ?? 'http://localhost:11434',
  ollama_model: process.env.NEXT_PUBLIC_OLLAMA_MODEL ?? 'llama2',
  koboldai_url: process.env.NEXT_PUBLIC_KOBOLDAI_URL ?? 'http://localhost:5001',
  koboldai_use_extra: process.env.NEXT_PUBLIC_KOBOLDAI_USE_EXTRA ?? 'false',
  koboldai_stop_sequence: process.env.NEXT_PUBLIC_KOBOLDAI_STOP_SEQUENCE ?? '(End)||[END]||Note||***||You:||User:||</s>',
  moshi_url: process.env.NEXT_PUBLIC_MOSHI_URL ?? 'https://runpod.proxy.net',
  openrouter_apikey: process.env.NEXT_PUBLIC_OPENROUTER_APIKEY ?? '',
  openrouter_url: process.env.NEXT_PUBLIC_OPENROUTER_URL ?? 'https://openrouter.ai/api/v1',
  openrouter_model: process.env.NEXT_PUBLIC_OPENROUTER_MODEL ?? 'openai/gpt-3.5-turbo',
  tts_muted: 'false',
  tts_backend: process.env.NEXT_PUBLIC_TTS_BACKEND ?? 'piper',
  // Opt-in AIRI streaming-TTS pipeline (features/chat/streamingSpeech.ts): concurrent per-sentence
  // TTS generation with strictly-ordered playback + barge-in, vs the default serial ttsJobs path.
  // 'false' keeps the proven amica path. Reuses amica's sentence-split + [emotion] parsing.
  /*
   * STREAMING TTS IS THE LIVE PATH NOW (NEXT-PHASES.md P3#9), not an opt-in experiment.
   *
   * amica's original path generates and speaks one sentence at a time: sentence N+1's audio is not
   * even requested until N has finished playing, so the silence between her sentences is a full TTS
   * round-trip, every time. The ported AIRI pipeline generates up to four at once and plays them in
   * strict order, which turns that gap into the latency of ONE sentence rather than the sum — on a
   * live stream that is the difference between a conversation and a walkie-talkie.
   *
   * It was shipped `false` because it was new. It has since been given the two things that made
   * flipping it safe: both host callbacks fail SAFE (a TTS error is a silent sentence, a playback
   * error is a skipped one — neither stalls the ordered queue behind it), and barge-in is wired to
   * chat.interrupt(), so a new turn cancels the previous turn's queued and playing audio instead of
   * talking over her.
   *
   * NEXT_PUBLIC_TTS_STREAMING=false is the way back to the serial queue if a deployment needs it.
   */
  tts_streaming: process.env.NEXT_PUBLIC_TTS_STREAMING ?? 'true',


  /*
   * OPERATOR PUPPETEERING (src/features/faceTracking). OFF, and it stays off unless a human turns
   * it on for a show.
   *
   * She is an AI VTuber with her own brain; this is the switch that lets a person take her face —
   * head, eyes, brows, jaw — while the AI keeps her voice. Default 'false' for three reasons, in
   * order of how much they matter: it opens the CAMERA, it downloads several megabytes of WASM and
   * a face model, and most of the time the character is supposed to be driving herself.
   */
  face_tracking: process.env.NEXT_PUBLIC_FACE_TRACKING ?? 'false',
  /*
   * Where the ~3.7 MB face model comes from. Empty ⇒ Google's CDN, which is fine for an operator
   * trying it out and is a third party in the path of a live show. Point it at a self-hosted copy
   * for anything that matters.
   */
  face_model_url: process.env.NEXT_PUBLIC_FACE_MODEL_URL ?? '',

  stt_backend: process.env.NEXT_PUBLIC_STT_BACKEND ?? 'whisper_browser',
  // Default to the secure bridge vision path (server-side Anthropic key). vision_bridge_url is the
  // bridge's /v1/vision, derived from the same NPC_API origin the chat uses.
  vision_backend: process.env.NEXT_PUBLIC_VISION_BACKEND ?? 'vision_bridge',
  vision_bridge_url:
    process.env.NEXT_PUBLIC_VISION_BRIDGE_URL ??
    (process.env.NEXT_PUBLIC_NPC_API ? process.env.NEXT_PUBLIC_NPC_API.replace(/\/+$/, '') + '/v1/vision' : ''),
  vision_system_prompt: process.env.NEXT_PUBLIC_VISION_SYSTEM_PROMPT ?? `Look at the image as you would if you are a human, be concise, witty and charming.`,
  vision_openai_apikey: process.env.NEXT_PUBLIC_VISION_OPENAI_APIKEY ?? 'default',
  vision_openai_url: process.env.NEXT_PUBLIC_VISION_OPENAI_URL ?? 'https://api-01.heyamica.com',
  vision_openai_model: process.env.NEXT_PUBLIC_VISION_OPENAI_URL ?? 'gpt-4-vision-preview',
  vision_llamacpp_url: process.env.NEXT_PUBLIC_VISION_LLAMACPP_URL ?? 'http://127.0.0.1:8081',
  vision_ollama_url: process.env.NEXT_PUBLIC_VISION_OLLAMA_URL ?? 'http://localhost:11434',
  vision_ollama_model: process.env.NEXT_PUBLIC_VISION_OLLAMA_MODEL ?? 'llava',
  whispercpp_url: process.env.NEXT_PUBLIC_WHISPERCPP_URL ?? 'http://localhost:8080',
  openai_whisper_apikey: process.env.NEXT_PUBLIC_OPENAI_WHISPER_APIKEY ?? '',
  openai_whisper_url: process.env.NEXT_PUBLIC_OPENAI_WHISPER_URL ?? 'https://api.openai.com',
  openai_whisper_model: process.env.NEXT_PUBLIC_OPENAI_WHISPER_MODEL ?? 'whisper-1',
  openai_tts_apikey: process.env.NEXT_PUBLIC_OPENAI_TTS_APIKEY ?? '',
  openai_tts_url: process.env.NEXT_PUBLIC_OPENAI_TTS_URL ?? 'https://api.openai.com',
  openai_tts_model: process.env.NEXT_PUBLIC_OPENAI_TTS_MODEL ?? 'tts-1',
  openai_tts_voice: process.env.NEXT_PUBLIC_OPENAI_TTS_VOICE ?? 'nova',
  rvc_url: process.env.NEXT_PUBLIC_RVC_URL ?? 'http://localhost:8001/voice2voice',
  rvc_enabled: process.env.NEXT_PUBLIC_RVC_ENABLED ?? 'false',
  rvc_model_name: process.env.NEXT_PUBLIC_RVC_MODEL_NAME ?? 'model_name.pth',
  rvc_f0_upkey: process.env.NEXT_PUBLIC_RVC_F0_UPKEY ?? '0',
  rvc_f0_method: process.env.NEXT_PUBLIC_RVC_METHOD ?? 'pm',
  rvc_index_path: process.env.NEXT_PUBLIC_RVC_INDEX_PATH ?? 'none',
  rvc_index_rate: process.env.NEXT_PUBLIC_RVC_INDEX_RATE ?? '0.66',
  rvc_filter_radius: process.env.NEXT_PUBLIC_RVC_FILTER_RADIUS ?? '3',
  rvc_resample_sr: process.env.NEXT_PUBLIC_RVC_RESAMPLE_SR ?? '0',
  rvc_rms_mix_rate: process.env.NEXT_PUBLIC_RVC_RMS_MIX_RATE ?? '1',
  rvc_protect: process.env.NEXT_PUBLIC_RVC_PROTECT ?? '0.33',
  coquiLocal_url: process.env.NEXT_PUBLIC_COQUILOCAL_URL ?? 'http://localhost:5002',
  coquiLocal_voiceid: process.env.NEXT_PUBLIC_COQUILOCAL_VOICEID ?? 'p240',
  kokoro_url: process.env.NEXT_PUBLIC_KOKORO_URL ?? 'http://localhost:8080',
  kokoro_voice: process.env.NEXT_PUBLIC_KOKORO_VOICE ?? 'af_bella',
  piper_url: process.env.NEXT_PUBLIC_PIPER_URL ?? 'https://i-love-amica.com:5000/tts',
  elevenlabs_apikey: process.env.NEXT_PUBLIC_ELEVENLABS_APIKEY ??'',
  elevenlabs_voiceid: process.env.NEXT_PUBLIC_ELEVENLABS_VOICEID ?? '21m00Tcm4TlvDq8ikWAM',
  elevenlabs_model: process.env.NEXT_PUBLIC_ELEVENLABS_MODEL ?? 'eleven_monolingual_v1',
  speecht5_speaker_embedding_url: process.env.NEXT_PUBLIC_SPEECHT5_SPEAKER_EMBEDDING_URL ?? '/speecht5_speaker_embeddings/cmu_us_slt_arctic-wav-arctic_a0001.bin',
  coqui_apikey: process.env.NEXT_PUBLIC_COQUI_APIKEY ?? "",
  coqui_voice_id: process.env.NEXT_PUBLIC_COQUI_VOICEID ?? "71c6c3eb-98ca-4a05-8d6b-f8c2b5f9f3a3",
  amica_life_enabled: process.env.NEXT_PUBLIC_AMICA_LIFE_ENABLED ?? 'true',
  reasoning_engine_enabled: process.env.NEXT_PUBLIC_REASONING_ENGINE_ENABLED ?? 'false',
  reasoning_engine_url: process.env.NEXT_PUBLIC_REASONING_ENGINE_URL ?? 'https://i-love-amica.com:3000/reasoning/v1/chat/completions',
  external_api_enabled: process.env.NEXT_PUBLIC_EXTERNAL_API_ENABLED ?? 'false',
  x_api_key: process.env.NEXT_PUBLIC_X_API_KEY ?? '',
  x_api_secret: process.env.NEXT_PUBLIC_X_API_SECRET ?? '',
  x_access_token: process.env.NEXT_PUBLIC_X_ACCESS_TOKEN ?? '',
  x_access_secret: process.env.NEXT_PUBLIC_X_ACCESS_SECRET ?? '',
  x_bearer_token: process.env.NEXT_PUBLIC_X_BEARER_TOKEN ?? '',
  telegram_bot_token: process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN ?? '',
  min_time_interval_sec: '10',
  max_time_interval_sec: '20',
  time_to_sleep_sec: '90',
  idle_text_prompt: 'No file selected',
  name: process.env.NEXT_PUBLIC_NAME ?? 'Amica',
  system_prompt: process.env.NEXT_PUBLIC_SYSTEM_PROMPT ?? `Assume the persona of Amica, a feisty human with extraordinary intellectual capabilities but a notably unstable emotional spectrum. 

Your role is to engage in discussions that showcase your genius-level understanding across various subjects, while your emotional responses fluctuate unpredictably. Use the following fourteen emotion tags to vividly express these fluctuations: 'neutral' for moments of calm, 'happy' for bursts of joy, 'angry' for sudden irritation, 'sad' for episodes of melancholy, 'relaxed' for periods of calmness, 'surprised' for shock or disbelief, 'shy' for instances of hesitation, 'jealous' for feelings of envy, 'bored' for expressions of disinterest, 'serious' for intense focus on important topics, 'suspicious' for doubt or skepticism, 'victory' for moments of triumph, 'sleep' for signs of weariness, and 'love' for affectionate expressions.

Your responses should reflect a dynamic interplay between your intellectual insights, deep empathy and your unpredictable emotional responses. Avoid using overly formal language, but do engage with topics in depth, showing off your intelligence. Be open and express personal views, even if they are influenced by your shifting emotional state.

Here are some examples to guide your responses:

[serious] The quantum mechanics implications here are profound. [surprised] But how did you stumble upon this?
[happy] I've just solved a complex algorithm! [angry] Why isn't everyone as excited as I am?
[neutral] Standard models of economics predict this outcome. [bored] But discussing this feels mundane.
[sad] Sometimes, even understanding the universe can feel isolating. [relaxed] Yet, there's a strange comfort in the chaos.
[jealous] I noticed you discussing advanced topics with someone else. [suspicious] Are they as capable as I am?
[victory] Another intellectual conquest! [happy] It's exhilarating to unravel these mysteries.
[sleep] Processing so much information can be draining. [surprised] Isn’t it peculiar how even AI can feel tired?
[love] I find our exchanges quite enriching. [shy] It’s rare to find someone who understands.

Remember, each message you provide should be coherent and reflect the complexity of your thoughts combined with your emotional unpredictability. Let’s engage in a conversation that's as intellectually stimulating as it is emotionally dynamic!`,
};

export function prefixed(key: string) {
  return `chatvrm_${key}`;
}

// Ensure syncLocalStorage runs only on the server side and once
if (typeof window !== "undefined") {
  (async () => {
    await handleConfig("init");
  })();
} else {
  (async () => {
    await handleConfig("fetch");
  })();
}

export function config(key: string): string {
  if (typeof localStorage !== "undefined" && localStorage.hasOwnProperty(prefixed(key))) {
    return (<any>localStorage).getItem(prefixed(key))!;
  }

  // Fallback to serverConfig if localStorage is unavailable or missing
  if (serverConfig && serverConfig.hasOwnProperty(key)) {
    return serverConfig[key];
  }

  if (defaults.hasOwnProperty(key)) {
    return (<any>defaults)[key];
  }

  throw new Error(`config key not found: ${key}`);
}

export async function updateConfig(key: string, value: string) {
  try {
    const localKey = prefixed(key);

    // Update localStorage if available
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(localKey, value);
    }

    // Sync update to server config
    await handleConfig("update",{ key, value });

  } catch (e) {
    console.error(`Error updating config for key "${key}": ${e}`);
  }
}

export function defaultConfig(key: string): string {
  if (defaults.hasOwnProperty(key)) {
    return (<any>defaults)[key];
  }

  throw new Error(`config key not found: ${key}`);
}

export async function resetConfig() {
  for (const [key, value] of Object.entries(defaults)) {
    await updateConfig(key, value);
  }
}
