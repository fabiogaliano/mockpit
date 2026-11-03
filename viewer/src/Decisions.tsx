// One line of the project's decision list: what the user settled, written by the
// server from their replies and read first by every agent. The user has the last
// word on every line, so each can be reworded or taken out here. Replies are
// untrusted: everything below is text nodes and attributes, and a line's words stay
// plain text however they read.

import { createResource, createSignal, onCleanup, Show } from "solid-js";
import type { DecisionLine } from "../../server/decisionList.ts";
import { api, type DecisionListView } from "./api.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { linkClick, mockPath } from "./route.ts";
import type { ToastLine } from "./toast.tsx";

// The list and how to refresh it, for whoever hosts the component and needs to
// know whether there is anything to show at all.
export function createDecisions(project: () => string | null) {
  // It adds to whatever hosts it; failing to load mustn't take the host down too.
  const [list, { mutate, refetch }] = createResource(project, (p) =>
    api.decisions(p).catch(() => null),
  );
  return { list, mutate, refetch };
}

// Rewording or removing a line, with the line its action leaves. Whoever shows the
// rows shows that line too.
export function createDecisionEdits(
  project: () => string,
  onChange: (list: DecisionListView) => void,
) {
  const [toast, setToast] = createSignal<ToastLine | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  async function change(body: Parameters<typeof api.editDecision>[1], failed: string) {
    try {
      onChange(await api.editDecision(project(), body));
      return true;
    } catch (e) {
      setToast({ text: `${failed}: ${e instanceof Error ? e.message : e}` });
      return false;
    }
  }
  async function remove(line: DecisionLine) {
    if (await change({ id: line.id, removed: true }, "Couldn't remove it")) {
      setToast({
        text: "Line removed. Agents won't read it.",
        undo: () => {
          setToast(null);
          void change({ id: line.id, reset: true }, "Couldn't bring it back");
        },
      });
    }
  }
  return { toast, setToast, editing, setEditing, change, remove };
}

export function DecisionRow(props: {
  project: string;
  line: DecisionLine;
  edits: ReturnType<typeof createDecisionEdits>;
}) {
  const e = props.edits;
  return (
    <Line
      line={props.line}
      href={mockPath(
        props.project,
        props.line.mock,
        props.line.state ? { state: props.line.state, variant: null } : null,
      )}
      editing={e.editing() === props.line.id}
      onEdit={() => e.setEditing(props.line.id)}
      onCancel={() => e.setEditing(null)}
      onSave={async (text) => {
        if (await e.change({ id: props.line.id, text }, "Couldn't save it")) e.setEditing(null);
      }}
      onReset={async () => {
        if (await e.change({ id: props.line.id, reset: true }, "Couldn't change it back")) {
          e.setEditing(null);
        }
      }}
      onRemove={() => void e.remove(props.line)}
    />
  );
}

function Line(props: {
  line: DecisionLine;
  href: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (text: string) => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  return (
    <div class="decisions-line">
      <Show
        when={props.editing}
        fallback={
          <>
            <div class="decisions-body">
              <Show
                when={props.line.parts}
                fallback={<Fold class="decisions-mine" text={props.line.text} href={props.href} />}
              >
                {(p) => (
                  <>
                    <a
                      class="decisions-text"
                      href={props.href}
                      onClick={(e) => linkClick(e, props.href)}
                    >
                      <span class="decisions-q">{p().asked}</span>
                      <Show when={p().chose}>
                        {(chose) => (
                          <>
                            {" "}
                            <b>{chose()}</b>
                          </>
                        )}
                      </Show>
                      <Show when={p().not}>
                        {(not) => <span class="decisions-not">{` Not: ${not()}`}</span>}
                      </Show>
                    </a>
                    <Show when={p().words}>
                      {(words) => (
                        <Fold class="decisions-words" text={`“${words()}”`} href={props.href} />
                      )}
                    </Show>
                  </>
                )}
              </Show>
              <Show when={props.line.edited}>
                <span class="decisions-edited">Edited by you</span>
              </Show>
            </div>
            <Show when={!readonly()}>
              <div class="decisions-acts">
                <button
                  type="button"
                  class="ib"
                  aria-label="Edit this line"
                  title="Edit"
                  onClick={props.onEdit}
                >
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  class="ib"
                  aria-label="Remove this line"
                  title="Remove"
                  onClick={props.onRemove}
                >
                  <Icon name="close" />
                </button>
              </div>
            </Show>
          </>
        }
      >
        <Editor
          text={props.line.text}
          edited={!!props.line.edited}
          onSave={props.onSave}
          onCancel={props.onCancel}
          onReset={props.onReset}
        />
      </Show>
    </div>
  );
}

// Someone's long write-in folds, so the answers around it can still be scanned;
// the question and the pick never do. How far it runs depends on the width it was
// given, so this asks the box, not the character count.
function Fold(props: { class: string; text: string; href: string }) {
  const [open, setOpen] = createSignal(false);
  const [long, setLong] = createSignal(false);
  const measure = (el: HTMLElement) => {
    const check = () => {
      if (!open()) setLong(el.scrollHeight > el.clientHeight + 1);
    };
    const seen = new ResizeObserver(check);
    seen.observe(el);
    onCleanup(() => seen.disconnect());
  };
  return (
    <>
      <a
        class={props.class}
        classList={{ folded: !open() }}
        ref={measure}
        href={props.href}
        onClick={(e) => linkClick(e, props.href)}
      >
        {props.text}
      </a>
      <Show when={long()}>
        <button type="button" class="decisions-fold" onClick={() => setOpen(!open())}>
          {open() ? "Less" : "More"}
        </button>
      </Show>
    </>
  );
}

function Editor(props: {
  text: string;
  edited: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const [value, setValue] = createSignal(props.text);
  const save = () => {
    const text = value().trim();
    if (text) props.onSave(text);
  };
  return (
    <div class="decisions-edit">
      <textarea
        aria-label="Decision"
        rows={3}
        value={value()}
        ref={(el) => queueMicrotask(() => el.focus())}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
      />
      <div class="decisions-edit-acts">
        <button type="button" class="btn go" disabled={!value().trim()} onClick={save}>
          Save
        </button>
        <button type="button" class="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <Show when={props.edited}>
          <button type="button" class="decisions-reset" onClick={props.onReset}>
            Back to mockpit's wording
          </button>
        </Show>
      </div>
    </div>
  );
}
