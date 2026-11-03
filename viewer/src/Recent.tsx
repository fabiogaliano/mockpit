// What happened lately, newest day first: designs that changed, and what the user
// decided. A day folds what's past its first few of each, since one sitting can leave
// sixty answers. This is also the one place to correct the decision list, because
// agents read it first and treat it as settled.

import { createMemo, createSignal, For, Show } from "solid-js";
import type { DecisionLine } from "../../server/decisionList.ts";
import { assetUrl, type DecisionListView, type DesignSummary, surfaceUrl } from "./api.ts";
import { byDay, plural, questions } from "./albums.ts";
import { DecisionRow, createDecisionEdits } from "./Decisions.tsx";
import { Icon } from "./icons.tsx";
import { timeAgo } from "./logic.ts";
import { linkClick, designPath, projectPath, type RecentShow } from "./route.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";
import { Toast } from "./toast.tsx";

const FIRST_OF_EACH = 3;

type Entry =
  | { kind: "design"; key: string; at: string; design: DesignSummary }
  | { kind: "decision"; key: string; at: string | undefined; line: DecisionLine };

export function DesignThumb(props: { design: DesignSummary }) {
  return (
    <Show when={props.design.thumbnail}>
      {(t) => (
        <Show
          when={t().poster}
          fallback={
            <Thumb
              src={surfaceUrl(t().postId, t().surface, {
                version: t().version,
                mode: theme(),
                w: t().rewrites,
              })}
            />
          }
        >
          {(id) => (
            <img class="home-poster" src={assetUrl(id())} alt="" loading="lazy" decoding="async" />
          )}
        </Show>
      )}
    </Show>
  );
}

export function Recent(props: {
  project: string;
  designs: DesignSummary[];
  // When a design last had new work, which is what "updated" here should mean. Not its
  // own updatedAt, which a reason or a restore also moves.
  workedAt: (design: DesignSummary) => string;
  lines: DecisionLine[];
  show: RecentShow | null;
  go: (e: MouseEvent, path: string) => void;
  onDecisions: (list: DecisionListView) => void;
}) {
  const edits = createDecisionEdits(
    () => props.project,
    (list) => props.onDecisions(list),
  );
  const entries = createMemo(() => {
    const designs: Entry[] =
      props.show === "decisions"
        ? []
        : props.designs.map((m) => ({
            kind: "design",
            key: `m:${m.id}`,
            at: props.workedAt(m),
            design: m,
          }));
    const decisions: Entry[] =
      props.show === "designs"
        ? []
        : props.lines.map((l) => ({ kind: "decision", key: `d:${l.id}`, at: l.at, line: l }));
    return [...designs, ...decisions];
  });
  const days = createMemo(() =>
    byDay(
      entries(),
      (e) => e.at,
      (e) => e.key,
    ),
  );
  // Opened days hold for as long as the page does, across the filters.
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set());
  const filter = (show: RecentShow | null, label: string) => {
    const href = () => projectPath(props.project, "recent", null, show);
    return (
      <a
        class="recent-filter"
        aria-current={props.show === show ? "page" : undefined}
        href={href()}
        onClick={(e) => props.go(e, href())}
      >
        {label}
      </a>
    );
  };
  return (
    <div class="recent">
      <Show when={props.lines.length > 0}>
        <nav class="recent-filters" aria-label="Show">
          {filter(null, "All")}
          {filter("decisions", `Decisions ${props.lines.length}`)}
          {filter("designs", "Designs")}
        </nav>
      </Show>
      <Show when={props.show === "decisions"}>
        <p class="decisions-lead">
          Written from what you sent. Agents read this first, and treat it as settled.
        </p>
      </Show>
      <For each={days()}>
        {(day) => {
          const of = (kind: Entry["kind"]) => day.rows.filter((e) => e.kind === kind);
          const isOpen = () => opened().has(day.key);
          const shown = () =>
            isOpen()
              ? [...of("design"), ...of("decision")]
              : [
                  ...of("design").slice(0, FIRST_OF_EACH),
                  ...of("decision").slice(0, FIRST_OF_EACH),
                ];
          const more = () => {
            const left = (kind: Entry["kind"], word: string) => {
              const n = of(kind).length - FIRST_OF_EACH;
              return n > 0 ? plural(n, `more ${word}`) : "";
            };
            return [left("design", "design"), left("decision", "decision")]
              .filter(Boolean)
              .join(" and ");
          };
          return (
            <section class="recent-day" aria-label={day.label}>
              <h2>{day.label}</h2>
              <ol>
                <For each={shown()}>
                  {(entry) =>
                    entry.kind === "design" ? (
                      <DesignEntry project={props.project} design={entry.design} at={entry.at} />
                    ) : (
                      <DecisionEntry project={props.project} line={entry.line} edits={edits} />
                    )
                  }
                </For>
              </ol>
              <Show when={more() && !isOpen()}>
                <button
                  type="button"
                  class="recent-more"
                  onClick={() => setOpened(new Set([...opened(), day.key]))}
                >
                  {`Show ${more()}`}
                </button>
              </Show>
            </section>
          );
        }}
      </For>
      <Toast toast={edits.toast()} onDismiss={() => edits.setToast(null)} />
    </div>
  );
}

function DesignEntry(props: { project: string; design: DesignSummary; at: string }) {
  const href = () => designPath(props.project, props.design.slug);
  return (
    <li class="recent-entry">
      <a
        class="home-pic recent-pic"
        href={href()}
        tabIndex={-1}
        aria-hidden="true"
        onClick={(e) => linkClick(e, href())}
      >
        <DesignThumb design={props.design} />
      </a>
      <div class="recent-body">
        <a class="recent-name" href={href()} onClick={(e) => linkClick(e, href())}>
          {props.design.title}
        </a>{" "}
        <span class="recent-what">updated</span>
        <Show when={props.design.open > 0}>
          <span class="home-chip recent-chip">
            <i class="dot" />
            {questions(props.design.open)}
          </span>
        </Show>
      </div>
      <time>{timeAgo(props.at)}</time>
    </li>
  );
}

function DecisionEntry(props: {
  project: string;
  line: DecisionLine;
  edits: ReturnType<typeof createDecisionEdits>;
}) {
  const href = () => designPath(props.project, props.line.design);
  return (
    <li class="recent-entry">
      <span class="recent-pic recent-mark" aria-hidden="true">
        <Icon name="check" />
      </span>
      <div class="recent-body">
        <a class="recent-name" href={href()} onClick={(e) => linkClick(e, href())}>
          {props.line.title}
        </a>
        <span class="recent-what"> · you decided</span>
        <Show when={props.line.archived}>
          <span class="decisions-closed"> · Archived</span>
        </Show>
        <DecisionRow project={props.project} line={props.line} edits={props.edits} />
      </div>
      <Show when={props.line.at}>{(at) => <time>{timeAgo(at())}</time>}</Show>
    </li>
  );
}
