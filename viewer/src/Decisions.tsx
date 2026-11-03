// The project's decision list: what the user settled, written by the server from
// their replies and read first by every agent. The user has the last word on
// every line, so each can be reworded or taken out here. Replies are untrusted:
// everything below is text nodes and attributes, and a line's words stay plain
// text however they read. It takes its lines and lays itself out in whatever
// width it is given, so it can sit in a page or a sidebar.

import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import type { DecisionLine } from "../../server/decisionList.ts";
import { api, type DecisionListView } from "./api.ts";
import { readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import { timeAgo } from "./logic.ts";
import { linkClick, mockPath } from "./route.ts";
import { Toast, type ToastLine } from "./toast.tsx";

// The list and how to refresh it, for whoever hosts the component and needs to
// know whether there is anything to show at all.
export function createDecisions(project: () => string | null) {
  // It adds to whatever hosts it; failing to load mustn't take the host down too.
  const [list, { mutate, refetch }] = createResource(project, (p) =>
    api.decisions(p).catch(() => null),
  );
  return { list, mutate, refetch };
}

export function Decisions(props: {
  project: string;
  lines: DecisionLine[];
  onChange: (list: DecisionListView) => void;
}) {
  const [toast, setToast] = createSignal<ToastLine | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);

  // One heading per mock: consecutive lines share one, since the server keeps a
  // mock's lines together.
  const groups = () => {
    const out: { mock: string; lines: DecisionLine[] }[] = [];
    for (const line of props.lines) {
      const last = out[out.length - 1];
      if (last?.mock === line.mock) last.lines.push(line);
      else out.push({ mock: line.mock, lines: [line] });
    }
    return out;
  };

  async function change(body: Parameters<typeof api.editDecision>[1], failed: string) {
    try {
      props.onChange(await api.editDecision(props.project, body));
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

  return (
    <div class="decisions">
      <p class="decisions-lead">
        Written from your replies. Agents read this first, and treat it as settled.
      </p>
      <For each={groups()}>
        {(group) => {
          const head = () => group.lines[0];
          const href = () => mockPath(props.project, group.mock);
          return (
            <section class="decisions-mock">
              <h3>
                <a href={href()} onClick={(e) => linkClick(e, href())}>
                  {head().title}
                </a>
                <Show when={head().closed}>
                  <span class="decisions-closed">Closed</span>
                </Show>
                <Show when={head().at}>{(at) => <time>{timeAgo(at())}</time>}</Show>
              </h3>
              <ul>
                <For each={group.lines}>
                  {(line) => (
                    <Line
                      line={line}
                      href={mockPath(
                        props.project,
                        line.mock,
                        line.state ? { state: line.state, variant: null } : null,
                      )}
                      editing={editing() === line.id}
                      onEdit={() => setEditing(line.id)}
                      onCancel={() => setEditing(null)}
                      onSave={async (text) => {
                        if (await change({ id: line.id, text }, "Couldn't save it"))
                          setEditing(null);
                      }}
                      onReset={async () => {
                        if (await change({ id: line.id, reset: true }, "Couldn't change it back"))
                          setEditing(null);
                      }}
                      onRemove={() => void remove(line)}
                    />
                  )}
                </For>
              </ul>
            </section>
          );
        }}
      </For>
      <Toast toast={toast()} onDismiss={() => setToast(null)} />
    </div>
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
    <li class="decisions-line">
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
    </li>
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
