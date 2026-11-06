// The typed surface a `run` script sees, as text. One source for the MCP `run`
// tool description, the scripts guide topic and `mockpit run --help`, so the
// tiers cannot describe different APIs. Hand-shaped rather than generated from
// mcpSpec: a generator repeats Surface per tool and the run-level params on
// every function, roughly tripling the size. Every host function named here
// must exist, and vice versa.

export const RUN_API = `// The body of an async function, in plain JavaScript (no TypeScript syntax).
// \`await mockpit.*\`, \`return\` a JSON value, print() adds an output line.
// No network, timers, imports or process. Session, project and agent are fixed
// for the run; pass the returned session to the next run.
type Ref = { design: string; state?: string; variant?: string };
type Knobs = Record<string, unknown>; // path → [default,min,max,step] | boolean | {type:"select",options} | "#hex"
type Surface =
  | { kind: "html"; html: string; kits?: string[] }
  | { kind: "markdown"; markdown: string }
  | { kind: "diff"; patch?: string; files?: { filename: string; before: string; after: string }[]; layout?: "unified" | "split" }
  | { kind: "image"; assetId: string; alt?: string; caption?: string }
  | { kind: "terminal"; text: string; cols?: number; title?: string }
  | { kind: "mermaid"; mermaid: string }
  | { kind: "json"; data: unknown; title?: string }
  | { kind: "code"; code: string; language?: string; lineStart?: number };
type Ask = {
  id?: string; text: string; scope?: "design" | "state" | "part"; state?: string; part?: string; multi?: boolean;
  options: { id?: string; label: string; variant?: string; set?: Knobs; palette?: string; recommended?: boolean }[];
};
type Written = {
  post?: { state: string | null; variant: string; version: number }; planned?: true; url: string;
  parts?: { state: string | null; parts: { name: string }[] }[];
  partChanges?: { vanished: string[]; renamed: { from: string; to: string }[] };
  nudges?: string[]; suggestedAsk?: Ask; suggestedFillAsks?: Ask[]; // send with ask when nudged
};
type Feedback = {
  design: string | null;
  reply: null | { asks: { ask: string; chosen: { id: string; label: string; other?: true }[]; comment?: string }[]; borrowed: Record<string, string>; tuned: Knobs; comments: { part: string | null; text: string }[]; verdict?: { kind: "use" | "revise"; state: string | null; variant: string; version?: number } };
  messages: { text: string; state: string | null; variant: string | null }[];
  inUse: { state: string | null; variant: string; version: number }[]; archived: { state: string | null; variant: string }[];
  system?: { rev: number; changes: string[] };
};
type Pending = { design: string; archived?: true; viewerOpen: boolean; draft: null | { answered: number; of: number; comments: number; touchedAt: string } };
declare const mockpit: {
  guide(topic?: "system" | "knobs" | "asks" | "surfaces" | "html" | "feedback" | "http" | "scripts"): Promise<string>;
  /** Read first: decisionList is what the user already settled; it stands unless they say otherwise.
   * No design: every design, the flows, plus pending; opts.area: one area. With one: its spec, states, variants, asks, parts, knobs.
   * opts.decisions: only the whole list, when a read cut it. */
  read(design?: string, opts?: { body?: boolean; history?: boolean; decisions?: boolean; area?: string }): Promise<unknown>;
  /** Creates or versions (design, state, variant). One of: html; surfaces, the full ordered list
   * ({id} alone keeps that surface, a missing id is removed); parts {"name"|"name#key": outer html};
   * fills {"part#fill": outer html}, replacing or adding one fill of a part.
   * None of them, with kind screen or component: plans it, for a later publish to draw. */
  publish(v: Ref & { title?: string; kind?: "screen" | "component" | "idea"; area?: string; source?: string; html?: string; poster?: string; surfaces?: (Surface | { id: string })[]; parts?: Record<string, string>; fills?: Record<string, string>; knobs?: Knobs; variantKnobs?: Knobs; from?: number; prompt?: string; description?: string; widths?: number[]; flow?: string; step?: number }): Promise<Written>;
  ask(design: string, asks: Ask[]): Promise<{ asks: { id: string; text: string }[]; url: string; nudges?: string[] }>;
  /** Never waits: what the user sent since you last heard, and what they are doing now. */
  feedback(): Promise<{ feedback: Feedback[]; pending: Pending[] }>;
  say(v: Ref, message: string): Promise<void>;
  /** to or toState moves variants there; archive hides them; restore brings them back. */
  move(v: Ref & { variants: string[]; to?: string; toState?: string; archive?: boolean; restore?: boolean }): Promise<{ variants: { state: string | null; variant: string; status: string }[]; skipped: { variant: string; why: string }[]; url: string }>;
  /** No new version; "" clears. Without design, rename, areas or description (with area: its) edit the project.
   * purpose, behaviour: the spec; not applied over the user's own edit (spec.*.applied). */
  edit(v: { design?: string; slug?: string; title?: string; kind?: string; area?: string; source?: string; firstState?: string; purpose?: string; behaviour?: { text: string; state?: string; part?: string }[]; rename?: string; areas?: string[]; description?: string }): Promise<{ url: string; spec?: unknown }>;
  /** The project's system: sheet, tokens, scales, palettes, project knobs. No argument reads it;
   * each key replaces its part (tokens, scales, palettes upsert by name). Applies to every design at once. */
  system(v?: { sheet?: string; classes?: { name: string; note: string }[]; fonts?: { family: string; href?: string }[]; tokens?: unknown[]; scales?: unknown[]; roles?: { name: string; note: string }[]; palettes?: unknown[]; pairs?: [string, string, number][]; as?: Record<string, string>; knobs?: Knobs; remove?: { tokens?: string[]; palettes?: string[]; scales?: string[] }; restore?: number }): Promise<{ rev: number; changed?: string[]; kept?: string[]; checks: string[]; url: string }>;
  export(v: Ref): Promise<{ states: { state: string | null; variant: string; version: number; html: string; allFills?: string }[]; reply: unknown }>;
  /** Without design: the project's system for code. css holds the default palette on :root and kept ones by [data-palette]. */
  export(v: {}): Promise<{ rev: number; sheet: string; css: string; tokens: unknown; knobs: Record<string, unknown>; additions: { knob: string; value: string; style: string }[]; components: { slug: string; purpose: string; source: string | null }[] }>;
  /** data: base64 bytes. Use id as an image surface's assetId. */
  upload(data: string, opts: { contentType: string; filename?: string; kind?: "image" | "file" }): Promise<{ id: string; url: string }>;
};
declare function print(...values: unknown[]): void;`;

// The host functions a script can reach, by the dotted name the calls log uses.
export const RUN_FUNCTIONS = [
  "guide",
  "read",
  "publish",
  "ask",
  "feedback",
  "say",
  "move",
  "edit",
  "system",
  "export",
  "upload",
] as const;
export type RunFunction = (typeof RUN_FUNCTIONS)[number];

export const RUN_EXAMPLE = `const html = (tone) => \`<section data-part="hero" class="\${tone}"><h1>Writer</h1></section>\`;
await mockpit.publish({ design: "writer", variant: "calm", html: html("calm") });
await mockpit.publish({ design: "writer", variant: "bold", html: html("bold") });
const { url } = await mockpit.ask("writer", [{ id: "tone", text: "Calm or bold?",
  options: [{ label: "Calm", variant: "calm" }, { label: "Bold", variant: "bold" }] }]);
// Tell the user where to look and end the turn; a later run reads mockpit.feedback().
return url;`;

export const RUN_DESCRIPTION =
  "Run a script against mockpit, which shows design work to the user (project > design > state > " +
  "variant > version). Publish variants and ask in one call; nothing waits for the user. Returns " +
  "value, prints, calls (every host call in order: which writes landed), error {kind, message, " +
  "line} and feedback (every batch received, even if the script failed). Read mockpit.guide() " +
  "before the first html.\n\n" +
  `\`\`\`ts\n${RUN_API}\n\`\`\`\n\nExample:\n\`\`\`js\n${RUN_EXAMPLE}\n\`\`\``;

export const RUN_INSTRUCTIONS =
  "Mockpit shows design work to the user. Call run with a JavaScript body that uses the " +
  "mockpit API in its description: publish variants, ask, then end your turn. When the user " +
  "says they answered, run mockpit.feedback(). Feedback is delivered once; read the run's " +
  "feedback field.";
