---
"mockpit": minor
---

Studio can select several versions: tick a card's number, Shift-click for a range, and an icon bar moves, saves or archives them together. Comment, Borrow and More like these go as one reply, and Comment switches between one sheet and one at a time. Once a mock's last design leaves, you land on its area, with Undo returning to the mock. Home moves a mock with everything archived and no question waiting out of the grid, into a folded Archived list. The Stage and Studio switch shows whenever a mock has more than one design or version, and a mock reopens in the view last used; from Look closer, Stage opens the version being looked at. The Save menu starts on moving: its Remove switch is on, and applies once a place is picked. Its button is now a folder with an arrow. Picking a look on an older draft now takes the look as it stands, and a component's repeated stylesheet loads once, so a later component can't undo an earlier one's styles.

Agents can tidy up: `mockpit move` (and the `move` tool and `POST /api/mocks/:id/move`) takes variants to another mock or tab and out of the one they were in, archives them or restores them. It never deletes, leaves a variant in use where it is, moves a group together and says what it did in the Thread. Archiving a variant also clears a pick of it from the draft, so Send cannot put a design nobody can see in use.

A small card under a lead drops the name it shares with that lead, so `moss ball · listening` reads as `listening`.

A mock with no states can take tabs: `mockpit edit --mock <slug> --first-state <name>` names the state it has, and every variant goes there, archived ones too.
