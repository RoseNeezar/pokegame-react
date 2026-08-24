# Eastward-style forest shrine in Phaser 3: production feasibility

## Verdict

The supplied forest-shrine scene is feasible as a playable Phaser 3 map. It
does not require an AAA engine. The exact static composition can be reproduced
with a baked pixel-art background; Eastward-like movement, occlusion, animated
water, particles, normal-mapped lights, and weather require the background to
be split into gameplay layers and supplied with non-visual metadata.

Eastward itself is not a conventional flat tilemap. Pixpil describes it as a
3D game with a 2D perspective: Aseprite art is split into natural structural
parts, rebuilt in a depth-bearing scene, supplied with hand-painted bump data,
and lit by a custom renderer. Phaser can implement the same architectural idea
in 2D/WebGL. Matching Pixpil's complete renderer would require custom shaders;
matching the supplied scene during ordinary gameplay does not.

## Evidence about Eastward

- Pixpil says the basic art is made in Aseprite, divided by natural structure
  (for example roof and wall), rebuilt in a 3D environment, and given
  hand-painted bump maps. The same interview calls Eastward a “3D game with a
  2D perspective” and discusses shaders, weather, fog, sunlight, and fixed
  camera occlusion.
  [GameDeveloper interview](https://www.gamedeveloper.com/art/eastward-s-creators-share-insights-on-making-pixel-art-adventures)
- Pixpil's development blog describes a skewed world coordinate system with
  the camera aligned to the Z axis and levels assembled from hundreds of
  assets.
  [Pixpil development blog](https://pixpilgames.tumblr.com/page/4)
- Eastward's in-house Gii engine is based on MOAI and provides Unity-like asset
  management and scene design. Pixpil used Aseprite, Photoshop, and custom
  automation tools.
  [Road to the IGF](https://www.gamedeveloper.com/business/road-to-the-igf-pixpil-s-i-eastward-i-)
- The official site describes the result as pixel artwork combined with a
  modern 3D lighting system.
  [Eastward FAQ](https://eastwardgame.com/faqs/)
  [Official media page](https://eastwardgame.com/media/)

The documented facts do not establish a universal terrain tile size or prove
that every Eastward surface uses square tiles. A mixed system of reusable
terrain, larger stamps, and bespoke structures is the defensible production
model.

## What the supplied image is

The supplied PNG is 1672 x 941, RGB, and contains 191,833 unique colors. It is a
flattened high-color concept render with a pixel-art appearance, not a
production pixel source. It has no alpha-separated foreground, hidden art,
collision geometry, animation frames, depth anchors, normal maps, or light
occluders.

One uploaded copy costs about 6.0 MiB as an RGBA GPU texture. Replacing the
entire image for six water frames would consume about 36 MiB before normal
maps, masks, mipmaps, and renderer overhead. Local animated atlases are both
cleaner and cheaper.

## Recommended scene package

Preserve the composition but reconstruct it into these layers:

1. `ground`: dirt, static grass, floor, non-moving water base, and baked ambient
   shadows.
2. `lower-props`: rocks, low plants, shrine bases, wall bases, and bridge deck.
3. `animated-water`: surface ripples, waterfall strips, impact foam, and rock
   ripples as small sprite animations.
4. `actors`: player, companion, monsters, NPCs, pickups, and combat effects,
   sorted by their feet Y coordinate.
5. `overhead`: tree crowns, roof eaves, high branches, arches, and any foreground
   piece actors can pass behind.
6. `lighting`: normal maps for selected assets, static ambient grade, lantern
   lights, glow sprites, fog, and particles.
7. `metadata`: collision, triggers, spawns, elevation, water bounds, navigation,
   and light definitions in Tiled object layers.

The projection is baked into the art. Phaser should use an orthographic 2D
camera; it does not need to tilt a 3D camera to obtain the illustrated angle.

## Collision design

Collision must represent ground contact, not the visible silhouette.

- Player and monsters: a small feet-biased box or capsule. The head, cloak,
  weapon, ears, and tail remain non-colliding.
- Trees: collide only with the trunk/root footprint; canopy belongs overhead.
- Shrine: rectangles/polygons around wall and pillar bases. Door openings use
  trigger volumes; they are not full-building colliders.
- Rocks and crystals: compact footprints at their bases.
- River banks and waterfall drops: blocked polygons or a fine occupancy grid.
- Bridge: walkable deck plus side blockers; an elevation/priority region controls
  whether actors draw above water and banks.
- Stairs: transition strips between discrete elevation regions, not physical
  stair-step collision.

For this map, a 32 px collision grid is acceptable for broad structures but too
coarse for the curved river bank. Use 8-16 px microcells for the bank or test a
feet box against authored polygons. Matter.js is unnecessary unless the game
needs dynamic rigid-body polygons; deterministic custom movement against a
static grid/polygon set is simpler for an action RPG.

Author Tiled object layers named `collision`, `triggers`, `spawns`, `elevation`,
`water`, `occluders`, and `lights`. Keep pet navigation as a separate occupancy
grid so visual following does not push the player or snag on scenery.

## Water animation

Do not animate water by swapping the full scene image.

- Water surface: static dark teal base plus a 3-6 frame highlight/ripple overlay
  at roughly 6-10 frames per second.
- Waterfall: a 6-8 frame vertical sprite at roughly 10-12 frames per second.
- Impact foam: independent 4-6 frame loop at roughly 8-12 frames per second.
- Ripples around rocks: 3-4 frame loops with staggered start phases.
- Mist: tiny sprite particles emitted only at waterfall impact points.

All surface and shoreline frames should share a phase clock where seams meet.
Use nearest-neighbor sampling. Prefer explicit frame animation over texture
scrolling for the falls because it preserves hand-authored pixel clusters.
Masks restrict effects to the authored water shapes. A subtle shader
displacement is optional, never a substitute for the pixel frames.

Phaser provides atlas/spritesheet animations, masks, render textures, and
TileSprite texture scrolling. Its Light2D pipeline supports normal maps under
WebGL.

- [Phaser animations](https://docs.phaser.io/phaser/concepts/animations)
- [Phaser TileSprite](https://docs.phaser.io/api-documentation/3.88.2/class/gameobjects-tilesprite)
- [Phaser RenderTexture](https://docs.phaser.io/phaser/concepts/gameobjects/render-texture)
- [Phaser Light2D and normal maps](https://docs.phaser.io/phaser/concepts/gameobjects/light)

## Lighting and Eastward fidelity

Use three levels of lighting:

1. Bake the global dusk palette, static ambient shadows, and large soft value
   shapes into the ground/prop art.
2. Use additive pixel glows for the lantern, cyan seal, and crystal. This is
   inexpensive and predictable.
3. Give important structures normal maps and use Phaser Light2D for moving or
   pulsing lights.

Stock Light2D provides normal-mapped diffuse light but is not a complete clone
of Eastward's custom renderer. True Eastward-style multi-light shadowing,
height-aware occlusion, and weather-integrated lighting require a custom WebGL
pipeline with color, normal, height/occlusion, and light buffers. That is an
advanced rendering feature, not an engine migration requirement. Phaser exposes
custom WebGL pipelines for this purpose.

[Phaser MultiPipeline API](https://docs.phaser.io/api-documentation/3.90.0/class/renderer-webgl-pipelines-multipipeline)

## Fit with the existing game

The current project already contains most of the required runtime:

- Phaser 3.90 with `pixelArt`, `roundPixels`, and FIT scaling.
- Full-bleed image-map loading.
- Optional full-scene overhead image.
- Tiled collision objects converted into the movement collision grid.
- Free movement with a feet-biased player collision box.
- Feet-Y depth sorting for player, follower, NPCs, and monsters.
- A delayed-trail companion follower.
- Elevation/raised-cell priority.
- Three-phase synchronized tile water.

The principal runtime additions are:

1. Load multiple named image layers instead of only `art` and `overhead`.
2. Spawn localized animated-region sprites from a Tiled `animated` object layer.
3. Support polygon or 8-16 px microgrid collision for irregular banks.
4. Add normal-map/light/occluder metadata for hero structures.
5. Cull or chunk large scrolling maps and atlas the animated details.

The existing whole-map `artPhases` mechanism is suitable for a quick prototype,
but local animated regions should replace it for the production scene.

## Production options

### Fast playable proof

Use the current image as `ground`, reconstruct a clean `overhead` cutout, draw
collision and triggers in Tiled, and replace visible water sections with small
animated overlays. This proves movement, combat space, pet following, and
occlusion quickly while preserving the composition.

### Recommended shipped map

Hand-clean/re-author the image at the game's native logical resolution, split
all gameplay layers, reconstruct hidden pixels, animate local water/foliage,
and create normal maps only for the shrine, lantern, water-edge rocks, and
crystal. This is the best quality-to-cost solution.

### Full reusable Eastward-style world pipeline

Break the scene into reusable terrain modules, large organic stamps, and
multi-part hero assets. Package each major asset with albedo, normal map,
collision footprint, depth anchor, occlusion mask, animations, and editor
properties. This costs substantially more art/tooling time but makes later maps
fast and consistent.

## Acceptance criteria

- The static scene is visually indistinguishable from the approved cleaned art
  at native scale.
- No anti-aliased scaling or subpixel camera shimmer occurs.
- Actor feet never enter walls, water, trunks, or rocks; upper bodies may overlap
  scenery naturally.
- Actors pass behind canopies/eaves and in front of their bases correctly.
- Every water loop is seamless and neighboring pieces stay phase-synchronized.
- Water animation swaps only local regions, not the full map.
- The scene holds the target frame rate on the weakest supported device.
- Gameplay remains correct with lighting disabled, making lighting presentation
  rather than collision/game-state authority.

## Final recommendation

Build this scene in Phaser. Start with the hybrid hero-plate method, not a giant
tile conversion and not a 3D engine rewrite. Treat Eastward as the architectural
reference: separated pixel assets, explicit depth, authored collision, localized
animation, and normal/bump-assisted lighting. The art-production workload—not
Phaser—is the limiting factor.
