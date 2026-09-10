import { emoteFor, type EmoteId } from "@/features/emote/emotes";

export type Role = "assistant" | "system" | "user";

// ChatGPT API
export type Message = {
  role: Role;
  content: string; // this can be a string or like {type: "image", image_url: {url: "https://example.com/image.jpg"} } but the typing for it sucks
};

const talkStyles = [
  "talk",
  "happy",
  "sad",
  "angry",
  "fear",
  "surprised",
] as const;
export type TalkStyle = (typeof talkStyles)[number];

export type Talk = {
  style: TalkStyle;
  message: string;
};

//Name of all the expression in the vrm 
export const emotionNames: string[] = [];

export const emotions = 
["neutral", "happy", "angry", "sad", "relaxed", "Surprised", 
"Shy", "Jealous", "Bored", "Serious", "Suspicious", "Victory", 
"Sleep", "Love"] as const;

// Convert user input to system format e.g. ["suspicious"] -> ["Sus"], ["sleep"] -> ["Sleep"]
const userInputToSystem = (input: string) => {
  const mapping: { [key: string]: string } = {
    ...Object.fromEntries(emotions
      .filter(e => e[0] === e[0].toUpperCase())
      .map(e => [e.toLowerCase(), e]))
  };

  return mapping[input.toLowerCase()] || input;
};

type EmotionType = (typeof emotions)[number];

/**
 * A set that includes utterances, voice emotions, and model emotional expressions.
 */
export type Screenplay = {
  expression: EmotionType;
  talk: Talk;
  text: string;
  /**
   * The EMOTE this line was tagged with, when she asked for one.
   *
   * A reply may carry a second leading tag — `[happy] [peace] hi` — which is a different axis from
   * the emotion: the emotion is the mood her face holds for the whole line, the emote is one
   * deliberate gesture at the top of it. Optional everywhere, so every existing caller and every
   * backend that never sends one is unaffected.
   */
  emote?: EmoteId;
};

export const textsToScreenplay = (
  texts: string[],
): Screenplay[] => {
  const screenplays: Screenplay[] = [];
  let prevExpression = "neutral";
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];

    const match = text.match(/\[(.*?)\]/);

    const tag = (match && match[1]) || prevExpression;

    const message = text.replace(/\[(.*?)\]/g, "");

    let expression = prevExpression;
    const systemTag = userInputToSystem(tag);

    if (emotions.includes(systemTag as any)) {
      console.log("Emotion detect :",systemTag);
      expression = systemTag;
      prevExpression = systemTag;
    }

    /*
     * THE SECOND LEADING TAG IS AN EMOTE. `[happy] [peace] hi there` asks for the peace-sign
     * gesture on top of the happy face; a line with only one tag, which is every line every backend
     * sent before emotes existed, parses exactly as it always did.
     *
     * The emote's own mood wins the EXPRESSION when the line did not name an emotion of its own —
     * a `[peace]` with no emotion in front of it should not be delivered in whatever she happened
     * to be wearing three sentences ago.
     */
    const emoteMatch = text.match(/^\s*\[[^\]]*\]\s*\[([^\]]*)\]/);
    const emote = emoteMatch ? emoteFor(emoteMatch[1]) : null;
    if (emote && !(match && emotions.includes(userInputToSystem(match[1]) as any))) {
      const moodTag = userInputToSystem(emote.mood);
      if (emotions.includes(moodTag as any)) {
        expression = moodTag;
        prevExpression = moodTag;
      }
    }

    screenplays.push({
      expression: expression as EmotionType,
      talk: {
        style: emotionToTalkStyle(expression as EmotionType),
        message: message,
      },
      text: text,
      ...(emote ? { emote: emote.id } : {}),
    });
  }

  return screenplays;
};

const emotionToTalkStyle = (emotion: EmotionType): TalkStyle => {
  switch (emotion) {
    case "angry":
      return "angry";
    case "happy":
      return "happy";
    case "sad":
      return "sad";
    default:
      return "talk";
  }
};
