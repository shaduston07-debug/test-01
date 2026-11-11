// Inkwell Learning — course content.
// Written from long-standing, human-made teaching sources (named in each lesson's Sources):
// Andrew Loomis, Scott Robertson, Drawabox, Ctrl+Paint, James Gurney, Paul Ekman, Frank Thomas &
// Ollie Johnston, Richard Williams, Scott McCloud, Blambot, the official WEBTOON creator guides
// and Clip Studio's tutorial site. Every picture in a lesson is a live, code-drawn demo.
//
// Lesson: { id, title, min, body: [html | {demo, caption}], keys: [takeaways],
//   quiz: [{ q, a: [answers], c: correctIndex, why }],
//   challenge: { title, text, steps: [], studio: { mode, w, h, name, persp?, fps?, len? } },
//   sources: [[label, url?]] }

const S = {
  drawabox: ['Drawabox — Lesson 1: Lines, Ellipses and Boxes (free)', 'https://drawabox.com/lesson/1'],
  ctrlpaint: ['Ctrl+Paint free video library (Matt Kohr)', 'https://www.ctrlpaint.com/library'],
  ctrlpersp: ['Ctrl+Paint — Perspective drawing isn\'t scary', 'https://www.ctrlpaint.com/videos/perspective-drawing-isnt-scary'],
  robertson: ['Scott Robertson & Thomas Bertling — How to Draw (Design Studio Press, 2013), ch. 1–5', null],
  loomisCreative: ['Andrew Loomis — Successful Drawing (1951), perspective chapters', null],
  loomisHead: ['Andrew Loomis — Drawing the Head and Hands (1956)', null],
  proko: ['Proko — Portrait drawing fundamentals (free videos + course)', 'https://www.proko.com/portrait'],
  ekman: ['Paul Ekman Group — Universal emotions', 'https://www.paulekman.com/universal-emotions/'],
  faigin: ['Gary Faigin — The Artist\'s Complete Guide to Facial Expression (1990)', null],
  loa: ['Line of Action — free timed practice (faces & expressions)', 'https://line-of-action.com'],
  gurney: ['James Gurney — Color and Light: A Guide for the Realist Painter (2010)', null],
  gurneyBlog: ['James Gurney — Gurney Journey blog', 'https://gurneyjourney.blogspot.com'],
  bucci: ['Marco Bucci on Proko — Working with color and light', 'https://www.proko.com/lesson/working-with-color-and-light'],
  ctrlcolor: ['Ctrl+Paint — Color videos', 'https://www.ctrlpaint.com/videos/tag/Color'],
  illusion: ['Frank Thomas & Ollie Johnston — The Illusion of Life: Disney Animation (1981)', null],
  williams: ['Richard Williams — The Animator\'s Survival Kit (2001)', null],
  becker: ['Alan Becker — 12 Principles of Animation (free video series)', 'https://www.youtube.com/@AlanBeckerTutorials'],
  open12: ['Open Culture — the 12 principles demonstrated in 12 short films', 'https://www.openculture.com/2015/04/disneys-12-timeless-principles-of-animation-demonstrated-in-12-animated-primers.html'],
  blenderFilms: ['Blender Studio open movies (CC-BY) — study real animation frame by frame', 'https://studio.blender.org/films/'],
  morevna: ['Morevna Project — open-source anime (CC-BY)', 'https://morevnaproject.org'],
  mccloud: ['Scott McCloud — Understanding Comics (1993), ch. 3; Making Comics (2006)', null],
  wtHandbook: ['WEBTOON — Creator\'s Resource Handbook (official PDF)', 'https://webtoons-static.pstatic.net/creator101/en/pdf/Creators-Resource-Handbook-Updated.pdf'],
  wtChecklist: ['WEBTOON — Before You Publish checklist (official PDF)', 'https://webtoons-static.pstatic.net/creator101/en/pdf/Before-you-publish-Checklist-Updated.pdf'],
  wtAcademy: ['WEBTOON Creators 101 — resource list', 'https://www.webtoons.com/en/creators101/webtoon-academy/resource-list'],
  cspPanels: ['Clip Studio Tips — Webtoon panelling tips', 'https://tips.clip-studio.com/en-us/articles/9341'],
  cspScroll: ['Clip Studio — Tips for creating vertical scrolling webtoons', 'https://www.clipstudio.net/how-to-draw/archives/157055'],
  cspLetter: ['Clip Studio Tips — Letter your webtoon like a pro', 'https://tips.clip-studio.com/en-us/articles/3751'],
  cspStart: ['Clip Studio Tips — Starting your own WEBTOON', 'https://tips.clip-studio.com/en-us/articles/7396'],
  blambot: ['Blambot (Nate Piekos) — Comic book grammar & tradition', 'https://blambot.com/pages/comic-book-grammar-tradition'],
  pepper: ['Pepper&Carrot by David Revoy — a whole webcomic with layered source files, CC-BY', 'https://www.peppercarrot.com'],
  polyhaven: ['Poly Haven — CC0 3D models, textures and HDRIs', 'https://polyhaven.com'],
  kenney: ['Kenney — CC0 3D asset packs (buildings, city kits, furniture)', 'https://kenney.nl/assets'],
  quaternius: ['Quaternius — CC0 low-poly models', 'https://quaternius.com'],
  blender: ['Blender (free, open source) — block out scenes and cameras', 'https://www.blender.org'],
};

const studioPaint = (name, persp, w = 2048, h = 1536) => ({ mode: 'paint', w, h, name, persp });
const studioAnim = (name, len = 48, fps = 24, w = 1920, h = 1080) => ({ mode: 'animate', w, h, name, fps, len });
const studioToon = (name, h = 6400) => ({ mode: 'webtoon', w: 800, h, name });

export const TRACKS = [
  { id: 'illustration', title: 'Illustration', blurb: 'Perspective, backgrounds, faces, light and colour.' },
  { id: 'animation', title: 'Animation', blurb: 'From a bouncing ball to a coloured character walking.' },
  { id: 'webtoon', title: 'Webtoon', blurb: 'Panels, flow, dialogue and colour for vertical comics.' },
];

export const COURSES = [
  // ════════════════════════ PERSPECTIVE ════════════════════════
  {
    id: 'perspective', track: 'illustration', title: 'Perspective', color: '#ff7a59',
    blurb: 'Horizon, vanishing points and the new Perspective tool. Draw boxes, rooms and streets that sit in space.',
    outcome: 'You can set up 1-, 2- and 3-point perspective from scratch, put people and objects at the right size anywhere in a scene, and use the Studio\'s Perspective tool to block in a background quickly.',
    lessons: [
      {
        id: 'horizon', title: 'The horizon is your eye level', min: 8,
        body: [
          '<p>Perspective drawing rests on one idea: <b>things look smaller the further away they are</b>, and the lines that are parallel in the real world seem to meet in the distance. Every perspective system is just a tidy way of drawing that.</p>',
          '<p>The most important line in any scene is the <b>horizon line</b>, also called <b>eye level</b>. It is always at the height of the viewer\'s eyes (the camera). It is not "where the ground ends"; in a room or a city you can\'t even see it, but it\'s still there, and you should still draw it.</p>',
          { demo: 'persp-horizon', caption: 'Move the camera up and down. Anything above the horizon shows its underside; anything below shows its top.' },
          '<ul><li>Camera <b>low</b> (worm\'s-eye): you see the bottoms of things, buildings tower, characters look powerful.</li><li>Camera at <b>standing height</b> (~1.6 m): the most natural, "you are there" view.</li><li>Camera <b>high</b> (bird\'s-eye): you see the tops of everything; good for maps, crowds and making a character feel small.</li></ul>',
          '<p>The "lens" slider changes the field of view. A wide lens exaggerates perspective (things near you get huge); a telephoto lens flattens it. Wide lenses feel dramatic, telephoto feels calm and observed.</p>',
        ],
        keys: ['The horizon = the viewer\'s eye level, always.', 'Objects above it show their bottoms, below it their tops.', 'Choose the eye level on purpose: it sets the mood before you draw anything.'],
        quiz: [
          { q: 'You can see the top of a table in your drawing. Where is the horizon?', a: ['Below the table top', 'Above the table top', 'Exactly on the table top'], c: 1, why: 'You only see the top of a surface that is below your eyes, so the horizon (eye level) is above it.' },
          { q: 'Which camera height makes a villain feel the most powerful?', a: ['A low camera looking up', 'A high camera looking down', 'Eye level'], c: 0, why: 'A low horizon makes the character tower over the viewer.' },
        ],
        challenge: { title: 'Three eye levels', text: 'Draw the same simple scene (a box, a door and a person) three times: worm\'s-eye, eye level and bird\'s-eye.', steps: ['Draw a horizon line first, every time.', 'Use the Perspective tool (top bar) and drag the orange horizon to a different height for each version.', 'Ask yourself which version feels scary, which feels normal and which feels lonely.'], studio: studioPaint('Perspective — three eye levels', { type: '2pt', horizon: 0.5 }) },
        sources: [S.ctrlpersp, S.drawabox, S.robertson],
      },
      {
        id: 'tool', title: 'The Perspective tool in Inkwell Studio', min: 6,
        body: [
          '<p>Inkwell Studio now has a <b>Perspective tool</b> (the fan-shaped icon in the top bar, or press <kbd>R</kbd>, or Actions › Canvas › Drawing guide · Perspective). It works like Clip Studio\'s perspective ruler:</p>',
          '<ol><li>Tap the tool. A 2-point guide appears. Switch to <b>1-point</b>, <b>2-point</b> or <b>3-point</b> in the bar.</li><li>Drag the coloured <b>VP</b> handles (vanishing points) and the orange <b>Horizon</b> handle. Moving one VP keeps the horizon level; keep a finger on the screen while dragging to tilt it (a Dutch angle).</li><li>Pick any brush. With <b>Snap strokes</b> on, each stroke follows the guide direction closest to the way you start the line: towards a vanishing point, or straight up. Lift and start a new stroke to change direction.</li><li>Keep one finger on the screen while you draw to draw freely (for curves, hair, plants).</li><li><b>See all points</b> zooms out to show vanishing points that are off the canvas. That is normal: in good perspective they usually are.</li></ol>',
          { demo: 'snap-pad', caption: 'Try it: draw a few boxes. Start each line in the direction you want and it locks to the guide.' },
          '<p>The guide is saved with the canvas. Turn <b>Show</b> off to hide it while you render, and back on any time.</p>',
        ],
        keys: ['Start each stroke in the direction you mean; Snap does the rest.', 'Finger on the screen = freehand.', 'VPs off the canvas are normal and look more natural.'],
        quiz: [
          { q: 'With Snap on, how do you draw a curved line?', a: ['Turn off the guide completely', 'Keep a finger on the screen while drawing', 'You can\'t'], c: 1, why: 'A finger held on the screen while drawing temporarily disables snapping for that stroke.' },
          { q: 'Why push vanishing points far apart (even off the canvas)?', a: ['It\'s required by the tool', 'Close VPs give strong, distorted perspective; far VPs look natural', 'It saves memory'], c: 1, why: 'Vanishing points close together act like an ultra-wide lens and distort boxes near the edges.' },
        ],
        challenge: { title: 'Box field', text: 'Fill a page with 20 boxes in 2-point perspective using the Perspective tool: some above the horizon, some below, some cutting through it.', steps: ['Use a thin inking brush.', 'Draw the nearest vertical edge first, then pull lines to VP1 and VP2.', 'Then turn Snap off and try 5 boxes freehand. Turn Show on afterwards to check them.'], studio: studioPaint('Perspective — box field', { type: '2pt', horizon: 0.45 }) },
        sources: [S.drawabox, S.ctrlpersp],
      },
      {
        id: 'one-point', title: 'One-point perspective', min: 10,
        body: [
          '<p>Use 1-point perspective when you look <b>straight at</b> a flat face of things: down a corridor, along a road, at the end wall of a room, through a train carriage. You have <b>one</b> vanishing point on the horizon.</p>',
          '<ul><li>Lines going <b>away</b> from you (depth) all meet at the VP.</li><li>Lines going <b>across</b> (width) stay perfectly horizontal.</li><li><b>Vertical</b> lines stay vertical.</li></ul>',
          { demo: 'persp-1pt', caption: 'Drag the box around the ground. The front face stays a flat square; only the depth lines run to the VP.' },
          '<p><b>Drawing a room:</b> draw the back wall as a rectangle. Put the VP inside it (at the eye height of a standing person, usually about ⅔ up a door). Pull lines from the VP through the four corners of the back wall: those are where the walls meet the floor and ceiling. Doors, windows and furniture are then boxes on those walls.</p>',
          '<p>1-point is very stable and symmetrical, so it reads as calm, formal or confrontational. Wes Anderson and Kubrick use it a lot. Put the VP off-centre to make it less stiff.</p>',
        ],
        keys: ['One VP: for looking straight down a space.', 'Width lines stay horizontal, heights stay vertical.', 'Put the VP where you want the eye to go.'],
        quiz: [
          { q: 'In 1-point perspective, the front edge of a box facing you is…', a: ['Converging to the VP', 'A flat rectangle (horizontal and vertical lines)', 'Curved'], c: 1, why: 'Only the depth edges converge. Faces parallel to the picture plane stay flat.' },
          { q: 'Where do the depth lines of a hallway meet?', a: ['On the horizon, at the vanishing point', 'At the bottom of the picture', 'Nowhere'], c: 0, why: 'All parallel lines going straight away from the viewer meet at one VP on the horizon.' },
        ],
        challenge: { title: 'A room you know', text: 'Draw your own bedroom (or a dream room) in 1-point perspective with at least a bed, a window, a door and a shelf.', steps: ['Back wall rectangle first, VP inside it.', 'Floor, walls and ceiling from the VP through the corners.', 'Each piece of furniture is a box: front face flat, sides to the VP.'], studio: studioPaint('Perspective — 1-point room', { type: '1pt', horizon: 0.45 }) },
        sources: [S.ctrlpersp, S.robertson, S.loomisCreative],
      },
      {
        id: 'two-point', title: 'Two-point perspective', min: 12,
        body: [
          '<p>Turn the box so you look at a <b>corner</b>, and the width lines start converging too. Now there are two VPs, both on the horizon: one for each set of horizontal edges. Verticals stay vertical. This is the workhorse for buildings, street corners and furniture.</p>',
          { demo: 'persp-2pt', caption: 'Turn the box: one VP slides in while the other slides out. Their distance apart stays the same for one camera.' },
          '<p><b>Plotting a box</b> (from Drawabox Lesson 1): draw the nearest vertical edge. From its top and bottom, draw lines to VP1 and VP2. Draw the two side verticals where you want the box to end. From the tops of those verticals, draw lines back to the opposite VPs: where they cross is the far top corner.</p>',
          '<p><b>Common mistakes:</b></p><ul><li>VPs too close together → boxes look stretched and warped at the edges ("fish-eye"). Push them apart, off the page.</li><li>Two horizons: both VPs must be on the same horizon line.</li><li>The nearest corner of a box looks sharper than 90° → a sign the VPs are too close.</li></ul>',
          '<p>Using 3D as a base: Studio\'s <b>3D layer › ＋ Library › Places</b> (castle, city street, cyberpunk street…) and free CC0 kits from Kenney or Poly Haven give you a correctly projected scene to draw over. Match the Perspective tool to it, then draw <i>your</i> design on top. Never just trace; redesign.</p>',
        ],
        keys: ['Two VPs, one horizon.', 'Verticals stay vertical.', 'Far-apart VPs = natural; close = distorted.'],
        quiz: [
          { q: 'Both vanishing points in 2-point perspective sit…', a: ['On the same horizon line', 'Anywhere you like', 'One above, one below the horizon'], c: 0, why: 'Both sets of edges are horizontal, so both VPs are at eye level.' },
          { q: 'A box near the edge of your picture looks stretched. The fix is to…', a: ['Move the VPs further apart', 'Move the VPs closer', 'Add a third VP'], c: 0, why: 'Close VPs are like a very wide lens: distortion grows towards the edges.' },
        ],
        challenge: { title: 'A street corner', text: 'Draw a street corner with two buildings, a shop front, a lamp post, steps and at least two people.', steps: ['Set the horizon at 1.6 m (a standing person\'s eyes).', 'Block every building as a big box first, then cut windows and doors into the faces.', 'Optional: start from Add 3D layer › Library › City street, then rasterize and draw over it.'], studio: studioPaint('Perspective — street corner', { type: '2pt', horizon: 0.5 }) },
        sources: [S.drawabox, S.robertson, S.ctrlpersp, S.kenney],
      },
      {
        id: 'three-point', title: 'Three-point perspective', min: 10,
        body: [
          '<p>When the camera <b>tilts up or down</b>, the verticals start converging as well, towards a third VP far above (looking up at a skyscraper) or far below (looking down from a rooftop). VP1 and VP2 stay on the horizon; VP3 sits on a vertical line through the middle of the view.</p>',
          { demo: 'persp-3pt', caption: 'Tilt the camera. Notice that the horizon moves too: look up and it drops, look down and it rises.' },
          '<ul><li>The <b>more</b> you tilt, the <b>closer</b> VP3 comes and the more the verticals lean.</li><li>Three-point adds drama and scale: height, vertigo, giant creatures, falling.</li><li>A gentle 3rd VP (far away) makes tall things look tall without looking broken.</li></ul>',
          '<p>In the Studio choose <b>3-point</b>. The blue VP3 starts below the canvas (a bird\'s-eye view); drag it above the canvas for a worm\'s-eye view.</p>',
        ],
        keys: ['Tilt the camera → verticals converge to VP3.', 'Looking up: VP3 above; looking down: VP3 below.', 'Use it for height, scale and drama.'],
        quiz: [
          { q: 'You look down from a tall tower. Where is VP3?', a: ['Far below the picture', 'Far above', 'On the horizon'], c: 0, why: 'Looking down, vertical edges converge downward toward the ground below you.' },
          { q: 'What happens to the horizon when the camera tilts up?', a: ['It moves down the picture', 'It moves up', 'It disappears'], c: 0, why: 'Tilting the camera up moves your eye level lower in the frame.' },
        ],
        challenge: { title: 'Vertigo', text: 'Draw a character standing on the edge of a rooftop, seen from above, with the street far below.', steps: ['3-point guide, VP3 below the canvas.', 'Buildings first as tall boxes, then the character.', 'Make the street tiny and the character\'s feet big: that contrast sells the height.'], studio: studioPaint('Perspective — vertigo', { type: '3pt', horizon: 0.2 }, 1536, 2048) },
        sources: [S.robertson, S.ctrlpersp],
      },
      {
        id: 'ellipses', title: 'Circles and cylinders in perspective', min: 9,
        body: [
          '<p>A circle in perspective is always drawn as an <b>ellipse</b>. (Strictly, the true centre of the circle is slightly behind the ellipse\'s centre, but the ellipse itself is correct.) Two rules handle almost every case:</p>',
          '<ol><li><b>Degree:</b> the closer a circle is to eye level, the thinner its ellipse. Exactly at eye level it\'s a straight line; far above or below it opens up toward a full circle.</li><li><b>Minor axis:</b> the short axis of the ellipse lines up with the cylinder\'s central axis (the axle of a wheel, the centre line of a cup).</li></ol>',
          { demo: 'persp-ellipse', caption: 'The top and bottom of each cylinder are the same size circle, but different ellipses, because they sit at different heights relative to your eyes.' },
          '<p>To place a circle accurately, draw a square in perspective and fit the ellipse inside, touching the middle of each side. Practise ellipses freehand: whole-arm motion, "ghost" the motion a few times above the paper, then draw it in one go, going round twice.</p>',
        ],
        keys: ['Near eye level → thin ellipse; far from it → round.', 'Minor axis = the cylinder\'s axis.', 'Fit circles inside perspective squares.'],
        quiz: [
          { q: 'A cup sits on a table well below your eyes. Its rim looks…', a: ['Quite round (a wide ellipse)', 'Like a flat line', 'Like a perfect circle with a point'], c: 0, why: 'Far from eye level, ellipses open up.' },
          { q: 'The minor axis of a car wheel\'s ellipse points along…', a: ['The axle', 'The ground', 'The horizon'], c: 0, why: 'The minor axis always aligns with the cylinder\'s central axis.' },
        ],
        challenge: { title: 'Kitchen still life', text: 'Draw a table with a mug, a bowl, a bottle and a plate in 2-point perspective.', steps: ['Table top as a box face, horizon above it.', 'Each round object: a perspective square first, then the ellipse inside.', 'Check: is the bottom ellipse of each object rounder than its top? (It should be: it\'s further from your eyes.)'], studio: studioPaint('Perspective — ellipses', { type: '2pt', horizon: 0.3 }) },
        sources: [S.drawabox, S.robertson],
      },
      {
        id: 'scale', title: 'People at the right size anywhere', min: 9,
        body: [
          '<p>The <b>horizon-line trick</b>: if everyone is standing on the same flat ground and is about the same height, the horizon crosses every one of them <b>at the same point on their body</b>. If the eye level is 1.6 m, it goes through every adult\'s eyes, near or far.</p>',
          { demo: 'persp-figures', caption: 'Set the camera to 0.9 m (a seated or kneeling viewer): now the horizon cuts everyone at the hips.' },
          '<p><b>Placing a person anywhere:</b> draw one reference figure. Pick a spot for the new figure\'s feet. Draw a line from the reference figure\'s feet through the new feet spot to the horizon, then back from that horizon point through the reference figure\'s head: the new figure\'s head is on that line, straight above the new feet. This works for cars, trees and doors too: anything resting on the same ground.</p>',
          '<p>Children, people on stairs, or people on a hill are different heights relative to the horizon: measure them from a standing adult next to them.</p>',
        ],
        keys: ['On flat ground the horizon hits everyone at the same body point.', 'Transfer heights with lines to the horizon.', 'Choose the eye level first; the crowd follows from it.'],
        quiz: [
          { q: 'Eye level is 1.6 m. A man is far away on the same flat street. The horizon passes through…', a: ['His eyes', 'His feet', 'Above his head'], c: 0, why: 'Same height, same ground: the horizon cuts every adult at eye height.' },
          { q: 'The viewer is sitting (eye level ≈ 1 m). The horizon hits standing people at…', a: ['The waist/hips', 'The eyes', 'The knees'], c: 0, why: 'Eye level 1 m means the horizon is at 1 m on everyone standing.' },
        ],
        challenge: { title: 'Crowd at a market', text: 'Draw a market street with at least 8 people at different distances, plus stalls.', steps: ['Decide the eye level: are you standing, sitting or on a balcony?', 'Draw one person in the foreground, then place the others with the horizon-line trick.', 'Add stalls as boxes. Overlap people and stalls to sell the depth.'], studio: studioPaint('Perspective — crowd', { type: '2pt', horizon: 0.42 }) },
        sources: [S.loomisCreative, S.robertson, S.ctrlpersp],
      },
    ],
    capstone: { title: 'Capstone: your location', text: 'Pick a place from one of your own stories or ideas (a classroom, a spaceship corridor, a temple…) and draw it three ways: 1-point establishing shot, 2-point corner view and 3-point dramatic view. Add at least two characters at the correct size in each.', ideas: ['A location from your webtoon idea', 'The inside of a character\'s home', 'A fantasy city gate'], studio: studioPaint('Capstone — my location', { type: '2pt', horizon: 0.45 }) },
  },

  // ════════════════════════ BACKGROUNDS ════════════════════════
  {
    id: 'backgrounds', track: 'illustration', title: 'Backgrounds & Environments', color: '#4fb39b',
    blurb: 'Composition, depth, atmosphere and value: backgrounds that set the mood and point at your characters.',
    outcome: 'You can plan a background from thumbnail to finish, show deep space with layers and atmosphere, and use free 3D assets and photos the right way.',
    lessons: [
      {
        id: 'composition', title: 'Composition: where the eye goes', min: 9,
        body: [
          '<p>A background has two jobs: <b>say where we are</b> and <b>lead the eye to what matters</b> (usually a character). Composition is how you arrange things to do that.</p>',
          { demo: 'composition', caption: 'Drag the figure. Notice how the path (a leading line) pulls your eye to it.' },
          '<ul><li><b>Rule of thirds:</b> placing the focal point near one of the four thirds intersections feels balanced but alive. Dead-centre feels static (useful on purpose for calm or confrontation).</li><li><b>Leading lines:</b> roads, rivers, fences, perspective lines and gazes pull the eye. Point them at your subject.</li><li><b>Contrast at the focal point:</b> the eye goes to the place with the most contrast in value, colour, detail and edges. Keep the strongest contrast where the story is.</li><li><b>Framing:</b> doorways, branches and silhouettes in the foreground frame the subject.</li></ul>',
          '<p>Start every background with <b>thumbnails</b>: tiny (5 × 3 cm) rough sketches in 2–3 greys, 5 to 10 of them, each taking under a minute. Pick the strongest one. Ctrl+Paint\'s "thumbnails" videos show the process.</p>',
        ],
        keys: ['Background = place + pointer.', 'Thirds, leading lines, framing.', 'Most contrast where the story is.'],
        quiz: [
          { q: 'Where will a viewer look first?', a: ['Where there is the most contrast', 'The top-left corner', 'Wherever there is the most detail in the sky'], c: 0, why: 'The eye goes to the strongest value/colour contrast and sharpest edges.' },
          { q: 'Why make several thumbnails before drawing?', a: ['To find the best composition while changes are cheap', 'They are required by publishers', 'To practise lines'], c: 0, why: 'Fixing a composition at thumbnail size takes seconds; at full size it takes hours.' },
        ],
        challenge: { title: '8 thumbnails', text: 'Make 8 thumbnails for one scene: "a traveller arrives at a town at dusk".', steps: ['Use one grey brush, 3 values only.', 'Vary the eye level, the framing and where the traveller is.', 'Circle your favourite, then redraw it bigger.'], studio: studioPaint('Backgrounds — thumbnails', null, 2400, 1600) },
        sources: [S.ctrlpaint, S.gurney],
      },
      {
        id: 'depth', title: 'Depth: foreground, middle ground, background', min: 8,
        body: [
          '<p>Split your scene into three planes. Each plane is usually its own layer in the Studio:</p>',
          '<ul><li><b>Foreground</b>: close, often dark, partly cropped by the frame (a branch, a railing, a shoulder). It puts the viewer <i>inside</i> the scene.</li><li><b>Middle ground</b>: where the action and characters usually are. Most detail and contrast.</li><li><b>Background</b>: sky, distant hills, the skyline. Simple shapes, low contrast.</li></ul>',
          '<p>Depth cues you can stack: <b>overlap</b> (the strongest: whatever overlaps is in front), <b>size</b> (smaller = further), <b>position</b> (higher up the picture = further, for things on the ground), <b>detail</b> (less detail far away), <b>atmosphere</b> (next lesson) and <b>perspective</b>.</p>',
          { demo: 'value-groups', caption: 'Flip to "3 values": a strong background still reads with only light, middle and dark.' },
        ],
        keys: ['Three planes, three layers.', 'Overlap is the strongest depth cue.', 'Detail and contrast go to the middle ground.'],
        quiz: [
          { q: 'Which is the strongest single depth cue?', a: ['Overlap', 'Colour', 'Line thickness'], c: 0, why: 'If A covers part of B, A is in front, whatever its size or colour.' },
        ],
        challenge: { title: 'Three-plane landscape', text: 'Paint a landscape on three separate layers: foreground, middle, background.', steps: ['Fill each layer with ONE flat value first.', 'Check in greyscale (Adjustments › Hue, Saturation, Brightness → saturation 0, then undo).', 'Only then add detail, mostly to the middle ground.'], studio: studioPaint('Backgrounds — three planes', null, 2400, 1350) },
        sources: [S.ctrlpaint, S.gurney],
      },
      {
        id: 'atmosphere', title: 'Atmospheric perspective', min: 8,
        body: [
          '<p>Air isn\'t perfectly clear. The further away something is, the more air sits between it and you, so distant objects become <b>lighter, lower in contrast, less saturated and shifted toward the sky colour</b> (blue on a clear day, orange at sunset, grey in fog). Leonardo da Vinci described it 500 years ago; James Gurney\'s <i>Color and Light</i> explains it for painters.</p>',
          { demo: 'atmosphere', caption: 'Change the haze colour: the far hills always become the colour of the air.' },
          '<p><b>How to paint it in Inkwell:</b> put each depth plane on its own layer. Above each distant layer add a <b>clipping layer</b> filled with the sky colour and lower its opacity: 60% for the far hills, 30% for the middle. Or use a soft airbrush on a Normal layer between the planes. Darkest darks and brightest lights belong in the foreground only.</p>',
          '<p>Night and underwater work the same way, just with a dark, coloured "air".</p>',
        ],
        keys: ['Far = lighter, less contrast, less saturated, more like the sky.', 'One haze layer per plane is enough.', 'Keep the darkest darks up front.'],
        quiz: [
          { q: 'On a clear day, distant mountains look…', a: ['Lighter and bluish', 'Darker and more saturated', 'Exactly the same as nearby'], c: 0, why: 'More air between you and them scatters blue light and lowers contrast.' },
          { q: 'At sunset the distant hills shift toward…', a: ['The warm sky colour', 'Pure black', 'Bright green'], c: 0, why: 'Distant objects take on the colour of the atmosphere, whatever it is.' },
        ],
        challenge: { title: 'Same place, three airs', text: 'Paint one landscape, then duplicate it twice and change only the atmosphere: clear day, sunset, fog.', steps: ['Keep the drawing identical.', 'Change only the haze layers and the sky.', 'Notice how much mood comes from the air alone.'], studio: studioPaint('Backgrounds — atmosphere', null, 2400, 1350) },
        sources: [S.gurney, S.gurneyBlog],
      },
      {
        id: 'references', title: 'Free 3D and photo references, used well', min: 10,
        body: [
          '<p>Professional background artists use 3D block-outs and photos all the time. Used well they save hours and make perspective correct; used badly they make lifeless traced pictures. The rule: <b>3D and photos give you facts; you still make the design decisions</b>.</p>',
          '<p><b>Free, legal sources (no AI):</b></p><ul><li>Inkwell Studio\'s own <b>3D layer</b>: ＋ Library › Places (castle, streets, cyberpunk street, mountains, forest, desert). Set the camera, rasterize, then paint over it.</li><li><b>Kenney</b> and <b>Quaternius</b>: thousands of CC0 low-poly models (buildings, furniture, nature). Import .glb/.obj straight into a 3D layer.</li><li><b>Poly Haven</b>: CC0 photo-real models, textures and HDRIs.</li><li><b>Blender</b>: free and open source, for arranging a whole scene and its camera.</li><li>Your own photos: walk around and shoot the places you want to draw.</li></ul>',
          '<p><b>Workflow:</b> block out → set the camera (eye level and lens!) → match the Perspective tool to the 3D lines → sketch your own design on a new layer, changing shapes, adding wear, stories and clutter → hide the 3D layer → ink and colour.</p>',
          '<p>CC0 means "no rights reserved": you can use it commercially with no credit needed (crediting is still kind). CC-BY means you must credit the author. Always read the licence on the download page.</p>',
        ],
        keys: ['3D/photos = facts, you = design.', 'CC0 is free for any use; CC-BY needs credit.', 'Match the guide to the 3D, then draw your own version.'],
        quiz: [
          { q: 'You use a CC-BY model in your comic. You must…', a: ['Credit the author', 'Pay a fee', 'Nothing at all'], c: 0, why: 'CC-BY = Attribution: free to use, with credit.' },
          { q: 'What should you always change when drawing over a 3D block-out?', a: ['Make your own design choices: shapes, wear, story details', 'Nothing, just trace it', 'Only the colours'], c: 0, why: 'Tracing gives stiff, generic results. The 3D is scaffolding.' },
        ],
        challenge: { title: 'Draw over 3D', text: 'Add a 3D layer with a Place, frame a shot with the camera, then draw your own version over it.', steps: ['Actions › Add › Add 3D layer › ＋ Library › Places.', 'Try two camera heights and pick the stronger one.', 'Rasterize, lower the opacity to 30%, and draw your design on a new layer above.'], studio: studioPaint('Backgrounds — over 3D', { type: '2pt', horizon: 0.5 }, 2400, 1350) },
        sources: [S.polyhaven, S.kenney, S.quaternius, S.blender],
      },
      {
        id: 'values', title: 'Value and lighting for backgrounds', min: 8,
        body: [
          '<p>Before colour, a background needs a clear <b>value plan</b>: 3–4 big groups of light and dark. Notan (Japanese for "light-dark harmony") is the 2-value version: if your scene works in pure black and white, it will work in colour.</p>',
          { demo: 'value-groups', caption: 'Compare "Colour" with "2 values (notan)". The big shapes are what the viewer reads first.' },
          '<ul><li>Pick a <b>light source</b> and a time of day before you start.</li><li>Group the shadows together into big connected shapes instead of scattering little dark spots.</li><li>Put the character where light meets dark: a figure in light against a dark background (or dark against light) always pops.</li><li>Detail lives in the light; shadows can be simple.</li></ul>',
        ],
        keys: ['Plan 3–4 value groups first.', 'Connect shadows into big shapes.', 'Silhouette the character against the opposite value.'],
        quiz: [{ q: 'Your character disappears into the background. The quickest fix is…', a: ['Put them against an area of opposite value', 'Add more detail to the background', 'Make the line art thicker'], c: 0, why: 'Value contrast is what separates shapes, not lines or detail.' }],
        challenge: { title: 'Notan studies', text: 'Make 4 small black-and-white (2-value) versions of a forest clearing with a character, then pick one to paint in 4 greys.', steps: ['Only black and white: no greys at first.', 'Make sure the character reads as a clear silhouette.', 'Then add one middle grey, then one more.'], studio: studioPaint('Backgrounds — notan', null, 2400, 1350) },
        sources: [S.ctrlpaint, S.gurney],
      },
    ],
    capstone: { title: 'Capstone: an establishing shot', text: 'Paint a finished establishing shot for one of your own stories: thumbnails → value plan → perspective → three planes → atmosphere → colour.', ideas: ['The opening panel of your webtoon', 'A video-game style environment concept', 'Your hometown, reimagined in a genre you love'], studio: studioPaint('Capstone — establishing shot', { type: '2pt', horizon: 0.42 }, 2400, 1350) },
  },

  // ════════════════════════ EXPRESSIVE FACES ════════════════════════
  {
    id: 'faces', track: 'illustration', title: 'Expressive Faces', color: '#ff6b8b',
    blurb: 'Head construction, the 7 universal expressions, and acting with the whole face.',
    outcome: 'You can construct a head from any angle and draw clear, believable emotions, then push them into your own style for a full expression sheet.',
    lessons: [
      {
        id: 'loomis', title: 'Building the head (Loomis method)', min: 10,
        body: [
          '<p>Andrew Loomis\'s method (1956), taught today by Proko and many others, builds the head from simple 3D forms so you can draw it from any angle:</p>',
          '<ol><li>A <b>ball</b> for the cranium.</li><li>Slice a flat <b>side plane</b> off each side (where the ear and temple go).</li><li>A <b>centre line</b> down the front and a <b>brow line</b> around the middle. These two lines wrap around the ball, which is what shows its turn and tilt.</li><li>Measure down the face in <b>three roughly equal thirds</b>: hairline → brow → bottom of the nose → chin.</li><li>Hang the jaw from the side plane down to the chin.</li></ol>',
          { demo: 'loomis', caption: 'Turn and tilt the head. The lines stay glued to the form; that\'s what makes the angle believable.' },
          '<p>Rough proportions for adults: the eyes sit about halfway down the whole head, there\'s about one eye width between the eyes, the bottom of the ears lines up with the bottom of the nose, and the corners of the mouth sit under the pupils. Stylised characters bend these rules, but always consistently.</p>',
        ],
        keys: ['Ball + side planes + centre line + brow line.', 'Three equal thirds down the face.', 'Draw the lines around the form, not flat.'],
        quiz: [
          { q: 'Where do the eyes sit on an adult head?', a: ['About halfway down the head', 'In the top third', 'Just above the mouth'], c: 0, why: 'Beginners almost always place them too high; the cranium is bigger than it looks.' },
          { q: 'What tells the viewer the head is turning?', a: ['How the centre and brow lines curve around the ball', 'The hair', 'The size of the eyes'], c: 0, why: 'The wrapped construction lines describe the 3D turn.' },
        ],
        challenge: { title: '12 heads', text: 'Draw 12 Loomis heads at different angles: 4 turning, 4 tilted up or down, 4 combined.', steps: ['Ball, side plane, centre line, brow line: lines only.', 'Mark the thirds and the jaw.', 'Pick your 3 best and add features.'], studio: studioPaint('Faces — 12 heads', null, 2048, 2048) },
        sources: [S.loomisHead, S.proko],
      },
      {
        id: 'universal', title: 'The 7 universal expressions', min: 12,
        body: [
          '<p>Psychologist Paul Ekman\'s research found <b>seven emotions whose facial expressions are recognised across cultures</b>: joy, sadness, surprise, fear, anger, disgust and contempt. Each one is made by specific muscles, so each has reliable "tells". Learn the tells and you can draw any emotion clearly.</p>',
          { demo: 'face', caption: 'Pick an emotion, then move single sliders to find which part does the most work.' },
          '<ul><li><b>The brows</b> carry most of the emotion. Inner ends UP = sadness/worry. Pulled DOWN and together = anger/concentration. All the way up = surprise.</li><li><b>The eyelids</b> show intensity: wide = surprise/fear, squinting lower lids = real joy, anger or disgust.</li><li><b>The mouth</b> tells you the direction: corners up = positive, down = negative, stretched sideways = fear, one side only = contempt.</li></ul>',
          '<p>Gary Faigin\'s <i>The Artist\'s Complete Guide to Facial Expression</i> is the classic artist\'s reference for these muscles.</p>',
        ],
        keys: ['7 universal expressions.', 'Brows = which emotion; lids = how strong; mouth = positive or negative.', 'A real smile reaches the eyes (lower lids squint).'],
        quiz: [
          { q: 'Inner brows pulled UP and together, mouth corners down:', a: ['Sadness', 'Anger', 'Surprise'], c: 0, why: 'Raised inner brows are the key tell of sadness.' },
          { q: 'What separates fear from surprise?', a: ['In fear the brows are also pulled together and the lips stretch sideways', 'Fear has a smile', 'There is no difference'], c: 0, why: 'Surprise: brows up and curved, jaw drops loosely. Fear: brows up AND knitted, tense lips.' },
          { q: 'The only one-sided universal expression is…', a: ['Contempt', 'Disgust', 'Joy'], c: 0, why: 'Contempt raises and tightens just one mouth corner.' },
        ],
        challenge: { title: 'Seven faces', text: 'Draw your character showing all 7 universal expressions, same angle each time.', steps: ['Copy the same head 7 times (duplicate the layer).', 'Change only brows, lids and mouth.', 'Show them to a friend without labels: can they name each one?'], studio: studioPaint('Faces — seven emotions', null, 2800, 1600) },
        sources: [S.ekman, S.faigin, S.proko],
      },
      {
        id: 'reading', title: 'Read faces like an artist', min: 6,
        body: [
          '<p>Before you can draw expressions well, you need to <b>see</b> them. This quiz generates faces with random variations. Name the emotion, then look at which features gave it away.</p>',
          { demo: 'face-quiz', caption: 'Aim for 10 in a row. Then open the sliders and copy one onto your own character.' },
          '<p>Practise from life: <b>Line of Action</b> has free timed practice with expression photos. Do 30-second sketches that capture only brows, eyes and mouth.</p>',
        ],
        keys: ['Look at brows first, then the mouth corners.', 'Short timed studies build your visual library.'],
        quiz: [{ q: 'Nose wrinkled and upper lip raised:', a: ['Disgust', 'Joy', 'Fear'], c: 0, why: 'The "something stinks" muscles define disgust.' }],
        challenge: { title: '30 quick faces', text: 'Do 30 expression sketches of 30 seconds each from a timed reference session (or the quiz above).', steps: ['Only lines for brows, eyes, nose and mouth: no shading.', 'Write the emotion under each.', 'Circle the 5 that feel most alive.'], studio: studioPaint('Faces — 30 second studies', null, 2400, 2400) },
        sources: [S.loa, S.ekman],
      },
      {
        id: 'push', title: 'Push it: exaggeration, asymmetry and style', min: 9,
        body: [
          '<p>Real faces are subtle; drawn faces need to read at a glance, often tiny in a panel. So we <b>exaggerate</b>.</p>',
          '<ul><li><b>Squash and stretch the whole face</b>: a shout stretches the head long; a wince squashes it. The skull doesn\'t change, but the jaw, cheeks and brows move a lot.</li><li><b>Asymmetry</b>: one brow higher, mouth pulled to one side. Perfect symmetry looks like a mask.</li><li><b>Tilt the head</b> and point the gaze: shy = head down, eyes up; proud = chin up; suspicious = head turned, eyes sideways.</li><li><b>Mix emotions</b>: a sad smile (inner brows up + mouth corners up) or a nervous laugh. Mixed emotions are what make characters feel real.</li><li><b>Manga/webtoon symbols</b> (sweat drops, blush lines, the anger vein, sparkles) are a shared visual language; use them to support the face, not to replace it.</li></ul>',
          { demo: 'face', caption: 'Make a "sad smile": Sadness preset, then push Mouth corners up. Add head tilt.' },
        ],
        keys: ['Exaggerate so it reads small.', 'Asymmetry and head tilt bring life.', 'Mixed emotions = real characters.'],
        quiz: [{ q: 'A "sad smile" combines…', a: ['Raised inner brows with raised mouth corners', 'Lowered brows with an open mouth', 'Wide eyes and a frown'], c: 0, why: 'The brows say sad, the mouth tries to smile.' }],
        challenge: { title: 'Mixed feelings', text: 'Draw 6 mixed emotions: sad smile, nervous laugh, angry crying, smug, shy happiness, scared determination.', steps: ['Name the two emotions you\'re mixing.', 'Decide which feature shows each one.', 'Use head tilt and gaze to finish the acting.'], studio: studioPaint('Faces — mixed feelings', null, 2800, 1800) },
        sources: [S.faigin, S.proko],
      },
      {
        id: 'sheet', title: 'Expression sheets and acting', min: 8,
        body: [
          '<p>Studios keep an <b>expression sheet</b> for every character so every artist draws them consistently. It shows the head in a few angles with the character\'s typical expressions and is the best way to <i>get to know</i> your own character.</p>',
          '<ul><li>Start with a neutral front, ¾ and side view.</li><li>Then 8–12 expressions that are <b>specific to the personality</b>: how does <i>this</i> person smile? A shy character and a cocky one smile completely differently.</li><li>Include the body: shoulders up for fear, chest out for pride. Expression continues below the neck.</li><li>Write a one-word label and a line of dialogue for each. If the face doesn\'t match the line, redraw it.</li></ul>',
          '<p>Studio tip: put the neutral head on a layer, set it as a <b>Reference layer</b> at 20% opacity, and draw each expression above it so the proportions stay consistent.</p>',
        ],
        keys: ['A sheet = consistency + character.', 'Expressions should match the personality.', 'Acting uses the whole body.'],
        quiz: [{ q: 'Why do expression sheets matter in a webtoon?', a: ['They keep the character consistent across hundreds of panels', 'They are required for upload', 'They replace storyboards'], c: 0, why: 'Consistency is what makes readers believe in a character.' }],
        challenge: { title: 'Your character\'s sheet', text: 'Make a full expression sheet for one of your own characters: 3 neutral angles + 10 expressions with a line of dialogue each.', steps: ['Neutral views first, then expressions.', 'At least 3 expressions must be mixed emotions.', 'Label every face.'], studio: studioPaint('Faces — expression sheet', null, 3000, 2000) },
        sources: [S.faigin, S.proko, S.loa],
      },
    ],
    capstone: { title: 'Capstone: an emotional scene', text: 'Draw a 3-panel scene where one of your characters goes through an emotional change (for example surprise → hurt → anger). Only the face and the head angle may change between panels.', ideas: ['A confession scene from your story', 'Receiving bad news', 'Seeing an old friend after years'], studio: studioPaint('Capstone — emotional scene', null, 2800, 1300) },
  },

  // ════════════════════════ COLOURING & LIGHT ════════════════════════
  {
    id: 'color', track: 'illustration', title: 'Colouring & Light', color: '#ffb020',
    blurb: 'Value, harmony, light and shadow, and a clean layer workflow for colouring line art.',
    outcome: 'You can pick a harmonious palette, light a character believably from any direction, and colour line art cleanly in cel or soft style.',
    lessons: [
      {
        id: 'value', title: 'Value does the work', min: 7,
        body: [
          '<p>Colour has three parts: <b>hue</b> (red, blue…), <b>saturation</b> (how intense) and <b>value</b> (how light or dark). Value is the one that makes things readable. Hue mostly makes the mood.</p>',
          { demo: 'value-hue', caption: 'Turn greyscale on and off. Same-value colours merge into mush.' },
          '<p><b>Check your values often</b>: in Inkwell, add a new layer on top, fill it with black, set its blend mode to <b>Color</b> (or Saturation): the whole picture shows in greyscale. Hide the layer to go back. Keep it at the top of your colour files.</p>',
        ],
        keys: ['Value = readability; hue = mood.', 'Check values with a greyscale layer.'],
        quiz: [{ q: 'Two colours with the same value next to each other will…', a: ['Blend together and be hard to read', 'Always clash', 'Look 3D'], c: 0, why: 'Without value contrast the edge between them almost disappears in greyscale, and to the eye.' }],
        challenge: { title: 'Greyscale first', text: 'Paint a simple character in 4 greys only, then colour it with a Color/Overlay layer. Check that your colours keep the same values.', steps: ['4 greys: light, two mids, dark.', 'New layer above in Color mode for the hues.', 'Toggle a black Color-mode layer to compare.'], studio: studioPaint('Colour — greyscale first', null, 2048, 2048) },
        sources: [S.ctrlcolor, S.gurney],
      },
      {
        id: 'harmony', title: 'Choosing a palette', min: 9,
        body: [
          '<p>Harmony comes from choosing a few hues with a clear relationship on the colour wheel, then using them in <b>unequal amounts</b>.</p>',
          { demo: 'harmony', caption: 'Pick a scheme, then drag the hue around the wheel.' },
          '<ul><li><b>Complementary</b>: opposites (blue/orange). Maximum punch; let one dominate.</li><li><b>Analogous</b>: neighbours (yellow-orange-red). Calm and unified.</li><li><b>Split-complementary</b>: a hue plus the two neighbours of its opposite. Punchy but easier than complementary.</li><li><b>Triadic</b>: three evenly spaced. Lively, cartoon-friendly; desaturate two of them.</li><li><b>Monochrome</b>: one hue in many values. Strong mood (flashbacks, horror).</li></ul>',
          '<p>The <b>60-30-10</b> guideline: about 60% dominant colour, 30% secondary, 10% accent. The accent goes on what you want noticed: a cape, eyes, a magic glow.</p>',
          '<p>Inkwell can build palettes from a photo (Colour panel › Palettes › New palette › From photo…). Use photos you took yourself or CC0 photos.</p>',
        ],
        keys: ['Few hues, clear relationship.', 'Unequal amounts: 60-30-10.', 'Accent colour = focal point.'],
        quiz: [{ q: 'Which scheme gives the strongest contrast?', a: ['Complementary', 'Analogous', 'Monochrome'], c: 0, why: 'Opposite hues contrast the most.' }],
        challenge: { title: 'One character, three palettes', text: 'Colour one character design three times: analogous, complementary and triadic.', steps: ['Flats only.', 'Decide which colour gets 60%, 30% and 10%.', 'Which version fits the personality best?'], studio: studioPaint('Colour — three palettes', null, 2800, 1600) },
        sources: [S.gurney, S.ctrlcolor],
      },
      {
        id: 'light', title: 'Light and shadow on form', min: 12,
        body: [
          '<p>Every lit object shows the same zones, from light to dark:</p>',
          '<ol><li><b>Highlight</b>: a reflection of the light source (sharp on shiny things, soft on matte).</li><li><b>Light side</b>: faces the light.</li><li><b>Core shadow / terminator</b>: where the form turns away from the light. The darkest part of the form shadow, and where the light colour turns into the shadow colour.</li><li><b>Reflected light</b>: light bounced back from the ground or nearby surfaces. It\'s always <i>darker than any part of the light side</i>.</li><li><b>Cast shadow</b>: the shadow the object throws. Sharpest and darkest right where the object touches the ground (the occlusion).</li></ol>',
          { demo: 'light-sphere', caption: 'Move the light around. Change the light and shadow colours. Try "Cel shading".' },
          '<p><b>Colour temperature:</b> sunlight is warm, so the sky-lit shadows are cool (blue). Under a cool light (moonlight, overcast, a cold screen) the shadows feel warmer by comparison. Marco Bucci and James Gurney both teach this as the key to "colours that glow".</p>',
          '<p><b>Cel shading</b> (anime/webtoon) is the same model with only two tones: light and shadow, split at the terminator. Learn the full model and your cel shadows will land in the right places.</p>',
        ],
        keys: ['Highlight → light → terminator → reflected → cast shadow.', 'Reflected light stays darker than the light side.', 'Warm light → cool shadows (and the reverse).'],
        quiz: [
          { q: 'Where is the darkest part of an object\'s form shadow?', a: ['The core shadow at the terminator', 'The reflected light', 'The middle of the light side'], c: 0, why: 'Reflected light brightens the shadow side further from the terminator.' },
          { q: 'Golden-hour sun from the left. The shadows on the right side of a face lean…', a: ['Cool (blue/purple)', 'Warm orange', 'Pure grey'], c: 0, why: 'The shadow side is lit by the blue sky, not the warm sun.' },
        ],
        challenge: { title: 'Light study: sphere, cube, head', text: 'Paint a sphere, a cube and a simple head under the same warm light, with cool shadows.', steps: ['Same light direction for all three.', 'Lay in light and shadow as two flat shapes first.', 'Then add the terminator, reflected light and cast shadows.'], studio: studioPaint('Colour — light study', null, 2800, 1400) },
        sources: [S.gurney, S.bucci, S.ctrlcolor],
      },
      {
        id: 'workflow', title: 'Colouring line art: the layer workflow', min: 11,
        body: [
          '<p>This is the standard way comic, webtoon and anime artists colour, and every step is built into Inkwell Studio:</p>',
          { demo: 'pipeline', caption: 'Slide through the steps. Each one is its own layer.' },
          '<ol><li><b>Line art</b> on its own layer, at the top. In the Layers panel mark it as a <b>Reference</b> layer.</li><li><b>Flats</b> on a layer below: Fill tool set to <i>Reads › Reference</i>, with Close gaps on. Every material gets its own flat colour (skin, hair, shirt…). Fill under the lines so no white halos are left.</li><li><b>Shadows</b>: a new layer above the flats, set to <b>Clipping</b> and blend mode <b>Multiply</b>. Paint all the shadows with ONE colour (a light purple or blue works for most materials). Use a hard brush for cel style, or soft for rendered.</li><li><b>Light</b>: another clipping layer, <b>Add (Glow)</b> or <b>Overlay</b>, for the lit edges and rim light.</li><li><b>Background</b>, then <b>effects and grading</b> on top (next course).</li></ol>',
          '<p>Because the shadows are one colour on a Multiply layer, they automatically look right on every material, and you can change their colour later in one step. Alpha Lock on the flats layer lets you recolour a material without going outside its shape.</p>',
        ],
        keys: ['Lines → flats → shadow (Multiply, clipped) → light → background → grade.', 'Reference layer + Fill = fast, clean flats.', 'One shadow colour unifies everything.'],
        quiz: [
          { q: 'Why put shadows on a clipped Multiply layer instead of painting darker colours?', a: ['One colour works on every material and stays editable', 'It\'s required by the app', 'Multiply makes things brighter'], c: 0, why: 'Multiply darkens whatever is below, and clipping keeps it inside the flats.' },
          { q: 'The Fill tool keeps leaking out of gaps in the line art. You should…', a: ['Raise "Close gaps" and fill from the Reference layer', 'Draw thicker lines everywhere', 'Fill on the line art layer'], c: 0, why: 'Gap closing virtually seals small openings in the lines.' },
        ],
        challenge: { title: 'Colour a character, the pro way', text: 'Take a line drawing of one of your characters and colour it with the full layer workflow, in cel style.', steps: ['Line art layer → Reference.', 'Flats with Fill, Close gaps ~4 px.', 'One Multiply shadow layer (clipped), one Add light layer (clipped).'], studio: studioPaint('Colour — layer workflow', null, 2048, 2732) },
        sources: [S.cspStart, S.pepper],
      },
      {
        id: 'mood', title: 'Lighting for mood', min: 7,
        body: [
          '<p>Light is storytelling. The same character in different light tells a different story:</p>',
          '<ul><li><b>Front light</b>: flat, open, honest, "nothing to hide".</li><li><b>Side light</b>: the most form and drama; half the face in shadow suggests conflict.</li><li><b>Back / rim light</b>: a glowing outline, heroic or mysterious; the face is in shadow.</li><li><b>Under light</b> (light from below): unnatural, the classic horror light.</li><li><b>Top light</b>: eyes fall into shadow, which feels tired, threatening or harsh noon heat.</li></ul>',
          { demo: 'light-sphere', caption: 'Try "Neon": a two-colour light (key + strong coloured fill) is a staple of modern illustration and webtoons.' },
        ],
        keys: ['Light direction = mood.', 'Under light = horror; rim light = heroic/mysterious.'],
        quiz: [{ q: 'Which light makes a friendly character look sinister?', a: ['Light from below', 'Soft front light', 'Bright overcast light'], c: 0, why: 'Light from below never happens in nature, so it feels wrong and threatening.' }],
        challenge: { title: 'Five lights', text: 'Light the same portrait five ways: front, side, rim, under and top.', steps: ['Duplicate the flats 5 times.', 'Only change the shadow and light layers.', 'Write one word for the mood of each.'], studio: studioPaint('Colour — five lights', null, 3000, 1400) },
        sources: [S.gurney, S.bucci],
      },
    ],
    capstone: { title: 'Capstone: a lit character illustration', text: 'Paint one of your characters in a setting with a clear light source, a chosen palette (60-30-10) and the full layer workflow.', ideas: ['Your protagonist by a campfire at night', 'A neon-lit city scene', 'Morning light through a window'], studio: studioPaint('Capstone — lit character', null, 2048, 2732) },
  },

  // ════════════════════════ COLOUR GRADING ════════════════════════
  {
    id: 'grading', track: 'illustration', title: 'Colour Grading', color: '#b07cff',
    blurb: 'The film-maker\'s finishing step for illustrations and webtoons: mood, unity and consistency.',
    outcome: 'You can grade a finished picture for a chosen mood, fix colours that feel "off", and keep a whole webtoon episode consistent.',
    lessons: [
      {
        id: 'what', title: 'What colour grading is', min: 8,
        body: [
          '<p>In film, <b>colour correction</b> fixes problems (too dark, too blue) and <b>colour grading</b> gives the picture its mood. For illustration it\'s the same: once your painting is finished, a few adjustment layers on top can turn "midday" into "golden hour" and pull every colour into one family.</p>',
          { demo: 'grading', caption: 'Drag across the picture to compare before and after. Try every preset, then rebuild one yourself.' },
          '<p>The order matters:</p><ol><li><b>Exposure / levels</b>: is it too dark or too bright?</li><li><b>White balance</b> (temperature and tint): which way should it lean?</li><li><b>Contrast</b>: punchy or soft?</li><li><b>Saturation</b>: usually <i>down</i> a little for realism, up for cartoons.</li><li><b>Look</b>: split-toning (one colour in the shadows, another in the highlights), vignette, fade.</li></ol>',
          '<p><b>Always check the skin tones</b> after grading. If faces turn green or grey, back off.</p>',
        ],
        keys: ['Correct first, then grade.', 'Exposure → white balance → contrast → saturation → look.', 'Protect skin tones.'],
        quiz: [{ q: 'What\'s the difference between correction and grading?', a: ['Correction fixes problems; grading creates a mood', 'They are the same', 'Grading is only for photos'], c: 0, why: 'Correction makes it right; grading makes it feel a certain way.' }],
        challenge: { title: 'Grade an old piece', text: 'Open an old finished illustration and grade it in three moods: warm, cold and one of your choice.', steps: ['Duplicate the canvas 3 times (Gallery › ⋯ › Duplicate).', 'Use only Adjustments and blend-mode layers, never repaint.', 'Which mood fits the story best?'], studio: studioPaint('Grading — three moods', null, 2048, 2048) },
        sources: [S.gurney, S.ctrlcolor],
      },
      {
        id: 'tools', title: 'The grading tools in Inkwell Studio', min: 10,
        body: [
          '<p>You don\'t need a film suite: the same operations exist in Inkwell. Do them on top of a <b>merged copy</b> (select your layers › Merge copy) or on fill layers with blend modes, so the painting underneath stays editable.</p>',
          '<ul><li><b>Adjustments › Levels / Contrast</b>: exposure and contrast.</li><li><b>Adjustments › Color Balance</b>: push the shadows, midtones and highlights in different directions. This <i>is</i> split-toning (e.g. shadows → blue, highlights → orange).</li><li><b>Adjustments › Gradient Map</b> at low opacity (10–30%): the most powerful grading tool. Presets like Golden Hour, Noir and Neon City map every value to a colour. Put the result on a layer and lower its opacity.</li><li><b>A fill layer in Soft Light or Overlay</b>: a single colour washes the whole picture with that light (orange = warm sunset, blue = night).</li><li><b>A Multiply layer with a soft dark brush</b> around the edges: a vignette that focuses the eye.</li><li><b>Add / Screen layers</b>: glow and light leaks.</li></ul>',
          '<p>Keep all grading layers in one group at the top called "Grade" so you can switch the whole look on and off.</p>',
        ],
        keys: ['Colour balance = split-toning.', 'Gradient map at low opacity = instant cohesive look.', 'Keep grading layers in one group.'],
        quiz: [{ q: 'You want the shadows bluer and the lights warmer. Use…', a: ['Color Balance (shadows and highlights separately)', 'Saturation only', 'The eraser'], c: 0, why: 'Color Balance adjusts each value range separately: that\'s split-toning.' }],
        challenge: { title: 'Build a look', text: 'Recreate the "Teal & orange" and "Flashback" looks from the demo with Inkwell\'s own tools on one of your pictures.', steps: ['Merge copy of your painting.', 'Color Balance for the split-tone.', 'Gradient map at 15%, then a soft vignette.'], studio: studioPaint('Grading — build a look', null, 2048, 2048) },
        sources: [S.gurney],
      },
      {
        id: 'eye', title: 'Train your eye', min: 6,
        body: [
          '<p>Grading is mostly <i>seeing</i>: is this picture too warm? too flat? too green? This exercise trains exactly that. Match your half to the target by adjusting the basic sliders.</p>',
          { demo: 'grade-match', caption: 'Work one property at a time: brightness, then warm/cool, then contrast, then saturation.' },
          '<p>Then do it with real images: take stills from the free Blender Studio open movies (CC-BY) or Pepper&Carrot pages, and analyse their grade: where do the shadows lean? how saturated are the skin tones?</p>',
        ],
        keys: ['Change one thing at a time.', 'Study real grades from open films.'],
        quiz: [{ q: 'The target looks the same brightness but bluer. Which slider first?', a: ['Temperature', 'Exposure', 'Vignette'], c: 0, why: 'Temperature moves along the warm–cool (orange–blue) axis.' }],
        challenge: { title: 'Grade analysis', text: 'Pick three frames from open movies or comics and write down their grade: shadow colour, highlight colour, contrast, saturation. Then apply one to your art.', steps: ['Use the eyedropper on shadows and highlights.', 'Copy the look with Color Balance + Gradient Map.'], studio: studioPaint('Grading — analysis', null, 2048, 1152) },
        sources: [S.blenderFilms, S.pepper],
      },
      {
        id: 'webtoon-grade', title: 'Grading for webtoons', min: 9,
        body: [
          '<p>A webtoon episode is one long picture read on a phone, so grading has extra jobs:</p>',
          '<ul><li><b>Scene consistency</b>: every panel in a scene must share the same grade, or the time of day seems to jump. Grade per <b>scene</b>, not per panel: one grading group clipped to a whole section of the strip.</li><li><b>Colour script</b>: plan the mood of each scene in tiny colour thumbnails across the whole episode (Pixar\'s "colour script"). Warm and safe → cold and tense → a hot red climax → soft relief.</li><li><b>Flashbacks and dreams</b> get a clearly different look (sepia, desaturated, soft and faded) so readers understand instantly.</li><li><b>Screens</b>: phones show bright, saturated colour, often in dark mode at night. Avoid huge areas of pure saturated colour (tiring) and pure black (crushes detail on OLED). Keep text-heavy panels calm.</li><li><b>Export in sRGB</b> (Inkwell does) so colours look the same on every phone.</li></ul>',
          { demo: 'grading', caption: 'Try Flashback and Night: two very common webtoon scene looks.' },
        ],
        keys: ['Grade per scene, not per panel.', 'Plan with a colour script.', 'Flashbacks need an unmistakable look.'],
        quiz: [{ q: 'Two panels in the same scene have different grades. Readers will think…', a: ['Time or place changed', 'Nothing', 'It\'s a mistake in the upload'], c: 0, why: 'Colour signals time and place, so mismatches confuse the story.' }],
        challenge: { title: 'Colour script', text: 'Make a colour script for one episode of your webtoon: 8–12 tiny colour thumbnails, one per scene beat.', steps: ['Tiny boxes, flat colours only.', 'Mark the emotional high point with your strongest colour.', 'Write one word under each (calm, tense, shock…).'], studio: studioToon('Grading — colour script', 3200) },
        sources: [S.wtHandbook, S.cspScroll],
      },
    ],
    capstone: { title: 'Capstone: grade a sequence', text: 'Take 4 panels (or 4 illustrations) of one story and grade them as a sequence: day → evening → night → flashback. Keep the characters recognisable in all four.', ideas: ['A day in your character\'s life', 'Before and after a disaster', 'A memory and the present'], studio: studioToon('Capstone — graded sequence', 6400) },
  },

  // ════════════════════════ ANIMATION 1 ════════════════════════
  {
    id: 'anim1', track: 'animation', title: 'Animation 1: Timing & Motion', color: '#7b5cff',
    blurb: 'Frames, timing and spacing, the bouncing ball, squash & stretch and arcs: the base of every animation.',
    outcome: 'You can animate a bouncing ball with convincing weight, explain timing vs. spacing, and use ease, squash & stretch and arcs on any moving object in your own ideas.',
    lessons: [
      {
        id: 'frames', title: 'Frames, fps, ones and twos', min: 7,
        body: [
          '<p>Animation is a series of still drawings shown fast enough that the brain sees motion. Film runs at <b>24 frames per second</b> (fps). Hand-drawn animation rarely draws all 24:</p>',
          '<ul><li><b>On ones</b>: a new drawing every frame (24 a second). Smoothest; used for fast action and camera moves.</li><li><b>On twos</b>: each drawing held for 2 frames (12 a second). The classic look of hand-drawn animation, and half the work.</li><li><b>On threes</b>: 8 a second, common in anime for calmer moments.</li></ul>',
          { demo: 'ones-twos', caption: 'Same move, three frame rates of drawings.' },
          '<p>In the Studio: an <b>Animate</b> canvas at 24 fps. Each drawing is a block on the track; drag its edge to make it last 1, 2 or 3 frames. Turn on <b>Onion skin</b> to see the drawings before and after.</p>',
        ],
        keys: ['24 fps; draw on ones, twos or threes.', 'Twos = classic look, half the drawings.', 'Mix: twos normally, ones for fast moves.'],
        quiz: [{ q: 'An animation at 24 fps "on twos" has how many drawings per second?', a: ['12', '24', '48'], c: 0, why: 'Each drawing is held for two frames.' }],
        challenge: { title: 'Flipbook', text: 'Make a 12-drawing flipbook of a simple loop (a flame, a waving flag or a blinking eye), on twos at 24 fps.', steps: ['Turn on Onion skin.', 'Make drawing 12 lead back into drawing 1 so it loops.', 'Play it, then try it on ones and on threes.'], studio: studioAnim('Animation — flipbook', 24) },
        sources: [S.williams, S.illusion],
      },
      {
        id: 'timing', title: 'Timing and spacing', min: 10,
        body: [
          '<p>Richard Williams called these the two most important ideas in animation:</p>',
          '<ul><li><b>Timing</b> = <i>how many</i> drawings (how long the action takes). More drawings = slower.</li><li><b>Spacing</b> = <i>where</i> each drawing is placed. Drawings close together = slow; far apart = fast.</li></ul>',
          { demo: 'spacing', caption: 'Keep the same number of drawings and change only the spacing: the motion feels completely different.' },
          '<p><b>Ease in / ease out</b> (also "slow in and slow out"): real objects speed up and slow down gradually, so drawings bunch up near the start and end. Animators plan this with a <b>timing chart</b>: the little ruler on the keys showing where each inbetween goes.</p>',
          '<p>Even (linear) spacing looks mechanical: perfect for robots, a sliding door or a falling-asleep effect, wrong for living things.</p>',
        ],
        keys: ['Timing = how many; spacing = where.', 'Bunch drawings up to slow down, spread them to speed up.', 'Plan with a timing chart.'],
        quiz: [
          { q: 'Drawings close together on screen mean the object is…', a: ['Moving slowly', 'Moving quickly', 'Stopped forever'], c: 0, why: 'Small spacing = small distance per frame = slow.' },
          { q: 'You want a punch to feel fast and heavy. You…', a: ['Use few drawings with big spacing, then a short hold on impact', 'Use many evenly spaced drawings', 'Draw it on threes'], c: 0, why: 'Few frames = fast; the hold lets the impact register.' },
        ],
        challenge: { title: 'Three slides', text: 'Animate a ball sliding from left to right three times in 12 drawings each: even spacing, ease out, ease in & out.', steps: ['Draw the keys first (start and end).', 'Draw a timing chart on a separate layer.', 'Place the inbetweens by the chart.'], studio: studioAnim('Animation — timing and spacing', 36) },
        sources: [S.williams, S.becker],
      },
      {
        id: 'ball', title: 'The bouncing ball', min: 12,
        body: [
          '<p>Every animator starts here because one simple ball teaches timing, spacing, weight, squash & stretch and arcs all at once.</p>',
          { demo: 'ball', caption: 'Step frame by frame. Change the bounciness: rubber ball vs. bowling ball.' },
          '<ol><li><b>Path</b>: each bounce is an arc (a parabola). Each one is lower and shorter than the last.</li><li><b>Spacing</b>: slow at the top (drawings bunched), fast near the ground (spread out), because gravity speeds it up.</li><li><b>Contact</b>: one squashed drawing on the ground.</li><li><b>Stretch</b>: on the fast frames just before and after contact, stretch the ball along its path.</li><li><b>Volume</b>: squashed and stretched, the ball keeps the same amount of "stuff": wider when flatter, thinner when longer.</li></ol>',
          '<p><b>Weight</b> comes from timing and squash: a bowling ball barely bounces, barely squashes and stops fast; a beach ball floats at the top and bounces many times.</p>',
        ],
        keys: ['Arcs, slower at the top, faster at the bottom.', 'Squash on contact, stretch when fast.', 'Keep the volume.'],
        quiz: [
          { q: 'Where are the ball drawings closest together?', a: ['At the top of each bounce', 'Just before hitting the ground', 'On the ground'], c: 0, why: 'The ball slows down as it rises, hangs, then speeds up as it falls.' },
          { q: 'A heavy bowling ball should have…', a: ['Little bounce and little squash', 'Lots of squash and many bounces', 'Stretch on every frame'], c: 0, why: 'Heavy, rigid things don\'t deform or rebound much.' },
        ],
        challenge: { title: 'Three balls', text: 'Animate three balls bouncing across the screen: a rubber ball, a bowling ball and a balloon.', steps: ['Draw the path and mark the contacts first.', 'Keys: contacts and tops. Then the inbetweens by spacing.', 'Squash and stretch only where it makes sense for the material.'], studio: studioAnim('Animation — bouncing balls', 48) },
        sources: [S.williams, S.illusion, S.becker],
      },
      {
        id: 'squash', title: 'Squash and stretch', min: 8,
        body: [
          '<p>The first of Disney\'s 12 principles (Thomas & Johnston, <i>The Illusion of Life</i>). Squashing and stretching shows that something is <b>flexible and alive</b>, and how fast and hard it moves.</p>',
          '<ul><li>Faces: a surprised face stretches; a wince squashes. (See Expressive Faces › Push it.)</li><li>Bodies: crouch before a jump (squash), stretch at take-off, squash on landing.</li><li>Fast motion: stretch along the direction of motion, a "smear", so the eye fills in the speed.</li></ul>',
          '<p>Rules: keep the volume the same, and keep rigid things rigid. A sword doesn\'t squash; the arm swinging it can. Overuse makes everything rubbery, so match it to the style.</p>',
          { demo: 'ball', caption: 'Slide Squash & stretch from 0 to 60%. Where does it start to look too rubbery?' },
        ],
        keys: ['Squash/stretch = flexible and fast.', 'Same volume.', 'Rigid things stay rigid.'],
        quiz: [{ q: 'When a ball squashes on the ground it should get…', a: ['Wider as it gets flatter', 'Smaller overall', 'Taller'], c: 0, why: 'Volume stays constant.' }],
        challenge: { title: 'Flour sack', text: 'Animate a "flour sack" (a simple bag shape) jumping onto a box: squash, stretch, squash.', steps: ['Crouch (squash) → launch (stretch) → land (squash) → settle.', 'Keep the volume the same throughout.', 'Use onion skin to check.'], studio: studioAnim('Animation — flour sack jump', 36) },
        sources: [S.illusion, S.becker, S.open12],
      },
      {
        id: 'arcs', title: 'Arcs', min: 7,
        body: [
          '<p>Limbs rotate around joints, so almost everything living moves along <b>arcs</b>: heads turning, arms swinging, a tail wagging. If you inbetween in straight lines, limbs shrink and motion looks robotic.</p>',
          { demo: 'arcs', caption: 'Toggle the arc off: the arm shrinks in the middle of the swing.' },
          '<p>How to: on a separate layer, draw the arc the hand (or nose, or tip of the tail) travels. Place each inbetween on it, by your timing chart. Check arcs on finished animation too: with onion skin, follow one point through the drawings; it should trace a smooth curve, not a zig-zag.</p>',
        ],
        keys: ['Living things move on arcs.', 'Draw the arc, then place inbetweens on it.', 'Track one point through all drawings to check.'],
        quiz: [{ q: 'Inbetweening an arm swing in a straight line makes the arm…', a: ['Shrink in the middle', 'Move faster', 'Look smoother'], c: 0, why: 'A straight line between two points on a circle cuts inside it.' }],
        challenge: { title: 'Pendulum and head turn', text: 'Animate a swinging pendulum, then a character head turning from left to right with a dip in the middle.', steps: ['Draw the arc of the pendulum bob and the arc of the nose.', 'Ease in and out at the ends.', 'Check the arcs with onion skin.'], studio: studioAnim('Animation — arcs', 36) },
        sources: [S.williams, S.illusion],
      },
    ],
    capstone: { title: 'Capstone: an object with personality', text: 'Animate a 3–4 second shot where an object (ball, lamp, cup, rock…) has a personality, using everything from this course: timing, spacing, squash & stretch and arcs.', ideas: ['A sleepy ball that doesn\'t want to bounce', 'A nervous cup jumping off a table', 'A magic item from your story coming to life'], studio: studioAnim('Capstone — object with personality', 96) },
  },

  // ════════════════════════ ANIMATION 2 ════════════════════════
  {
    id: 'anim2', track: 'animation', title: 'Animation 2: Character Animation', color: '#3dc5ff',
    blurb: 'Anticipation, follow-through, key poses and the walk cycle: make characters move with weight and intention.',
    outcome: 'You can plan a shot with keys and breakdowns, animate a character jumping and walking, and add overlapping action so it feels alive.',
    lessons: [
      {
        id: 'antic', title: 'Anticipation, action, follow-through', min: 10,
        body: [
          '<p>Every action has three parts:</p><ol><li><b>Anticipation</b>: a small move in the <i>opposite</i> direction to prepare (crouch before a jump, wind-up before a throw). It tells the audience something is coming.</li><li><b>Action</b>: usually fast.</li><li><b>Follow-through</b>: the body keeps going after the action and then settles; looser parts keep moving even longer.</li></ol>',
          { demo: 'anticipation', caption: 'Switch off anticipation and follow-through: the jump becomes weightless and unreadable.' },
          '<p>The bigger or heavier the action, the bigger the anticipation. Comedy sometimes skips it on purpose (a sudden zip off-screen). In webtoon panels anticipation matters too: draw the wind-up pose to make the hit in the next panel land.</p>',
        ],
        keys: ['Anticipate → act → follow through.', 'Anticipation goes the opposite way.', 'Bigger action = bigger anticipation.'],
        quiz: [{ q: 'Before throwing a ball forward, the arm first…', a: ['Pulls back (anticipation)', 'Moves forward slowly', 'Stays still'], c: 0, why: 'Anticipation moves opposite to the main action.' }],
        challenge: { title: 'Jump', text: 'Animate a simple character (a bean or a mannequin) doing a standing jump onto a step.', steps: ['Keys: stand, crouch, take-off, peak, land, settle.', 'Crouch about 4–8 frames; airtime depends on height.', 'Overshoot the landing and settle back.'], studio: studioAnim('Animation — jump', 48) },
        sources: [S.illusion, S.williams, S.becker],
      },
      {
        id: 'keys', title: 'Keys, breakdowns and inbetweens', min: 9,
        body: [
          '<p>There are two ways to animate (both from <i>The Illusion of Life</i>):</p><ul><li><b>Straight ahead</b>: draw frame 1, 2, 3… in order. Spontaneous; good for fire, water, smoke and wild action, but things drift in size and position.</li><li><b>Pose to pose</b>: plan the important poses first, then fill in. Controlled; the standard for acting.</li></ul>',
          '<p>Pose to pose works in three passes:</p><ol><li><b>Keys</b>: the storytelling poses. Someone watching only the keys should understand the shot.</li><li><b>Breakdowns</b>: the in-between poses that decide <i>how</i> you get from one key to the next (the dip in a head turn, the arc of a reach). The breakdown is where the personality is.</li><li><b>Inbetweens</b>: the drawings that fill the gaps, placed by the timing chart.</li></ol>',
          '<p>In the Studio: draw keys on a track with long holds, play to check the timing, then split the holds and add breakdowns and inbetweens. Use onion skin to see neighbours.</p>',
          { demo: 'spacing', caption: 'The two big ticks are the keys; everything between them is planned by the chart.' },
        ],
        keys: ['Keys tell the story; breakdowns add personality.', 'Test the timing with keys only.', 'Straight ahead for chaos, pose to pose for acting.'],
        quiz: [{ q: 'Which drawings decide HOW a head moves between two keys (straight, or with a dip)?', a: ['Breakdowns', 'Inbetweens', 'Backgrounds'], c: 0, why: 'The breakdown sets the path and character of the move.' }],
        challenge: { title: 'Pick it up', text: 'Animate a character picking up a heavy box, pose to pose.', steps: ['5 keys: look, bend, grab, strain, lift.', 'Play the keys with holds to check the story and timing.', 'Add breakdowns (the strain!), then inbetweens.'], studio: studioAnim('Animation — pick up', 72) },
        sources: [S.illusion, S.williams],
      },
      {
        id: 'overlap', title: 'Overlapping action and drag', min: 8,
        body: [
          '<p>Not everything moves at once. The main body leads; hair, clothes, tails, ears, cheeks and loose flesh <b>start later</b> and <b>stop later</b>. This "overlapping action" and "drag" is what makes motion feel organic instead of stiff.</p>',
          { demo: 'overlap', caption: 'The head stops; the ponytail keeps going and swings back. Turn it off to see the difference.' },
          '<p>How to animate it: animate the body first. Then, on a separate track, animate the hair or cape as a chain: each piece copies the motion of the piece before it, 1–2 frames later. Loose, light things (silk, long hair) drag more; heavy or stiff things (leather, short hair) less.</p>',
        ],
        keys: ['Body leads, loose parts follow.', 'Each segment lags the one before it.', 'Lighter material = more drag.'],
        quiz: [{ q: 'A character stops running. Their long scarf…', a: ['Keeps moving forward, then swings back and settles', 'Stops at exactly the same time', 'Falls straight down'], c: 0, why: 'Follow-through and overlap: loose parts carry momentum.' }],
        challenge: { title: 'Tail and hair', text: 'Animate a character turning their head quickly, with a ponytail (or a cat with a tail) following.', steps: ['Head animation on one track.', 'Hair on its own track, 2 frames behind.', 'Let the tip overshoot and settle.'], studio: studioAnim('Animation — overlap', 48) },
        sources: [S.illusion, S.becker],
      },
      {
        id: 'walk', title: 'The walk cycle', min: 14,
        body: [
          '<p>Richard Williams wrote that a walk is a "controlled fall": the body falls forward and a leg catches it. A walk <b>cycle</b> is one full step with each foot (two steps) that loops forever. It uses four key positions per step:</p>',
          { demo: 'walk', caption: 'Step through it frame by frame and watch the orange hip-height curve.' },
          '<ol><li><b>Contact</b>: the front heel touches the ground; legs at their widest. The arms are at their widest too, opposite to the legs.</li><li><b>Down</b>: the weight lands; the front knee bends and the body is at its <b>lowest</b>.</li><li><b>Passing</b>: the back leg swings past the standing leg; the body rises.</li><li><b>Up</b>: the standing leg pushes off; the body is at its <b>highest</b>.</li><li>Then the next <b>contact</b>, with the other foot forward.</li></ol>',
          '<p><b>Timing</b>: a normal walk is about one step every half second (12 frames per step at 24 fps, so a 24-frame cycle). 8 frames per step is a brisk march; 16 is a slow stroll. Draw the walk "on the spot" and slide the background (the world moves; the character stays centred), or let the character move across the screen with the feet planted, without sliding.</p>',
          '<p><b>Personality</b>: change the up-and-down, the arm swing, the head tilt and the timing: a happy bounce, a sad drag, a sneaky tiptoe or a proud strut, all from the same four positions.</p>',
        ],
        keys: ['Contact → down → passing → up → contact.', 'Lowest on down, highest on up.', '12 frames per step is a normal walk.'],
        quiz: [
          { q: 'At which position is the body lowest?', a: ['Down', 'Contact', 'Up'], c: 0, why: 'Right after contact, the weight lands and the knee bends.' },
          { q: 'The left leg is forward. The left arm is…', a: ['Back', 'Forward', 'Straight down'], c: 0, why: 'Arms swing opposite to the legs, for balance.' },
        ],
        challenge: { title: 'Walk cycle', text: 'Animate a 24-frame walk cycle of a simple mannequin, on twos, side view.', steps: ['Draw the two contacts (frames 1 and 13) first.', 'Then down, passing and up for each step.', 'Loop it and check the hip goes down-up twice per cycle.', 'Tip: a 3D mannequin layer (Add 3D layer) can be posed as reference.'], studio: studioAnim('Animation — walk cycle', 24, 24) },
        sources: [S.williams, S.becker],
      },
      {
        id: 'color-anim', title: 'Colouring and finishing an animation', min: 11,
        body: [
          '<p>Colouring animation uses the same layer workflow as illustration (Colouring & Light › Layer workflow), with one rule above all: <b>consistency across every drawing</b>.</p>',
          '<ol><li><b>Clean-up</b>: trace the rough drawings into clean line art on a new track.</li><li><b>Model sheet / colour key</b>: one reference picture with every flat colour, the shadow colour and the light colour. Never pick by eye per frame; use the palette.</li><li><b>Flats per drawing</b>: a colour track under the line track. Use Fill with <i>Reads › All layers</i> and gap closing. Animation lines must be closed shapes for this to work.</li><li><b>Shadows</b>: a shadow track with its blend mode set to Multiply. In TV animation and anime, shadows are cel-shaded (one hard-edged tone) to keep them fast and stable between frames.</li><li><b>Background</b>: one painted background on its own layer that doesn\'t change, with the characters on top.</li><li><b>Grade and export</b>: Actions › Share › Animated MP4 or GIF.</li></ol>',
          { demo: 'pipeline', caption: 'The same steps, applied to every drawing.' },
          '<p>Study how real productions do it: the Morevna Project (open-source anime) and Blender Studio\'s open movies publish their production files under CC-BY.</p>',
        ],
        keys: ['One colour key for the whole shot.', 'Closed lines → fast fills.', 'Cel shadows stay stable between frames.'],
        quiz: [{ q: 'Why use one fixed palette for every frame?', a: ['Picked-by-eye colours flicker between frames', 'The app requires it', 'It\'s faster to export'], c: 0, why: 'Tiny colour differences between drawings read as flicker in motion.' }],
        challenge: { title: 'Colour your walk', text: 'Clean up and colour your walk cycle with flats, cel shadows and a background, then export it as a GIF.', steps: ['Colour key first: skin, clothes, hair, shadow colour.', 'Flats on a track under the lines.', 'One Multiply shadow track.', 'Paint a simple looping background strip.'], studio: studioAnim('Animation — coloured walk', 24, 24) },
        sources: [S.morevna, S.blenderFilms, S.williams],
      },
    ],
    capstone: { title: 'Capstone: a coloured character shot', text: 'Animate and colour a 3–5 second shot from one of your own ideas: your character must anticipate, act and follow through, with overlapping hair or clothing, a background and a final grade.', ideas: ['Your character reacts to a surprise and runs off', 'A magic attack: wind-up, blast, recoil', 'A tired walk home in the rain'], studio: studioAnim('Capstone — character shot', 120) },
  },

  // ════════════════════════ WEBTOON 1 ════════════════════════
  {
    id: 'toon1', track: 'webtoon', title: 'Webtoon 1: Format & Panel Flow', color: '#2ecc71',
    blurb: 'How vertical comics are read, sizes and slicing, panels, gutters and pacing.',
    outcome: 'You can plan an episode that reads smoothly on a phone, use panel size and gutters to control time, and export it correctly for WEBTOON and other platforms.',
    lessons: [
      {
        id: 'format', title: 'How a webtoon is read', min: 8,
        body: [
          '<p>A webtoon is read <b>top to bottom, by scrolling with a thumb</b>, on a phone, one or two panels on screen at a time. That changes everything compared with a printed page:</p>',
          '<ul><li>The reader sees panels <b>one after another</b>, not a whole page at once: the scroll is your timeline.</li><li>The screen is narrow: panels are mostly full-width, one per "beat". Side-by-side panels are used sparingly.</li><li>Space between panels (the gutter) is <b>time</b>: the longer the reader scrolls through blank space, the longer the pause.</li><li>There\'s no page turn for reveals. Instead, use a big gutter and a tall panel.</li></ul>',
          { demo: 'webtoon-scroll', caption: 'Scroll inside the phone and change the gutter size.' },
        ],
        keys: ['Vertical, one beat at a time.', 'Scrolling is the timeline.', 'Gutters are time.'],
        quiz: [{ q: 'What replaces the "page turn" reveal of a printed comic?', a: ['A long gutter before a big panel', 'A double-page spread', 'Smaller text'], c: 0, why: 'Empty scrolling space builds suspense before the reveal.' }],
        challenge: { title: 'Read like a creator', text: 'Read the first three episodes of two webtoons you like. Note where the big gutters and the biggest panels are, and what happens there.', steps: ['Count panels per episode.', 'Mark every "reveal" and what came just before it.'], studio: studioToon('Webtoon — study notes', 3200) },
        sources: [S.cspScroll, S.cspPanels, S.wtHandbook],
      },
      {
        id: 'size', title: 'Canvas size, slicing and export', min: 8,
        body: [
          '<p>Technical facts from WEBTOON\'s official creator guides:</p>',
          '<ul><li>Episode images for WEBTOON CANVAS are <b>800 px wide</b>. Each uploaded image can be at most <b>800 × 1280 px</b> (JPG or PNG), and the episode can have up to 100 images (20 MB total). Larger images get shrunk and sliced automatically, with some quality loss, so it\'s better to slice yourself.</li><li>Many creators <b>draw at double size</b> (1600 px wide) for detail and export at 800. Tapas uses 940 px wide.</li><li>Thumbnails have their own sizes; see the official handbook.</li></ul>',
          { demo: 'slicing', caption: 'Plain slicing vs. smart slicing that cuts in the gutters.' },
          '<p>In Inkwell: new <b>Webtoon</b> canvas › "Webtoon · 800 wide". Actions › Webtoon › <b>Extend canvas height</b> as you go, and <b>Export episode slices</b> to get correctly sized, panel-safe images. Use <b>Phone scroll preview</b> constantly.</p>',
        ],
        keys: ['800 px wide, slices ≤ 800 × 1280 px.', 'Slice in the gutters.', 'Preview on a phone-sized view often.'],
        quiz: [{ q: 'What is the maximum size of one uploaded image on WEBTOON CANVAS?', a: ['800 × 1280 px', '1080 × 1920 px', 'Unlimited'], c: 0, why: 'From WEBTOON\'s Creator\'s Resource Handbook; bigger images get resized and sliced automatically.' }],
        challenge: { title: 'Set up an episode file', text: 'Create an episode canvas, place 10 empty panels, and export test slices. Check them in the phone preview.', steps: ['New Webtoon canvas, 800 wide.', 'Actions › Webtoon › Auto panel layout.', 'Export episode slices and look at where the cuts landed.'], studio: studioToon('Webtoon — episode setup', 6400) },
        sources: [S.wtHandbook, S.wtChecklist, S.cspStart],
      },
      {
        id: 'panels', title: 'Panels: size, shape and beats', min: 10,
        body: [
          '<p>Plan one <b>beat</b> (one moment of story) per panel. Then size the panel by how important that beat is:</p>',
          '<ul><li><b>Wide establishing panels</b> at the start of a scene: where are we, who is here?</li><li><b>Medium shots</b> for conversation.</li><li><b>Close-ups</b> for emotion: narrower or smaller panels, often with more space around them.</li><li><b>Tall, full-width panels</b> for big moments, falls, towers, reveals: the reader has to scroll through them.</li><li><b>Borderless panels</b> (art bleeding into the white) for dreamy, open or fast moments.</li><li>Break the frame (a hand or effect crossing the border) for impact, but rarely, so it keeps its power.</li></ul>',
          '<p><b>Camera</b>: vary the shot size (wide/medium/close) and the angle, but keep the <b>180° rule</b>: in a conversation, keep the camera on one side of the line between the two characters so the left-hand character stays on the left. Crossing it confuses readers.</p>',
        ],
        keys: ['One beat per panel.', 'Size = importance.', 'Keep the 180° rule in conversations.'],
        quiz: [
          { q: 'The most important moment of the episode should usually get…', a: ['A tall, full-width panel after a long gutter', 'The smallest panel', 'A panel with lots of text'], c: 0, why: 'Size and the space before it signal importance.' },
          { q: 'In a two-person conversation, the 180° rule means…', a: ['Each character stays on the same side of the frame', 'The camera must rotate 180°', 'Use 180 px gutters'], c: 0, why: 'Crossing the imaginary line flips the characters and confuses the reader.' },
        ],
        challenge: { title: 'Thumbnail an episode', text: 'Write a tiny script (10–15 beats) and thumbnail it as a webtoon strip: stick figures, boxes and arrows only.', steps: ['One beat per panel.', 'Mark the biggest moment and give it the tallest panel.', 'Decide each gutter size: short, medium or long.'], studio: studioToon('Webtoon — thumbnails', 6400) },
        sources: [S.cspPanels, S.mccloud, S.cspScroll],
      },
      {
        id: 'flow', title: 'Transitions and pacing', min: 9,
        body: [
          '<p>Scott McCloud\'s <i>Understanding Comics</i> names six kinds of transition between panels:</p>',
          '<ol><li><b>Moment-to-moment</b>: tiny change (a blink). Very slow.</li><li><b>Action-to-action</b>: one subject doing one action (wind-up → punch). The most common.</li><li><b>Subject-to-subject</b>: same scene, different subject (the speaker → the listener\'s reaction).</li><li><b>Scene-to-scene</b>: a jump in time or place. Use a big gutter or a caption ("Later…").</li><li><b>Aspect-to-aspect</b>: wandering around one place or mood (rain, a cup, a window). Common in manga for atmosphere.</li><li><b>Non-sequitur</b>: no logical link. Rare, for surreal effect.</li></ol>',
          '<p><b>Pacing</b>: many small moment-to-moment panels slow time down (tension, a kiss, a bomb timer). Action-to-action with short gutters speeds it up (fights). End each episode on a hook: a question, a reveal or a cliffhanger in the last panel.</p>',
        ],
        keys: ['Six transitions; action-to-action is the most common.', 'More panels for one moment = slower time.', 'End on a hook.'],
        quiz: [
          { q: 'Panel 1: she draws her sword. Panel 2: she swings. This is…', a: ['Action-to-action', 'Scene-to-scene', 'Aspect-to-aspect'], c: 0, why: 'One subject, progressing through an action.' },
          { q: 'You want a tense moment to feel longer. You…', a: ['Split it into several small moment-to-moment panels', 'Use one small panel', 'Skip it with a scene-to-scene cut'], c: 0, why: 'More panels for the same moment stretch the reader\'s sense of time.' },
        ],
        challenge: { title: 'Same scene, two speeds', text: 'Thumbnail the same 5-second event (a glass falling off a table) twice: once in 2 panels, once in 8.', steps: ['Version A: action-to-action.', 'Version B: moment-to-moment plus aspect-to-aspect reactions.', 'Which one creates more tension?'], studio: studioToon('Webtoon — pacing', 6400) },
        sources: [S.mccloud],
      },
    ],
    capstone: { title: 'Capstone: a 20-panel pilot', text: 'Thumbnail and rough the first episode of your own webtoon idea, around 20–40 panels, ending on a hook. Export slices and read it in the phone preview.', ideas: ['The opening of your main story', 'A one-shot short story', 'A side story about a minor character'], studio: studioToon('Capstone — pilot episode', 12800) },
  },

  // ════════════════════════ WEBTOON 2 ════════════════════════
  {
    id: 'toon2', track: 'webtoon', title: 'Webtoon 2: Dialogue & Lettering', color: '#1abc9c',
    blurb: 'Where to put balloons, how to keep reading order clear, balloon types, fonts and SFX.',
    outcome: 'You can letter a webtoon so it reads clearly and naturally on a phone: balloons in the right order, readable fonts, and sound effects that add energy without clutter.',
    lessons: [
      {
        id: 'order', title: 'Reading order and balloon placement', min: 11,
        body: [
          '<p>Readers read balloons <b>top to bottom, then left to right</b> (for English-language webtoons). Your job is to place balloons so the order is obvious without thinking.</p>',
          { demo: 'dialogue-order', caption: 'Arrange the conversation, then press Check.' },
          '<ul><li><b>Plan dialogue before drawing.</b> Leave room for balloons in the thumbnails. Lettering added at the end always covers something important.</li><li><b>Who speaks first goes on the left</b> (and/or higher). When blocking a conversation, put the first speaker on the left.</li><li><b>Each balloon a little lower</b> than the one before it. In a webtoon, stack them down the scroll.</li><li><b>Tails point at the speaker\'s mouth</b> and never cross other tails.</li><li><b>Don\'t cover</b> faces, hands or the key action. Balloons can sit in the gutter between panels: this is very common in webtoons and helps pacing.</li><li><b>Short lines</b>: about 1–3 short sentences per balloon. Split long speeches into several balloons down the scroll.</li></ul>',
        ],
        keys: ['Top→bottom, left→right.', 'First speaker on the left.', 'Plan balloon space in the thumbnails.'],
        quiz: [
          { q: 'Two characters talk; A speaks first. Where should A stand?', a: ['On the left', 'On the right', 'It doesn\'t matter'], c: 0, why: 'Then A\'s balloon is naturally read first.' },
          { q: 'A character has a long speech. Best approach:', a: ['Split it into several balloons spaced down the scroll', 'One huge balloon', 'Make the text tiny'], c: 0, why: 'Small chunks are easier to read on a phone, and pace the speech.' },
        ],
        challenge: { title: 'Letter a conversation', text: 'Draw (or thumbnail) a 6-panel conversation between two characters and letter it so it reads clearly.', steps: ['Write the script first.', 'Block the characters: first speaker on the left.', 'Place balloons with the Balloon tool; use the gutters.'], studio: studioToon('Webtoon — conversation', 4800) },
        sources: [S.cspLetter, S.blambot, S.cspPanels],
      },
      {
        id: 'types', title: 'Balloon types and text', min: 9,
        body: [
          '<p>Balloon shape tells the reader <i>how</i> something is said. The common conventions (see Blambot\'s comic grammar guide):</p>',
          '<ul><li><b>Speech</b>: smooth oval, tail to the mouth.</li><li><b>Thought</b>: cloud with a trail of small bubbles (less common in modern comics; captions are often used instead).</li><li><b>Shout</b>: spiky, burst outline, bigger or bold text.</li><li><b>Whisper</b>: dashed outline, smaller text, sometimes grey.</li><li><b>Narration / caption</b>: a rectangular box, often a different colour.</li><li><b>Off-panel</b>: the tail points to the edge of the panel, toward where the speaker is.</li><li><b>Electronic / phone</b>: zig-zag tail, sometimes a jagged outline.</li></ul>',
          '<p><b>Text</b>: use a proper comic font (Inkwell has 14 built in, and you can import TTF/OTF fonts). Comic lettering is traditionally all caps in Western comics, while webtoons often use sentence case. Pick one and stay consistent. On an 800 px canvas, body text around 20–28 px reads well on a phone; check it in Phone scroll preview. Bold for emphasis, sparingly.</p>',
        ],
        keys: ['Balloon shape = how it\'s said.', 'One consistent font and size.', 'Check readability on phone size.'],
        quiz: [{ q: 'A dashed balloon outline usually means…', a: ['Whispering', 'Shouting', 'A narrator'], c: 0, why: 'The broken line suggests a quiet voice.' }],
        challenge: { title: 'Balloon style sheet', text: 'Make a lettering style sheet for your webtoon: one sample of each balloon type, with your chosen font and size.', steps: ['Use Add speech bubble for each type.', 'Decide colours for narration and phone text.', 'Check it in Phone scroll preview.'], studio: studioToon('Webtoon — lettering style sheet', 3200) },
        sources: [S.blambot, S.cspLetter],
      },
      {
        id: 'sfx', title: 'Sound effects (SFX)', min: 7,
        body: [
          '<p>Sound effects are part of the art, not the text. Hand-drawn SFX add energy and tell the reader the <i>quality</i> of the sound:</p>',
          '<ul><li><b>Shape follows the sound</b>: a "THOOM" is heavy, wide and low; a "tink" is small and light.</li><li><b>Direction</b>: tilt and stretch SFX along the motion, like a smear in animation.</li><li><b>Layering</b>: put SFX partly behind and partly in front of objects to place them in space.</li><li><b>Colour</b>: use the scene\'s colours, often with an outline for contrast.</li><li>Don\'t overdo it: every SFX on the page competes with the dialogue.</li></ul>',
          '<p>In Inkwell: write SFX with Add text (outline on, a bold font), rasterize it, then transform/warp it; or simply draw it with an inking brush on its own layer.</p>',
        ],
        keys: ['SFX shape = sound quality.', 'Follow the motion.', 'Use sparingly.'],
        quiz: [{ q: 'A heavy door slamming should have SFX that is…', a: ['Big, heavy and wide', 'Small and thin', 'In a whisper balloon'], c: 0, why: 'The letterforms should feel like the sound.' }],
        challenge: { title: 'Ten sounds', text: 'Draw 10 sound effects with different qualities: explosion, footstep, phone buzz, rain, sword clash, heartbeat, door, splash, whoosh, crunch.', steps: ['Each one hand-lettered.', 'Make the shape match the sound.'], studio: studioToon('Webtoon — SFX', 3200) },
        sources: [S.blambot],
      },
    ],
    capstone: { title: 'Capstone: letter your pilot', text: 'Letter your pilot episode from Webtoon 1 (or a new 15-panel scene): dialogue, captions and at least 3 SFX. Read it in the phone preview and ask someone else to read it.', ideas: ['Your pilot', 'A funny 4-panel-style gag strip, vertical', 'A tense argument scene'], studio: studioToon('Capstone — lettered episode', 8000) },
  },

  // ════════════════════════ WEBTOON 3 ════════════════════════
  {
    id: 'toon3', track: 'webtoon', title: 'Webtoon 3: Colouring & Production', color: '#ff9f43',
    blurb: 'An efficient colour pipeline for weekly episodes: flats, shading, backgrounds, effects and grading.',
    outcome: 'You can produce a fully coloured episode efficiently and consistently, the way weekly webtoon artists do.',
    lessons: [
      {
        id: 'pipeline', title: 'The production pipeline', min: 10,
        body: [
          '<p>Weekly webtoons survive on an efficient, repeatable pipeline. A typical one:</p>',
          '<ol><li><b>Script</b> → <b>thumbnails/storyboard</b> (with balloon space).</li><li><b>Sketch</b> per panel.</li><li><b>Line art</b> (Reference layer).</li><li><b>Flats</b>: one colour per material, filled from the reference line art. Many studios have dedicated "flatters" because this step takes time.</li><li><b>Shading</b>: one Multiply shadow layer clipped to the flats; cel shading is standard in webtoons.</li><li><b>Lighting and effects</b>: Add/Glow layers, rim lights, speed lines.</li><li><b>Backgrounds</b>: often 3D or photo-based for consistency, simplified and colour-matched.</li><li><b>Grading per scene.</b></li><li><b>Lettering</b> last, on its own layer group.</li><li><b>Export slices.</b></li></ol>',
          { demo: 'pipeline', caption: 'The core colouring steps of the pipeline.' },
          '<p>Keep the layer structure the <b>same in every episode</b>: Inkwell\'s webtoon canvas starts you with Colors, Line art, Panels and Balloons layers already in place.</p>',
        ],
        keys: ['Same pipeline, same layers, every episode.', 'Flats → shadow → light → BG → grade → letters.'],
        quiz: [{ q: 'Why is lettering usually done last, on its own layers?', a: ['Text can be edited, translated or moved without touching the art', 'Fonts look better last', 'It isn\'t; it\'s first'], c: 0, why: 'Separate text layers make edits and translations easy. (But plan the space for it first!)' }],
        challenge: { title: 'Pipeline test', text: 'Take 3 panels through the full pipeline and time each step. Where does your time go?', steps: ['Write down minutes per step.', 'Find the slowest step and look for a faster method (reference layer fill, colour key, 3D backgrounds).'], studio: studioToon('Webtoon — pipeline test', 4000) },
        sources: [S.cspStart, S.wtHandbook, S.pepper],
      },
      {
        id: 'colorkey', title: 'Character colour keys and consistency', min: 8,
        body: [
          '<p>Readers notice when a character\'s hair is a different red in every panel. Make a <b>colour key</b> for every character: flats for each material, plus the shadow colour, plus variants for night and other lighting.</p>',
          '<ul><li>Save each character\'s colours as a <b>palette</b> in Inkwell (Colours › Palettes › New), named after the character.</li><li>Always pick flats from the palette with the eyedropper; never by eye.</li><li>Change the <i>lighting</i> per scene with the shadow/light/grade layers, not by changing the flats. The flats stay the same; the light changes.</li></ul>',
          { demo: 'light-sphere', caption: 'The object colour stays fixed; the light and shadow colours change the scene.' },
        ],
        keys: ['One palette per character.', 'Flats never change; light does.'],
        quiz: [{ q: 'A night scene: the character\'s flats should…', a: ['Stay the same, with a night shadow/grade layer on top', 'Be repainted darker by hand', 'Be desaturated one by one'], c: 0, why: 'Consistent flats + scene lighting = consistent and fast.' }],
        challenge: { title: 'Colour keys', text: 'Make colour keys for your main cast: flats, shadow colour, and a day and a night version.', steps: ['One palette per character.', 'Show each character in day and night lighting.'], studio: studioPaint('Webtoon — colour keys', null, 3000, 2000) },
        sources: [S.gurney, S.cspStart],
      },
      {
        id: 'bg-fx', title: 'Backgrounds and effects for webtoons', min: 9,
        body: [
          '<p>Backgrounds in webtoons are often <b>simplified and reused</b>: draw a location once (or build it in 3D) and re-shoot it from different angles. Keep them a bit <b>softer and lower in contrast</b> than the characters so the characters always pop.</p>',
          '<ul><li>Use the Perspective tool or a 3D Place for each new location; save the file as a reusable asset.</li><li>Close-ups don\'t need a full background: a gradient, a blur, screen tones or an emotional pattern (sparkles, dark stripes) can work better.</li><li><b>Effects</b>: glows (Add/Screen layers), speed lines (Comic & Tone brushes), focus lines for shock, soft light leaks for romance.</li><li>Atmospheric perspective and grading tie characters and backgrounds together so they look like they share the same light.</li></ul>',
          { demo: 'atmosphere', caption: 'Lower contrast in the background keeps characters readable.' },
        ],
        keys: ['Build a location once, reuse it.', 'Backgrounds softer than characters.', 'Emotional backgrounds for close-ups.'],
        quiz: [{ q: 'For an emotional close-up, a background that often works better than a detailed room is…', a: ['A soft gradient or emotional pattern', 'An even more detailed room', 'Pure white always'], c: 0, why: 'It focuses everything on the emotion.' }],
        challenge: { title: 'One location, five shots', text: 'Build one location (3D or perspective) and use it for 5 panels from different angles.', steps: ['Wide shot, two medium shots, a close-up with an emotional background, and a high angle.', 'Grade them all with the same scene grade.'], studio: studioToon('Webtoon — reusable location', 6400) },
        sources: [S.kenney, S.polyhaven, S.cspScroll],
      },
      {
        id: 'final', title: 'Grading, export and publishing', min: 8,
        body: [
          '<p>The final pass for every episode:</p>',
          '<ol><li><b>Scene grades</b> (see Colour Grading › Grading for webtoons).</li><li><b>Read it in the Phone scroll preview</b> from top to bottom: check reading order, pacing, text size and any colour jumps.</li><li><b>Export episode slices</b> (smart slicing, 800 px wide, JPG for most panels).</li><li>Check against WEBTOON\'s <b>Before You Publish</b> checklist: the official advice is to launch with at least three episodes ready, and to keep a regular schedule.</li><li>Back up the project file (.inkwell) and the slices.</li></ol>',
          { demo: 'slicing', caption: 'Last check: are any cuts going through a panel?' },
        ],
        keys: ['Preview → slice → checklist → back up.', 'Launch with several episodes ready.'],
        quiz: [{ q: 'According to WEBTOON\'s own checklist, how many episodes should you have ready at launch?', a: ['About three', 'One', 'Fifty'], c: 0, why: 'Several ready episodes let readers get hooked and give you a buffer.' }],
        challenge: { title: 'Ship an episode', text: 'Finish one complete, coloured, lettered episode and export it, ready to upload.', steps: ['Run the full pipeline.', 'Phone preview twice.', 'Export slices and check them one by one.'], studio: studioToon('Webtoon — finished episode', 12800) },
        sources: [S.wtChecklist, S.wtHandbook, S.wtAcademy],
      },
    ],
    capstone: { title: 'Capstone: episode 1', text: 'Produce the full first episode of your own webtoon: script, thumbnails, sketches, line art, colour, grading, lettering and export. You now have every skill you need.', ideas: ['Your dream series', 'A short 3-episode mini-series', 'An adaptation of one of your animation ideas'], studio: studioToon('Capstone — Episode 1', 12800) },
  },
];

export function findLesson(cid, lid) {
  const c = COURSES.find((x) => x.id === cid);
  return c ? { course: c, lesson: c.lessons.find((l) => l.id === lid) } : {};
}
