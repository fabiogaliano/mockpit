// The typed surface a `run` script sees, as text. One source for the MCP `run`
// tool description, the scripts guide topic and `mockpit run --help`, so the
// tiers cannot describe different APIs. Hand-shaped rather than generated from
// mcpSpec: a generator repeats Surface per tool and the run-level params on
// every function, roughly tripling the size. test/run.test.ts checks that every
// host function named here exists and vice versa.

export const RUN_API = `// The body of an async function, in plain JavaScript (no TypeScript syntax).
// \`await mockpit.*\`, \`return\` a JSON value, print() adds an output line.
// No network, timers, imports or process. Session, project and agent are fixed
// for the run; pass the returned session to the next run.
type Ref = { mock: string; state?: string; variant?: string };
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
  id?: string; text: string; scope?: "mock" | "state" | "part"; state?: string; part?: string; multi?: boolean;
  options: { id?: string; label: string; variant?: string; set?: Knobs }[];
};
type Written = {
  post: { state: string | null; variant: string; version: number }; url: string;
  parts: { state: string | null; parts: { name: string }[] }[];
  partChanges?: { vanished: string[]; renamed: { from: string; to: string }[] };
  nudges?: string[]; suggestedAsk?: Ask; // send it with ask when nudged
};
type Feedback = {
  mock: string | null;
  reply: null | { asks: { ask: string; chosen: { id: string; label: string; other?: true }[]; note?: string }[]; mix: Knobs; tuned: Knobs; comments: { part: string | null; text: string }[] };
  comments: { text: string; state: string | null; variant: string | null }[];
  accepted: { state: string | null; variant: string }[]; archived: { state: string | null; variant: string }[];
};
type Pending = { mock: string; viewerOpen: boolean; draft: null | { answered: number; of: number; comments: number; touchedAt: string } };
declare const mockpit: {
  guide(topic?: "knobs" | "asks" | "surfaces" | "html" | "reply" | "http" | "scripts"): Promise<string>;
  /** No mock: every mock plus pending. With one: its states, variants, asks, parts, knobs. */
  read(mock?: string, opts?: { body?: boolean; history?: boolean }): Promise<unknown>;
  /** Creates or versions (mock, state, variant). One of: html; surfaces, the full ordered list
   * ({id} alone keeps that surface, a missing id is removed); parts {"name"|"name#key": outer html}. */
  publish(v: Ref & { title?: string; kind?: "component" | "page"; html?: string; surfaces?: (Surface | { id: string })[]; parts?: Record<string, string>; knobs?: Knobs; variantKnobs?: Knobs; from?: number }): Promise<Written>;
  ask(mock: string, asks: Ask[]): Promise<{ asks: { id: string; text: string }[]; url: string }>;
  /** Never waits: what the user sent since you last heard, and what they are doing now. */
  feedback(): Promise<{ feedback: Feedback[]; pending: Pending[] }>;
  say(v: Ref, message: string): Promise<void>;
  export(v: Ref): Promise<{ states: { state: string | null; variant: string; version: number; html: string }[]; reply: unknown }>;
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
  "export",
  "upload",
] as const;
export type RunFunction = (typeof RUN_FUNCTIONS)[number];

export const RUN_EXAMPLE = `const html = (tone) => \`<section data-part="hero" class="\${tone}"><h1>Writer</h1></section>\`;
await mockpit.publish({ mock: "writer", variant: "calm", html: html("calm") });
await mockpit.publish({ mock: "writer", variant: "bold", html: html("bold") });
const { url } = await mockpit.ask("writer", [{ id: "look", text: "Which look?",
  options: [{ label: "Calm", variant: "calm" }, { label: "Bold", variant: "bold" }] }]);
// Tell the user where to look and end the turn; a later run reads mockpit.feedback().
return url;`;

export const RUN_DESCRIPTION =
  "Run a script against mockpit, which shows design work to the user (project > mock > state > " +
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
