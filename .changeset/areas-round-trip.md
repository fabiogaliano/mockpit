---
"mockpit": patch
---

`edit`'s `areas` takes the `{name, description}` objects `read` returns as well as plain names, on every tier (`mockpit edit --areas` also takes that JSON list), so a read sent back round-trips. Only the order is taken from it; a description is still written with `description` and `area`.
