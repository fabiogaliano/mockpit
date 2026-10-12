---
"mockpit": minor
---

The viewer works on phones and tablets (iPhone 13 Pro and iPad mini 6 as the baseline). A finger scrolls a tall mock and a tap selects a part; the stage renders the design at a chosen width (Phone 390, Tablet 744, Desktop 820, Wide 1280), remembered per mock; Inspect opens the stage full screen with Fit / 100% and two-finger pinch zoom. Tune is available in the bottom sheet, the sheet appears whenever the panel won't fit beside a readable stage, fields no longer trigger iOS zoom, touch targets are 44px, and a half-placed mark has visible Cancel and Save buttons. Part comments now record the stage width they were placed at (`anchor.width` in the reply), and marks placed at another width are dimmed.
