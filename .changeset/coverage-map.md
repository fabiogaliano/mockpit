---
"mockpit": minor
---

Each page of the Board says what's left on it. The page card holds a coverage map: the area's screens and components down, every state across, each cell Ready (marked Ready and still showing what was marked), In design (drawn), Planned (declared, nothing drawn) or Missing (a standard state the screen is owed and nobody dismissed), with a legend and each flow's "N of M steps ready" under it. Clicking a cell fits the Board to that frame and selects it, a Missing cell its dashed frame, and a flow's line fits its section. Hide map folds the card to its one line, "0 of 7 ready · 3 missing · 1 question", and the choice holds on every page. A flow's section says "N of M steps ready" too, and the rail shows each page's Ready designs, "3/7", after its name. `mockpit read --area` carries the same map as `coverage`: the summary, a legend and the map as text, a line per design, and each flow there says its steps ready.
