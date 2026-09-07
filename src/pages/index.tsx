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
            onClick={() => router.push("/game")}
            className="rounded px-1 py-0.5 tracking-tight transition-colors hover:text-[#00ffa3]"
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

      {/* The live 3D anime character — the hero of the stage. */}
      <VrmStoreProvider>
        <VrmViewer chatMode={false} />
      </VrmStoreProvider>

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
