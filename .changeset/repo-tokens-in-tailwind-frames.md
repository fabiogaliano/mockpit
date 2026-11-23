---
"mockpit": patch
---

On a Tailwind project, frames now get the repo theme's own tokens (spacing, type sizes, line heights, radii, fonts, weights, motion) even when `mockpit init` had to strip the theme file from the Tailwind entry; colours that change with the mode stay the palette's. A page carrying its own copy still renders, and the publish nudge says those names are already in every frame.
