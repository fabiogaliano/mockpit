// A design's notes: a short spec an agent drafts, the user corrects by hand, and later
// agents read. Plain text, always shown as text nodes. An experiment: what would prove
// it wrong is an agent that ignores an edit.

import { createSignal, Show } from "solid-js";
import { MAX_NOTES } from "../../server/types.ts";
import { readonly } from "./host.ts";
import type { DesignScreenState } from "./state.ts";

// A note is shown wherever there is one. An empty one only asks to be written on a
// screen: on an idea or a document it would be one more thing nobody asked for.
export const notesShown = (s: DesignScreenState) => {
  const m = s.design();
  return !!m && (!!m.notes || m.kind === "screen");
};

export function Notes(props: { s: DesignScreenState }) {
  const s = props.s;
  const notes = () => s.design()?.notes;
  const text = s.notesWriting;
  const setText = s.setNotesWriting;
  const [busy, setBusy] = createSignal(false);
  const save = async (to: string) => {
    setBusy(true);
    const saved = await s.saveNotes(to);
    setBusy(false);
    if (saved) setText(null);
  };
  return (
    <div class="notes">
      <Show
        when={text() !== null}
        fallback={
          <>
            <Show
              when={notes()}
              fallback={
                <p class="notes-none">
                  Nothing written yet. A short spec of this screen, which agents read before they
                  change it.
                </p>
              }
            >
              {(n) => (
                <>
                  <p class="notes-text">{n().text}</p>
                  <p class="notes-by">
                    {n().by === "user"
                      ? "Edited by you. Agents can't replace this."
                      : "An agent's draft."}
                  </p>
                </>
              )}
            </Show>
            <Show when={!readonly()}>
              <div class="notes-acts">
                <button type="button" class="btn" onClick={() => setText(notes()?.text ?? "")}>
                  {notes() ? "Edit" : "Write"}
                </button>
                <Show when={notes()?.by === "user"}>
                  <button
                    type="button"
                    class="btn"
                    title="Agents can draft them again"
                    disabled={busy()}
                    onClick={() => void save("")}
                  >
                    Clear
                  </button>
                </Show>
              </div>
            </Show>
          </>
        }
      >
        <textarea
          class="notes-input"
          aria-label="Notes"
          rows={10}
          maxLength={MAX_NOTES}
          value={text() ?? ""}
          onInput={(e) => setText(e.currentTarget.value)}
          on:keydown={(e) => {
            // Esc shuts panels, and a spec half typed isn't what it's reaching for.
            if (e.key === "Escape") e.preventDefault();
          }}
          ref={(el) => queueMicrotask(() => el.focus())}
        />
        <div class="notes-acts">
          <button
            type="button"
            class="btn"
            disabled={busy()}
            onClick={() => void save(text() ?? "")}
          >
            Save
          </button>
          <button type="button" class="btn" onClick={() => setText(null)}>
            Cancel
          </button>
          <span class="grow" />
          <Show when={(text()?.length ?? 0) > MAX_NOTES * 0.8}>
            <span class="notes-count num">{`${text()?.length ?? 0} / ${MAX_NOTES}`}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}
