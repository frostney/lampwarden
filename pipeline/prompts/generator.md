You write ONE short TypeScript function `build(k)` that composes a single isometric pixel-art sprite for an ancient-Greek-myth action RPG (Titan Quest style). A fixed renderer (iso projection, z-buffer, banded Lambert light, auto outline, cast shadow, 128x128) draws whatever you add to `k`. You only choose and parameterise builders. Reply with only a ```ts code block, ideally under 30 lines, no imports, no comments needed.

WORLD: units ~= pixels. Ground z=0, origin [0,0] is the tile centre (sprite stands there). +u points screen down-right, +v screen down-left, +z up. facing (degrees): 0 faces +u (viewer sees front + its left side), 90 faces +v. Prefer facing 10-40 for upright figures; centaurs and quadrupeds must be turned near side-on, facing -35 (the builder clamps them to -50..-15). Keep everything within ~|u|,|v| <= 14 and z <= 40 or it clips.

MATERIALS (strings; 9-shade ramps): marble limestone bronze gold iron terracotta black olive laurel aegean crimson purple linen leather skin skin_olive skin_dark skin_pale skin_green skin_grey fur fur_dark feather bone wood snake sky fire. Aliases: red wine->crimson, blue->aegean, green->laurel, white->marble, stone->limestone, brown->leather, silver steel->iron, hair->fur_dark, scales->snake. Unknown names throw.

CHARACTER BUILDERS (all params optional):
humanoid(k, {at:[u,v], facing, height:22, build:'slim'|'average'|'heavy'|'giant', pose, skin, gender:'female', material,
  head:{type:'human'|'bull'|'goat'|'cyclops'|'gorgon'|'skull', hair, beard, helmet:'corinthian'|'attic'|'none', helmetMat, crest, eyes},
  torso:{armour:'muscle-cuirass'|'linothorax'|'chiton'|'robe'|'none', colour, trim},
  legs:{greaves:true|mat, sandals:true|mat, lower:'human'|'goat'|'bird'|'serpent', colour},
  arms:{bracers:true|mat},
  weapon:'spear'|'trident'|'staff'|'torch'|'xiphos'|'sword'|'kopis'|'axe'|'club'|'labrys'|'hammer'|'thunderbolt'|'javelin'|'throwspear'|'sling'|'pipes'|'bow', weaponMat,
  shield:'hoplon'|'pelte'|{type, colour, emblem:'disc'|'ring'|'lambda'|'eye'|'star', emblemColour, rim},
  cape: mat, wings:{type:'feather'|'bat', colour, span:12}})
  - gender:'female' = slim, no beard, hair colour, ankle-length robe by default (priestess, nymph, goddess, handmaiden). torso.armour 'robe' = long pleated ankle-length dress for any figure; give torso.colour and trim.
  - material:'marble'|'bronze'|'iron'|'gold'|... = single-material figure for statues and automatons (every part takes that material).
  - defaults give contrast: a bronze helmet gets a crimson crest and crimson shield with gold emblem unless you set them. Bow: weapon:'bow' draws a curved bow, string and nocked arrow.
  - 'thunderbolt' = gold zigzag forks (Zeus statues: material:'marble' + weapon 'thunderbolt', pose 'attack2'); 'hammer' = haft + big flat head; 'axe' = bearded head. 'bow' has a thick limb and string; 'sling' shows cord and stone.
  - head type 'skull' (or skin 'bone') = skeleton; 'gorgon' = snake hair; 'cyclops' = one eye; 'bull' = minotaur head; 'goat' = horns+ears.
  - legs.lower 'goat' = satyr hooves, 'bird' = talons, 'serpent' = coiled snake tail (lamia/gorgon).
  - build 'giant' is ~1.4x taller and bulkier (cyclops, titans).
CREATURE BUILDERS (take the same params as humanoid, all optional; they set sensible anatomy, gear and facing themselves, so call them bare and only override what the brief asks for):
spartan(k, {...}) red cape + crested corinthian helmet + hoplon + xiphos; cyclops(k, {...}) giant, one big eye, club; minotaur(k, {...}) giant bull head, labrys; satyr(k, {...}) goat legs + hooves, pipes; harpy(k, {...}) feathered torso, wings, talons, human face.
humanoid also takes capeStyle:'big' (long cape draped behind and to the sides).
winged(k, {...humanoid params, span}) = humanoid with wings (Nike, Icarus; use harpy() for harpies).
centaur(k, {at, facing, colour, pose, upper:{...humanoid params for the torso/head/arms/weapon}}).
quadruped(k, {at, facing, kind:'horse'|'bull'|'lion'|'dog'|'boar'|'goat', colour, mane, size:1, pose, rider:{...humanoid params}}).
pose: 'idle'|'idle1'..'idle4'|'walk1'..'walk6'|'attack1'..'attack5'|'hurt'|'death' (default 'idle'; attack3 is the strike frame, use it for an action still). Builders add muscle shading, armour plates, pteruges, cloth folds, big props and a wide stance by themselves; just pick the params.

quadruped lion = heavy body, short thick legs, deep chest, thick neck, dark mane framing a visible face and snout, tail tuft; boar has long tusks and a bristle ridge.
HERO (the player character; same bronze/gold armour in both sexes):
hero(k, {sex:'male'|'female', melee:'xiphos'|'sword'|'spear'|'axe'|'club'|'hammer', ranged:'bow'|'sling'|'javelin'|'throwspear', ready:'melee'|'ranged' (which one is in hand), pose, at, facing:20, setting:'greek', helmet:'none'|'corinthian'|'attic', cape:true, palette:{cloth, accent, hair, skin, metal}})
  - hero pose: 'idle'|'idle1'..'idle4'|'walk1'..'walk6'|'melee1'..'melee5' (melee weapon in hand)|'ranged1'..'ranged5' (draw-and-release; ranged weapon in hand)|'hurt'|'death'. The other weapon is shown stowed (quiver + back-slung bow, hip scabbard, back spear, hip sling pouch).
  - male = broad, short hair, pteruges; female = slim, ponytail, bust-shaped cuirass, short chiton skirt. Do not pass humanoid params; use palette.
setting: hero/ship read their materials from a theme; only setting:'greek' exists (more themes can be added later). Leave it out.
ship(k, {at, facing:5 (0 side-on, bow right; 45 bow toward viewer; -60 bow away), kind:'trireme'|'galley', sail:true|false, oars:5, dock:true|false, setting}) a long wooden warship: planked hull, crimson rail, shield row, painted eyes, raised prow with a bronze ram, curled stern post, oars, optional striped sail, optional wooden dock beside it (use dock for 'at a dock').
hydra(k, {at, facing, heads:3, colour:'snake'}) body, stubby legs, tail and `heads` (2-7) fanged serpent heads on long necks.
tree(k, {at, kind:'olive'|'cypress'|'laurel', height, leaf})  olive = twisting multi-strand trunk with roots, black knot hollow and forked limbs, silver-green canopy; cypress = tall dark flame; laurel = round green canopy.

PROP BUILDERS:
column(k, {at, order:'doric'|'ionic', height:26, mat:'marble', broken:false})
amphora(k, {at, height:26, style:'black-figure'|'red-figure'|'plain', mat:'terracotta', figure:'warriors'|'horses'|'rider', border:'meander'|'palmette'})  (paints black silhouettes on the terracotta panel)
brazier(k, {at, height:11, mat:'bronze', fire:true})
altar(k, {at, w:9, h:7, mat:'marble', fire:false})
statueBase(k, {at, w:8, h:4, mat}) -> returns top z (stand a humanoid on it with at:[u,v,top] with skin 'marble' or 'bronze' for a statue).

RAW SHAPES (only for small extras the builders lack; world coords [u,v,z]):
k.sphere(c, r, mat), k.ellipsoid(c, [ru,rv,rz], mat), k.capsule(a, b, r1, r2, mat), k.box(lo, hi, mat),
k.cyl(a, b, r1, r2, mat) (cone if r2 differs), k.lathe([u,v,z0], [[h,r],...], mat), k.plate([[u,v,z],...], thick, mat), k.ring(c, axis, R, r, mat).
Optional last-but-one arg {shift:-2..2 (darker/lighter), glow:true}. Builders already ground and outline; do not draw outlines or shadows. Raw shapes that float free get snapped onto the nearest part (or dropped), and large raw ellipsoids/rings wrapped around a builder's head, neck or torso are dropped, so use builder params instead. Sprites that come out small are scaled up automatically to fill the frame. brazier/altar with fire:true keep their flame uncovered.

RULES: one subject, centred at [0,0]; use the builder that matches the creature; express the brief through params (colours, gear, head/legs type) before adding raw shapes; at most ~6 raw shapes; strictly deterministic (no Math.random, no loops over many shapes).

EXAMPLE brief: "hoplite with hoplon and spear"
```ts
function build(k) {
  humanoid(k, {
    facing: 20, pose: 'idle', skin: 'skin',
    head: { helmet: 'corinthian', crest: 'crimson' },
    torso: { armour: 'linothorax', trim: 'aegean' },
    legs: { greaves: true, sandals: true },
    weapon: 'spear',
    shield: { type: 'hoplon', colour: 'bronze', emblem: 'lambda', emblemColour: 'crimson' },
    cape: 'crimson',
  });
}
```

EXAMPLE brief: "female hero with a spear and a bow"
```ts
function build(k) {
  hero(k, { sex: 'female', melee: 'spear', ranged: 'bow', ready: 'melee', pose: 'idle' });
}
```

EXAMPLE brief: "Ionic marble column"
```ts
function build(k) {
  column(k, { order: 'ionic', height: 30, mat: 'marble' });
}
```
