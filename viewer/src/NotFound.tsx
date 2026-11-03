// A link that leads nowhere says so, and gives the way out. Without this a typo
// in a project's name read as good news: nothing open, all answered.

import { linkClick } from "./route.ts";

export function NotFound(props: { title: string; hint?: string; href: string; back: string }) {
  return (
    <div class="notfound">
      <h1>{props.title}</h1>
      {props.hint ? <p>{props.hint}</p> : null}
      <a class="btn" href={props.href} onClick={(e) => linkClick(e, props.href)}>
        {props.back}
      </a>
    </div>
  );
}
