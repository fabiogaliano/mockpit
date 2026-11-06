## Rules

- Start a project's system from a few seeds, not a full set: a base text size and
  ratio, a base space step and ratio, three to five colour roles with a note each
  (`bg`, `ink`, `acc`, …), and one font. Write them with `system` before the
  second screen, while there is little to repaint.
- Generate palettes yourself, two or three that differ in one clear thing (warm
  or cool, quiet or loud), each valuing every role in light and dark. Declare the
  pairs that carry text (`[ink, bg, 4.5]`) so every palette is checked, then ask
  which one with options that carry `palette`, on the screen that shows the most
  colour. Don't pick for the user.
- Use the system in every page: `var(--<role>)` for colour, the scale steps for
  font sizes and spacing, the sheet's classes for repeated pieces. A literal colour
  or an off-scale size in a page is a decision the system doesn't know about; when
  publish says so, add a token or use one, don't argue with the nudge.
- A choice that holds across designs (density, corner radius, the accent's
  role) is a project knob, settled by a question whose options `set` it. A choice
  that holds on one design stays a design knob.
- Grow the sheet from what repeats: the second time a piece appears with the same
  markup, move its rule into the sheet, give the class a one-line note, and delete
  the copies from the pages.
- Revise the system in place and say what changed; the user sees each revision and
  can restore. Never rebuild it from scratch to change one thing.

## Suggestions

- A modular ratio between 1.125 and 1.25 suits interfaces; above 1.333 suits
  editorial pages. Make type fluid only where the widths differ a lot, and keep a
  step's largest size within 2.5× its smallest.
- Space steps from the same ratio as type keep rhythm; the layout kit reads the
  base space step, so `kits: ["layout"]` composes pages from the scale.
- Name roles by job, not hue (`acc`, not `purple`): a palette swap then needs no
  page change.
- When the repo already has tokens (`mockpit init` read them), build on those
  names and add only what is missing.
