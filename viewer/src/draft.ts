// What the user is about to send, and the way it goes: the draft (local at once, the
// server after a short pause), who a Send reaches, and what became of the last one. The
// design screen (state.ts) shapes what a Send carries; this holds it and sends it.

import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import type { AskAnswer } from "../../server/types.ts";
import {
  api,
  type CommentRow,
  type DesignDetail,
  type DraftInput,
  type SendRecipients,
} from "./api.ts";
import { host, readonly } from "./host.ts";
import { draftIsEmpty, emptyDraft } from "./logic.ts";

const SAVE_MS = 300;
const RECIPIENTS_MS = 10_000;
// How long a Send gets to reach a live agent before the user is offered a way to
// wake it. A held watch takes it in moments; this only has to outlast a slow network.
const BEAT_MS = 4000;

export type ReplyBody = Parameters<typeof api.reply>[1];

interface DraftDeps {
  design: () => DesignDetail | null;
  setDesign: (m: DesignDetail) => void;
  latest: () => number;
  designId: () => string | null;
  comments: () => CommentRow[];
  loadComments: () => Promise<void>;
  setError: (e: string | null) => void;
}

export function createDraft(deps: DraftDeps) {
  const { design, setDesign, latest, comments, loadComments, setError } = deps;
  const [draft, setDraft] = createSignal<DraftInput | null>(null);
  const [sent, setSent] = createSignal(false);
  // The reply the last Send stored, and whether a beat has passed since: an
  // undelivered reply after that beat, with no watcher, earns the line to wake the agent.
  const [sentId, setSentId] = createSignal<string | null>(null);
  const [beat, setBeat] = createSignal(false);
  const [sending, setSending] = createSignal(false);

  // Q6: a draft made on an older version keeps the stage on that version until
  // the user chooses to view the new one.
  const boundVersion = createMemo(() => {
    const d = draft();
    return d && !draftIsEmpty(d) && d.version < latest() ? d.version : null;
  });

  // --- writes: local at once, server after a short pause ---

  let saveTimer = 0;
  let lastLocalWrite = 0;
  let pending: DraftInput | null = null;
  async function flush() {
    const m = design();
    const d = pending;
    pending = null;
    host().window.clearTimeout(saveTimer);
    if (!m || !d) return;
    try {
      await api.putDraft(m.id, d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function writeDraft(fn: (d: DraftInput) => DraftInput) {
    const base = draft() ?? emptyDraft(boundVersion() ?? latest());
    const next = fn({
      ...base,
      answers: { ...base.answers },
      borrowed: { ...base.borrowed },
      tunedOn: Object.fromEntries(Object.entries(base.tunedOn).map(([k, v]) => [k, { ...v }])),
      comments: [...base.comments],
      others: { ...base.others },
      askComments: { ...base.askComments },
      otherImages: { ...base.otherImages },
      askCommentImages: { ...base.askCommentImages },
      answerComments: { ...base.answerComments },
    });
    batch(() => {
      setDraft(next);
      setSent(false);
      setError(null);
    });
    pending = next;
    lastLocalWrite = Date.now();
    host().window.clearTimeout(saveTimer);
    saveTimer = host().window.setTimeout(flush, SAVE_MS);
  }
  // Whether the user has written here since the screen opened.
  const wroteHere = () => lastLocalWrite > 0;
  onCleanup(() => {
    if (pending) void flush();
  });

  async function loadDraft() {
    const id = deps.designId();
    if (!id) return;
    const { draft: d } = await api.draft(id).catch(() => ({ draft: null }));
    if (Date.now() - lastLocalWrite < 1500 || pending) return;
    setDraft(
      d
        ? {
            version: d.version,
            answers: d.answers,
            borrowed: d.borrowed,
            tunedOn: d.tunedOn ?? {},
            comments: d.comments,
            others: d.others ?? {},
            askComments: d.askComments ?? {},
            otherImages: d.otherImages ?? {},
            askCommentImages: d.askCommentImages ?? {},
            answerComments: d.answerComments ?? {},
          }
        : null,
    );
  }

  // --- who hears it ---

  // Who else could hear a Send, while the agent that asked can't. A watcher opening
  // or closing sends no event, so this is read on a timer.
  const [recipients, setRecipients] = createSignal<SendRecipients>({
    default: null,
    recipients: [],
  });
  const [pickedTo, setPickedTo] = createSignal<string | null>(null);
  const sendTo = createMemo(() => {
    const { default: fallback, recipients: list } = recipients();
    return list.find((r) => r.id === pickedTo()) ?? list.find((r) => r.id === fallback) ?? null;
  });
  // Only a pick still on offer is sent; otherwise the server applies the rule the row showed.
  const toField = () => {
    const to = pickedTo();
    return to && recipients().recipients.some((r) => r.id === to) ? { to } : {};
  };
  async function loadRecipients() {
    const id = deps.designId();
    if (!id || readonly() || host().window.document.hidden) return;
    const next = await api.recipients(id).catch(() => null);
    if (next && id === deps.designId()) setRecipients(next);
  }
  const recipientsTimer = host().window.setInterval(() => void loadRecipients(), RECIPIENTS_MS);
  onCleanup(() => host().window.clearInterval(recipientsTimer));

  // --- what became of it ---

  let beatTimer = 0;
  onCleanup(() => host().window.clearTimeout(beatTimer));
  // Read again at the beat: what was read straight after the Send may have caught a
  // watcher between two polls, or one that has since gone.
  function armBeat() {
    setBeat(false);
    host().window.clearTimeout(beatTimer);
    beatTimer = host().window.setTimeout(() => {
      setBeat(true);
      void loadComments().catch(() => {});
    }, BEAT_MS);
  }
  const sentReply = createMemo(() => {
    const id = sentId();
    return (sent() && id && comments().find((c) => c.id === id)) || null;
  });
  // Whether an agent has the last Send yet; null when nothing was sent here.
  const sentDelivered = () => (sent() && sentId() ? (sentReply()?.delivered ?? false) : null);
  const beatPassed = () => beat() && sentDelivered() === false;
  const agentListening = () => !!sentReply()?.listening;
  // The last thing the user sent that an agent owes an answer to, read from the same
  // comments as the Thread, so the word and the Thread can't disagree. A move from
  // a cover's menu or a close isn't one.
  const lastSend = createMemo(() => {
    const list = comments();
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (c.kind !== "reply" || !c.payload || c.payload.edited || c.payload.archived) continue;
      return {
        sessionId: c.sessionId,
        at: c.createdAt,
        delivered: c.delivered,
        ...(c.calledAt ? { calledAt: c.calledAt } : {}),
      };
    }
    return null;
  });
  // A reply stored by something other than send: the screen says it went the same way.
  function landed(replyId: string) {
    batch(() => {
      setSent(true);
      setSentId(replyId);
    });
    armBeat();
  }

  // --- the Send ---

  // The draft goes as `shape` makes it, and clears once the design carrying it as sent
  // arrives: dropping it first would put the stage on another alternative for one fetch
  // (a flash of a different frame fading in, then back). `done` runs in that same batch.
  async function submit(shape: (d: DraftInput) => ReplyBody, done: () => void) {
    const m = design();
    if (!m || sending()) return false;
    await flush();
    const d = draft() ?? emptyDraft(boundVersion() ?? latest());
    setSending(true);
    try {
      const { reply } = await api.reply(m.id, { ...shape(d), ...toField() });
      const [next] = await Promise.all([
        api.design(m.id).catch(() => null),
        loadComments().catch(() => {}),
      ]);
      batch(() => {
        if (next) setDesign(next);
        setDraft(null);
        setSent(true);
        setSentId(reply.id);
        done();
      });
      armBeat();
      void loadRecipients();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSending(false);
    }
  }

  // A steer (more like this, a borrow) has no Send to wait for: it is a reply of its
  // own. It goes alone — never with the answers, tuning or notes the user is still
  // composing, which a steer must not decide — and that draft is left as it was.
  // True once the reply is stored, so a "sent" never shows for one that wasn't.
  async function sendAlone(body: {
    comments?: DraftInput["comments"];
    text?: string;
    more?: { ask: string; note?: string; like?: string };
    answers?: Record<string, AskAnswer>;
    update?: { ask: string; option: string };
  }): Promise<boolean> {
    const m = design();
    if (!m || readonly()) return false;
    await flush();
    const keep = draft();
    try {
      const { reply } = await api.reply(m.id, {
        ...emptyDraft(boundVersion() ?? latest()),
        comments: body.comments ?? [],
        ...(body.answers ? { answers: body.answers } : {}),
        ...(body.text ? { text: body.text } : {}),
        ...(body.more ? { more: body.more } : {}),
        ...(body.update ? { update: body.update } : {}),
        ...toField(),
      });
      // Every reply clears the stored draft; put the user's back before the
      // design is fetched again, so the screen never shows it gone. What this reply
      // answered is settled, so its drafted picks don't come back.
      if (keep) {
        const left = { ...keep, answers: { ...keep.answers } };
        for (const id of Object.keys(body.answers ?? {})) delete left.answers[id];
        await api.putDraft(m.id, left);
      }
      const [next] = await Promise.all([
        api.design(m.id).catch(() => null),
        loadComments().catch(() => {}),
      ]);
      batch(() => {
        if (next) setDesign(next);
        setSent(true);
        setSentId(reply.id);
      });
      armBeat();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  return {
    draft,
    boundVersion,
    writeDraft,
    flush,
    loadDraft,
    wroteHere,
    recipients,
    sendTo,
    setPickedTo,
    toField,
    loadRecipients,
    sent,
    sentReply,
    sentDelivered,
    beatPassed,
    agentListening,
    lastSend,
    sending,
    landed,
    submit,
    sendAlone,
  };
}
