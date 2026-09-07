import {
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/router";
import { clsx } from "clsx";
import { M_PLUS_2, Montserrat } from "next/font/google";

import { AssistantText } from "@/components/assistantText";
import { AddToHomescreen } from "@/components/addToHomescreen";
import { Alert } from "@/components/alert";
import { UserText } from "@/components/userText";
import VrmViewer from "@/components/vrmViewer";
import { MessageInputContainer } from "@/components/messageInputContainer";
import { Introduction } from "@/components/introduction";
import { LoadingProgress } from "@/components/loadingProgress";

import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { Message, Role } from "@/features/chat/messages";
import { ChatContext } from "@/features/chat/chatContext";
import { AlertContext } from "@/features/alert/alertContext";

import { config, updateConfig } from "@/utils/config";
import { VrmStoreProvider } from "@/features/vrmStore/vrmStoreContext";
import { AmicaLifeContext } from "@/features/amicaLife/amicaLifeContext";

import { TimestampedPrompt } from "@/features/amicaLife/eventHandler";
import { handleChatLogs } from "@/features/externalAPI/externalAPI";
import { ThoughtText } from "@/components/thoughtText";

import { useWakeGame } from "@/npc/useWakeGame";
import { WakeGamePanel } from "@/npc/WakeGamePanel";
import { NPC_CSS } from "@/npc/styles";

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

export default function Home() {
  const router = useRouter();
  const { viewer } = useContext(ViewerContext);
  const { alert } = useContext(AlertContext);
  const { chat: bot } = useContext(ChatContext);
  const { amicaLife } = useContext(AmicaLifeContext);

  const [chatSpeaking, setChatSpeaking] = useState(false);
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

  // The "tap to wake her" clicker now lives on this stage: tapping the character IS the wake action,
  // the compact HUD reads her state, and the richer stats/quests surface expands as an overlay.
  const game = useWakeGame();
  const [gameOpen, setGameOpen] = useState(false);

  // There is no settings pane in the consumer layout, so amica's idle life should always run as if
  // settings are closed. (Previously driven by the now-removed settings toggle.)
  useEffect(() => {
    amicaLife.checkSettingOff(true);
  }, [amicaLife]);

  useEffect(() => {
    if (config("bg_color") !== "") {
      document.body.style.backgroundColor = config("bg_color");
    } else {
      document.body.style.backgroundImage = `url(${config("bg_url")})`;
    }
  }, []);

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
    if (config("tts_backend") === "openai") {
      updateConfig("tts_backend", "openai_tts");
    }
  }, [bot, viewer]);

  useEffect(() => {
    amicaLife.initialize(viewer, bot, setSubconciousLogs, chatSpeaking);
  }, [amicaLife, bot, viewer]);

  useEffect(() => {
    handleChatLogs(chatLog);
  }, [chatLog]);

  // this exists to prevent build errors with ssr
  useEffect(() => setShowContent(true), []);
  if (!showContent) return <></>;

  return (
    <div className={clsx(m_plus_2.variable, montserrat.variable)}>
      {/* Consumer top bar: premium wordmark (left) + minimal text nav (right).
          The wrapper is pointer-events-none so it never steals drags from the 3D stage; only the
          interactive children re-enable pointer events. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="pointer-events-auto select-none font-mono text-[15px] tracking-tight">
          <span className="text-white/45">$</span>
          <span className="font-semibold text-[#00ffa3] [text-shadow:0_0_18px_rgba(0,255,163,0.45)]">
            KAMIKO
          </span>
        </div>

        <nav className="pointer-events-auto flex items-center gap-2.5 font-mono text-[13px] text-white/55 sm:text-sm">
          <button
            onClick={() => setGameOpen((o) => !o)}
            className={clsx(
              "rounded px-1 py-0.5 tracking-tight transition-colors hover:text-[#00ffa3]",
              gameOpen && "text-[#00ffa3]",
            )}
          >
            game
          </button>
          <span className="text-white/20">·</span>
          <button
            onClick={() => router.push("/holder")}
            className="rounded px-1 py-0.5 tracking-tight transition-colors hover:text-[#00ffa3]"
          >
            holder
          </button>
          <span className="text-white/20">·</span>
          <button
            onClick={() => router.push("/trust")}
            className="rounded px-1 py-0.5 tracking-tight transition-colors hover:text-[#00ffa3]"
          >
            trust
          </button>
        </nav>
      </div>

      {config("youtube_videoid") !== "" && (
        <div className="fixed video-container w-full h-full z-0">
          <iframe
            className="w-full h-full"
            src={`https://www.youtube.com/embed/${config("youtube_videoid")}?&autoplay=1&mute=1&playsinline=1&loop=1&controls=0&disablekb=1&fs=0&playlist=${config("youtube_videoid")}`}
            frameBorder="0"
          ></iframe>
        </div>
      )}

      <Introduction open={config("show_introduction") === "true"} />

      <LoadingProgress />

      {/* The scoped $KAMIKO stylesheet (npcg- tokens) — powers the floating "+1" taps here and the
          expandable stats/quests overlay below. Scoped by class prefix, so it never leaks. */}
      <style dangerouslySetInnerHTML={{ __html: NPC_CSS }} />

      {/* The live 3D anime character — the hero of the stage. Tapping her IS the wake action: the
          handler sits on the WRAPPER, so pointerdown bubbles up from the canvas and the VRM's own
          cursor look-at keeps working (no opaque layer over the canvas). */}
      <div
        className="fixed inset-0 z-0"
        onPointerDown={(e) => game.tap(e.clientX, e.clientY)}
      >
        <VrmStoreProvider>
          <VrmViewer chatMode={false} />
        </VrmStoreProvider>
      </div>

      {/* Floating "+1" at the tap coordinates. */}
      {game.floats.map((f) => (
        <span
          key={f.id}
          className="npcg-float"
          style={{ left: f.x, top: f.y, color: "#00ffa3" }}
        >
          {f.text}
        </span>
      ))}

      {/* First-visit coach hint — dismisses on the first tap (the hook clears `coach`). */}
      {game.coach && (
        <div className="pointer-events-none fixed inset-x-0 top-[44%] z-30 flex justify-center px-4">
          <div className="select-none rounded-full border border-[#00ffa3]/30 bg-black/45 px-4 py-1.5 font-mono text-[12px] text-white/80 backdrop-blur-md">
            <span className="text-[#00ffa3]">tap her</span> to wake her
          </div>
        </div>
      )}

      {/* Premium game HUD — pinned top-right, below the nav; clear of the chat input and disclaimer.
          Compact and mobile-safe: her reaction line, awakeness bar, taps, streak, and a stats toggle. */}
      <div className="pointer-events-none fixed right-3 top-14 z-40 w-[13.5rem] sm:top-16">
        <div className="pointer-events-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono backdrop-blur-md">
          <div
            className={clsx(
              "mb-2 min-h-[2.4em] text-[11px] leading-snug",
              game.dim ? "text-white/45" : "text-white/85",
            )}
          >
            {game.line}
          </div>

          <div className="mb-1 flex items-center justify-between text-[9px] tracking-[0.18em] text-white/40">
            <span>AWAKENESS</span>
            <span className="text-[#00ffa3]">{Math.floor(game.awake)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#00ffa3] transition-[width] duration-200"
              style={{ width: game.awake + "%" }}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] tracking-[0.14em] text-white/40">YOUR TAPS</div>
              <div className="text-[15px] font-bold text-[#00ffa3]">{game.taps.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[9px] tracking-[0.14em] text-white/40">STREAK</div>
              <div className="text-[15px] font-bold text-white/90">
                {game.streak ? `${game.streak.streak}${game.streak.streak === 1 ? " day" : " days"}` : "—"}
              </div>
            </div>
          </div>

          <button
            onClick={() => setGameOpen(true)}
            className="mt-3 w-full rounded-lg border border-white/10 bg-white/[0.03] py-1.5 text-[11px] font-semibold tracking-tight text-white/75 transition-colors hover:border-[#00ffa3]/40 hover:text-[#00ffa3]"
          >
            stats · quests
          </button>
        </div>
      </div>

      {/* The richer surface (leaderboard, quests, buy/chart CTA, share, wallet, streak-saver),
          expandable on the SAME page in the unified npcg- language. */}
      {gameOpen && <WakeGamePanel game={game} onClose={() => setGameOpen(false)} />}

      <MessageInputContainer isChatProcessing={chatProcessing} />

      {/* Her voice on stage: assistant / user speech text. */}
      {shownMessage === "assistant" && <AssistantText message={assistantMessage} />}
      {shownMessage === "user" && <UserText message={userMessage} />}

      {/* Thought text */}
      {thoughtMessage !== "" && <ThoughtText message={thoughtMessage} />}

      {/* Slim, honest footer flush to the very bottom edge. It is a thin full-width line with a
          subtle backdrop and sits BELOW the raised chat input (see messageInput.tsx bottom-7), so it
          never overlaps the input or any control. pointer-events-none keeps it click-through. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50">
        <p className="w-full bg-black/45 py-1 text-center text-[10px] leading-tight text-white/50 backdrop-blur-sm">
          Not financial advice. $KAMIKO isn&apos;t live yet — no official contract exists.
        </p>
      </div>

      <AddToHomescreen />

      <Alert />
    </div>
  );
}
