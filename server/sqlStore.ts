import {
  type Anchor,
  type Ask,
  type JumpRows,
  type DesignKind,
  type Asset,
  collectAssetIds,
  collectAttachedIds,
  type Comment,
  type CommentQuery,
  type CommitReplyInput,
  type CreateAssetInput,
  type CreateCommentInput,
  type CreateDesignInput,
  type CreatePostInput,
  type CreateSessionInput,
  DEFAULT_PROJECT,
  DEFAULT_ALTERNATIVE,
  type Draft,
  hashAssetId,
  HISTORY_LIMIT,
  htmlSurface,
  type Knobs,
  MAX_WORKSPACE_ASSET_BYTES,
  type Design,
  type DesignReady,
  type DesignSpec,
  type ProjectArea,
  type AnswerAddition,
  type AnswerCombo,
  type AnswerStanding,
  type StateOutline,
  isDesignKind,
  isIdeaBecomes,
  newId,
  normalizeSurfaceIds,
  type Post,
  type CopyRef,
  isLive,
  type LiveCopy,
  type PostHead,
  type PostQuery,
  type PostStatus,
  type PostVersion,
  projectFromCwd,
  type Reply,
  AREAS_SETTING,
  DECISION_EDITS_SETTING,
  PROJECT_DESCRIPTION_SETTING,
  reservedAgent,
  sameScreen,
  selectEvictions,
  type Session,
  type Instance,
  type Flow,
  type FlowStep,
  type ForkRef,
  slugify,
  type SqlStorage,
  type SqlStorageValue,
  stripNul,
  type Store,
  summarizeProjects,
  type Surface,
  type SurfaceHead,
  type UpdateDesignInput,
  type UpdatePostInput,
  type AmendPostInput,
  type DecisionAlternative,
} from "./types.ts";
import { renameSlugRefs } from "./instances.ts";
import { AS_IS_SWAP } from "./swaps.ts";
import {
  CURRENT_CONTRACT,
  normalizeSystem,
  SYSTEM_LIMITS,
  type System,
  systemFromDesignSettings,
} from "./system.ts";
import type { Mode } from "./themes.ts";
import { RULES_SETTING } from "./guidance.ts";

type Row = Record<string, SqlStorageValue>;

// The settings keyed `<prefix>:<project>`, which a project rename carries.
const PROJECT_SETTINGS = [
  AREAS_SETTING,
  PROJECT_DESCRIPTION_SETTING,
  RULES_SETTING,
  DECISION_EDITS_SETTING,
] as const;

// An optional free-text label: blank means none.
const label = (v: string | null | undefined): string | null => stripNul(v ?? "").trim() || null;

function parseJson<T>(raw: SqlStorageValue, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// A stored reply in the current names, or null when it already uses them.
function contractReply(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (!("mix" in payload) && !("decision" in payload) && !("resolved" in payload)) return null;
  const { mix, decision, resolved, ...rest } = payload;
  const out: Record<string, unknown> = { ...rest };
  if (mix !== undefined) out.borrowed = mix;
  const kind = (decision as { kind?: unknown } | undefined)?.kind;
  if (kind === "accept" || kind === "revise") {
    out.verdict = { ...(decision as object), kind: kind === "accept" ? "use" : "revise" };
  }
  if (resolved !== undefined) out.archived = resolved;
  return out;
}

// `surfaces` with every `<mockpit-slot>` tag spelled `<mockpit-instance>`, or null
// when none has one. Only html is markup; a code or markdown surface may quote
// the tag as text.
function slotTagsToInstance(surfaces: Surface[]): Surface[] | null {
  let changed = false;
  const out = surfaces.map((s) => {
    if (s.kind !== "html" || !/<\/?mockpit-slot\b/i.test(s.html)) return s;
    changed = true;
    return { ...s, html: s.html.replace(/<(\/?)mockpit-slot\b/gi, "<$1mockpit-instance") };
  });
  return changed ? out : null;
}

// What the post cache may hold by default, in stored surface characters: a
// Durable Object has 128 MB in all.
const POST_CACHE_BYTES = 32 * 1024 * 1024;

const surfaceHeads = (surfaces: Surface[]): string =>
  JSON.stringify(
    surfaces.map((s): SurfaceHead => {
      if (s.kind !== "html") return { kind: s.kind };
      return {
        kind: s.kind,
        ...(s.poster ? { poster: s.poster } : {}),
        ...(s.poster && s.posterMode ? { posterMode: s.posterMode } : {}),
        ...(s.poster && s.posterMode && s.posterSystem !== undefined
          ? { posterSystem: s.posterSystem }
          : {}),
        ...(/<mockpit-instance|data-swap/i.test(s.html) ? { marked: true } : {}),
      };
    }),
  );

// One attribute of an open tag (after its name): the space before it, its name, and its
// value, quoted values read whole.
const TAG_ATTR = /(\s+)([^\s"'>/=]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

// An open tag, its quoted attribute values read whole so a ">" inside one doesn't end it.
const OPEN_TAG =
  /<[A-Za-z][\w:-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g;

// surfaceHeads in SQL, for the rows written before heads were: it runs without
// bringing a workspace's bodies into memory, which a Durable Object can't hold.
const SURFACE_HEADS_SQL = `CASE WHEN json_valid(surfaces) THEN (
  SELECT json_group_array(json(h)) FROM (
    SELECT '{"kind":' || json_quote(json_extract(value, '$.kind'))
      || CASE WHEN json_extract(value, '$.kind') = 'html' AND json_extract(value, '$.poster') <> ''
           THEN ',"poster":' || json_quote(json_extract(value, '$.poster')) ELSE '' END
      || CASE WHEN json_extract(value, '$.kind') = 'html'
             AND (json_extract(value, '$.html') LIKE '%<mockpit-instance%'
               OR json_extract(value, '$.html') LIKE '%data-swap%')
           THEN ',"marked":true' ELSE '' END
      || '}' AS h
    FROM json_each(surfaces) ORDER BY key
  )
) ELSE '[]' END`;

// Everything a head row needs, spelled out because `SELECT *` reads the bodies.
const POST_HEAD_COLUMNS =
  "id, sessionId, designId, state, variant, status, title, head, knobs, slots, createdAt, updatedAt, version, curFrom, curPrompt, curAuthor, description, forkedFrom, copiedFrom, starred, acceptedVersion, hiddenVersions, curSession, amendedAt, rewrites, archiveReason, stayedVersion, archivedAt";

// Holding every column a head reads, so listing a project's alternatives never touches
// a row with a body: those columns sit after `surfaces`, and reaching them through
// the table walks the body's overflow pages. Any column added to the heads belongs
// here too (it is built from them), under a new index name so the old one is replaced.
const POST_HEADS_INDEX = `designId, ${POST_HEAD_COLUMNS.split(", ")
  .filter((c) => c !== "designId")
  .join(", ")}`;

const POST_COLUMNS = `
  id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, designId TEXT NOT NULL, state TEXT,
  variant TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', title TEXT NOT NULL,
  surfaces TEXT NOT NULL, knobs TEXT, slots TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL,
  curFrom INTEGER, curPrompt TEXT, curAuthor TEXT, description TEXT`;

// Store implementation on SQLite — a Durable Object's `ctx.storage.sql` in the
// Worker, or node:sqlite via an adapter on Node (see server/sqliteStorage.ts).
// One workspace = one database, so plain SQL with no tenant columns.
export class SqlStore implements Store {
  private sql: SqlStorage;
  // Cached set of asset ids referenced by any live surface (current or a
  // historical version of any post). Built lazily and maintained incrementally
  // — post writes add to it, removes invalidate it — so isAssetReferenced (hit
  // on every /a/:id miss) and putAsset's eviction scan don't re-parse every
  // post's surfaces on each call. Stays correct because history is append-only:
  // an asset id once referenced stays referenced until its post is deleted.
  private assetRefCache: Set<string> | undefined;
  // Parsed posts per design, least recently used first. A component is read again
  // for every instance that shows it, and parsing its bodies each time is what a
  // page full of instances would wait on. A statement that writes posts or versions
  // drops all of it unless `writingPosts` says which posts it touches; the byte
  // budget keeps a Durable Object's memory bounded.
  private postCache = new Map<string, { posts: Post[]; bytes: number }>();
  private postCacheBytes = 0;
  private postCacheLimit: number;
  // Past the cache's drop, for a write that patches the cache itself.
  private raw: SqlStorage;
  private holdPostDrop = false;

  constructor(sql: SqlStorage, opts: { postCacheBytes?: number } = {}) {
    this.raw = sql;
    this.postCacheLimit = opts.postCacheBytes ?? POST_CACHE_BYTES;
    const drop = () => {
      if (this.holdPostDrop) return;
      this.postCache.clear();
      this.postCacheBytes = 0;
    };
    this.sql = {
      exec: (query, ...bindings) => {
        if (!/^\s*SELECT\b/i.test(query) && /\bpost(s|_versions)\b/i.test(query)) drop();
        return sql.exec(query, ...bindings);
      },
      ...(sql.transactionSync
        ? {
            transactionSync: <T>(fn: () => T): T => {
              try {
                return sql.transactionSync!(fn);
              } catch (err) {
                // Reads inside a rolled-back transaction may have cached its writes.
                drop();
                throw err;
              }
            },
          }
        : {}),
    };
    this.atomic(() => this.migrate());
  }

  // On a Durable Object the synchronous writes of one event already commit as a
  // unit, so its SqlStorage has no transactionSync; node:sqlite provides one.
  private atomic<T>(fn: () => T): T {
    return this.sql.transactionSync ? this.sql.transactionSync(fn) : fn();
  }

  private tables(): Set<string> {
    return new Set(
      this.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((t) => t.name as string),
    );
  }

  private columns(table: string): Set<string> {
    return new Set(
      this.sql
        .exec(`SELECT name FROM pragma_table_info('${table}')`)
        .toArray()
        .map((c) => c.name as string),
    );
  }

  // SQLite has no ADD COLUMN IF NOT EXISTS, so probe and patch.
  private addMissing(table: string, columns: Record<string, string>) {
    const have = this.columns(table);
    for (const [name, decl] of Object.entries(columns)) {
      if (!have.has(name)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
    }
  }

  // What was called a mock is a design, in the store as everywhere else. First of all
  // the migrations: every one below it speaks the new names, and a workspace with no
  // designs table would otherwise read as older than mocks.
  // The words stored inside JSON and values, once every older migration has written
  // its own: a kind, what an answer's comment is called, and an archive in a reply.
  private migrateToDesignWords() {
    const kinds: Record<string, string> = { page: "screen", sketch: "idea" };
    for (const [from, to] of Object.entries(kinds)) {
      this.sql.exec("UPDATE designs SET kind = ? WHERE kind = ?", to, from);
    }
    const renameKeys = (o: Record<string, unknown>, names: Record<string, string>) => {
      let changed = false;
      for (const [from, to] of Object.entries(names)) {
        if (from in o) {
          o[to] = o[from];
          delete o[from];
          changed = true;
        }
      }
      return changed;
    };
    for (const r of this.sql.exec("SELECT id, asks, draft FROM designs").toArray()) {
      const asks = parseJson<Record<string, unknown>[]>(r.asks, []);
      let asksChanged = false;
      for (const ask of asks) {
        if (renameKeys(ask, { note: "comment", noteImages: "commentImages" })) asksChanged = true;
      }
      if (asksChanged) {
        this.sql.exec(
          "UPDATE designs SET asks = ? WHERE id = ?",
          JSON.stringify(asks),
          r.id as string,
        );
      }
      const draft = parseJson<Record<string, unknown> | null>(r.draft, null);
      if (draft && renameKeys(draft, { notes: "askComments", noteImages: "askCommentImages" })) {
        this.sql.exec(
          "UPDATE designs SET draft = ? WHERE id = ?",
          JSON.stringify(draft),
          r.id as string,
        );
      }
    }
    for (const r of this.sql
      .exec("SELECT seq, payload FROM comments WHERE kind = 'reply' AND payload IS NOT NULL")
      .toArray()) {
      const payload = parseJson<Record<string, unknown> | null>(r.payload, null);
      if (!payload) continue;
      let changed = renameKeys(payload, {
        notes: "askComments",
        noteImages: "askCommentImages",
        closed: "archived",
      });
      const edited = payload.edited as Record<string, unknown> | undefined;
      if (edited) {
        if (typeof edited.kind === "string" && edited.kind in kinds) {
          edited.kind = kinds[edited.kind];
          changed = true;
        }
        if ("grouped" in edited) {
          delete edited.grouped;
          changed = true;
          // All it said was about grouping, which no longer exists: it would read as a blank line.
          if (!Object.keys(edited).length) {
            this.sql.exec("DELETE FROM comments WHERE seq = ?", r.seq as number);
            continue;
          }
        }
      }
      if (changed) {
        this.sql.exec(
          "UPDATE comments SET payload = ? WHERE seq = ?",
          JSON.stringify(payload),
          r.seq as number,
        );
      }
    }
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('designWords', '1')");
  }

  // A value, so migrateToDesignWords' renames never reached it, and that one has
  // already run on every workspace that needs this.
  private migrateAskScopeWord() {
    for (const r of this.sql.exec("SELECT id, asks FROM designs").toArray()) {
      const asks = parseJson<Record<string, unknown>[]>(r.asks, []);
      const old = asks.filter((a) => a.scope === "mock");
      if (!old.length) continue;
      for (const a of old) a.scope = "design";
      this.sql.exec(
        "UPDATE designs SET asks = ? WHERE id = ?",
        JSON.stringify(asks),
        r.id as string,
      );
    }
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('askScopeWord', '1')");
  }

  // Rewrites one JSON column of every row through `fix`, which returns whether it
  // changed the value in place.
  private rewriteJson(
    table: string,
    key: string,
    column: string,
    fix: (value: unknown, id: string | number) => boolean,
    where = `${column} IS NOT NULL`,
  ) {
    for (const r of this.sql
      .exec(`SELECT ${key}, ${column} FROM ${table} WHERE ${where}`)
      .toArray()) {
      const value = parseJson<unknown>(r[column], null);
      if (value === null || !fix(value, r[key] as string | number)) continue;
      this.sql.exec(
        `UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`,
        JSON.stringify(value),
        r[key] as string | number,
      );
    }
  }

  // What the user chooses between is an alternative: the stored JSON that names one
  // (ask options, the built-in question's ids, verdicts, reactions, standings, forks
  // and copies) says so. A component instance still names its variant, and the posts
  // column keeps its name.
  private migrateToAlternativeWords() {
    const OLD = /^variant(:|$)/;
    const renameKey = (o: unknown): boolean => {
      if (!o || typeof o !== "object" || !("variant" in o)) return false;
      const rec = o as Record<string, unknown>;
      rec.alternative = rec.variant;
      delete rec.variant;
      return true;
    };
    const ANSWER_MAPS = ["answers", "others", "askComments", "otherImages", "askCommentImages"];
    type Rec = Record<string, unknown>;
    const asRec = (v: unknown): Rec | null => (v && typeof v === "object" ? (v as Rec) : null);
    const designs = this.sql
      .exec("SELECT id, project, asks, draft, standings, sets FROM designs")
      .toArray()
      .map((r) => ({
        id: r.id as string,
        project: r.project as string,
        asks: parseJson<Rec[]>(r.asks, []),
        draft: parseJson<Rec | null>(r.draft, null),
        standings: parseJson<Rec>(r.standings, {}),
        sets: parseJson<Rec[]>(r.sets, []),
      }));
    const replies = this.sql
      .exec(
        "SELECT seq, designId, payload FROM comments WHERE kind = 'reply' AND payload IS NOT NULL",
      )
      .toArray()
      .map((r) => ({
        seq: r.seq as number,
        designId: r.designId as string | null,
        payload: parseJson<Rec | null>(r.payload, null),
      }));
    // Every question id a design's data names: its asks and what answered them.
    const idsOf = (d: (typeof designs)[number], own: typeof replies): string[] => {
      const ids: string[] = [];
      const keys = (v: unknown) => ids.push(...Object.keys(asRec(v) ?? {}));
      const answered = (o: Rec | null) => {
        if (!o) return;
        for (const field of ANSWER_MAPS) keys(o[field]);
      };
      for (const a of d.asks) {
        if (typeof a.id === "string") ids.push(a.id);
        if (typeof a.after === "string") ids.push(a.after);
      }
      answered(d.draft);
      keys(d.standings);
      for (const c of d.sets) keys(c.answers);
      for (const { payload } of own) {
        answered(payload);
        keys(payload?.standings);
        ids.push(...((asRec(payload?.archived)?.dismissed as string[] | undefined) ?? []));
        for (const field of ["more", "update"]) {
          const ask = asRec(payload?.[field])?.ask;
          if (typeof ask === "string") ids.push(ask);
        }
      }
      return ids;
    };
    // The built-in question's ids become the new built-in's, unless an agent already asked a
    // question under that id: its answers stand, and the old built-in's take the next free
    // id instead (`alternative-2`, `alternative-2:<state>`), so no answer is overwritten.
    const mapFor = (ids: string[]): Map<string, string> => {
      const taken = new Set(ids.filter((id) => !OLD.test(id)));
      const map = new Map<string, string>();
      for (const old of [...new Set(ids.filter((id) => OLD.test(id)))].sort()) {
        const rest = old.slice("variant".length);
        let to = `alternative${rest}`;
        for (let n = 2; taken.has(to); n++) to = `alternative-${n}${rest}`;
        taken.add(to);
        map.set(old, to);
      }
      return map;
    };
    const byAskId = (v: unknown, map: Map<string, string>): unknown => {
      const rec = asRec(v);
      if (!rec || !Object.keys(rec).some((k) => map.has(k))) return v;
      return Object.fromEntries(Object.entries(rec).map(([k, x]) => [map.get(k) ?? k, x]));
    };
    const answered = (o: Rec, map: Map<string, string>) => {
      for (const field of ANSWER_MAPS)
        if (o[field] !== undefined) o[field] = byAskId(o[field], map);
      for (const c of (o.comments as unknown[] | undefined) ?? []) renameKey(c);
    };
    const standings = (v: unknown, map: Map<string, string>): unknown => {
      const next = byAskId(v, map);
      for (const st of Object.values(asRec(next) ?? {}) as { hidden?: unknown[] }[]) {
        for (const h of st?.hidden ?? []) renameKey(h);
      }
      return next;
    };
    const maps = new Map<string, Map<string, string>>();
    for (const d of designs) {
      const own = replies.filter((r) => r.designId === d.id);
      const map = mapFor(idsOf(d, own));
      maps.set(d.id, map);
      const id = (x: string) => map.get(x) ?? x;
      for (const a of d.asks) {
        if (typeof a.id === "string") a.id = id(a.id);
        if (typeof a.after === "string") a.after = id(a.after);
        for (const o of (a.options as unknown[] | undefined) ?? []) renameKey(o);
      }
      if (d.draft) answered(d.draft, map);
      const nextStandings = standings(d.standings, map);
      for (const c of d.sets) c.answers = byAskId(c.answers, map);
      this.sql.exec(
        "UPDATE designs SET asks = ?, draft = ?, standings = ?, sets = ? WHERE id = ?",
        JSON.stringify(d.asks),
        d.draft ? JSON.stringify(d.draft) : null,
        JSON.stringify(nextStandings),
        JSON.stringify(d.sets),
        d.id,
      );
      for (const r of own) {
        const reply = r.payload;
        if (!reply) continue;
        answered(reply, map);
        if (reply.standings !== undefined) reply.standings = standings(reply.standings, map);
        renameKey(reply.verdict);
        const archived = asRec(reply.archived);
        if (Array.isArray(archived?.dismissed)) archived.dismissed = archived.dismissed.map(id);
        for (const field of ["more", "update"]) {
          const at = asRec(reply[field]);
          if (typeof at?.ask === "string") at.ask = id(at.ask);
        }
        this.sql.exec(
          "UPDATE comments SET payload = ? WHERE seq = ?",
          JSON.stringify(reply),
          r.seq,
        );
      }
    }
    // A hand edit to the decision log is keyed by the question's id: it follows the rename,
    // its text, removal and basis as they were.
    for (const r of this.sql
      .exec("SELECT key, value FROM settings WHERE key LIKE ?", `${DECISION_EDITS_SETTING}:%`)
      .toArray()) {
      const edits = parseJson<Rec>(r.value, {});
      let changed = false;
      const next = Object.fromEntries(
        Object.entries(edits).map(([key, edit]) => {
          const m = /^ask:([^:]+):(.*)$/s.exec(key);
          const to = m ? maps.get(m[1])?.get(m[2]) : undefined;
          if (!m || !to) return [key, edit];
          changed = true;
          return [`ask:${m[1]}:${to}`, edit];
        }),
      );
      if (changed) {
        this.sql.exec(
          "UPDATE settings SET value = ? WHERE key = ?",
          JSON.stringify(next),
          r.key as string,
        );
      }
    }
    this.rewriteJson("posts", "id", "forkedFrom", renameKey);
    this.rewriteJson("posts", "id", "copiedFrom", renameKey);
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('alternativeWords', '1')");
  }

  // Rewrites the html of every stored version, current and past, through `fix`. Only
  // rows `like` matches are read, and each rewritten row's head is worked out again.
  private rewriteStoredHtml(like: string, fix: (html: string, designId: string | null) => string) {
    const rewrite = (raw: SqlStorageValue, designId: string | null): string | null => {
      const surfaces = parseJson<Surface[]>(raw, []);
      let changed = false;
      for (const s of surfaces) {
        if (s.kind !== "html") continue;
        const next = fix(s.html, designId);
        if (next !== s.html) {
          s.html = next;
          changed = true;
        }
      }
      return changed ? JSON.stringify(surfaces) : null;
    };
    for (const r of this.sql
      .exec("SELECT id, designId, surfaces FROM posts WHERE surfaces LIKE ?", like)
      .toArray()) {
      const next = rewrite(r.surfaces, r.designId as string);
      if (!next) continue;
      this.sql.exec("UPDATE posts SET surfaces = ? WHERE id = ?", next, r.id as string);
      this.sql.exec(`UPDATE posts SET head = ${SURFACE_HEADS_SQL} WHERE id = ?`, r.id as string);
    }
    for (const r of this.sql
      .exec(
        "SELECT v.postId, v.version, v.surfaces, p.designId FROM post_versions v LEFT JOIN posts p ON p.id = v.postId WHERE v.surfaces LIKE ?",
        like,
      )
      .toArray()) {
      const next = rewrite(r.surfaces, (r.designId as string | null) ?? null);
      if (!next) continue;
      this.sql.exec(
        "UPDATE post_versions SET surfaces = ? WHERE postId = ? AND version = ?",
        next,
        r.postId as string,
        r.version as number,
      );
      this.sql.exec(
        `UPDATE post_versions SET head = ${SURFACE_HEADS_SQL} WHERE postId = ? AND version = ?`,
        r.postId as string,
        r.version as number,
      );
    }
  }

  // What can go in a part is a swap: `data-swap` in every stored version, and `swap`
  // on the answers that bring one. Only an element that is a part was ever one: a page's
  // own `data-fill` elsewhere (a meter's level) stays as it is, and so do its selectors.
  private migrateToSwapWords() {
    const OLD_MARK = /^data-fill(-label|-default)?$/i;
    const unquote = (value: string) => {
      const v = value.replace(/^\s*=\s*/, "");
      return /^["']/.test(v) ? v.slice(1, -1) : v;
    };
    // One open tag's attributes, renamed by their name alone: a quoted value is read
    // whole, so text inside it never changes. What a part's `data-fill` held goes in `values`.
    const marks = (tag: string, values: Set<string>): string => {
      const name = /^<[A-Za-z][\w:-]*/.exec(tag)?.[0];
      if (!name) return tag;
      const body = tag.slice(name.length);
      const attrs = [...body.matchAll(TAG_ATTR)].map((a) => a[2].toLowerCase());
      if (!attrs.includes("data-part") || !attrs.some((a) => OLD_MARK.test(a))) return tag;
      return (
        name +
        body.replace(TAG_ATTR, (all, space: string, attr: string, value = "") => {
          if (!OLD_MARK.test(attr)) return all;
          if (attr.toLowerCase() === "data-fill") values.add(unquote(value));
          return `${space}data-swap${attr.slice("data-fill".length)}${value}`;
        })
      );
    };
    // A `[data-fill…]` in one selector (a rule's whole prelude, or one string in a script)
    // was a swap's only where nothing else could be meant: compared to a value some part
    // carried, or, without one, beside a `data-part`. Every other one is the page's own.
    const OLD_SELECTOR =
      /\[(\s*)data-fill(-label|-default)?(?![\w-])((?:[^\]"']|"[^"]*"|'[^']*')*)\]/gi;
    const selector = (text: string, values: Set<string>): string => {
      if (!/data-fill/i.test(text)) return text;
      const nearPart = /\[\s*data-part(?![\w-])/i.test(text);
      return text.replace(OLD_SELECTOR, (all, space: string, suffix = "", rest: string) => {
        const equals = /^\s*=\s*(\\?["']?)([\s\S]*?)\1(?:\s+[is])?\s*$/i.exec(rest);
        const swap = suffix
          ? nearPart
          : equals
            ? values.has(equals[2])
            : rest.trim() === "" && nearPart;
        return swap ? `[${space}data-swap${suffix}${rest}]` : all;
      });
    };
    // Each rule's prelude, read past strings and comments so a brace inside one isn't a rule.
    const CSS_TOKEN = /"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\/\*[\s\S]*?\*\/|[{};]/g;
    const inCss = (css: string, values: Set<string>): string => {
      let out = "";
      let from = 0;
      for (const m of css.matchAll(CSS_TOKEN)) {
        if (m[0].length !== 1) continue;
        const prelude = css.slice(from, m.index);
        out += (m[0] === "{" ? selector(prelude, values) : prelude) + m[0];
        from = m.index + 1;
      }
      return out + css.slice(from);
    };
    const JS_STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`/g;
    const inScript = (js: string, values: Set<string>): string =>
      js.replace(JS_STRING, (s) => selector(s, values));
    const page = (html: string, values: Set<string>): string => {
      const own = new Set<string>();
      let marked = false;
      const next = html.replace(OPEN_TAG, (tag) => {
        const renamed = marks(tag, own);
        if (renamed !== tag) marked = true;
        return renamed;
      });
      if (!marked) return html;
      for (const v of own) values.add(v);
      return next.replace(
        /(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
        (_, open: string, tag: string, body: string, close: string) =>
          open + (tag.toLowerCase() === "style" ? inCss(body, own) : inScript(body, own)) + close,
      );
    };
    // The values each design's parts carried, in any version: an answer's style may name them.
    const carried = new Map<string, Set<string>>();
    const valuesOf = (designId: string): Set<string> => {
      let values = carried.get(designId);
      if (!values) carried.set(designId, (values = new Set()));
      return values;
    };
    this.rewriteStoredHtml("%data-fill%", (html, designId) =>
      page(html, designId ? valuesOf(designId) : new Set()),
    );
    // An answer: its swap renamed, and its style read against what its swap and its
    // design's pages carried. A swap a render adds is marked with the answer's value, and
    // the part it joins with the as-is one, so those were carried too.
    const answer = (o: Record<string, unknown>, designId: string): boolean => {
      const values = new Set(carried.get(designId));
      let changed = false;
      if ("fill" in o) {
        const set = o.set && typeof o.set === "object" ? Object.values(o.set) : [];
        for (const v of [o.value, ...set, AS_IS_SWAP]) if (typeof v === "string") values.add(v);
        o.swap = typeof o.fill === "string" ? page(o.fill, values) : o.fill;
        delete o.fill;
        changed = true;
      }
      if (values.size > 0 && typeof o.style === "string") {
        const next = inCss(o.style, values);
        if (next !== o.style) {
          o.style = next;
          changed = true;
        }
      }
      return changed;
    };
    this.rewriteJson("designs", "id", "asks", (asks, id) => {
      let changed = false;
      for (const a of asks as { options?: Record<string, unknown>[] }[]) {
        for (const o of a.options ?? []) changed = answer(o, id as string) || changed;
      }
      return changed;
    });
    this.rewriteJson("designs", "id", "answerAdditions", (list, id) => {
      let changed = false;
      for (const a of list as Record<string, unknown>[])
        changed = answer(a, id as string) || changed;
      return changed;
    });
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('swapWords', '1')");
  }

  // An included component is an instance: every stored version, and every answer that
  // brings a page or a swap, spells its tag `<mockpit-instance>`, and the pages that style
  // the wrapper it renders into name `data-mockpit-instance`.
  private migrateToInstanceWords() {
    const tags = (html: string) =>
      html
        .replace(/<(\/?)mockpit-embed(?=[\s/>])/gi, "<$1mockpit-instance")
        .replace(/data-mockpit-embed\b/g, "data-mockpit-instance");
    this.rewriteStoredHtml("%mockpit-embed%", tags);
    // An answer's style is CSS alone: the tag's name and the wrapper's attribute as selectors.
    const styles = (css: string) =>
      css.replace(/(?<![\w-])(data-)?mockpit-embed(?![\w-])/g, "$1mockpit-instance");
    const pages = (o: Record<string, unknown>): boolean => {
      let changed = false;
      for (const [field, fix] of [
        ["html", tags],
        ["swap", tags],
        ["style", styles],
      ] as const) {
        const v = o[field];
        if (typeof v === "string" && fix(v) !== v) {
          o[field] = fix(v);
          changed = true;
        }
      }
      return changed;
    };
    this.rewriteJson("designs", "id", "asks", (asks) => {
      let changed = false;
      for (const a of asks as { options?: Record<string, unknown>[] }[]) {
        for (const o of a.options ?? []) changed = pages(o) || changed;
      }
      return changed;
    });
    this.rewriteJson("designs", "id", "answerAdditions", (list) => {
      let changed = false;
      for (const a of list as Record<string, unknown>[]) changed = pages(a) || changed;
      return changed;
    });
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('instanceWords', '1')");
  }

  // A saved combination of answers is a combo: a reply that put one in use names it so.
  // The designs column keeps its first name, `sets`.
  private migrateToComboWords() {
    this.rewriteJson(
      "comments",
      "seq",
      "payload",
      (p) => {
        const reply = p as Record<string, unknown>;
        if (typeof reply.set !== "string") return false;
        reply.combo = reply.set;
        delete reply.set;
        return true;
      },
      "kind = 'reply' AND payload LIKE '%\"set\":%'",
    );
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('comboWords', '1')");
  }

  private renameMocksToDesigns() {
    if (!this.tables().has("mocks") || this.tables().has("designs")) return;
    for (const name of [
      "mockpit_mocks_slug_idx",
      "mockpit_mocks_updated_at_idx",
      "mockpit_posts_mock_idx",
      "mockpit_comments_mock_seq_idx",
      "mockpit_posts_copies_idx",
    ]) {
      this.sql.exec(`DROP INDEX IF EXISTS ${name}`);
    }
    this.sql.exec("ALTER TABLE mocks RENAME TO designs");
    for (const table of ["posts", "comments"]) {
      if (this.columns(table).has("mockId")) {
        this.sql.exec(`ALTER TABLE ${table} RENAME COLUMN mockId TO designId`);
      }
    }
    // Steps and copy references are stored as JSON, keyed by the old word.
    const renamed = (raw: unknown) =>
      typeof raw === "string" ? raw.replaceAll('"mock":', '"design":') : raw;
    for (const r of this.sql.exec("SELECT project, name, steps FROM flows").toArray()) {
      this.sql.exec(
        "UPDATE flows SET steps = ? WHERE project = ? AND name = ?",
        renamed(r.steps) as string,
        r.project as string,
        r.name as string,
      );
    }
    // Only the key: a user's text can hold the same letters, escaped inside its string.
    for (const r of this.sql
      .exec("SELECT seq, payload FROM comments WHERE payload LIKE '%\"mockId\":%'")
      .toArray()) {
      this.sql.exec(
        "UPDATE comments SET payload = ? WHERE seq = ?",
        (r.payload as string).replace(/(?<!\\)"mockId":/g, '"designId":'),
        r.seq as number,
      );
    }
    // The same release gave the design's archive fields and an alternative's description
    // their names; the JSON that speaks these words waits for migrateToDesignWords.
    const designCols = this.columns("designs");
    if (designCols.has("closedAt")) {
      this.sql.exec("ALTER TABLE designs RENAME COLUMN closedAt TO archivedAt");
    }
    if (designCols.has("closeReason")) {
      this.sql.exec("ALTER TABLE designs RENAME COLUMN closeReason TO archiveReason");
    }
    if (this.columns("posts").has("note")) {
      this.sql.exec("ALTER TABLE posts RENAME COLUMN note TO description");
    }
    if (this.columns("posts").has("copiedFrom")) {
      for (const r of this.sql
        .exec("SELECT id, copiedFrom FROM posts WHERE copiedFrom IS NOT NULL")
        .toArray()) {
        this.sql.exec(
          "UPDATE posts SET copiedFrom = ? WHERE id = ?",
          renamed(r.copiedFrom) as string,
          r.id as string,
        );
      }
    }
  }

  private migrate() {
    this.renameMocksToDesigns();
    const before = this.tables();
    // Deployed Durable Objects can never be reset, so a workspace written by a
    // build from before designs existed is lifted in place (see migrateLegacy).
    const legacy = before.has("posts") && !before.has("designs");
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT, cwd TEXT,
        createdAt TEXT NOT NULL, lastActiveAt TEXT NOT NULL,
        agentSeq INTEGER NOT NULL DEFAULT 0, project TEXT, key TEXT, agentActiveAt TEXT
      );
      CREATE TABLE IF NOT EXISTS designs (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'idea', states TEXT NOT NULL DEFAULT '[]',
        asks TEXT NOT NULL DEFAULT '[]', knobs TEXT NOT NULL DEFAULT '{}', draft TEXT,
        sessionId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        widths TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS posts (${POST_COLUMNS});
      CREATE TABLE IF NOT EXISTS post_versions (
        postId TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL,
        surfaces TEXT NOT NULL, at TEXT NOT NULL,
        fromVersion INTEGER, prompt TEXT, author TEXT,
        PRIMARY KEY (postId, version)
      );
      CREATE TABLE IF NOT EXISTS comments (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL,
        sessionId TEXT NOT NULL, designId TEXT, postId TEXT,
        author TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'comment', anchor TEXT, anchors TEXT NOT NULL DEFAULT '[]',
        postVersion INTEGER, viewport INTEGER, payload TEXT
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, kind TEXT NOT NULL,
        contentType TEXT NOT NULL, byteLength INTEGER NOT NULL, filename TEXT,
        data BLOB NOT NULL, createdAt TEXT NOT NULL, lastAccessedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS flows (
        project TEXT NOT NULL, name TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        PRIMARY KEY (project, name)
      );
      CREATE TABLE IF NOT EXISTS systems (
        project TEXT PRIMARY KEY, rev INTEGER NOT NULL, json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS system_revisions (
        project TEXT NOT NULL, rev INTEGER NOT NULL, json TEXT NOT NULL, at TEXT NOT NULL,
        sessionId TEXT, summary TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (project, rev)
      );
    `);
    this.addMissing("sessions", {
      agentSeq: "INTEGER NOT NULL DEFAULT 0",
      project: "TEXT",
      key: "TEXT",
      agentActiveAt: "TEXT",
    });
    // The close column's first name.
    const designCols = this.columns("designs");
    if (designCols.has("resolvedAt") && !designCols.has("archivedAt")) {
      this.sql.exec("ALTER TABLE designs RENAME COLUMN resolvedAt TO archivedAt");
    }
    const specced = this.columns("designs").has("spec");
    this.addMissing("designs", {
      widths: "TEXT NOT NULL DEFAULT '[]'",
      archivedAt: "TEXT",
      archiveReason: "TEXT",
      area: "TEXT",
      // A design's `group`; the plain word is an SQL keyword.
      libraryGroup: "TEXT",
      source: "TEXT",
      shortlist: "INTEGER NOT NULL DEFAULT 0",
      variants: "INTEGER NOT NULL DEFAULT 0",
      // A design's `for`, another SQL keyword.
      forDesign: "TEXT",
      becomes: "TEXT",
      spec: "TEXT",
      ready: "TEXT",
      stateOutlines: "TEXT NOT NULL DEFAULT '{}'",
      answerAdditions: "TEXT NOT NULL DEFAULT '[]'",
      standings: "TEXT NOT NULL DEFAULT '{}'",
      sets: "TEXT NOT NULL DEFAULT '[]'",
    });
    if (!specced) this.migrateNotesToSpec();
    this.migrateReadyStates();
    this.migrateAreaOrder();
    this.migrateSituations();
    // Before the legacy lift, whose history rows are written with every column.
    this.addMissing("post_versions", {
      sessionId: "TEXT",
      amendedAt: "TEXT",
      contract: "INTEGER",
      system: "INTEGER",
    });
    if (legacy) this.migrateLegacy();
    // After the legacy lift, which rebuilds posts from POST_COLUMNS alone.
    const pinned = this.columns("posts").has("acceptedVersion");
    const dated = this.columns("posts").has("archivedAt");
    this.addMissing("posts", {
      description: "TEXT",
      forkedFrom: "TEXT",
      copiedFrom: "TEXT",
      // Inert: kept answers (`Design.standings`) took over from the star.
      starred: "INTEGER NOT NULL DEFAULT 0",
      acceptedVersion: "INTEGER",
      hiddenVersions: "TEXT",
      curSession: "TEXT",
      amendedAt: "TEXT",
      rewrites: "INTEGER NOT NULL DEFAULT 0",
      archiveReason: "TEXT",
      stayedVersion: "INTEGER",
      archivedAt: "TEXT",
      curContract: "INTEGER",
      curSystem: "INTEGER",
    });
    // Before the pin, accepted meant "its latest": freeze that as the version in use.
    if (!pinned) {
      this.sql.exec("UPDATE posts SET acceptedVersion = version WHERE status = 'accepted'");
    }
    for (const table of ["posts", "post_versions"]) {
      if (this.columns(table).has("head")) continue;
      this.addMissing(table, { head: "TEXT" });
      this.sql.exec(`UPDATE ${table} SET head = ${SURFACE_HEADS_SQL}`);
    }
    if (this.settingSync("sketchKind") !== "1") this.migrateToSketches();
    this.migrateSystems();
    if (this.settingSync("contractTerms") !== "1") this.migrateToContractTerms();
    if (this.settingSync("designWords") !== "1") this.migrateToDesignWords();
    if (this.settingSync("askScopeWord") !== "1") this.migrateAskScopeWord();
    if (this.settingSync("alternativeWords") !== "1") this.migrateToAlternativeWords();
    if (this.settingSync("swapWords") !== "1") this.migrateToSwapWords();
    if (this.settingSync("instanceWords") !== "1") this.migrateToInstanceWords();
    if (this.settingSync("comboWords") !== "1") this.migrateToComboWords();
    // The day it went was never kept, and the design's last change is the nearest thing.
    // Frozen now, or the next reason or draft on the design would move it to that day.
    if (!dated) {
      this.sql.exec(
        "UPDATE posts SET archivedAt = (SELECT updatedAt FROM designs WHERE designs.id = posts.designId) WHERE status = 'archived'",
      );
    }
    this.createIndexes();
  }

  // Notes were one block of text, and they become the spec's purpose: what it is for
  // was what a note mostly said. The column stays, empty, on a workspace that has it;
  // new workspaces never get one. A stored reply that told the agent of a hand edit
  // says so in the spec's words, so the Thread and an undelivered batch still read.
  private migrateNotesToSpec() {
    if (this.columns("designs").has("notes")) {
      // A user's notes were their words, which stood against agents: the purpose holds.
      this.sql.exec(
        `UPDATE designs SET spec = json_object(
           'purpose', json_extract(notes, '$.text'), 'behaviour', json('[]'),
           'by', json_extract(notes, '$.by'), 'at', json_extract(notes, '$.at')
         ), notes = NULL
         WHERE notes IS NOT NULL AND json_valid(notes) AND json_extract(notes, '$.text') != ''
           AND json_extract(notes, '$.by') IS NOT 'user'`,
      );
      this.sql.exec(
        `UPDATE designs SET spec = json_object(
           'purpose', json_extract(notes, '$.text'), 'behaviour', json('[]'),
           'by', 'user', 'at', json_extract(notes, '$.at'), 'held', json('["purpose"]')
         ), notes = NULL
         WHERE notes IS NOT NULL AND json_valid(notes) AND json_extract(notes, '$.text') != ''
           AND json_extract(notes, '$.by') = 'user'`,
      );
      this.sql.exec("UPDATE designs SET notes = NULL WHERE notes IS NOT NULL");
    }
    this.sql.exec(
      `UPDATE comments SET payload = json_remove(
         json_set(payload, '$.edited.spec', json_object('purpose', json_extract(payload, '$.edited.notes'))),
         '$.edited.notes')
       WHERE kind = 'reply' AND json_valid(payload) AND json_type(payload, '$.edited.notes') IS NOT NULL`,
    );
  }

  // The order Home lists a project's areas in became the areas themselves, each with
  // room for what it is for. Done on every boot: a key is moved once and then gone.
  private migrateAreaOrder() {
    const prefix = "areaOrder:";
    for (const row of this.sql
      .exec("SELECT key, value FROM settings WHERE key LIKE 'areaOrder:%'")
      .toArray()) {
      const project = (row.key as string).slice(prefix.length);
      const target = `${AREAS_SETTING}:${project}`;
      if (this.settingSync(target) === null) {
        const names = parseJson<unknown[]>(row.value, []).filter(
          (x): x is string => typeof x === "string",
        );
        const areas: ProjectArea[] = names.map((name) => ({ name, description: "" }));
        this.sql.exec(
          "INSERT INTO settings (key, value) VALUES (?, ?)",
          target,
          JSON.stringify(areas),
        );
      }
      this.sql.exec("DELETE FROM settings WHERE key = ?", row.key);
    }
  }

  // A situation was already a state of its own, filed in `states` under the name
  // feedback gave it ("Writing · Couldn't save"), with its asks, comments and posts
  // there too, so those keep that name and only the map that set it apart goes. The
  // column itself stays on a workspace that has it, empty: nothing reads it any more,
  // and new workspaces never get one.
  private migrateSituations() {
    if (!this.columns("designs").has("situations")) return;
    for (const r of this.sql
      .exec("SELECT id, states, situations FROM designs WHERE situations != '{}'")
      .toArray()) {
      const states = parseJson<string[]>(r.states, []);
      const map = parseJson<Record<string, string[]>>(r.situations, {});
      for (const [state, names] of Object.entries(map)) {
        for (const name of names) {
          const key = `${state} · ${name}`;
          if (!states.includes(key)) states.push(key);
        }
      }
      this.sql.exec(
        "UPDATE designs SET states = ?, situations = '{}' WHERE id = ?",
        JSON.stringify(states),
        r.id as string,
      );
    }
  }

  // A Ready mark first stored only its covers. It records the states the design declared
  // since, so a state declared later reads Changed; an older mark gets the states its
  // covers name, in the design's order, which says nothing of a state declared after it
  // and leaves a mark that still matches reading Ready. Only rows without `states`, so it
  // runs on every boot and changes nothing the second time.
  private migrateReadyStates() {
    for (const r of this.sql
      .exec(
        "SELECT id, states, ready FROM designs WHERE ready IS NOT NULL AND ready NOT LIKE '%\"states\"%'",
      )
      .toArray()) {
      const ready = parseJson<Omit<DesignReady, "states"> | null>(r.ready, null);
      if (!ready) continue;
      const order = parseJson<string[]>(r.states, []);
      const named = new Set(ready.covers.map((c) => c.state));
      const states = [
        ...order.filter((s) => named.has(s)),
        // A covered state renamed or removed since keeps its place after the rest.
        ...[...named].filter((s): s is string => s !== null && !order.includes(s)),
      ];
      this.sql.exec(
        "UPDATE designs SET ready = ? WHERE id = ?",
        JSON.stringify({ ...ready, states }),
        r.id as string,
      );
    }
  }

  // The agent contract renamed what replies and drafts store (mix → borrowed,
  // decision → verdict with accept → use, resolved → archived) and retired drop
  // and the `<mockpit-slot>` instance alias. Stored data is rewritten once, here,
  // so nothing past the store reads an old name: a dropped alternative is archived
  // (both were hidden from the choice and restorable), a drop verdict loses its
  // verdict (the alternative's archived status says the rest), and every stored
  // version spells its instances `<mockpit-instance>` so it still renders them.
  private migrateToContractTerms() {
    this.sql.exec(
      "UPDATE posts SET status = 'archived', acceptedVersion = NULL WHERE status = 'dropped'",
    );
    for (const r of this.sql
      .exec("SELECT seq, payload FROM comments WHERE kind = 'reply' AND payload IS NOT NULL")
      .toArray()) {
      const payload = parseJson<Record<string, unknown> | null>(r.payload, null);
      const next = payload && contractReply(payload);
      if (next) {
        this.sql.exec("UPDATE comments SET payload = ? WHERE seq = ?", JSON.stringify(next), r.seq);
      }
    }
    for (const r of this.sql
      .exec("SELECT id, draft FROM designs WHERE draft IS NOT NULL")
      .toArray()) {
      const draft = parseJson<Record<string, unknown> | null>(r.draft, null);
      if (!draft || !("mix" in draft)) continue;
      const { mix, ...rest } = draft;
      this.sql.exec(
        "UPDATE designs SET draft = ? WHERE id = ?",
        JSON.stringify({ ...rest, borrowed: mix ?? {} }),
        r.id as string,
      );
    }
    for (const r of this.sql
      .exec("SELECT id, surfaces FROM posts WHERE surfaces LIKE '%mockpit-slot%'")
      .toArray()) {
      const surfaces = slotTagsToInstance(parseJson<Surface[]>(r.surfaces, []));
      if (surfaces) {
        this.sql.exec(
          "UPDATE posts SET surfaces = ? WHERE id = ?",
          JSON.stringify(surfaces),
          r.id as string,
        );
      }
    }
    for (const r of this.sql
      .exec(
        "SELECT postId, version, surfaces FROM post_versions WHERE surfaces LIKE '%mockpit-slot%'",
      )
      .toArray()) {
      const surfaces = slotTagsToInstance(parseJson<Surface[]>(r.surfaces, []));
      if (surfaces) {
        this.sql.exec(
          "UPDATE post_versions SET surfaces = ? WHERE postId = ? AND version = ?",
          JSON.stringify(surfaces),
          r.postId as string,
          r.version as number,
        );
      }
    }
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('contractTerms', '1')");
  }

  private createIndexes() {
    this.sql.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS mockpit_designs_slug_idx ON designs (project, slug);
      CREATE INDEX IF NOT EXISTS mockpit_designs_updated_at_idx ON designs (updatedAt DESC);
      CREATE INDEX IF NOT EXISTS mockpit_posts_design_idx ON posts (designId, state, variant);
      CREATE INDEX IF NOT EXISTS mockpit_posts_session_created_at_idx ON posts (sessionId, createdAt);
      CREATE INDEX IF NOT EXISTS mockpit_posts_copies_idx ON posts (designId, state, variant, status, copiedFrom) WHERE copiedFrom IS NOT NULL;
      CREATE INDEX IF NOT EXISTS mockpit_posts_heads_idx ON posts (${POST_HEADS_INDEX});
      CREATE INDEX IF NOT EXISTS mockpit_post_versions_heads_idx ON post_versions (postId, version, head);
      CREATE INDEX IF NOT EXISTS mockpit_comments_session_seq_idx ON comments (sessionId, seq);
      CREATE INDEX IF NOT EXISTS mockpit_comments_design_seq_idx ON comments (designId, seq);
      CREATE INDEX IF NOT EXISTS mockpit_comments_post_seq_idx ON comments (postId, seq);
      CREATE INDEX IF NOT EXISTS mockpit_comments_id_idx ON comments (id);
      CREATE INDEX IF NOT EXISTS mockpit_assets_session_idx ON assets (sessionId);
      CREATE INDEX IF NOT EXISTS mockpit_sessions_key_idx ON sessions (key);
    `);
  }

  // --- in-place migration of a pre-design workspace ---

  private migrateLegacy() {
    this.addMissing("comments", {
      anchor: "TEXT",
      kind: "TEXT NOT NULL DEFAULT 'comment'",
      anchors: "TEXT NOT NULL DEFAULT '[]'",
      draft: "INTEGER NOT NULL DEFAULT 0",
      postVersion: "INTEGER",
      viewport: "INTEGER",
      designId: "TEXT",
      payload: "TEXT",
    });
    this.migrateToSurfaces();
    this.migrateToPosts();
    this.migrateSurfaceIds();
    this.migrateToItems();
    this.migrateToVersions();
    this.migrateToDesigns();
    this.sql.exec(`
      DROP TABLE IF EXISTS trace_steps;
      DROP INDEX IF EXISTS mockpit_comments_post_draft_idx;
      DROP INDEX IF EXISTS mockpit_posts_updated_at_idx;
      DROP INDEX IF EXISTS sideshow_posts_session_created_at_idx;
      DROP INDEX IF EXISTS sideshow_posts_updated_at_idx;
      DROP INDEX IF EXISTS sideshow_comments_session_seq_idx;
      DROP INDEX IF EXISTS sideshow_comments_post_seq_idx;
      DROP INDEX IF EXISTS sideshow_comments_id_idx;
      DROP INDEX IF EXISTS sideshow_assets_session_idx;
      DROP INDEX IF EXISTS sideshow_posts_variant_idx;
      DROP INDEX IF EXISTS sideshow_comments_post_draft_idx;
    `);
  }

  // Pre-0.5.0 workspaces stored a `snippets` table and `comments.snippetId`.
  private migrateToSurfaces() {
    const commentCols = this.columns("comments");
    if (commentCols.has("snippetId") && !commentCols.has("surfaceId")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN snippetId TO surfaceId");
    }
    if (commentCols.has("snippetTitle") && !commentCols.has("surfaceTitle")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN snippetTitle TO surfaceTitle");
    }
    if (!this.tables().has("snippets")) return;
    for (const r of this.sql.exec("SELECT * FROM snippets").toArray()) {
      const legacyHistory = parseJson<
        Array<{ version: number; title: string; html: string; at: string }>
      >(r.history, []);
      const history: PostVersion[] = legacyHistory.map((h) => ({
        version: h.version,
        title: h.title,
        surfaces: [htmlSurface(h.html)],
        at: h.at,
      }));
      this.sql.exec(
        "INSERT OR IGNORE INTO posts (id, sessionId, title, surfaces, createdAt, updatedAt, version, history) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        r.id as string,
        r.sessionId as string,
        r.title as string,
        JSON.stringify([htmlSurface(r.html as string)]),
        r.createdAt as string,
        r.updatedAt as string,
        r.version as number,
        JSON.stringify(history),
      );
    }
    this.sql.exec("DROP TABLE snippets");
  }

  // 0.5.x workspaces stored a `surfaces` table with a `parts` column and
  // `comments.surfaceId/surfaceTitle`.
  private migrateToPosts() {
    const commentCols = this.columns("comments");
    if (commentCols.has("surfaceId") && !commentCols.has("postId")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN surfaceId TO postId");
    }
    if (commentCols.has("surfaceTitle") && !commentCols.has("postTitle")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN surfaceTitle TO postTitle");
    }
    if (!this.tables().has("surfaces")) return;
    for (const r of this.sql.exec("SELECT * FROM surfaces").toArray()) {
      const history = parseJson<Array<Record<string, unknown>>>(r.history, []).map(
        ({ parts, ...rest }) => ({ ...rest, surfaces: parts ?? [] }),
      );
      this.sql.exec(
        "INSERT OR IGNORE INTO posts (id, sessionId, title, surfaces, createdAt, updatedAt, version, history) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        r.id as string,
        r.sessionId as string,
        r.title as string,
        r.parts as string,
        r.createdAt as string,
        r.updatedAt as string,
        r.version as number,
        JSON.stringify(history),
      );
    }
    this.sql.exec("DROP TABLE surfaces");
  }

  // Assign stable ids to surfaces written before surface ids existed.
  private migrateSurfaceIds() {
    if (this.settingSync("surfaceIdsMigrated") === "1") return;
    for (const r of this.sql.exec("SELECT id, surfaces, history FROM posts").toArray()) {
      const surfaces = normalizeSurfaceIds(parseJson<Surface[]>(r.surfaces, []));
      const history = parseJson<PostVersion[]>(r.history, []).map((h) => ({
        ...h,
        surfaces: normalizeSurfaceIds(h.surfaces ?? []),
      }));
      this.sql.exec(
        "UPDATE posts SET surfaces = ?, history = ? WHERE id = ?",
        JSON.stringify(surfaces),
        JSON.stringify(history),
        r.id as string,
      );
    }
  }

  // Before items, posts had no project/slug/alternative; derive them per post.
  private migrateToItems() {
    this.addMissing("posts", {
      project: "TEXT NOT NULL DEFAULT 'workspace'",
      slug: "TEXT NOT NULL DEFAULT ''",
      kind: "TEXT NOT NULL DEFAULT 'component'",
      variant: "TEXT NOT NULL DEFAULT 'default'",
      status: "TEXT NOT NULL DEFAULT 'open'",
      slots: "TEXT NOT NULL DEFAULT '[]'",
      curFrom: "INTEGER",
      curPrompt: "TEXT",
      curAuthor: "TEXT",
    });
    if (this.settingSync("itemsMigrated") === "1") return;
    const sessions = new Map<string, { project: string | null; cwd: string | null }>();
    for (const r of this.sql.exec("SELECT id, project, cwd FROM sessions").toArray()) {
      sessions.set(r.id as string, {
        project: (r.project as string) ?? null,
        cwd: (r.cwd as string) ?? null,
      });
    }
    const taken = new Map<string, Set<string>>();
    for (const r of this.sql
      .exec("SELECT id, sessionId, title, slug FROM posts ORDER BY createdAt ASC")
      .toArray()) {
      if (((r.slug as string) ?? "") !== "") continue;
      const session = sessions.get(r.sessionId as string);
      const project = session?.project || projectFromCwd(session?.cwd ?? null) || DEFAULT_PROJECT;
      let used = taken.get(project);
      if (!used) taken.set(project, (used = new Set<string>()));
      const base = slugify(r.title as string);
      const suffix = (r.id as string)
        .slice(0, 4)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "0");
      let slug = `${base}-${suffix}`;
      for (let n = 2; used.has(slug); n++) slug = `${base}-${suffix}-${n}`;
      used.add(slug);
      this.sql.exec(
        "UPDATE posts SET project = ?, slug = ? WHERE id = ?",
        project,
        slug,
        r.id as string,
      );
    }
  }

  // History used to live in a `history` JSON blob on the post row.
  private migrateToVersions() {
    if (this.settingSync("versionsMigrated") === "1") return;
    for (const r of this.sql.exec("SELECT id, history FROM posts").toArray()) {
      for (const h of parseJson<PostVersion[]>(r.history, [])) {
        this.insertVersion(r.id as string, {
          ...h,
          surfaces: normalizeSurfaceIds(h.surfaces ?? []),
        });
      }
    }
  }

  // Every (project, item slug) becomes one single-state design; its posts become
  // the design's alternatives with state null. Unsent operator drafts become the
  // design's draft so they are still there to send; decisions become plain
  // comments (they were already delivered).
  private migrateToDesigns() {
    const rows = this.sql.exec("SELECT * FROM posts ORDER BY createdAt ASC, rowid ASC").toArray();
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.project as string}\u0000${r.slug as string}`;
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
    const designOf = new Map<string, string>();
    const alternativeOf = new Map<string, string>();
    for (const group of groups.values()) {
      const first = group[0];
      const latest = group.reduce((a, b) =>
        (b.updatedAt as string) > (a.updatedAt as string) ? b : a,
      );
      const id = newId();
      this.sql.exec(
        "INSERT INTO designs (id, project, slug, title, kind, states, asks, knobs, draft, sessionId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, '[]', '[]', '{}', NULL, ?, ?, ?)",
        id,
        (first.project as string) || DEFAULT_PROJECT,
        (first.slug as string) || slugify(first.title as string),
        first.title as string,
        group.some((r) => r.kind === "page") ? "page" : "component",
        latest.sessionId as string,
        first.createdAt as string,
        latest.updatedAt as string,
      );
      const used = new Set<string>();
      for (const r of group) {
        const base = (r.variant as string) || DEFAULT_ALTERNATIVE;
        let alternative = base;
        for (let n = 2; used.has(alternative); n++) alternative = `${base}-${n}`;
        used.add(alternative);
        designOf.set(r.id as string, id);
        alternativeOf.set(r.id as string, alternative);
      }
    }

    this.sql.exec(`CREATE TABLE posts_next (${POST_COLUMNS})`);
    for (const r of rows) {
      const id = r.id as string;
      this.sql.exec(
        "INSERT INTO posts_next (id, sessionId, designId, state, variant, status, title, surfaces, knobs, slots, createdAt, updatedAt, version, curFrom, curPrompt, curAuthor) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
        id,
        r.sessionId as string,
        designOf.get(id)!,
        alternativeOf.get(id)!,
        (r.status as string) || "open",
        r.title as string,
        r.surfaces as string,
        (r.slots as string) || "[]",
        r.createdAt as string,
        r.updatedAt as string,
        r.version as number,
        r.curFrom ?? null,
        r.curPrompt ?? null,
        r.curAuthor ?? null,
      );
    }
    this.sql.exec("DROP TABLE posts");
    this.sql.exec("ALTER TABLE posts_next RENAME TO posts");

    this.sql.exec(
      "UPDATE comments SET designId = (SELECT designId FROM posts WHERE posts.id = comments.postId) WHERE designId IS NULL",
    );
    this.sql.exec(
      "UPDATE comments SET text = (CASE kind WHEN 'accept' THEN 'Accepted' WHEN 'revise' THEN 'Revise' ELSE 'Dropped' END) || (CASE WHEN text = '' THEN '' ELSE ': ' || text END), kind = 'comment' WHERE kind IN ('accept', 'revise', 'drop')",
    );

    const drafts = new Map<string, Draft>();
    for (const c of this.sql
      .exec("SELECT * FROM comments WHERE draft = 1 AND designId IS NOT NULL ORDER BY seq ASC")
      .toArray()) {
      const designId = c.designId as string;
      let draft = drafts.get(designId);
      if (!draft) {
        draft = {
          version: 1,
          answers: {},
          borrowed: {},
          tuned: {},
          comments: [],
          updatedAt: c.createdAt as string,
        };
        drafts.set(designId, draft);
      }
      draft.version = Math.max(draft.version, (c.postVersion as number) ?? 1);
      draft.comments.push({ part: null, state: null, text: c.text as string });
      draft.updatedAt = c.createdAt as string;
    }
    for (const [designId, draft] of drafts) {
      this.sql.exec("UPDATE designs SET draft = ? WHERE id = ?", JSON.stringify(draft), designId);
    }
    this.sql.exec("DELETE FROM comments WHERE draft = 1");
  }

  // A design no one declared used to be a component. Keep that only where it acts
  // as one, included somewhere or a step of a flow; the rest become sketches.
  private migrateToSketches() {
    const projectOf = new Map<string, string>();
    for (const r of this.sql.exec("SELECT id, project FROM designs").toArray()) {
      projectOf.set(r.id as string, r.project as string);
    }
    const used = new Set<string>();
    for (const r of this.sql.exec("SELECT designId, slots FROM posts").toArray()) {
      const project = projectOf.get(r.designId as string);
      for (const e of parseJson<Instance[]>(r.slots, [])) used.add(`${project}\u0000${e.slug}`);
    }
    for (const r of this.sql.exec("SELECT project, steps FROM flows").toArray()) {
      for (const x of parseJson<FlowStep[]>(r.steps, [])) {
        used.add(`${r.project as string}\u0000${x.design}`);
      }
    }
    for (const r of this.sql
      .exec("SELECT id, project, slug FROM designs WHERE kind = 'component'")
      .toArray()) {
      if (used.has(`${r.project as string}\u0000${r.slug as string}`)) continue;
      this.sql.exec("UPDATE designs SET kind = 'sketch' WHERE id = ?", r.id as string);
    }
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('sketchKind', '1')");
  }

  private settingSync(key: string): string | null {
    const rows = this.sql.exec("SELECT value FROM settings WHERE key = ?", key).toArray();
    return rows.length ? (rows[0].value as string) : null;
  }

  // --- rows ---

  private insertVersion(postId: string, v: PostVersion) {
    this.sql.exec(
      "INSERT OR REPLACE INTO post_versions (postId, version, title, surfaces, head, at, fromVersion, prompt, author, sessionId, amendedAt, contract, system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      postId,
      v.version,
      v.title,
      JSON.stringify(v.surfaces ?? []),
      surfaceHeads(v.surfaces ?? []),
      v.at,
      v.from ?? null,
      v.prompt ?? null,
      v.author ?? null,
      v.publishedBy ?? null,
      v.amendedAt ?? null,
      v.contract ?? null,
      v.system ?? null,
    );
  }

  private rowToVersion(r: Row): PostVersion {
    return {
      version: r.version as number,
      title: r.title as string,
      surfaces: parseJson<Surface[]>(r.surfaces, []),
      at: r.at as string,
      // Absent stays absent: the store contract compares entries whole.
      ...(r.fromVersion == null ? {} : { from: r.fromVersion as number }),
      ...(r.prompt == null ? {} : { prompt: r.prompt as string }),
      ...(r.author == null ? {} : { author: r.author as string }),
      ...(r.sessionId == null ? {} : { publishedBy: r.sessionId as string }),
      ...(r.amendedAt == null ? {} : { amendedAt: r.amendedAt as string }),
      ...(r.contract == null ? {} : { contract: r.contract as number }),
      ...(r.system == null ? {} : { system: r.system as number }),
    };
  }

  private historiesFor(ids: string[], weigh?: (bytes: number) => void): Map<string, PostVersion[]> {
    const out = new Map<string, PostVersion[]>();
    if (ids.length === 0) return out;
    const rows = this.sql
      .exec(
        `SELECT * FROM post_versions WHERE postId IN (${ids.map(() => "?").join(",")}) ORDER BY version ASC`,
        ...ids,
      )
      .toArray();
    for (const r of rows) {
      const id = r.postId as string;
      let list = out.get(id);
      if (!list) out.set(id, (list = []));
      weigh?.((r.surfaces as string).length);
      list.push(this.rowToVersion(r));
    }
    return out;
  }

  private rowsToPosts(rows: Row[], weigh?: (bytes: number) => void): Post[] {
    const histories = this.historiesFor(
      rows.map((r) => r.id as string),
      weigh,
    );
    return rows.map((r) => this.rowToPost(r, histories.get(r.id as string) ?? []));
  }

  private rowToSession(r: Row): Session {
    return {
      id: r.id as string,
      agent: r.agent as string,
      title: (r.title as string) ?? null,
      cwd: (r.cwd as string) ?? null,
      createdAt: r.createdAt as string,
      lastActiveAt: r.lastActiveAt as string,
      agentSeq: (r.agentSeq as number) ?? 0,
      project: (r.project as string) ?? null,
      agentActiveAt: (r.agentActiveAt as string) ?? null,
      keyed: r.key != null,
    };
  }

  private rowToDesign(r: Row): Design {
    return {
      id: r.id as string,
      project: r.project as string,
      slug: r.slug as string,
      title: r.title as string,
      kind: isDesignKind(r.kind) ? r.kind : "idea",
      area: (r.area as string) ?? null,
      group: (r.libraryGroup as string) ?? null,
      source: (r.source as string) ?? null,
      states: parseJson<string[]>(r.states, []),
      asks: parseJson<Ask[]>(r.asks, []),
      knobs: parseJson<Knobs>(r.knobs, {}),
      widths: parseJson<number[]>(r.widths, []),
      draft: parseJson<Draft | null>(r.draft, null),
      sessionId: (r.sessionId as string) ?? null,
      shortlist: !!r.shortlist,
      variants: !!r.variants,
      for: (r.forDesign as string) ?? null,
      becomes: isIdeaBecomes(r.becomes) ? r.becomes : null,
      archivedAt: (r.archivedAt as string) ?? null,
      archiveReason: (r.archiveReason as string) ?? null,
      spec: parseJson<DesignSpec | null>(r.spec, null),
      ready: parseJson<DesignReady | null>(r.ready, null),
      stateOutlines: parseJson<Record<string, StateOutline>>(r.stateOutlines, {}),
      answerAdditions: parseJson<AnswerAddition[]>(r.answerAdditions, []),
      standings: parseJson<Record<string, AnswerStanding>>(r.standings, {}),
      combos: parseJson<AnswerCombo[]>(r.sets, []),
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
    };
  }

  private rowToPost(r: Row, history: PostVersion[]): Post {
    const knobs = parseJson<Knobs | null>(r.knobs, null);
    const hidden = parseJson<number[]>(r.hiddenVersions, []);
    return {
      id: r.id as string,
      sessionId: r.sessionId as string,
      design: r.designId as string,
      state: (r.state as string) ?? null,
      alternative: r.variant as string,
      status: ((r.status as string) || "open") as PostStatus,
      title: r.title as string,
      surfaces: parseJson<Surface[]>(r.surfaces, []),
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
      version: r.version as number,
      history,
      ...(knobs ? { knobs } : {}),
      ...(r.description == null ? {} : { description: r.description as string }),
      // The column keeps its first name, from when instances were called slots.
      instances: parseJson<Instance[]>(r.slots, []),
      ...(r.forkedFrom == null ? {} : { forkedFrom: parseJson<ForkRef>(r.forkedFrom, null!) }),
      ...(r.copiedFrom == null ? {} : { copiedFrom: parseJson<CopyRef>(r.copiedFrom, null!) }),
      ...(r.status === "accepted" && r.acceptedVersion != null
        ? { acceptedVersion: r.acceptedVersion as number }
        : {}),
      ...(hidden.length ? { hiddenVersions: hidden } : {}),
      ...(r.archiveReason == null ? {} : { archiveReason: r.archiveReason as string }),
      ...(r.stayedVersion == null ? {} : { stayedVersion: r.stayedVersion as number }),
      ...(r.archivedAt == null ? {} : { archivedAt: r.archivedAt as string }),
      ...(r.curFrom == null ? {} : { from: r.curFrom as number }),
      ...(r.curPrompt == null ? {} : { prompt: r.curPrompt as string }),
      ...(r.curAuthor == null ? {} : { author: r.curAuthor as string }),
      ...(r.curSession == null ? {} : { publishedBy: r.curSession as string }),
      ...(r.amendedAt == null ? {} : { amendedAt: r.amendedAt as string }),
      ...(r.curContract == null ? {} : { contract: r.curContract as number }),
      ...(r.curSystem == null ? {} : { system: r.curSystem as number }),
      ...(r.rewrites ? { rewrites: r.rewrites as number } : {}),
    };
  }

  // The BLOB comes back as an ArrayBuffer (real DO) or a Uint8Array
  // (node:sqlite); `new Uint8Array(raw)` copies from either into a fresh array.
  private rowToAsset(r: Row): Asset {
    const raw = r.data as ArrayBuffer | Uint8Array;
    return {
      id: r.id as string,
      sessionId: r.sessionId as string,
      kind: r.kind === "image" ? "image" : "file",
      contentType: r.contentType as string,
      byteLength: r.byteLength as number,
      filename: (r.filename as string) ?? null,
      data: new Uint8Array(raw),
      createdAt: r.createdAt as string,
      lastAccessedAt: r.lastAccessedAt as string,
    };
  }

  private rowToComment(r: Row): Comment {
    const anchor = parseJson<Comment["anchor"] | null>(r.anchor, null);
    const payload = parseJson<Reply | null>(r.payload, null);
    return {
      id: r.id as string,
      seq: r.seq as number,
      sessionId: r.sessionId as string,
      designId: (r.designId as string) ?? null,
      postId: (r.postId as string) ?? null,
      author: r.author as string,
      text: r.text as string,
      createdAt: r.createdAt as string,
      ...(anchor ? { anchor } : {}),
      kind: ((r.kind as string) || "comment") as Comment["kind"],
      anchors: parseJson<Anchor[]>(r.anchors, []),
      postVersion: r.postVersion == null ? null : (r.postVersion as number),
      viewport: r.viewport == null ? null : (r.viewport as number),
      ...(payload ? { payload } : {}),
    };
  }

  // --- sessions ---

  async listSessions(project?: string) {
    const rows =
      project === undefined
        ? this.sql.exec("SELECT * FROM sessions ORDER BY lastActiveAt DESC").toArray()
        : this.sql
            .exec("SELECT * FROM sessions WHERE project = ? ORDER BY lastActiveAt DESC", project)
            .toArray();
    return rows.map((r) => this.rowToSession(r));
  }

  async getSession(id: string) {
    const rows = this.sql.exec("SELECT * FROM sessions WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.rowToSession(rows[0]) : null;
  }

  async getSessionByKey(key: string) {
    const rows = this.sql
      .exec("SELECT * FROM sessions WHERE key = ? ORDER BY lastActiveAt DESC LIMIT 1", key)
      .toArray();
    return rows.length > 0 ? this.rowToSession(rows[0]) : null;
  }

  async createSession(input: CreateSessionInput) {
    const now = new Date().toISOString();
    const session: Session = {
      id: newId(),
      agent: reservedAgent(stripNul(input.agent).trim() || "agent"),
      title: stripNul(input.title)?.trim() || null,
      cwd: stripNul(input.cwd ?? null),
      createdAt: now,
      lastActiveAt: now,
      agentSeq: 0,
      project:
        stripNul(input.project)?.trim() || projectFromCwd(stripNul(input.cwd ?? null)) || null,
      agentActiveAt: now,
      keyed: !!stripNul(input.key)?.trim(),
    };
    this.sql.exec(
      "INSERT INTO sessions (id, agent, title, cwd, createdAt, lastActiveAt, agentSeq, project, key, agentActiveAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
      session.id,
      session.agent,
      session.title,
      session.cwd,
      session.createdAt,
      session.lastActiveAt,
      session.project,
      stripNul(input.key)?.trim() || null,
      session.agentActiveAt,
    );
    return session;
  }

  async renameSession(id: string, title: string) {
    const session = await this.getSession(id);
    if (!session) return null;
    session.title = stripNul(title).trim() || null;
    this.sql.exec("UPDATE sessions SET title = ? WHERE id = ?", session.title, id);
    return session;
  }

  async removeSession(id: string) {
    if (!(await this.getSession(id))) return false;
    this.atomic(() => {
      this.sql.exec("DELETE FROM comments WHERE sessionId = ?", id);
      this.sql.exec(
        "DELETE FROM post_versions WHERE postId IN (SELECT id FROM posts WHERE sessionId = ?)",
        id,
      );
      const drawn = JSON.stringify(
        this.sql
          .exec("SELECT DISTINCT designId FROM posts WHERE sessionId = ?", id)
          .toArray()
          .map((r) => r.designId),
      );
      this.sql.exec("DELETE FROM posts WHERE sessionId = ?", id);
      // A design left with no alternatives has nothing to show, unless it was declared ahead
      // of being drawn, which only goes with the session that planned it. One this
      // session drew is not a plan, whoever wrote to it last: it would come back as one.
      const emptied =
        "id NOT IN (SELECT designId FROM posts) AND (kind = 'idea' OR sessionId = ? OR id IN (SELECT value FROM json_each(?)))";
      this.sql.exec(
        `DELETE FROM comments WHERE designId IN (SELECT id FROM designs WHERE ${emptied})`,
        id,
        drawn,
      );
      this.sql.exec(`DELETE FROM designs WHERE ${emptied}`, id, drawn);
      this.sql.exec("UPDATE designs SET sessionId = NULL WHERE sessionId = ?", id);
      // Posts are gone, so the referenced set reflects survivors only: drop this
      // session's own assets except any a surviving surface still points at
      // (assets are content-addressed and may be shared across sessions).
      this.invalidateAssetRefs();
      const referenced = this.referencedAssetIds();
      for (const r of this.sql.exec("SELECT id FROM assets WHERE sessionId = ?", id).toArray()) {
        const aid = r.id as string;
        if (!referenced.has(aid)) this.sql.exec("DELETE FROM assets WHERE id = ?", aid);
      }
      this.sql.exec("DELETE FROM sessions WHERE id = ?", id);
    });
    return true;
  }

  private touch(sessionId: string) {
    this.sql.exec(
      "UPDATE sessions SET lastActiveAt = ? WHERE id = ?",
      new Date().toISOString(),
      sessionId,
    );
  }

  async markAgentSeen(sessionId: string, seq: number) {
    this.sql.exec(
      "UPDATE sessions SET agentSeq = ? WHERE id = ? AND agentSeq < ?",
      seq,
      sessionId,
      seq,
    );
  }

  async touchAgent(sessionId: string) {
    this.sql.exec(
      "UPDATE sessions SET agentActiveAt = ? WHERE id = ?",
      new Date().toISOString(),
      sessionId,
    );
  }

  async handOff(
    sessionId: string,
    seen: Pick<Session, "agentSeq" | "agentActiveAt">,
    toSeq: number,
  ) {
    return (
      this.sql
        .exec(
          "UPDATE sessions SET agentSeq = ? WHERE id = ? AND agentSeq = ? AND agentActiveAt IS ? AND agentSeq < ? RETURNING id",
          toSeq,
          sessionId,
          seen.agentSeq,
          seen.agentActiveAt,
          toSeq,
        )
        .toArray().length > 0
    );
  }

  // --- settings ---

  async getSetting(key: string) {
    return this.settingSync(key);
  }

  async setSetting(key: string, value: string) {
    this.sql.exec(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      stripNul(key),
      stripNul(value),
    );
  }

  // --- projects / designs ---

  async listProjects() {
    return summarizeProjects(await this.listDesigns(), await this.listSessions());
  }

  // Spelled out because `SELECT *` on posts reads the bodies, the very cost search avoids.
  async listJumpRows(): Promise<JumpRows> {
    return {
      designs: this.sql
        .exec(
          "SELECT id, project, slug, title, kind, area, states, asks, widths, archivedAt, updatedAt FROM designs",
        )
        .toArray()
        .map((r) => ({
          id: r.id as string,
          project: r.project as string,
          slug: r.slug as string,
          title: r.title as string,
          kind: r.kind as DesignKind,
          area: (r.area as string | null) ?? null,
          states: parseJson<string[]>(r.states, []),
          asks: parseJson<Ask[]>(r.asks, []),
          widths: parseJson<number[]>(r.widths, []),
          archivedAt: (r.archivedAt as string | null) ?? null,
          updatedAt: r.updatedAt as string,
        })),
      alternatives: this.sql
        .exec("SELECT designId, state, variant, description, status FROM posts")
        .toArray()
        .map((r) => ({
          designId: r.designId as string,
          state: (r.state as string | null) ?? null,
          alternative: r.variant as string,
          description: (r.description as string | null) ?? null,
          status: r.status as PostStatus,
        })),
    };
  }

  async listDesigns(project?: string) {
    const rows =
      project === undefined
        ? this.sql.exec("SELECT * FROM designs ORDER BY updatedAt DESC, rowid DESC").toArray()
        : this.sql
            .exec(
              "SELECT * FROM designs WHERE project = ? ORDER BY updatedAt DESC, rowid DESC",
              project,
            )
            .toArray();
    return rows.map((r) => this.rowToDesign(r));
  }

  async getDesign(id: string) {
    const rows = this.sql.exec("SELECT * FROM designs WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.rowToDesign(rows[0]) : null;
  }

  async findDesign(project: string, slug: string) {
    const rows = this.sql
      .exec("SELECT * FROM designs WHERE project = ? AND slug = ?", project, slug)
      .toArray();
    return rows.length > 0 ? this.rowToDesign(rows[0]) : null;
  }

  async createDesign(input: CreateDesignInput) {
    const now = new Date().toISOString();
    const design: Design = {
      id: newId(),
      project: stripNul(input.project).trim() || DEFAULT_PROJECT,
      slug: slugify(stripNul(input.slug)),
      title: stripNul(input.title)?.trim() || input.slug,
      kind: isDesignKind(input.kind) ? input.kind : "idea",
      area: label(input.area),
      group: label(input.group),
      source: label(input.source),
      states: (input.states ?? []).map((s) => stripNul(s)),
      asks: [],
      knobs: input.knobs ?? {},
      widths: input.widths ?? [],
      draft: null,
      sessionId: input.sessionId ?? null,
      shortlist: !!input.shortlist,
      variants: !!input.variants,
      for: input.for ?? null,
      becomes: input.becomes ?? null,
      archivedAt: null,
      archiveReason: null,
      spec: null,
      ready: null,
      stateOutlines: {},
      answerAdditions: [],
      standings: {},
      combos: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sql.exec(
      "INSERT INTO designs (id, project, slug, title, kind, area, libraryGroup, source, states, asks, knobs, widths, draft, sessionId, shortlist, variants, forDesign, becomes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
      design.id,
      design.project,
      design.slug,
      design.title,
      design.kind,
      design.area,
      design.group,
      design.source,
      JSON.stringify(design.states),
      JSON.stringify(design.knobs),
      JSON.stringify(design.widths),
      design.sessionId,
      design.shortlist ? 1 : 0,
      design.variants ? 1 : 0,
      design.for,
      design.becomes,
      design.createdAt,
      design.updatedAt,
    );
    return design;
  }

  async updateDesign(id: string, patch: UpdateDesignInput) {
    const design = await this.getDesign(id);
    if (!design) return null;
    const next: Design = {
      ...design,
      ...(patch.title !== undefined && { title: stripNul(patch.title).trim() || design.title }),
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.area !== undefined && { area: label(patch.area) }),
      ...(patch.group !== undefined && { group: label(patch.group) }),
      ...(patch.variants !== undefined && { variants: patch.variants }),
      ...(patch.for !== undefined && { for: patch.for }),
      ...(patch.becomes !== undefined && { becomes: patch.becomes }),
      ...(patch.source !== undefined && { source: label(patch.source) }),
      ...(patch.states !== undefined && { states: patch.states.map((s) => stripNul(s)) }),
      ...(patch.asks !== undefined && { asks: patch.asks }),
      ...(patch.knobs !== undefined && { knobs: patch.knobs }),
      ...(patch.widths !== undefined && { widths: patch.widths }),
      ...(patch.sessionId !== undefined && { sessionId: patch.sessionId }),
      ...(patch.archivedAt !== undefined && { archivedAt: patch.archivedAt }),
      ...(patch.archivedAt === null && { archiveReason: null }),
      ...(patch.archiveReason !== undefined && { archiveReason: patch.archiveReason }),
      ...(patch.spec !== undefined && { spec: patch.spec }),
      ...(patch.ready !== undefined && { ready: patch.ready }),
      ...(patch.stateOutlines !== undefined && { stateOutlines: patch.stateOutlines }),
      ...(patch.answerAdditions !== undefined && { answerAdditions: patch.answerAdditions }),
      ...(patch.standings !== undefined && { standings: patch.standings }),
      ...(patch.combos !== undefined && { combos: patch.combos }),
      updatedAt: new Date().toISOString(),
    };
    this.sql.exec(
      "UPDATE designs SET title = ?, kind = ?, area = ?, libraryGroup = ?, variants = ?, forDesign = ?, becomes = ?, source = ?, states = ?, asks = ?, knobs = ?, widths = ?, sessionId = ?, archivedAt = ?, archiveReason = ?, spec = ?, ready = ?, stateOutlines = ?, answerAdditions = ?, standings = ?, sets = ?, updatedAt = ? WHERE id = ?",
      next.title,
      next.kind,
      next.area,
      next.group,
      next.variants ? 1 : 0,
      next.for,
      next.becomes,
      next.source,
      JSON.stringify(next.states),
      JSON.stringify(next.asks),
      JSON.stringify(next.knobs),
      JSON.stringify(next.widths),
      next.sessionId,
      next.archivedAt,
      next.archiveReason,
      next.spec ? JSON.stringify(next.spec) : null,
      next.ready ? JSON.stringify(next.ready) : null,
      JSON.stringify(next.stateOutlines),
      JSON.stringify(next.answerAdditions),
      JSON.stringify(next.standings),
      JSON.stringify(next.combos),
      next.updatedAt,
      id,
    );
    if (patch.asks !== undefined) this.invalidateAssetRefs();
    return next;
  }

  async removeDesign(id: string) {
    const design = await this.getDesign(id);
    if (!design) return false;
    this.atomic(() => {
      this.sql.exec("DELETE FROM comments WHERE designId = ?", id);
      this.sql.exec(
        "DELETE FROM post_versions WHERE postId IN (SELECT id FROM posts WHERE designId = ?)",
        id,
      );
      this.sql.exec("DELETE FROM posts WHERE designId = ?", id);
      this.sql.exec("DELETE FROM designs WHERE id = ?", id);
      // The ideas that were for it are for nothing now.
      this.sql.exec("UPDATE designs SET forDesign = NULL WHERE forDesign = ?", id);
      for (const flow of this.flowsOf(design.project)) {
        const steps = flow.steps.filter((x) => x.design !== design.slug);
        if (steps.length !== flow.steps.length) this.writeFlow(flow, steps);
      }
    });
    this.invalidateAssetRefs();
    return true;
  }

  async nameFirstState(id: string, state: string) {
    const name = stripNul(state);
    const design = await this.getDesign(id);
    if (!design || design.states.length > 0) return null;
    const updatedAt = new Date().toISOString();
    this.atomic(() => {
      this.sql.exec("UPDATE posts SET state = ? WHERE designId = ? AND state IS NULL", name, id);
      this.sql.exec(
        "UPDATE designs SET states = ?, updatedAt = ? WHERE id = ?",
        JSON.stringify([name]),
        updatedAt,
        id,
      );
      for (const r of this.sql
        .exec(
          "SELECT id, copiedFrom FROM posts WHERE copiedFrom IS NOT NULL AND designId IN (SELECT id FROM designs WHERE project = ?)",
          design.project,
        )
        .toArray()) {
        const from = parseJson<CopyRef>(r.copiedFrom, null!);
        if (from?.design !== id || from.state !== null) continue;
        this.sql.exec(
          "UPDATE posts SET copiedFrom = ? WHERE id = ?",
          JSON.stringify({ ...from, state: name }),
          r.id as string,
        );
      }
      for (const flow of this.flowsOf(design.project)) {
        if (!flow.steps.some((x) => x.design === design.slug && x.state === null)) continue;
        this.writeFlow(
          flow,
          flow.steps.map((x) =>
            x.design === design.slug && x.state === null ? { ...x, state: name } : x,
          ),
        );
      }
      if (design.draft) {
        const comments = design.draft.comments.map((c) =>
          c.state === null ? { ...c, state: name } : c,
        );
        this.sql.exec(
          "UPDATE designs SET draft = ? WHERE id = ?",
          JSON.stringify({ ...design.draft, comments }),
          id,
        );
      }
    });
    // Copies elsewhere changed too, so nothing cached can be patched one post at a time.
    this.postCache.clear();
    this.postCacheBytes = 0;
    return this.getDesign(id);
  }

  async renameDesign(id: string, slug: string) {
    const to = slugify(stripNul(slug));
    return this.atomic(() => {
      const rows = this.sql.exec("SELECT * FROM designs WHERE id = ?", id).toArray();
      if (rows.length === 0) return null;
      const design = this.rowToDesign(rows[0]);
      const from = design.slug;
      if (to === from) return design;
      const taken = this.sql
        .exec("SELECT id FROM designs WHERE project = ? AND slug = ?", design.project, to)
        .toArray();
      if (taken.length > 0) return null;
      const updatedAt = new Date().toISOString();
      this.sql.exec("UPDATE designs SET slug = ?, updatedAt = ? WHERE id = ?", to, updatedAt, id);
      // History is rewritten too: instances resolve by slug at render time, so an
      // old version left naming the old slug would show its components missing.
      const rewrite = (raw: SqlStorageValue): string | null => {
        let changed = false;
        const next = parseJson<Surface[]>(raw, []).map((x) => {
          if (x.kind !== "html") return x;
          const html = renameSlugRefs(x.html, from, to);
          if (html === x.html) return x;
          changed = true;
          return { ...x, html };
        });
        return changed ? JSON.stringify(next) : null;
      };
      const posts = this.sql
        .exec(
          "SELECT id, surfaces, slots FROM posts WHERE designId IN (SELECT id FROM designs WHERE project = ?)",
          design.project,
        )
        .toArray();
      for (const r of posts) {
        const postId = r.id as string;
        const surfaces = rewrite(r.surfaces);
        if (surfaces) this.sql.exec("UPDATE posts SET surfaces = ? WHERE id = ?", surfaces, postId);
        const instances = parseJson<Instance[]>(r.slots, []);
        if (instances.some((e) => e.slug === from)) {
          this.sql.exec(
            "UPDATE posts SET slots = ? WHERE id = ?",
            JSON.stringify(instances.map((e) => (e.slug === from ? { ...e, slug: to } : e))),
            postId,
          );
        }
        for (const v of this.sql
          .exec("SELECT version, surfaces FROM post_versions WHERE postId = ?", postId)
          .toArray()) {
          const old = rewrite(v.surfaces);
          if (!old) continue;
          this.sql.exec(
            "UPDATE post_versions SET surfaces = ? WHERE postId = ? AND version = ?",
            old,
            postId,
            v.version as number,
          );
        }
      }
      for (const flow of this.flowsOf(design.project)) {
        if (!flow.steps.some((x) => x.design === from)) continue;
        this.writeFlow(
          flow,
          flow.steps.map((x) => (x.design === from ? { ...x, design: to } : x)),
        );
      }
      return { ...design, slug: to, updatedAt };
    });
  }

  async renameProject(from: string, to: string) {
    const target = stripNul(to).trim();
    return this.atomic(() => {
      const occupied = this.sql
        .exec("SELECT COUNT(*) AS n FROM designs WHERE project = ?", target)
        .one().n as number;
      if (occupied > 0) return false;
      // A project with no designs has nothing a leftover flow could walk.
      this.sql.exec("DELETE FROM flows WHERE project = ?", target);
      this.sql.exec("UPDATE designs SET project = ? WHERE project = ?", target, from);
      this.sql.exec("UPDATE sessions SET project = ? WHERE project = ?", target, from);
      this.sql.exec("UPDATE flows SET project = ? WHERE project = ?", target, from);
      for (const prefix of PROJECT_SETTINGS) {
        const value = this.settingSync(`${prefix}:${from}`);
        if (value === null) continue;
        this.sql.exec(
          "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
          `${prefix}:${target}`,
          value,
        );
        this.sql.exec("DELETE FROM settings WHERE key = ?", `${prefix}:${from}`);
      }
      if (this.sql.exec("SELECT 1 FROM systems WHERE project = ?", from).toArray().length) {
        this.sql.exec("DELETE FROM systems WHERE project = ?", target);
        this.sql.exec("DELETE FROM system_revisions WHERE project = ?", target);
        for (const table of ["systems", "system_revisions"]) {
          for (const r of this.sql
            .exec(`SELECT rowid AS id, json FROM ${table} WHERE project = ?`, from)
            .toArray()) {
            const moved = { ...parseJson<Record<string, unknown>>(r.json, {}), project: target };
            this.sql.exec(
              `UPDATE ${table} SET project = ?, json = ? WHERE rowid = ?`,
              target,
              JSON.stringify(moved),
              r.id as number,
            );
          }
        }
      }
      return true;
    });
  }

  // --- systems ---

  async getSystem(project: string) {
    const rows = this.sql.exec("SELECT json FROM systems WHERE project = ?", project).toArray();
    return rows.length ? normalizeSystem(project, parseJson(rows[0].json, null)) : null;
  }

  async putSystem(system: System, meta: { sessionId: string | null; summary: string }) {
    this.atomic(() => this.writeSystem(system, meta));
    this.invalidateAssetRefs();
    return system;
  }

  async commitSystemDecision(input: {
    system: System;
    summary: string;
    tell: { sessionId: string; payload: Reply } | null;
  }) {
    const tell = input.tell;
    const comment = this.atomic(() => {
      this.writeSystem(input.system, { sessionId: null, summary: input.summary });
      return tell
        ? this.insertComment({
            sessionId: tell.sessionId,
            author: "user",
            text: "",
            kind: "reply",
            payload: tell.payload,
          })
        : null;
    });
    this.invalidateAssetRefs();
    return comment;
  }

  // Unwrapped, so a reply's transaction can carry it.
  private writeSystem(system: System, meta: { sessionId: string | null; summary: string }) {
    const json = JSON.stringify(system);
    const at = new Date().toISOString();
    {
      this.sql.exec(
        "INSERT INTO systems (project, rev, json) VALUES (?, ?, ?) ON CONFLICT(project) DO UPDATE SET rev = excluded.rev, json = excluded.json",
        system.project,
        system.rev,
        json,
      );
      this.sql.exec(
        "INSERT OR REPLACE INTO system_revisions (project, rev, json, at, sessionId, summary) VALUES (?, ?, ?, ?, ?, ?)",
        system.project,
        system.rev,
        json,
        at,
        meta.sessionId,
        stripNul(meta.summary).slice(0, SYSTEM_LIMITS.summary),
      );
      this.sql.exec(
        "DELETE FROM system_revisions WHERE project = ? AND rev <= ?",
        system.project,
        system.rev - SYSTEM_LIMITS.revisions,
      );
    }
  }

  async listSystemRevisions(project: string) {
    return this.sql
      .exec(
        "SELECT rev, at, sessionId, summary FROM system_revisions WHERE project = ? ORDER BY rev DESC",
        project,
      )
      .toArray()
      .map((r) => ({
        rev: r.rev as number,
        at: r.at as string,
        sessionId: (r.sessionId as string | null) ?? null,
        summary: r.summary as string,
      }));
  }

  async getSystemRevision(project: string, rev: number) {
    const rows = this.sql
      .exec("SELECT json FROM system_revisions WHERE project = ? AND rev = ?", project, rev)
      .toArray();
    return rows.length ? normalizeSystem(project, parseJson(rows[0].json, null)) : null;
  }

  // Each project's old design settings become its system, with the repo's
  // tokens derived, and the setting goes.
  private migrateSystems() {
    const rows = this.sql
      .exec("SELECT key, value FROM settings WHERE key LIKE 'design:%'")
      .toArray();
    if (rows.length === 0) return;
    const at = new Date().toISOString();
    for (const r of rows) {
      const project = (r.key as string).slice("design:".length);
      const have = this.sql.exec("SELECT 1 FROM systems WHERE project = ?", project).toArray();
      if (have.length === 0) {
        const system = { ...systemFromDesignSettings(project, parseJson(r.value, null)), rev: 1 };
        const json = JSON.stringify(system);
        this.sql.exec("INSERT INTO systems (project, rev, json) VALUES (?, 1, ?)", project, json);
        this.sql.exec(
          "INSERT INTO system_revisions (project, rev, json, at, sessionId, summary) VALUES (?, 1, ?, ?, NULL, ?)",
          project,
          json,
          at,
          "from what the project stored before",
        );
      }
      this.sql.exec("DELETE FROM settings WHERE key = ?", r.key as string);
    }
    this.invalidateAssetRefs();
  }

  // --- flows ---

  private flowsOf(project: string): Flow[] {
    return this.sql
      .exec("SELECT * FROM flows WHERE project = ? ORDER BY createdAt, rowid", project)
      .toArray()
      .map((r) => ({
        project: r.project as string,
        name: r.name as string,
        steps: parseJson<FlowStep[]>(r.steps, []),
        createdAt: r.createdAt as string,
        updatedAt: r.updatedAt as string,
      }));
  }

  // An emptied flow is deleted rather than kept as a name with nothing to walk.
  private writeFlow(flow: Flow, steps: FlowStep[]): Flow | null {
    if (steps.length === 0) {
      this.sql.exec("DELETE FROM flows WHERE project = ? AND name = ?", flow.project, flow.name);
      return null;
    }
    const next = { ...flow, steps, updatedAt: new Date().toISOString() };
    this.sql.exec(
      "INSERT INTO flows (project, name, steps, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project, name) DO UPDATE SET steps = excluded.steps, updatedAt = excluded.updatedAt",
      next.project,
      next.name,
      JSON.stringify(next.steps),
      next.createdAt,
      next.updatedAt,
    );
    return next;
  }

  async listFlows(project: string) {
    return this.flowsOf(project);
  }

  async placeFlowStep(project: string, name: string, screen: FlowStep, step: number) {
    const clean = { design: stripNul(screen.design), state: stripNul(screen.state) };
    const label = stripNul(name);
    return this.atomic(() => {
      const now = new Date().toISOString();
      const flow = this.flowsOf(project).find((f) => f.name === label) ?? {
        project,
        name: label,
        steps: [],
        createdAt: now,
        updatedAt: now,
      };
      const steps = flow.steps.filter((x) => !sameScreen(x, clean));
      if (step > 0) steps.splice(Math.min(step, steps.length + 1) - 1, 0, clean);
      if (steps.length === 0 && flow.steps.length === 0) return null;
      return this.writeFlow(flow, steps);
    });
  }

  async putDraft(designId: string, draft: Draft | null) {
    const design = await this.getDesign(designId);
    if (!design) return null;
    this.sql.exec(
      "UPDATE designs SET draft = ? WHERE id = ?",
      draft ? JSON.stringify(draft) : null,
      designId,
    );
    this.invalidateAssetRefs();
    return { ...design, draft };
  }

  private touchDesign(designId: string, at: string) {
    this.sql.exec("UPDATE designs SET updatedAt = ? WHERE id = ?", at, designId);
  }

  // --- posts ---

  async listPosts(query: PostQuery = {}) {
    if (query.designId !== undefined && query.sessionId === undefined) {
      return this.postsOfDesign(query.designId).slice();
    }
    const clauses: string[] = [];
    const params: SqlStorageValue[] = [];
    if (query.designId !== undefined) {
      clauses.push("designId = ?");
      params.push(query.designId);
    }
    if (query.sessionId !== undefined) {
      clauses.push("sessionId = ?");
      params.push(query.sessionId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sql
      .exec(`SELECT * FROM posts ${where} ORDER BY createdAt ASC, rowid ASC`, ...params)
      .toArray();
    return this.rowsToPosts(rows);
  }

  async listPostHeads(project?: string) {
    const scope =
      project === undefined ? "" : "WHERE designId IN (SELECT id FROM designs WHERE project = ?)";
    const args = project === undefined ? [] : [project];
    const history = new Map<string, PostHead["history"]>();
    for (const r of this.sql
      .exec(
        `SELECT postId, version, head FROM post_versions WHERE postId IN (SELECT id FROM posts ${scope}) ORDER BY version ASC`,
        ...args,
      )
      .toArray()) {
      const id = r.postId as string;
      let list = history.get(id);
      if (!list) history.set(id, (list = []));
      list.push({ version: r.version as number, surfaces: parseJson<SurfaceHead[]>(r.head, []) });
    }
    return this.sql
      .exec(
        `SELECT ${POST_HEAD_COLUMNS} FROM posts ${scope} ORDER BY createdAt ASC, rowid ASC`,
        ...args,
      )
      .toArray()
      .map((r): PostHead => ({
        ...this.rowToPost(r, []),
        surfaces: parseJson<SurfaceHead[]>(r.head, []),
        history: history.get(r.id as string) ?? [],
      }));
  }

  // Every open design screen asks, and a project's posts can be hundreds of MB:
  // the index holds each column read here, so no row with a body is touched.
  async listCopies(project: string) {
    return this.sql
      .exec(
        "SELECT designId, state, variant, status, copiedFrom FROM posts WHERE copiedFrom IS NOT NULL AND designId IN (SELECT id FROM designs WHERE project = ?)",
        project,
      )
      .toArray()
      .filter((r) => isLive(r.status as PostStatus))
      .map((r): LiveCopy => ({
        design: r.designId as string,
        state: r.state as string | null,
        alternative: r.variant as string,
        copiedFrom: parseJson<CopyRef>(r.copiedFrom, null!),
      }));
  }

  private postsOfDesign(designId: string): Post[] {
    const hit = this.postCache.get(designId);
    if (hit) {
      this.postCache.delete(designId);
      this.postCache.set(designId, hit);
      return hit.posts;
    }
    const rows = this.sql
      .exec("SELECT * FROM posts WHERE designId = ? ORDER BY createdAt ASC, rowid ASC", designId)
      .toArray();
    let bytes = 0;
    for (const r of rows) bytes += (r.surfaces as string).length;
    const posts = this.rowsToPosts(rows, (n) => (bytes += n));
    if (bytes > this.postCacheLimit) return posts;
    this.postCache.set(designId, { posts, bytes });
    this.postCacheBytes += bytes;
    this.trimPostCache();
    return posts;
  }

  private trimPostCache(): void {
    for (const [id, entry] of this.postCache) {
      if (this.postCacheBytes <= this.postCacheLimit) break;
      this.postCache.delete(id);
      this.postCacheBytes -= entry.bytes;
    }
  }

  // A synchronous write to these posts of one design, re-reading just them after:
  // a publish into a big lab would otherwise leave the viewer's next read parsing
  // every design in it.
  private writingPosts<T>(designId: string, ids: string[], write: () => T): T {
    this.holdPostDrop = true;
    let out: T;
    try {
      out = write();
    } catch (err) {
      const entry = this.postCache.get(designId);
      if (entry) {
        this.postCache.delete(designId);
        this.postCacheBytes -= entry.bytes;
      }
      throw err;
    } finally {
      this.holdPostDrop = false;
    }
    const entry = this.postCache.get(designId);
    if (entry) {
      const weigh = (p: Post | null | undefined) =>
        p
          ? [p.surfaces, ...p.history.map((h) => h.surfaces)].reduce(
              (n, x) => n + JSON.stringify(x).length,
              0,
            )
          : 0;
      for (const id of ids) {
        const rows = this.sql.exec("SELECT * FROM posts WHERE id = ?", id).toArray();
        const fresh = rows.length ? this.rowsToPosts(rows)[0] : null;
        const stale = entry.posts.find((p) => p.id === id);
        const change = weigh(fresh) - weigh(stale);
        entry.bytes += change;
        this.postCacheBytes += change;
        if (!fresh) entry.posts = entry.posts.filter((p) => p.id !== id);
        else if (stale) entry.posts = entry.posts.map((p) => (p.id === id ? fresh : p));
        else entry.posts = [...entry.posts, fresh];
      }
      this.trimPostCache();
    }
    return out;
  }

  private cachedPost(id: string): Post | null {
    for (const { posts } of this.postCache.values()) {
      const hit = posts.find((p) => p.id === id);
      if (hit) return hit;
    }
    return null;
  }

  // For a write that leaves the bodies alone, so the size stands. Archiving
  // through a lab would otherwise re-read every design in it after each ×.
  private recache(post: Post): void {
    const entry = this.postCache.get(post.design);
    if (entry) entry.posts = entry.posts.map((p) => (p.id === post.id ? post : p));
  }

  async countPostsBySession() {
    const counts = new Map<string, number>();
    for (const row of this.sql
      .exec("SELECT sessionId, COUNT(*) AS n FROM posts GROUP BY sessionId")
      .toArray()) {
      counts.set(row.sessionId as string, row.n as number);
    }
    return counts;
  }

  async getPost(id: string) {
    const rows = this.sql.exec("SELECT * FROM posts WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.rowsToPosts(rows)[0] : null;
  }

  async findPost(designId: string, state: string | null, alternative: string) {
    const cached = this.postCache.get(designId);
    if (cached)
      return cached.posts.find((p) => p.state === state && p.alternative === alternative) ?? null;
    const rows = this.sql
      .exec(
        "SELECT * FROM posts WHERE designId = ? AND state IS ? AND variant = ? ORDER BY createdAt ASC LIMIT 1",
        designId,
        state,
        alternative,
      )
      .toArray();
    return rows.length > 0 ? this.rowsToPosts(rows)[0] : null;
  }

  async createPost(input: CreatePostInput) {
    if (!(await this.getSession(input.sessionId))) return null;
    if (!(await this.getDesign(input.design))) return null;
    const now = new Date().toISOString();
    const post: Post = {
      id: newId(),
      sessionId: input.sessionId,
      design: input.design,
      state: input.state === null ? null : stripNul(input.state),
      alternative: stripNul(input.alternative)?.trim() || DEFAULT_ALTERNATIVE,
      status: "open",
      title: stripNul(input.title)?.trim() || "Untitled",
      surfaces: normalizeSurfaceIds(input.surfaces),
      createdAt: now,
      updatedAt: now,
      version: 1,
      history: [],
      ...(input.knobs ? { knobs: input.knobs } : {}),
      ...(stripNul(input.description ?? "").trim()
        ? { description: stripNul(input.description ?? "").trim() }
        : {}),
      instances: input.instances ?? [],
      ...(input.forkedFrom ? { forkedFrom: input.forkedFrom } : {}),
      ...(input.copiedFrom ? { copiedFrom: input.copiedFrom } : {}),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.prompt === undefined ? {} : { prompt: stripNul(input.prompt) }),
      ...(input.author === undefined ? {} : { author: stripNul(input.author) }),
      publishedBy: input.publishedBy ?? input.sessionId,
      contract: input.contract ?? CURRENT_CONTRACT,
      ...(input.system === undefined ? {} : { system: input.system }),
    };
    this.writingPosts(post.design, [post.id], () =>
      this.sql.exec(
        "INSERT INTO posts (id, sessionId, designId, state, variant, status, title, surfaces, head, knobs, slots, createdAt, updatedAt, version, curFrom, curPrompt, curAuthor, description, forkedFrom, copiedFrom, curSession, curContract, curSystem) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        post.id,
        post.sessionId,
        post.design,
        post.state,
        post.alternative,
        post.title,
        JSON.stringify(post.surfaces),
        surfaceHeads(post.surfaces),
        post.knobs ? JSON.stringify(post.knobs) : null,
        JSON.stringify(post.instances),
        post.createdAt,
        post.updatedAt,
        post.from ?? null,
        post.prompt ?? null,
        post.author ?? null,
        post.description ?? null,
        post.forkedFrom ? JSON.stringify(post.forkedFrom) : null,
        post.copiedFrom ? JSON.stringify(post.copiedFrom) : null,
        post.publishedBy ?? null,
        post.contract ?? null,
        post.system ?? null,
      ),
    );
    this.touch(input.sessionId);
    this.touchDesign(post.design, now);
    this.addAssetRefs(post.surfaces);
    return post;
  }

  // The versions of a post history keeps past its limit: the one in use and the ones
  // its design's Ready mark records for it. Never empty, so the SQL list is valid.
  private pinnedVersions(post: Pick<Post, "design" | "state" | "alternative" | "acceptedVersion">) {
    const row = this.sql.exec("SELECT ready FROM designs WHERE id = ?", post.design).toArray()[0];
    const ready = parseJson<DesignReady | null>(row?.ready, null);
    const covered = (ready?.covers ?? [])
      .filter((c) => c.state === post.state && c.name === post.alternative)
      .map((c) => c.version);
    return [post.acceptedVersion ?? -1, ...covered];
  }

  async updatePost(id: string, patch: UpdatePostInput) {
    // Compare-and-set on the version: two concurrent updates serialize without
    // a read-then-write gap. The loser sees 0 rows changed and retries.
    for (let attempt = 0; attempt < 4; attempt++) {
      const post = await this.getPost(id);
      if (!post) return null;
      const archived: PostVersion = {
        version: post.version,
        title: post.title,
        surfaces: post.surfaces,
        at: post.updatedAt,
        ...(post.from === undefined ? {} : { from: post.from }),
        ...(post.prompt === undefined ? {} : { prompt: post.prompt }),
        ...(post.author === undefined ? {} : { author: post.author }),
        ...(post.publishedBy === undefined ? {} : { publishedBy: post.publishedBy }),
        ...(post.amendedAt === undefined ? {} : { amendedAt: post.amendedAt }),
        ...(post.contract === undefined ? {} : { contract: post.contract }),
        ...(post.system === undefined ? {} : { system: post.system }),
      };
      // The version in use, and any version a Ready mark names, are kept past the limit:
      // export and instances resolve to them.
      const pins = this.pinnedVersions(post);
      const history = [...post.history, archived];
      const prunable = history.filter((h) => !pins.includes(h.version));
      if (prunable.length > HISTORY_LIMIT) history.splice(history.indexOf(prunable[0]), 1);
      const title =
        patch.title !== undefined ? stripNul(patch.title).trim() || post.title : post.title;
      const surfaces =
        patch.surfaces !== undefined ? normalizeSurfaceIds(patch.surfaces) : post.surfaces;
      const knobs = patch.knobs === undefined ? post.knobs : (patch.knobs ?? undefined);
      const description =
        patch.description === undefined
          ? post.description
          : stripNul(patch.description).trim() || undefined;
      const instances = patch.instances ?? post.instances;
      const state = patch.state === undefined ? post.state : patch.state;
      const version = post.version + 1;
      const updatedAt = new Date().toISOString();
      // A revision may branch from any earlier version; default to the one it replaces.
      const from = patch.from ?? post.version;
      const prompt = stripNul(patch.prompt ?? "");
      const author = patch.author === undefined ? null : stripNul(patch.author);
      const publishedBy = patch.publishedBy ?? null;
      const contract = patch.contract ?? CURRENT_CONTRACT;
      const system = patch.system ?? null;
      const copiedFrom = patch.copiedFrom ?? post.copiedFrom;
      const wrote = this.writingPosts(post.design, [id], () => {
        this.sql.exec(
          "UPDATE posts SET title = ?, surfaces = ?, head = ?, knobs = ?, description = ?, slots = ?, state = ?, updatedAt = ?, version = ?, curFrom = ?, curPrompt = ?, curAuthor = ?, curSession = ?, amendedAt = NULL, curContract = ?, curSystem = ?, copiedFrom = ? WHERE id = ? AND version = ?",
          title,
          JSON.stringify(surfaces),
          surfaceHeads(surfaces),
          knobs ? JSON.stringify(knobs) : null,
          description ?? null,
          JSON.stringify(instances),
          state,
          updatedAt,
          version,
          from,
          prompt,
          author,
          publishedBy,
          contract,
          system,
          copiedFrom ? JSON.stringify(copiedFrom) : null,
          id,
          post.version,
        );
        if ((this.sql.exec("SELECT changes() AS n").one().n as number) === 0) return false;
        this.insertVersion(id, archived);
        this.sql.exec(
          `DELETE FROM post_versions WHERE postId = ? AND version <= ? AND version NOT IN (${pins.map(() => "?").join(",")})`,
          id,
          version - 1 - HISTORY_LIMIT,
          ...pins,
        );
        return true;
      });
      if (wrote) {
        this.touch(post.sessionId);
        this.touchDesign(post.design, updatedAt);
        if (patch.surfaces !== undefined) this.addAssetRefs(surfaces);
        const {
          knobs: _knobs,
          description: _description,
          author: _author,
          publishedBy: _by,
          amendedAt: _amended,
          contract: _contract,
          system: _system,
          ...rest
        } = post;
        return {
          ...rest,
          contract,
          ...(system === null ? {} : { system }),
          title,
          surfaces,
          ...(knobs ? { knobs } : {}),
          ...(description ? { description } : {}),
          instances,
          state,
          version,
          updatedAt,
          history,
          from,
          prompt,
          ...(author === null ? {} : { author }),
          ...(publishedBy === null ? {} : { publishedBy }),
          ...(copiedFrom ? { copiedFrom } : {}),
        };
      }
    }
    return null;
  }

  async amendPost(id: string, version: number, patch: AmendPostInput) {
    const post = await this.getPost(id);
    if (!post || post.version !== version) return null;
    const title =
      patch.title !== undefined ? stripNul(patch.title).trim() || post.title : post.title;
    const surfaces =
      patch.surfaces !== undefined ? normalizeSurfaceIds(patch.surfaces) : post.surfaces;
    const knobs = patch.knobs === undefined ? post.knobs : (patch.knobs ?? undefined);
    const description =
      patch.description === undefined
        ? post.description
        : stripNul(patch.description).trim() || undefined;
    const instances = patch.instances ?? post.instances;
    const from = patch.from ?? post.from;
    const prompt = patch.prompt === undefined ? post.prompt : stripNul(patch.prompt);
    const author = patch.author === undefined ? post.author : stripNul(patch.author);
    const amendedAt = new Date().toISOString();
    const rewrites = (post.rewrites ?? 0) + 1;
    const contract = patch.contract ?? CURRENT_CONTRACT;
    const system = patch.system ?? post.system;
    const wrote = this.writingPosts(post.design, [id], () => {
      this.sql.exec(
        "UPDATE posts SET title = ?, surfaces = ?, head = ?, knobs = ?, description = ?, slots = ?, curFrom = ?, curPrompt = ?, curAuthor = ?, amendedAt = ?, rewrites = ?, curContract = ?, curSystem = ? WHERE id = ? AND version = ?",
        title,
        JSON.stringify(surfaces),
        surfaceHeads(surfaces),
        knobs ? JSON.stringify(knobs) : null,
        description ?? null,
        JSON.stringify(instances),
        from ?? null,
        prompt ?? null,
        author ?? null,
        amendedAt,
        rewrites,
        contract,
        system ?? null,
        id,
        version,
      );
      return (this.sql.exec("SELECT changes() AS n").one().n as number) > 0;
    });
    if (!wrote) return null;
    this.touch(post.sessionId);
    this.touchDesign(post.design, amendedAt);
    // The surfaces it replaced may have held the only reference to an asset.
    this.invalidateAssetRefs();
    const {
      knobs: _knobs,
      description: _description,
      from: _from,
      prompt: _prompt,
      author: _author,
      ...rest
    } = post;
    return {
      ...rest,
      title,
      surfaces,
      ...(knobs ? { knobs } : {}),
      ...(description ? { description } : {}),
      instances,
      ...(from === undefined ? {} : { from }),
      ...(prompt === undefined ? {} : { prompt }),
      ...(author === undefined ? {} : { author }),
      amendedAt,
      rewrites,
      contract,
      ...(system === undefined ? {} : { system }),
    };
  }

  async setPosterOnce(id: string, version: number, poster: string, mode?: Mode, system?: number) {
    const post = await this.getPost(id);
    if (!post || post.version !== version) return false;
    const at = post.surfaces.findIndex((s) => s.kind === "html");
    const page = post.surfaces[at];
    if (!page || page.kind !== "html") return false;
    // A still mockpit took under another system revision no longer shows, so a new
    // one may take its place; an agent's own, or a current one, stays.
    const stale =
      page.posterMode !== undefined &&
      system !== undefined &&
      (page.posterSystem === undefined ? system > 1 : page.posterSystem !== system);
    if (page.poster && !stale) return false;
    const surfaces = post.surfaces.map((s, i) =>
      i === at
        ? {
            ...page,
            poster,
            ...(mode ? { posterMode: mode } : {}),
            ...(mode && system !== undefined ? { posterSystem: system } : {}),
          }
        : s,
    );
    const wrote = this.writingPosts(post.design, [id], () => {
      this.sql.exec(
        "UPDATE posts SET surfaces = ?, head = ? WHERE id = ? AND version = ?",
        JSON.stringify(surfaces),
        surfaceHeads(surfaces),
        id,
        version,
      );
      return (this.sql.exec("SELECT changes() AS n").one().n as number) > 0;
    });
    if (wrote) this.invalidateAssetRefs();
    return wrote;
  }

  async withdrawVersion(id: string, version: number, instances: Instance[]) {
    const post = await this.getPost(id);
    if (!post || post.version !== version) return null;
    const previous = post.history.at(-1);
    const now = new Date().toISOString();
    if (!previous) {
      this.writingPosts(post.design, [id], () =>
        this.atomic(() => {
          // Only the agent can have written on a version the user never touched;
          // its messages stay in the design's thread.
          this.sql.exec("UPDATE comments SET postId = NULL WHERE postId = ?", id);
          this.sql.exec("DELETE FROM post_versions WHERE postId = ?", id);
          this.sql.exec("DELETE FROM posts WHERE id = ?", id);
        }),
      );
      this.touchDesign(post.design, now);
      this.invalidateAssetRefs();
      return { post: null };
    }
    const rewrites = (post.rewrites ?? 0) + 1;
    const hidden = (post.hiddenVersions ?? []).filter((v) => v !== version);
    this.writingPosts(post.design, [id], () =>
      this.atomic(() => {
        this.sql.exec(
          "UPDATE posts SET title = ?, surfaces = ?, head = ?, slots = ?, updatedAt = ?, version = ?, curFrom = ?, curPrompt = ?, curAuthor = ?, curSession = ?, amendedAt = ?, rewrites = ?, hiddenVersions = ?, curContract = ?, curSystem = ? WHERE id = ? AND version = ?",
          previous.title,
          JSON.stringify(previous.surfaces),
          surfaceHeads(previous.surfaces),
          JSON.stringify(instances),
          previous.at,
          previous.version,
          previous.from ?? null,
          previous.prompt ?? null,
          previous.author ?? null,
          previous.publishedBy ?? null,
          previous.amendedAt ?? null,
          rewrites,
          hidden.length ? JSON.stringify(hidden) : null,
          previous.contract ?? null,
          previous.system ?? null,
          id,
          version,
        );
        this.sql.exec(
          "DELETE FROM post_versions WHERE postId = ? AND version = ?",
          id,
          previous.version,
        );
      }),
    );
    this.touchDesign(post.design, now);
    this.invalidateAssetRefs();
    const {
      from: _from,
      prompt: _prompt,
      author: _author,
      publishedBy: _by,
      amendedAt: _amended,
      hiddenVersions: _hidden,
      contract: _contract,
      system: _system,
      ...rest
    } = post;
    return {
      post: {
        ...rest,
        title: previous.title,
        surfaces: previous.surfaces,
        instances,
        updatedAt: previous.at,
        version: previous.version,
        history: post.history.slice(0, -1),
        ...(previous.from === undefined ? {} : { from: previous.from }),
        ...(previous.prompt === undefined ? {} : { prompt: previous.prompt }),
        ...(previous.author === undefined ? {} : { author: previous.author }),
        ...(previous.publishedBy === undefined ? {} : { publishedBy: previous.publishedBy }),
        ...(previous.amendedAt === undefined ? {} : { amendedAt: previous.amendedAt }),
        ...(hidden.length ? { hiddenVersions: hidden } : {}),
        ...(previous.contract === undefined ? {} : { contract: previous.contract }),
        ...(previous.system === undefined ? {} : { system: previous.system }),
        rewrites,
      },
    };
  }

  async removePost(id: string) {
    if (!(await this.getPost(id))) return false;
    this.atomic(() => {
      this.sql.exec("DELETE FROM comments WHERE postId = ?", id);
      this.sql.exec("DELETE FROM post_versions WHERE postId = ?", id);
      this.sql.exec("DELETE FROM posts WHERE id = ?", id);
    });
    this.invalidateAssetRefs();
    return true;
  }

  async setPostStatus(id: string, status: PostStatus, acceptedVersion?: number) {
    const post = this.cachedPost(id) ?? (await this.getPost(id));
    if (!post) return null;
    const pin = status === "accepted" ? (acceptedVersion ?? post.version) : null;
    // A reason says why it left, and a stay was about the version once in use.
    const reason = status === "archived" ? (post.archiveReason ?? null) : null;
    // Archiving what's already archived keeps the day it went.
    const archivedAt =
      status === "archived"
        ? ((post.status === "archived" ? post.archivedAt : undefined) ?? new Date().toISOString())
        : null;
    this.raw.exec(
      "UPDATE posts SET status = ?, acceptedVersion = ?, archiveReason = ?, stayedVersion = NULL, archivedAt = ? WHERE id = ?",
      status,
      pin,
      reason,
      archivedAt,
      id,
    );
    const {
      acceptedVersion: _,
      archiveReason: _reason,
      stayedVersion: _stayed,
      archivedAt: _archivedAt,
      ...rest
    } = post;
    const next: Post = {
      ...rest,
      status,
      ...(pin === null ? {} : { acceptedVersion: pin }),
      ...(reason === null ? {} : { archiveReason: reason }),
      ...(archivedAt === null ? {} : { archivedAt }),
    };
    this.recache(next);
    return pin !== null && next.hiddenVersions?.includes(pin)
      ? this.setVersionHidden(id, pin, false)
      : next;
  }

  async setPostArchived(id: string, archivedAt: string, reason: string | null) {
    const post = this.cachedPost(id) ?? (await this.getPost(id));
    if (!post) return null;
    this.raw.exec(
      "UPDATE posts SET status = 'archived', acceptedVersion = NULL, archiveReason = ?, stayedVersion = NULL, archivedAt = ? WHERE id = ?",
      reason,
      archivedAt,
      id,
    );
    const { acceptedVersion: _, archiveReason: _reason, stayedVersion: _stayed, ...rest } = post;
    const next: Post = {
      ...rest,
      status: "archived",
      archivedAt,
      ...(reason === null ? {} : { archiveReason: reason }),
    };
    this.recache(next);
    return next;
  }

  async setForkedFrom(id: string, from: ForkRef | null) {
    const post = this.cachedPost(id) ?? (await this.getPost(id));
    if (!post) return null;
    this.raw.exec(
      "UPDATE posts SET forkedFrom = ? WHERE id = ?",
      from ? JSON.stringify(from) : null,
      id,
    );
    const { forkedFrom: _, ...rest } = post;
    const next: Post = from ? { ...rest, forkedFrom: from } : rest;
    this.recache(next);
    return next;
  }

  async bumpRewrites(designId: string) {
    const ids = (await this.listPosts({ designId })).map((p) => p.id);
    this.writingPosts(designId, ids, () =>
      this.sql.exec("UPDATE posts SET rewrites = rewrites + 1 WHERE designId = ?", designId),
    );
  }

  async setVersionHidden(id: string, version: number, hidden: boolean): Promise<Post | null> {
    const post = this.cachedPost(id) ?? (await this.getPost(id));
    if (!post) return null;
    const set = new Set(post.hiddenVersions ?? []);
    if (hidden) set.add(version);
    else set.delete(version);
    const list = [...set].sort((a, b) => a - b);
    this.raw.exec(
      "UPDATE posts SET hiddenVersions = ? WHERE id = ?",
      list.length ? JSON.stringify(list) : null,
      id,
    );
    const { hiddenVersions: _, ...rest } = post;
    const next: Post = list.length ? { ...rest, hiddenVersions: list } : rest;
    this.recache(next);
    return next;
  }

  async deleteOldVersions(id: string, versions: number[]): Promise<Post | null> {
    const post = await this.getPost(id);
    if (!post) return null;
    const gone = new Set(versions.filter((v) => v !== post.version));
    const hidden = (post.hiddenVersions ?? []).filter((v) => !gone.has(v));
    this.writingPosts(post.design, [id], () =>
      this.atomic(() => {
        for (const v of gone) {
          this.sql.exec("DELETE FROM post_versions WHERE postId = ? AND version = ?", id, v);
        }
        this.sql.exec(
          "UPDATE posts SET hiddenVersions = ? WHERE id = ?",
          hidden.length ? JSON.stringify(hidden) : null,
          id,
        );
      }),
    );
    this.touchDesign(post.design, new Date().toISOString());
    this.invalidateAssetRefs();
    return this.getPost(id);
  }

  async setPostReason(id: string, reason: string | null) {
    const post = this.cachedPost(id) ?? (await this.getPost(id));
    if (!post) return null;
    this.raw.exec("UPDATE posts SET archiveReason = ? WHERE id = ?", reason, id);
    const { archiveReason: _, ...rest } = post;
    const next: Post = reason ? { ...rest, archiveReason: reason } : rest;
    this.recache(next);
    return next;
  }

  async setPostStayed(id: string, version: number) {
    const post = this.cachedPost(id) ?? (await this.getPost(id));
    if (!post) return null;
    this.raw.exec("UPDATE posts SET stayedVersion = ? WHERE id = ?", version, id);
    const next: Post = { ...post, stayedVersion: version };
    this.recache(next);
    return next;
  }

  // --- comments ---

  async listComments(query: CommentQuery) {
    const clauses: string[] = [];
    const params: SqlStorageValue[] = [];
    if (query.noDesign) clauses.push("designId IS NULL");
    if (query.sessionId !== undefined) {
      clauses.push("sessionId = ?");
      params.push(query.sessionId);
    }
    if (query.designId !== undefined) {
      clauses.push("designId = ?");
      params.push(query.designId);
    }
    if (query.postId !== undefined) {
      clauses.push("postId = ?");
      params.push(query.postId);
    }
    if (query.afterSeq !== undefined) {
      clauses.push("seq > ?");
      params.push(query.afterSeq);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.sql
      .exec(`SELECT * FROM comments ${where} ORDER BY seq ASC`, ...params)
      .toArray()
      .map((r) => this.rowToComment(r));
  }

  private insertComment(input: CreateCommentInput): Comment {
    const createdAt = new Date().toISOString();
    const comment: Omit<Comment, "seq"> = {
      id: newId(),
      sessionId: input.sessionId,
      designId: input.designId ?? null,
      postId: input.postId ?? null,
      author: stripNul(input.author).trim() || "user",
      text: stripNul(input.text),
      createdAt,
      ...(input.anchor ? { anchor: input.anchor } : {}),
      kind: input.kind ?? "comment",
      anchors: input.anchors ?? [],
      postVersion: input.postVersion ?? null,
      viewport: input.viewport ?? null,
      ...(input.payload ? { payload: input.payload } : {}),
    };
    this.sql.exec(
      "INSERT INTO comments (id, sessionId, designId, postId, author, text, createdAt, kind, anchor, anchors, postVersion, viewport, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      comment.id,
      comment.sessionId,
      comment.designId,
      comment.postId,
      comment.author,
      comment.text,
      comment.createdAt,
      comment.kind,
      comment.anchor ? JSON.stringify(comment.anchor) : null,
      JSON.stringify(comment.anchors),
      comment.postVersion,
      comment.viewport,
      comment.payload ? JSON.stringify(comment.payload) : null,
    );
    const seq = this.sql.exec("SELECT last_insert_rowid() AS seq").one().seq as number;
    this.touch(input.sessionId);
    return { ...comment, seq };
  }

  async createComment(input: CreateCommentInput) {
    if (!(await this.getSession(input.sessionId))) return null;
    const post = input.postId ? await this.getPost(input.postId) : null;
    return this.insertComment({
      ...input,
      postId: post?.id ?? null,
      designId: input.designId ?? post?.design ?? null,
      postVersion: input.postVersion ?? post?.version ?? null,
    });
  }

  async removeComment(id: string) {
    const rows = this.sql.exec("SELECT * FROM comments WHERE id = ?", id).toArray();
    if (rows.length === 0) return null;
    const comment = this.rowToComment(rows[0]);
    this.sql.exec("DELETE FROM comments WHERE id = ?", id);
    if (comment.kind === "reply") this.invalidateAssetRefs();
    this.touch(comment.sessionId);
    return comment;
  }

  async listDecisionSources(project: string) {
    const alternatives = this.sql
      .exec(
        "SELECT designId, state, variant, status, version, acceptedVersion FROM posts WHERE designId IN (SELECT id FROM designs WHERE project = ?) ORDER BY createdAt ASC, rowid ASC",
        project,
      )
      .toArray()
      .map((r): DecisionAlternative => ({
        designId: r.designId as string,
        state: (r.state as string | null) ?? null,
        alternative: r.variant as string,
        status: r.status as PostStatus,
        version: r.version as number,
        acceptedVersion: (r.acceptedVersion as number | null) ?? null,
      }));
    // A close or a move from Home is a reply too, and decides nothing.
    const decidedAt: Record<string, string> = {};
    for (const r of this.sql
      .exec(
        `SELECT designId, MAX(createdAt) AS at FROM comments
         WHERE kind = 'reply' AND designId IN (SELECT id FROM designs WHERE project = ?)
           AND json_extract(payload, '$.archived') IS NULL
           AND json_extract(payload, '$.edited') IS NULL
         GROUP BY designId`,
        project,
      )
      .toArray()) {
      decidedAt[r.designId as string] = r.at as string;
    }
    return { alternatives, decidedAt };
  }

  async commitReply(input: CommitReplyInput) {
    if (!(await this.getSession(input.sessionId))) return null;
    if (!(await this.getDesign(input.designId))) return null;
    const moved = [...input.accept.map((x) => x.id), ...input.archive, ...(input.release ?? [])];
    return this.writingPosts(input.designId, moved, () =>
      this.atomic(() => {
        const comment = this.insertComment({
          sessionId: input.sessionId,
          designId: input.designId,
          author: "user",
          text: input.text,
          kind: "reply",
          postVersion: input.payload.version,
          payload: input.payload,
        });
        if (input.system) {
          this.writeSystem(input.system.next, {
            sessionId: input.sessionId,
            summary: input.system.summary,
          });
        }
        this.sql.exec(
          input.keepDraft
            ? "UPDATE designs SET asks = ? WHERE id = ?"
            : "UPDATE designs SET asks = ?, draft = NULL WHERE id = ?",
          JSON.stringify(input.asks),
          input.designId,
        );
        if (input.standings) {
          this.sql.exec(
            "UPDATE designs SET standings = ? WHERE id = ?",
            JSON.stringify(input.standings),
            input.designId,
          );
        }
        if (input.owner) {
          this.sql.exec(
            "UPDATE designs SET sessionId = ? WHERE id = ?",
            input.owner,
            input.designId,
          );
        }
        for (const { id, version } of input.accept) {
          // Picking an older version is passing on the newer ones. Otherwise they'd read
          // as unruled-on, and the viewer would move straight back to them.
          this.sql.exec(
            "UPDATE posts SET status = 'accepted', acceptedVersion = ?, archiveReason = NULL, stayedVersion = CASE WHEN ? < version THEN version ELSE NULL END, archivedAt = NULL WHERE id = ? AND designId = ?",
            version,
            version,
            id,
            input.designId,
          );
          // An answer's whole page stays hidden until it is chosen; now it's a version.
          const hiddenRow = this.sql
            .exec("SELECT hiddenVersions FROM posts WHERE id = ?", id)
            .toArray()[0];
          const hidden = parseJson<number[]>(hiddenRow?.hiddenVersions, []);
          if (hidden.includes(version)) {
            const left = hidden.filter((v) => v !== version);
            this.sql.exec(
              "UPDATE posts SET hiddenVersions = ? WHERE id = ?",
              left.length ? JSON.stringify(left) : null,
              id,
            );
          }
        }
        for (const id of input.release ?? []) {
          this.sql.exec(
            "UPDATE posts SET status = 'open', acceptedVersion = NULL, stayedVersion = NULL WHERE id = ? AND designId = ? AND status = 'accepted'",
            id,
            input.designId,
          );
        }
        for (const id of input.archive) {
          this.sql.exec(
            "UPDATE posts SET status = 'archived', acceptedVersion = NULL, archivedAt = ? WHERE id = ? AND designId = ?",
            new Date().toISOString(),
            id,
            input.designId,
          );
        }
        this.invalidateAssetRefs();
        return comment;
      }),
    );
  }

  // --- assets ---

  private referencedAssetIds(): Set<string> {
    if (this.assetRefCache) return this.assetRefCache;
    const out = new Set<string>();
    for (const r of this.sql.exec("SELECT surfaces FROM posts").toArray()) {
      collectAssetIds(parseJson<Surface[]>(r.surfaces, []), out);
    }
    for (const r of this.sql.exec("SELECT surfaces FROM post_versions").toArray()) {
      collectAssetIds(parseJson<Surface[]>(r.surfaces, []), out);
    }
    // The user's attachments: in a draft, in a sent reply, on an answered ask.
    for (const r of this.sql.exec("SELECT asks, draft FROM designs").toArray()) {
      collectAttachedIds(parseJson<Draft | null>(r.draft, null), out);
      for (const ask of parseJson<Ask[]>(r.asks, [])) collectAttachedIds(ask, out);
    }
    for (const r of this.sql
      .exec("SELECT payload FROM comments WHERE kind = 'reply' AND payload IS NOT NULL")
      .toArray()) {
      collectAttachedIds(parseJson<Reply | null>(r.payload, null), out);
    }
    // An installed icon set is referenced by its project's system, not by a
    // surface; evicting it would blank that project's icons.
    for (const r of this.sql.exec("SELECT json FROM systems").toArray()) {
      const sets = parseJson<{ iconSets?: { assetId?: unknown }[] } | null>(r.json, null)?.iconSets;
      for (const ref of Array.isArray(sets) ? sets : []) {
        if (typeof ref?.assetId === "string") out.add(ref.assetId);
      }
    }
    this.assetRefCache = out;
    return out;
  }

  private addAssetRefs(surfaces: Surface[]): void {
    if (this.assetRefCache) collectAssetIds(surfaces, this.assetRefCache);
  }

  private invalidateAssetRefs(): void {
    this.assetRefCache = undefined;
  }

  async putAsset(input: CreateAssetInput) {
    if (!(await this.getSession(input.sessionId))) return null;
    // Content-addressed: identical bytes dedupe to the existing blob (idempotent
    // upload), keeping its original session and createdAt; we just warm it.
    const id = await hashAssetId(input.data);
    if (await this.getAsset(id)) {
      await this.touchAsset(id);
      this.touch(input.sessionId);
      return (await this.getAsset(id))!;
    }
    const referenced = this.referencedAssetIds();
    const candidates = this.sql
      .exec("SELECT id, byteLength, lastAccessedAt FROM assets")
      .toArray()
      .map((r) => ({
        id: r.id as string,
        byteLength: r.byteLength as number,
        lastAccessedAt: r.lastAccessedAt as string,
        referenced: referenced.has(r.id as string),
      }));
    for (const evict of selectEvictions(
      candidates,
      input.data.byteLength,
      MAX_WORKSPACE_ASSET_BYTES,
    )) {
      this.sql.exec("DELETE FROM assets WHERE id = ?", evict);
    }
    const now = new Date().toISOString();
    const asset: Asset = {
      id,
      sessionId: input.sessionId,
      kind: input.kind,
      contentType: stripNul(input.contentType),
      byteLength: input.data.byteLength,
      filename: stripNul(input.filename ?? null),
      data: input.data,
      createdAt: now,
      lastAccessedAt: now,
    };
    // Bind the blob as an ArrayBuffer (the SqlStorageValue type); the node
    // adapter turns it back into a Uint8Array for node:sqlite.
    const buf = asset.data.buffer.slice(
      asset.data.byteOffset,
      asset.data.byteOffset + asset.data.byteLength,
    ) as ArrayBuffer;
    this.sql.exec(
      "INSERT INTO assets (id, sessionId, kind, contentType, byteLength, filename, data, createdAt, lastAccessedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      asset.id,
      asset.sessionId,
      asset.kind,
      asset.contentType,
      asset.byteLength,
      asset.filename,
      buf,
      asset.createdAt,
      asset.lastAccessedAt,
    );
    this.touch(input.sessionId);
    return asset;
  }

  async getAsset(id: string) {
    const rows = this.sql.exec("SELECT * FROM assets WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.rowToAsset(rows[0]) : null;
  }

  async touchAsset(id: string) {
    this.sql.exec(
      "UPDATE assets SET lastAccessedAt = ? WHERE id = ?",
      new Date().toISOString(),
      id,
    );
  }

  async listAssets(sessionId: string) {
    return this.sql
      .exec("SELECT * FROM assets WHERE sessionId = ?", sessionId)
      .toArray()
      .map((r) => this.rowToAsset(r));
  }

  async removeAsset(id: string) {
    if (!(await this.getAsset(id))) return false;
    this.sql.exec("DELETE FROM assets WHERE id = ?", id);
    return true;
  }

  async isAssetReferenced(id: string) {
    return this.referencedAssetIds().has(id);
  }
}
