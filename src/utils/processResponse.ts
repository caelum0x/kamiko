import { Screenplay, textsToScreenplay } from "@/features/chat/messages";
import { isEmoteId } from "@/features/emote/emotes";

export type ProcessResponseRetVal = {
  sentences: string[];
  aiTextLog: string;
  receivedMessage: string;
  tag: string;
  /**
   * The emote tag of THIS reply, consumed once.
   *
   * Unlike `tag`, which is deliberately carried onto every sentence so her face keeps the mood for
   * the whole answer, an emote is a single gesture at the top of the reply. Carrying it would
   * re-fire the peace sign on every full stop.
   */
  emote: string;
  isThinking: boolean;
  rolePlay: string;
  shouldBreak: boolean;
}

// this function is used to process the response from the AI
// it will call callback once it has a full "sentence" to speak
// it returns updated variables for the next iteration
// this is intended to be used in a loop
export function processResponse({
  sentences,
  aiTextLog,
  receivedMessage,
  tag,
  emote = "",
  isThinking,
  rolePlay,
  callback,
}: {
  sentences: string[],
  aiTextLog: string,
  receivedMessage: string,
  tag: string,
  emote?: string,
  isThinking: boolean,
  rolePlay: string,
  callback: (aiTalks: Screenplay[]) => boolean,
}): ProcessResponseRetVal {
  let shouldBreak = false;

  const thinkTagMatch = receivedMessage.match(/<\/?think>/);
  if (thinkTagMatch && thinkTagMatch[0]) {
    if (thinkTagMatch[0] === "</think>") {
      isThinking = false;
    } else  {
      isThinking = true;
    }
    receivedMessage = receivedMessage.slice(thinkTagMatch[0].length);
  }

  // Detection of tag part of reply content
  const tagMatch = receivedMessage.match(/^\[(.*?)\]/);
  if (tagMatch && tagMatch[0]) {
    tag = tagMatch[0];
    receivedMessage = receivedMessage.slice(tag.length);
  }

  /*
   * A SECOND leading bracket, when it names an emote, is the gesture for this reply.
   *
   * It is matched on its own pass rather than in one regex with the emotion tag because the two
   * halves can arrive in different stream chunks — `"[hap"`, `"py] [pea"`, `"ce] hi"` is a normal
   * way for this to come over the wire, and a combined pattern would only ever match when both
   * brackets landed together. Only tried while we have an emotion tag and no emote yet, and only
   * accepted for the ten known emote names, so a reply that genuinely starts with a bracket
   * ("[sic] ...") is left in the spoken text where it belongs.
   */
  if (tag !== "" && emote === "") {
    const emoteMatch = receivedMessage.match(/^\s*\[(.*?)\]/);
    if (emoteMatch && isEmoteId(emoteMatch[1])) {
      emote = emoteMatch[1].trim().toLowerCase();
      receivedMessage = receivedMessage.slice(emoteMatch[0].length);
    }
  }

  // Detection of role play part of reply content e.g. *smiling nervously*
  const rolePlayMatch = receivedMessage.match(/\*(.*?)\*/);
  if (rolePlayMatch && rolePlayMatch[0]) {
    rolePlay = rolePlayMatch[0];
    receivedMessage = receivedMessage.replace(rolePlay, '');
  }

  // Cut out and process the response sentence by sentence
  const sentenceMatch = receivedMessage.match(
    /^(.+[\.\。\!\！\?\？\，\n]|.{10,}[,])/,
  );
  if (sentenceMatch && sentenceMatch[0]) {
    const sentence = sentenceMatch[0];
    sentences.push(sentence);
    receivedMessage = receivedMessage
      .slice(sentence.length)
      .trimStart();

    // Skip if the string is unnecessary/impossible to utter.
    if (
      !sentence.replace(
        /^[\s\[\(\{「［（【『〈《〔｛«‹〘〚〛〙›»〕》〉』】）］」\}\)\]]+$/g,
        "",
      )
    ) {
      // continue
      return {
        sentences,
        aiTextLog,
        receivedMessage,
        tag,
        emote,
        isThinking,
        rolePlay,
        shouldBreak,
      }
    }

    const aiText = emote !== "" ? `${tag} [${emote}] ${sentence}` : `${tag} ${sentence}`;
    const aiTalks = textsToScreenplay([aiText]);
    aiTextLog += aiText;
    emote = ""; // one gesture per reply — see ProcessResponseRetVal.emote

    shouldBreak = callback(aiTalks);
  }

  return {
    sentences,
    aiTextLog,
    receivedMessage,
    tag,
    emote,
    isThinking,
    rolePlay,
    shouldBreak,
  }
}
