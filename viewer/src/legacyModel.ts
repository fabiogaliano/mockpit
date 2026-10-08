// The pre-rebuild wire model this viewer still speaks. The server moved to
// project › mock › state › variant (server/types.ts); the viewer is rewritten
// against that model in its own phase, and this file goes with it. Until then
// these declarations keep the old viewer compiling — they describe no route the
// server still serves.
import type {
  CodeSurface,
  DiffSurface,
  HtmlSurface,
  ImageSurface,
  JsonSurface,
  MarkdownSurface,
  MermaidSurface,
  Session,
  SurfaceKind as ServerSurfaceKind,
  TerminalSurface,
} from "../../server/types.ts";

export type {
  CodeSurface,
  DiffSurface,
  HtmlSurface,
  ImageSurface,
  JsonSurface,
  MarkdownSurface,
  MermaidSurface,
  Session,
  TerminalSurface,
};

export interface TraceStep {
  label: string;
  kind?: string;
  detail?: string;
  ts?: string;
}

export interface TraceSurface {
  kind: "trace";
  steps?: TraceStep[];
  assetId?: string;
  title?: string;
}

export type SurfaceKind = ServerSurfaceKind | "trace";

export type Surface =
  | (HtmlSurface & { id?: string })
  | (DiffSurface & { id?: string })
  | (ImageSurface & { id?: string })
  | (TraceSurface & { id?: string })
  | (MarkdownSurface & { id?: string })
  | (TerminalSurface & { id?: string })
  | (MermaidSurface & { id?: string })
  | (JsonSurface & { id?: string })
  | (CodeSurface & { id?: string });

export type PostStatus = "open" | "accepted" | "archived";

export interface Slot {
  slug: string;
  variant: string;
  version: number;
}

export interface PostAsk {
  text: string;
  at: string;
}

export interface PostVersion {
  version: number;
  title: string;
  surfaces: Surface[];
  at: string;
  from?: number;
  prompt?: string;
  author?: string;
}

export interface Post {
  id: string;
  sessionId: string;
  title: string;
  surfaces: Surface[];
  createdAt: string;
  updatedAt: string;
  version: number;
  history: PostVersion[];
  project: string;
  slug: string;
  kind: "component" | "page";
  variant: string;
  status: PostStatus;
  ask: PostAsk | null;
  slots: Slot[];
  from?: number;
  prompt?: string;
  author?: string;
}

interface AnchorBase {
  surfaceIndex: number;
  surfaceId?: string;
  surfaceKind?: SurfaceKind;
  postVersion: number;
}

export type CommentAnchor =
  | (AnchorBase & { kind: "point"; x: number; y: number })
  | (AnchorBase & { kind: "rect"; x: number; y: number; w: number; h: number })
  | (AnchorBase & { kind: "lineRange"; startLine: number; endLine: number; file?: string });

export type CommentKind = "comment" | "revise" | "accept" | "drop" | "ask" | "reply";

export interface Anchor {
  ref: string;
  shape: "pin" | "rect" | "circle";
  box: number[];
  surfaceIndex: number;
  postVersion: number;
  path?: string;
  text?: string;
  viewport?: number;
}

export interface Comment {
  id: string;
  seq: number;
  sessionId: string;
  postId: string | null;
  postTitle: string | null;
  author: string;
  text: string;
  createdAt: string;
  anchor?: CommentAnchor;
  kind: CommentKind;
  anchors: Anchor[];
  draft: boolean;
  postVersion: number | null;
  viewport: number | null;
}

export interface ViewerSurface {
  id?: string;
  kind: SurfaceKind;
  index: number;
  [key: string]: unknown;
}

export interface ViewerPost {
  id: string;
  sessionId: string;
  title: string;
  surfaces: ViewerSurface[];
  createdAt: string;
  updatedAt: string;
  version: number;
  versionCount: number;
}
