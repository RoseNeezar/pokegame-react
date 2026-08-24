# Eastward-style detailed pixel-map production

## Conclusion

The closest documented shipped-game match to the supplied forest-and-ruins map is
**Eastward** by Pixpil. Its production method is a hybrid:

- hand-authored 2D pixel-art assets;
- hundreds of separate environment pieces assembled in a scene editor;
- structures split into natural layers, such as walls and roofs;
- those layers rebuilt into a skewed 3D scene to provide depth;
- hand-painted bump/normal information for lighting;
- dynamic shaders, fog, weather, sunlight, and deferred-style lighting.

It is therefore neither a single painted background, nor a conventional 3D game
rendered into flat screenshots, nor demonstrably a pure square-tile map.

## Directly documented facts

Pixpil lead programmer Tommo Zhou describes Eastward as a "3D game with a 2D
perspective." The engine uses shader textures and lighting systems for atmosphere,
weather, fog, and time of day. The same interview explains that basic assets are
created in Aseprite, divided according to structure (for example, roof and wall),
rebuilt in a 3D environment, and given hand-painted bump maps before import.

Source: [Eastward's creators share insights on making pixel art adventures](https://www.gamedeveloper.com/art/eastward-s-creators-share-insights-on-making-pixel-art-adventures)

Pixpil's in-house Gii engine provides a Unity-like environment for asset management
and scene design. It is built on MOAI. Aseprite is used for animation, Photoshop for
design, and custom automation tools process assets for artists.

Source: [Road to the IGF: Pixpil's Eastward](https://www.gamedeveloper.com/business/road-to-the-igf-pixpil-s-i-eastward-i-)

The official Eastward site identifies the engine as a cross-platform C++/Lua engine
based on MOAI, and describes the visual result as rich pixel artwork combined with a
modern 3D lighting system.

Sources: [Eastward FAQ](https://eastwardgame.com/faqs/), [Eastward media page](https://eastwardgame.com/media/)

Pixpil's development blog describes level building from "hundreds of assets." It
also explains that the camera is aligned to the Z axis while a skewed coordinate
system supplies depth information for lighting and other 3D effects.

Source: [Pixpil development blog, page 4](https://pixpilgames.tumblr.com/page/4)

## What is evidenced versus inferred

### Evidenced

- Environments are assembled from many assets in a scene editor.
- Pixel assets are authored in Aseprite and designed in Photoshop.
- Major assets are split into independently layered structural parts.
- Scene depth is real engine data rather than only a painted illusion.
- Bump maps are painted per asset for dynamic lighting.
- Atmospheric lighting and post-processing are applied at runtime.

### Strong inference

Repeated ground motifs are probably built from reusable terrain tiles or stamps,
while buildings and hero structures use larger modular pieces. This is consistent
with the documented "hundreds of assets" workflow and visible repetition, but no
primary source located for this report publishes Eastward's terrain tile dimensions
or says that every surface uses a conventional grid tilemap. It would be inaccurate
to claim a specific tile size as fact.

## Comparison with the supplied map

The supplied 1108 x 1419 image is a flattened high-color raster composition. It has
the visual density of Eastward but none of Eastward's production metadata:

- no separate roof, wall, canopy, or foreground layers;
- no hidden artwork behind foreground structures;
- no collision geometry;
- no depth/height data;
- no normal or bump maps;
- no independent waterfall, foliage, or rune animation frames.

It can be used unchanged as a baked background. To behave like an Eastward scene,
it must be converted into gameplay layers.

## Phaser 3 reproduction paths

### Baked path: exact static appearance

Use the original image as the base texture, then add:

1. a transparent foreground/overhead cutout;
2. collision rectangles or polygons;
3. spawn and trigger objects;
4. separate character and monster sprites;
5. localized animated overlays for water, runes, foliage, and particles.

This preserves the source image exactly and requires no 3D engine.

### Eastward-style hybrid path: reusable structures and moving lights

Convert each reusable structure into a package containing:

1. color/albedo pixel art;
2. wall/base and roof/overhead layers;
3. collision footprint;
4. depth or height metadata;
5. a hand-painted normal map;
6. optional animation frames and interaction anchors.

Assemble those packages in Tiled or a custom editor. Use small tiles for ordinary
terrain, larger stamps for cliffs and tree clusters, and bespoke multi-part assets
for important structures.

Phaser 3's WebGL Light2D pipeline can light textures that have normal maps. It is a
forward diffuse lighting pipeline rather than a clone of Pixpil's custom renderer,
so matching Eastward's complete deferred-lighting behavior may require a custom
WebGL pipeline.

Sources: [Phaser Light2D and normal-map documentation](https://docs.phaser.io/phaser/concepts/gameobjects/light), [Phaser LightPipeline documentation](https://docs.phaser.io/api-documentation/3.88.2/class/renderer-webgl-pipelines-lightpipeline)

## Comparison games

**Sea of Stars** is another relevant 2D reference. Sabotage Studio documents a custom
render pipeline with full dynamic lighting, but the public primary sources located
here do not describe its map assembly precisely enough to classify every environment
as tiles, modular stamps, or 3D geometry.

Source: [Sea of Stars official press kit](https://sabotagestudio.com/presskits/sea-of-stars/)

**Octopath Traveler** is the clear contrasting method: it intentionally combines 2D
pixel characters with 3D environments and modern Unreal Engine effects. It is a true
HD-2D/3D-scene pipeline and is not the closest production match for the supplied map.

Source: [Unreal Engine's Octopath Traveler production feature](https://www.unrealengine.com/spotlights/octopath-traveler-s-hd-2d-art-style-and-story-make-for-a-jrpg-dream-come-true)

## Recommendation

For this project, use the baked path for unique hero maps and the Eastward-style
hybrid path for repeatable world production. Phaser is sufficient for both. A AAA
engine becomes useful only if the project chooses genuine 3D environments, 3D
cameras, volumetric effects, or complex global illumination; none is required to
retain the supplied map's appearance.
