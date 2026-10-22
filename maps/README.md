# Maps

Every folder here is a map in the game's menu. Each one was made with the map
maker (`?mapmaker=true`, root menu → **Map maker**) and contributed as a pull
request:

```
maps/<id>/
  map.json            the map (golpe-tilemap v1, sanitised)
  screenshot-1.png    the whole map — also its card in the menu
  screenshot-2..4.png play-test frames
  preview.webm        a play-test clip against bots
```

`?map=<id>` boots straight into one (e.g. `/?map=castle-keep&bots=5`).

To contribute a map: build it, press **Test vs bots**, then **Publish**. From a
checkout you can also save it here and run `pnpm map:pr <id>`, which films it
against bots if the media is missing and opens the PR with `gh`.

See [specs/map-maker.md](../specs/map-maker.md).
