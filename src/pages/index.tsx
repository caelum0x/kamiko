import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/router";
import { Menu, Transition } from '@headlessui/react'
import { clsx } from "clsx";
import { M_PLUS_2, Montserrat } from "next/font/google";
import { useTranslation, Trans } from 'react-i18next';
import {
  ChatBubbleLeftIcon,
  ChatBubbleLeftRightIcon,
  CloudArrowDownIcon,
  LanguageIcon,
  ShareIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  Squares2X2Icon,
  SquaresPlusIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon,
  WrenchScrewdriverIcon,
  AcademicCapIcon,
  CursorArrowRaysIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { MenuButton } from "@/components/menuButton";
import { AssistantText } from "@/components/assistantText";
import { AddToHomescreen } from "@/components/addToHomescreen";
import { Alert } from "@/components/alert";
import { UserText } from "@/components/userText";
import { ChatLog } from "@/components/chatLog";
import VrmViewer from "@/components/vrmViewer";
import { MessageInputContainer } from "@/components/messageInputContainer";
import { Introduction } from "@/components/introduction";
import { ArbiusIntroduction } from "@/components/arbiusIntroduction";
import { LoadingProgress } from "@/components/loadingProgress";
import { Settings } from "@/components/settings";
import { EmbeddedWebcam } from "@/components/embeddedWebcam";
import { Moshi } from "@/features/moshi/components/Moshi";

import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { Message, Role } from "@/features/chat/messages";
import { ChatContext } from "@/features/chat/chatContext";
import { textsToScreenplay } from "@/features/chat/messages";
import { TapToWake, MarketHud } from "@/components/tapToWake";
import { AlertContext } from "@/features/alert/alertContext";

import { config, updateConfig } from '@/utils/config';
import { isTauri } from '@/utils/isTauri';
import { readDevMode } from '@/utils/devMode';
import { langs } from '@/i18n/langs';
import { VrmStoreProvider } from "@/features/vrmStore/vrmStoreContext";
import { AmicaLifeContext } from "@/features/amicaLife/amicaLifeContext";
import { ChatModeText } from "@/components/chatModeText";

import { TimestampedPrompt } from "@/features/amicaLife/eventHandler";
import { handleChatLogs } from "@/features/externalAPI/externalAPI";
import { VerticalSwitchBox } from "@/components/switchBox";
import { ThoughtText } from "@/components/thoughtText";

const m_plus_2 = M_PLUS_2({
  variable: "--font-m-plus-2",
  display: "swap",
  preload: false,
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  display: "swap",
  subsets: ["latin"],
});

function detectVRHeadset() {
  const userAgent = navigator.userAgent.toLowerCase();

  // Meta Quest detection
  // Quest 2 and 3 both use "oculus" in their user agent
  const isQuest = userAgent.includes('oculus') ||
                  userAgent.includes('quest 2') ||
                  userAgent.includes('quest 3');

  // Vision Pro detection
  // visionOS is the specific identifier for Apple Vision Pro
  const isVisionPro = userAgent.includes('visionos') ||
                      userAgent.includes('xros');

  // Detailed device information
  let deviceInfo = {
    isVRDevice: isQuest || isVisionPro,
    deviceType: '',
    browserInfo: userAgent
  };

  if (isQuest) {
    deviceInfo.deviceType = 'quest-3';
    if (userAgent.includes('quest 3')) {
      deviceInfo.deviceType = 'quest-3';
    } else if (userAgent.includes('quest 2')) {
      deviceInfo.deviceType = 'quest-2';
    }
  } else if (isVisionPro) {
    deviceInfo.deviceType = 'vision-pro';
  }

  return deviceInfo;
}


export default function Home() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const currLang = i18n.resolvedLanguage;
  const { viewer } = useContext(ViewerContext);
  const { alert } = useContext(AlertContext);
  const { chat: bot } = useContext(ChatContext);


  const { amicaLife: amicaLife } = useContext(AmicaLifeContext);

  const [chatSpeaking, setChatSpeaking] = useState(false);

  /**
   * SAY A LINE AS HER, not as page text.
   *
   * This is the whole reason the clicker moved onto this screen. `/game` answered a tap by calling
   * setLine() with a string from a local pool — no voice, no expression, and no avatar on the page
   * to wear one. Here the line goes through the SAME path a chat reply takes:
   *   textsToScreenplay parses the `[emotion]` tag the bridge injects and produces the talk style;
   *   ttsJobs carries it to fetchAudio, then speakJobs to viewer.model.speak, which is what moves
   *   her face and mouth.
   *
   * `currentStreamIdx` is passed rather than a fresh number because chat.interrupt() bumps it to
   * abandon in-flight speech — reusing it means a tap line is dropped by the same interrupt that
   * drops a chat reply, instead of talking over her.
   */
  const speakAsHer = useCallback(async (line: string) => {
    const text = String(line ?? "").trim();
    if (!text) return;
    // Never talk over a chat reply. The tap line is an aside, not a turn.
    if (chatSpeaking) return;
    try {
      const [screenplay] = textsToScreenplay([text]);
      if (!screenplay) return;
      /*
       * SPOKEN DIRECTLY, DELIBERATELY BYPASSING chat.ttsJobs.
       *
       * The obvious wiring — enqueue onto ttsJobs — was wrong, and quietly. That queue ends in
       * processSpeakJobs, which calls bubbleMessage("assistant", …) for every job. bubbleMessage
       * APPENDS (`currentAssistantMessage += text`) and the result is pushed onto `messageList`,
       * and `messageList` is spliced into the prompt on the next user turn
       * (receiveMessageFromUser: [system, ...messageList, user]).
       *
       * So routing tap lines through the queue put them in her CONVERSATION MEMORY: a greeting the
       * player never said anything to earn, glued onto whatever she last replied, sent to the model
       * as prior context on every subsequent turn. A clicker milestone is not something she said to
       * you, and it must not become something the model believes she said.
       *
       * fetchAudio + model.speak is the same pair processSpeakJobs uses, minus the logging.
       */
      const audio = await bot.fetchAudio(screenplay.talk);
      if (audio) {
        await bot.viewer?.model?.speak(audio, screenplay);
      } else {
        // No TTS configured, or it failed: fetchAudio swallows both and returns null. She still
        // REACTS — playEmotion is what model.speak would have called — rather than doing nothing.
        bot.viewer?.model?.playEmotion(screenplay.expression);
      }
    } catch (e) {
      // A tap must never be able to take down the avatar screen. The panel still shows the line.
      console.error("tap-to-wake could not speak the line", e);
    }
  }, [bot, chatSpeaking]);
  const [chatProcessing, setChatProcessing] = useState(false);
  const [chatLog, setChatLog] = useState<Message[]>([]);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [thoughtMessage, setThoughtMessage] = useState("");
  const [shownMessage, setShownMessage] = useState<Role>("system");
  const [subconciousLogs, setSubconciousLogs] = useState<TimestampedPrompt[]>([]);

  // showContent exists to allow ssr
  // otherwise issues from usage of localStorage and window will occur
  const [showContent, setShowContent] = useState(false);
  /*
   * THE DEVELOPER TOOLS ARE OPT-IN (NEXT-PHASES.md P1#4).
   *
   * `/share` is amica's character creator and `/import` loads somebody else's character file —
   * both wonderful tools, and both an invitation to REPLACE Kamiko with a VRM of your own, one
   * click from the front of the shop. Nothing is deleted (the owner's instruction was "develop,
   * don't trim"): the routes still work for anyone who types them, and `?dev=1` puts the buttons
   * back. Read after mount for the same reason showContent exists — it depends on `window`, and a
   * server render that guessed would flicker a developer's menu at every visitor.
   */
  const [devMode, setDevMode] = useState(false);

  const [showArbiusIntroduction, setShowArbiusIntroduction] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChatLog, setShowChatLog] = useState(false);
  const [showChatMode, setShowChatMode] = useState(false);
  const [showMoshi, setShowMoshi] = useState(false);
  const [showTapToWake, setShowTapToWake] = useState(false);

  // null indicates havent loaded config yet
  const [muted, setMuted] = useState<boolean|null>(null);
  const [webcamEnabled, setWebcamEnabled] = useState(false);
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);

  const [isVRHeadset, setIsVRHeadset] = useState(false);


  useEffect(() => {
    amicaLife.checkSettingOff(!showSettings);
  }, [showSettings, amicaLife]);

  useEffect(() => {
    if (muted === null) {
      setMuted(config('tts_muted') === 'true');
    }

    setShowArbiusIntroduction(config("show_arbius_introduction") === 'true');

    if (config("bg_color") !== '') {
      document.body.style.backgroundColor = config("bg_color");
    } else {
      document.body.style.backgroundImage = `url(${config("bg_url")})`;
    }
    // Temp Disable : WebXR
    // if (window.navigator.xr && window.navigator.xr.isSessionSupported) {
    //   let deviceInfo = detectVRHeadset();
    //   setIsVRHeadset(deviceInfo.isVRDevice);

    //   window.navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
    //     console.log('ar supported', supported);
    //     setIsARSupported(supported);
    //   });
    //   window.navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    //     console.log('vr supported', supported);
    //     setIsVRSupported(supported);
    //   });
    // }
  }, []);

  function toggleTTSMute() {
    updateConfig('tts_muted', config('tts_muted') === 'true' ? 'false' : 'true')
    setMuted(config('tts_muted') === 'true')
  }

  const toggleState = (
    setFunc: React.Dispatch<React.SetStateAction<boolean>>, 
    deps: React.Dispatch<React.SetStateAction<boolean>>[],
  ) => {
    setFunc(prev => {
      if (!prev) {
        deps.forEach(dep => dep(false));
      } 
      return !prev;
    });
  };
  
  const toggleChatLog = () => {
    toggleState(setShowChatLog, [setShowChatMode]);
  };

  const toggleChatMode = () => {
    toggleState(setShowChatMode, [setShowChatLog]);
  };

  useEffect(() => {
    bot.initialize(
      amicaLife,
      viewer,
      alert,
      setChatLog,
      setUserMessage,
      setAssistantMessage,
      setThoughtMessage,
      setShownMessage,
      setChatProcessing,
      setChatSpeaking,
    );

    // TODO remove in future
    // this change was just to make naming cleaner
    if (config("tts_backend") === 'openai') {
      updateConfig("tts_backend", "openai_tts");
    }
  }, [bot, viewer]);

  useEffect(() => {
    amicaLife.initialize(
      viewer,
      bot,
      setSubconciousLogs,
      chatSpeaking,
    );
  }, [amicaLife, bot, viewer]);

  useEffect(() => {
    handleChatLogs(chatLog);
  }, [chatLog]);

  // this exists to prevent build errors with ssr
  useEffect(() => setShowContent(true), []);
  useEffect(() => setDevMode(readDevMode()), []);
  if (!showContent) return <></>;

  return (
    <div className={clsx(
      m_plus_2.variable,
      montserrat.variable,
    )}>
      { config("youtube_videoid") !== '' && (
        <div className="fixed video-container w-full h-full z-0">
          <iframe
            className="w-full h-full"
            src={`https://www.youtube.com/embed/${config("youtube_videoid")}?&autoplay=1&mute=1&playsinline=1&loop=1&controls=0&disablekb=1&fs=0&playlist=${config("youtube_videoid")}`}
            frameBorder="0"></iframe>
        </div>
      )}

      <Introduction open={config("show_introduction") === 'true'} />
      <ArbiusIntroduction open={showArbiusIntroduction} close={() => setShowArbiusIntroduction(false)} />

      <LoadingProgress />

      { webcamEnabled && <EmbeddedWebcam setWebcamEnabled={setWebcamEnabled} /> }
      { config("chatbot_backend") === "moshi" && <Moshi setAssistantText={setAssistantMessage}/>  }

      <VrmStoreProvider>
        <VrmViewer chatMode={showChatMode}/>
        {showSettings && (
          <Settings
            onClickClose={() => setShowSettings(false)}
          />
        )}
      </VrmStoreProvider>
      
      <MessageInputContainer isChatProcessing={chatProcessing} />

      {/*
        THE TWO-TICKER HUD, ON THE STAGE. She woke up inside NVIDIA and lives on NVDAX; this shows
        the tape she reacts to — the NVDAX quote she is paired against and her own $KAMIKO token.
        Pinned top-right so it clears the top-left menu and the bottom chat input at 390px, and it
        fails silently: a slow poll of the bridge's /market, last-good left standing on any failure.
      */}
      <MarketHud
        openLink={(url) => {
          try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* popup blocked */ }
        }}
      />

      {/* main menu */}
      <div className="absolute z-10 m-2">
        <div className="grid grid-flow-col gap-[8px] place-content-end mt-2 bg-slate-800/40 rounded-md backdrop-blur-md shadow-sm">
          <div className='flex flex-col justify-center items-center p-1 space-y-3'>
            <MenuButton
              large={isVRHeadset}
              icon={WrenchScrewdriverIcon}
              onClick={() => setShowSettings(true)}
              label="show settings"
            />

            {showChatLog ? (
              <MenuButton
                large={isVRHeadset}
                icon={ChatBubbleLeftIcon}
                onClick={toggleChatLog}
                label="hide chat log"
              />
            ) : (
              <MenuButton
                large={isVRHeadset}
                icon={ChatBubbleLeftRightIcon}
                onClick={toggleChatLog}
                label="show chat log"
              />
            )}

            { muted ? (
              <MenuButton
                large={isVRHeadset}
                icon={SpeakerXMarkIcon}
                onClick={toggleTTSMute}
                label="unmute"
              />
            ) : (
              <MenuButton
                large={isVRHeadset}
                icon={SpeakerWaveIcon}
                onClick={toggleTTSMute}
                label="mute"
              />
            )}

            { webcamEnabled ? (
              <MenuButton
                large={isVRHeadset}
                icon={VideoCameraIcon}
                onClick={() => setWebcamEnabled(false)}
                label="disable webcam"
              />
            ) : (
              <MenuButton
                large={isVRHeadset}
                icon={VideoCameraSlashIcon}
                onClick={() => setWebcamEnabled(true)}
                label="enable webcam"
              />
            )}

            {/*
              Creator tools, behind ?dev=1. See the devMode comment above for why these two in
              particular: they are the doors that swap the character out, and this stage is one
              character's. Both routes remain reachable by URL for anyone who wants them.
            */}
            {devMode && (
              <>
                <MenuButton
                  large={isVRHeadset}
                  icon={ShareIcon}
                  href="/share"
                  target={isTauri() ? '' : '_blank'}
                  label="character creator (dev)"
                />
                <MenuButton
                  large={isVRHeadset}
                  icon={CloudArrowDownIcon}
                  href="/import"
                  label="import a character (dev)"
                />
              </>
            )}

            {/*
              THE $NPC FUNNEL, REACHABLE FROM THE FRONT DOOR.
              `/` is the URL a visitor actually lands on, and until these three existed the clicker
              (retention), the holder dashboard (tips and perks — the revenue surface) and the trust
              page were direct-link-only orphans: /game and /holder linked back here, nothing linked
              forward. The trust page was the one that cost us — somebody who lands on `/` and wants
              to check the mint before buying had no path to the page that answers that.

              `router.push` rather than MenuButton's `href`, which is `window.open(href, target)`:
              window.open takes a raw URL and does NOT apply next.config.js's `basePath`, so on a
              BASE_PATH deployment every one of these would open a 404. The router applies it.
            */}
            {/*
              IT OPENS HERE NOW, instead of `router.push("/game")`.
              The game is called "tap to wake her" and /game renders no avatar and speaks with a
              local string pool, so the button built to drive retention navigated away from the one
              thing this product is. The panel mounts over the stage and her line is spoken by the
              real pipeline; /game stays exactly where it was for the full dashboard — leaderboard,
              quests, the CTA, the wallet handshake — which does not belong on top of the stage.
            */}
            <MenuButton
              large={isVRHeadset}
              icon={CursorArrowRaysIcon}
              onClick={() => setShowTapToWake((v) => !v)}
              label="tap to wake her"
            />
            <MenuButton
              large={isVRHeadset}
              icon={CurrencyDollarIcon}
              onClick={() => router.push("/holder")}
              label="holder dashboard"
            />
            <MenuButton
              large={isVRHeadset}
              icon={ShieldCheckIcon}
              onClick={() => router.push("/trust")}
              label="trust / verify the mint"
            />
            <MenuButton
              large={isVRHeadset}
              icon={UserGroupIcon}
              onClick={() => router.push("/agents")}
              label="agents"
            />

            <div className="flex flex-row items-center space-x-2">
                <VerticalSwitchBox
                  value={showChatMode}
                  label={""}
                  onChange={toggleChatMode}
                />
            </div>

          </div>
        </div>    
      </div>

      {showChatLog && <ChatLog messages={chatLog} />}

      {/*
        The clicker, over the stage rather than instead of it. It is deliberately mounted here —
        after VrmViewer and outside the settings tree — so opening it never unmounts the VRM: the
        model reload costs seconds and would make the panel feel like a page navigation, which is
        the thing it exists to stop being.
      */}
      {showTapToWake && (
        <TapToWake
          speak={speakAsHer}
          onTap={() => {
            /*
             * TAPPING IS A REAL WAKE SIGNAL, not a meter.
             *
             * Her wakefulness is owned by chat.lastAwake and by amicaLife (enabled by default),
             * which puts her to `Sleep` on idle and pauses itself. Nothing outside amicaLife called
             * wakeFromSleep(), so before this the player could tap the bar to 100% while she stayed
             * asleep in the system that decides whether she idles, animates and speaks on her own —
             * and the panel painted `happy` over a sleeping face. "Tap to wake her" was a caption.
             */
            try { bot.updateAwake(); } catch { /* chat is not initialized yet */ }
          }}
          setMood={(mood) => {
            try {
              // WHILE SHE IS SPEAKING, THE CHAT OWNS HER FACE. processSpeakJobs sets the expression
              // from the screenplay for the sentence she is delivering; overwriting it mid-word
              // because the meter crossed a band is the panel talking over her.
              if (chatSpeaking) return;
              /*
               * THE PANEL CAN WAKE HER. IT MAY NOT PUT HER TO SLEEP.
               *
               * A 'Sleep' mood only means the CLICKER's meter is low, which is a fact about the
               * game and not about her. Writing it was the mirror of the bug where closing the
               * panel woke her: open the clicker while she is awake and mid-conversation, the meter
               * starts at zero, and the first mood effect painted her asleep. Whether she is asleep
               * is amicaLife's call, made from the idle timer, and the emoji on the panel is where
               * the meter gets to have its say.
               */
              if (mood === 'Sleep') return;
              // wakeFromSleep() FIRST, and it matters: it ends amicaLife's sleep state AND writes
              // the neutral reset itself, so doing it after playEmotion would immediately overwrite
              // the mood we just set.
              {
                // THE CANONICAL SEQUENCE, copied from amicaLife.checkSettingOff — the repo's own
                // answer to "the user came back". wakeFromSleep() alone is not waking her:
                // handleSleepEvent PAUSED the loop on the way in (amicaLife.pause()), and clearing
                // isSleep without resume() leaves her neither asleep nor running.
                amicaLife.wakeFromSleep();
                bot.updateAwake();
                amicaLife.resume();
              }
              // playEmotion drives the FACE and the body's idle mood together (model.ts), no audio.
              bot.viewer?.model?.playEmotion(mood);
            } catch { /* the model or amicaLife is not up yet; a tap must not throw on the stage */ }
          }}
          openLink={(url) => {
            // The panel never navigates this tab — the whole point of moving the dashboard onto
            // the stage is that you do not leave her to use it. A buy/chart link is the one thing
            // that genuinely belongs somewhere else, so it opens in a new tab, with noopener so
            // the destination cannot reach back into this window.
            try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* popup blocked */ }
          }}
          onClose={() => setShowTapToWake(false)}
        />
      )}

      {/* Normal chat text */}
      {! showChatLog && ! showChatMode && (
        <>
          { shownMessage === 'assistant' && (
            <AssistantText message={assistantMessage} />
          )}
          { shownMessage === 'user' && (
            <UserText message={userMessage} />
          )}
        </>
      )}

      {/* Thought text */}
      {thoughtMessage !== "" && <ThoughtText message={thoughtMessage}/>}

      {/* Chat mode text */}
      {showChatMode && <ChatModeText messages={chatLog}/>}

      <AddToHomescreen />

      <Alert />
    </div>
  );
}