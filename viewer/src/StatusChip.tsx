// A variant's status in the words the user decides with: the accepted one is
// "chosen". Shared by the tree drill-down and the library.

import type { PostStatus } from "../../server/types.ts";

const LABEL: Record<PostStatus, string> = {
  accepted: "chosen",
  open: "open",
  archived: "archived",
  dropped: "dropped",
};

export function StatusChip(props: { status: PostStatus }) {
  return <span class={`st-chip st-${props.status}`}>{LABEL[props.status]}</span>;
}
