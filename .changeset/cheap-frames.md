---
"mockpit": minor
---

Pages of designs load far faster, and they cost less while they're on screen. A frame's document now carries what it needs: mockpit's own files, and the fonts, stylesheets and scripts a page links from the CDN allowlist, fetched once by the server. Eight frames used to make 40 requests on every load for mockpit's own files, plus each page's CDN links, and now make none once their documents are cached. If a CDN can't be reached the link stays and the next load tries again, while a link the CDN says doesn't exist stays for good; a page that can't be inlined, such as a module script, keeps its link.

Studio's wall keeps a state's frames loaded when you switch away, so coming back is immediate. The small pictures on the wall, in Grid, on Home and on question options stop animating once the page has settled; Stage, the closer look and Studio's columns never do.

The CLI and the stdio MCP server now take a poster of each published page with a local Chrome or Chromium, just after the publish and without slowing it. Studio and Home show it instead of running the page, in the theme it was taken in; in the other theme the page runs as before. An explicit `--poster` always wins, and with no browser (or `CHROME_PATH` pointing nowhere) a publish works as before.
