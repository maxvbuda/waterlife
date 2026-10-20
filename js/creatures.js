// Waterlife — creature art and marine-life data.
// Every creature is drawn procedurally, facing right, centered on the origin.
// `s` is the creature's size in pixels (roughly its body length).

const TAU = Math.PI * 2;

function ellipse(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot, 0, TAU);
}

function poly(ctx, pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

function eye(ctx, x, y, r, iris = '#111') {
  ctx.fillStyle = '#fff';
  ellipse(ctx, x, y, r, r); ctx.fill();
  ctx.fillStyle = iris;
  ellipse(ctx, x + r * 0.2, y, r * 0.62, r * 0.62); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ellipse(ctx, x + r * 0.38, y - r * 0.3, r * 0.2, r * 0.2); ctx.fill();
}

function glowDot(ctx, x, y, r, rgb, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.35, `rgba(${rgb},${a * 0.45})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

// Tail + oval body, the base of most fish.
function fishShape(ctx, t, L, H, color, tailColor, wag = 8) {
  const w = Math.sin(t * wag) * H * 0.18;
  ctx.fillStyle = tailColor || color;
  ctx.beginPath();
  ctx.moveTo(-L * 0.36, 0);
  ctx.lineTo(-L * 0.58, -H * 0.42 + w);
  ctx.quadraticCurveTo(-L * 0.5, w * 0.5, -L * 0.58, H * 0.42 + w);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = color;
  ellipse(ctx, 0, 0, L * 0.42, H * 0.5); ctx.fill();
}

// A wavy, tapering arm or tentacle. Returns the tip position.
function tendril(ctx, x, y, len, dir, w0, w1, t, freq, amp, color, segs = 10) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let k = 0; k < segs; k++) {
    const u = k / segs;
    const a = dir + Math.sin(t * freq + u * 5) * amp * u;
    const nx = x + Math.cos(a) * len / segs;
    const ny = y + Math.sin(a) * len / segs;
    ctx.lineWidth = Math.max(0.5, w0 + (w1 - w0) * u);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
    x = nx; y = ny;
  }
  return [x, y];
}

function limb(ctx, x, y, rot, w, l) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ellipse(ctx, -l * 0.5, 0, l * 0.55, w); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ocean zones
// ---------------------------------------------------------------------------

const ZONES = {
  sunlit: {
    name: 'Sunlit Zone',
    range: '0–200 m',
    fact: 'Sunlight powers photosynthesis here. Tiny drifting plants called phytoplankton make roughly half of the oxygen on Earth.',
  },
  twilight: {
    name: 'Twilight Zone',
    range: '200–1,000 m',
    fact: 'Only faint blue light reaches this deep — too little for plants to grow. Many animals here make their own light. That’s called bioluminescence.',
  },
  midnight: {
    name: 'Midnight Zone',
    range: '1,000 m and deeper',
    fact: 'No sunlight ever reaches here. The water is near freezing and the pressure is over 100 times stronger than at the surface. Follow the glowing lights!',
  },
};

const OCTO_FACTS = [
  'Octopuses have three hearts: two pump blood through the gills, and one pumps it to the rest of the body.',
  'Octopus blood is blue! It carries oxygen with a copper-based molecule called hemocyanin.',
  'About two-thirds of an octopus’s neurons are in its arms, so each arm can feel and taste on its own.',
  'Octopuses have no bones. They can squeeze through any gap bigger than their hard beak.',
  'Skin cells called chromatophores let an octopus change color in a fraction of a second.',
  'Octopuses taste with their suckers, which are packed with chemical sensors.',
  'Veined octopuses have been seen carrying coconut shells around to use as portable shelters.',
  'Many octopus species live only about one to two years.',
  'An octopus’s ink cloud hides it from view, giving it a moment to jet away.',
];

// ---------------------------------------------------------------------------
// Predators and prey (not in the journal)
// ---------------------------------------------------------------------------

function sharkPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.02);
  ctx.quadraticCurveTo(s * 0.35, -s * 0.12, 0, -s * 0.12);
  ctx.quadraticCurveTo(-s * 0.3, -s * 0.08, -s * 0.42, -s * 0.01);
  ctx.quadraticCurveTo(-s * 0.3, s * 0.08, 0, s * 0.1);
  ctx.quadraticCurveTo(s * 0.35, s * 0.1, s * 0.5, s * 0.02);
  ctx.closePath();
}

function drawShark(ctx, t, s) {
  const w = Math.sin(t * 5) * 0.04 * s;
  poly(ctx, [-s * 0.38, 0, -s * 0.56, -s * 0.22 + w, -s * 0.47, w * 0.5, -s * 0.52, s * 0.12 + w], '#6a7c8f');
  poly(ctx, [s * 0.05, -s * 0.11, -s * 0.13, -s * 0.1, -s * 0.07, -s * 0.3], '#5d6e80');
  ctx.fillStyle = '#6f8396';
  sharkPath(ctx, s); ctx.fill();
  ctx.save();
  sharkPath(ctx, s); ctx.clip();
  ctx.fillStyle = '#dfe8ef';
  ellipse(ctx, s * 0.08, s * 0.08, s * 0.4, s * 0.05); ctx.fill();
  ctx.restore();
  poly(ctx, [s * 0.12, s * 0.07, 0, s * 0.08, -s * 0.05, s * 0.22], '#5d6e80');
  ctx.strokeStyle = 'rgba(30,40,50,0.5)';
  ctx.lineWidth = s * 0.008;
  for (let i = 0; i < 3; i++) {
    const x = s * (0.24 - i * 0.03);
    ctx.beginPath(); ctx.moveTo(x, -s * 0.03); ctx.lineTo(x - s * 0.01, s * 0.05); ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(s * 0.44, s * 0.05); ctx.quadraticCurveTo(s * 0.38, s * 0.07, s * 0.33, s * 0.05);
  ctx.stroke();
  ctx.fillStyle = '#111';
  ellipse(ctx, s * 0.37, -s * 0.03, s * 0.016, s * 0.016); ctx.fill();
}

function drawShrimp(ctx, t, s) {
  const k = Math.sin(t * 6) * 0.08;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ff9d8c';
  ctx.lineWidth = s * 0.32;
  ctx.beginPath(); ctx.arc(0, -s * 0.05, s * 0.36, Math.PI * (0.05 + k), Math.PI * 0.95); ctx.stroke();
  poly(ctx, [-s * 0.36, 0, -s * 0.62, -s * 0.12, -s * 0.58, s * 0.14], '#ff8a78');
  ctx.strokeStyle = 'rgba(255,190,170,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(s * 0.38, -s * 0.02); ctx.quadraticCurveTo(s * 0.8, -s * 0.4, s * 1.0, -s * (0.2 + k));
  ctx.moveTo(s * 0.38, 0); ctx.quadraticCurveTo(s * 0.7, -s * 0.2, s * 0.95, s * 0.05);
  ctx.stroke();
  ctx.fillStyle = '#222';
  ellipse(ctx, s * 0.3, -s * 0.08, s * 0.06, s * 0.06); ctx.fill();
}

// ---------------------------------------------------------------------------
// Species for the Field Journal
// frame: bounding box in units of size, used to fit portraits.
// home: where the creature lives in the world (pixels). floor: height above
// the seafloor, as a fraction of size, for bottom-dwellers.
// quiz.options: the correct answer is listed first (shuffled in game).
// ---------------------------------------------------------------------------

const SPECIES = [
  // ---------------- Sunlit Zone ----------------
  {
    id: 'clownfish', name: 'Clownfish', sci: 'Amphiprion ocellaris', zone: 'sunlit',
    lives: 'Coral reefs, 1–15 m', size: 46, behavior: 'hover', roam: 35,
    home: { x: [900, 900] }, floor: 1.4, frame: { w: 1.05, h: 0.85, cx: -0.08, cy: -0.05 },
    facts: [
      'Clownfish live among the stinging tentacles of sea anemones. A special coat of mucus keeps them from getting stung.',
      'It’s a partnership: the anemone protects the clownfish, and the clownfish cleans the anemone and chases off fish that would nibble it.',
      'All clownfish hatch as males. The biggest, most dominant fish in a group can change into a female.',
    ],
    quiz: {
      q: 'What protects a clownfish from its anemone’s stings?',
      options: ['A special coat of mucus', 'Extra-thick scales', 'It swims too fast to be stung', 'The anemone is always asleep'],
      why: 'A layer of mucus on the clownfish’s skin stops the anemone’s stingers from firing.',
    },
    draw(ctx, t, s) {
      const H = s * 0.5;
      poly(ctx, [-s * 0.22, -H * 0.38, s * 0.12, -H * 0.42, -s * 0.04, -H * 0.85], '#ff7a1a');
      fishShape(ctx, t, s, H, '#ff7a1a', '#ff7a1a', 10);
      ctx.save();
      ellipse(ctx, 0, 0, s * 0.42, H * 0.5); ctx.clip();
      for (const bx of [s * 0.22, -s * 0.02, -s * 0.26]) {
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(bx - s * 0.05, -H, s * 0.1, H * 2);
        ctx.fillStyle = '#fff'; ctx.fillRect(bx - s * 0.035, -H, s * 0.07, H * 2);
      }
      ctx.restore();
      poly(ctx, [s * 0.06, H * 0.15, -s * 0.06, H * 0.2, -s * 0.02, H * 0.6], '#ff8f3a');
      eye(ctx, s * 0.32, -H * 0.08, H * 0.13);
    },
  },
  {
    id: 'seahorse', name: 'Seahorse', sci: 'Hippocampus kuda', zone: 'sunlit',
    lives: 'Seagrass beds and reefs, 1–30 m', size: 64, behavior: 'hover', roam: 22,
    home: { x: [1710, 1710] }, floor: 1.1, frame: { w: 0.5, h: 0.85, cx: 0.04, cy: 0.0 },
    facts: [
      'Seahorse dads carry the eggs in a pouch on their belly and give birth to the babies!',
      'They are slow swimmers. A seahorse flutters its tiny back fin dozens of times per second to move.',
      'Their curly tails grip seagrass like a hand, so currents don’t sweep them away.',
    ],
    quiz: {
      q: 'Which seahorse parent gives birth to the babies?',
      options: ['The father', 'The mother', 'Both parents take turns', 'Neither — eggs hatch on the seafloor'],
      why: 'Male seahorses carry the eggs in a brood pouch until the babies are born.',
    },
    draw(ctx, t, s) {
      const pts = [[0.0, -0.3], [-0.05, -0.2], [0.02, -0.08], [0.06, 0.04], [0.02, 0.15], [-0.04, 0.23], [-0.06, 0.31], [-0.02, 0.37], [0.04, 0.36], [0.045, 0.3], [0.01, 0.29]];
      const rads = [0.09, 0.08, 0.1, 0.1, 0.08, 0.06, 0.045, 0.035, 0.028, 0.022, 0.018];
      ctx.fillStyle = 'rgba(255,225,150,0.75)';
      ellipse(ctx, -s * 0.07, s * 0.02, s * 0.03 * (1 + 0.4 * Math.sin(t * 25)), s * 0.07); ctx.fill();
      ctx.fillStyle = '#f2b13c';
      for (let i = 0; i < pts.length - 1; i++) {
        for (let k = 0; k < 4; k++) {
          const u = k / 4;
          const x = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u) * s;
          const y = (pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u) * s;
          const r = (rads[i] + (rads[i + 1] - rads[i]) * u) * s;
          ellipse(ctx, x, y, r, r); ctx.fill();
        }
      }
      ellipse(ctx, s * 0.02, -s * 0.34, s * 0.08, s * 0.065); ctx.fill();
      ctx.strokeStyle = '#f2b13c'; ctx.lineWidth = s * 0.05; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s * 0.06, -s * 0.35); ctx.lineTo(s * 0.19, -s * 0.32); ctx.stroke();
      poly(ctx, [-s * 0.03, -s * 0.39, s * 0.01, -s * 0.46, s * 0.04, -s * 0.39], '#e09a25');
      ctx.strokeStyle = 'rgba(150,80,10,0.35)'; ctx.lineWidth = s * 0.012;
      for (let i = 0; i < 6; i++) {
        const y = -s * 0.15 + i * s * 0.05;
        ctx.beginPath(); ctx.moveTo(-s * 0.02, y); ctx.lineTo(s * 0.11, y + s * 0.01); ctx.stroke();
      }
      eye(ctx, s * 0.04, -s * 0.35, s * 0.024);
    },
  },
  {
    id: 'seastar', name: 'Sea Star', sci: 'Class Asteroidea', zone: 'sunlit',
    lives: 'Rocky and sandy seafloors, all depths', size: 54, behavior: 'bottom', roam: 30, speed: 3,
    home: { x: [1260, 1260] }, floor: 0.38, noFlip: true, frame: { w: 1.05, h: 1.0, cx: 0, cy: 0.02 },
    facts: [
      'Sea stars aren’t fish! They are echinoderms, related to sea urchins and sand dollars.',
      'If a sea star loses an arm, it can grow a new one.',
      'To eat a clam, a sea star pulls the shell open a crack, then pushes its stomach out of its body to digest the meal.',
      'They walk on hundreds of tiny tube feet, powered by seawater pumped through their bodies.',
    ],
    quiz: {
      q: 'How does a sea star eat a clam?',
      options: ['It pushes its stomach out of its body', 'It swallows the clam whole', 'It cracks the shell with its teeth', 'It waits for the clam to dissolve'],
      why: 'A sea star slips its stomach into the clam’s shell and digests the clam right there.',
    },
    draw(ctx, t, s) {
      ctx.save();
      ctx.rotate(Math.sin(t * 0.4) * 0.08);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = (i % 2 ? 0.18 : 0.46) * s;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = '#ec7438'; ctx.strokeStyle = '#ec7438';
      ctx.lineJoin = 'round'; ctx.lineWidth = s * 0.08;
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffc48f';
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * TAU / 5;
        for (const d of [0.14, 0.25, 0.35]) {
          ellipse(ctx, Math.cos(a) * d * s, Math.sin(a) * d * s, s * 0.025, s * 0.025); ctx.fill();
        }
      }
      ellipse(ctx, 0, 0, s * 0.05, s * 0.05); ctx.fill();
      ctx.restore();
    },
  },
  {
    id: 'parrotfish', name: 'Parrotfish', sci: 'Family Scaridae', zone: 'sunlit',
    lives: 'Coral reefs, 1–30 m', size: 80, behavior: 'swim', speed: 55,
    home: { x: [1000, 2400], y: [650, 1050] }, frame: { w: 1.05, h: 0.75, cx: -0.08, cy: -0.05 },
    facts: [
      'Parrotfish have teeth fused into a beak, which they use to scrape algae off coral.',
      'They grind up bits of coral rock and poop it out as fine white sand. One big parrotfish can make hundreds of kilograms of sand a year!',
      'Some parrotfish sleep inside a see-through bubble of mucus, which may hide their scent from predators.',
    ],
    quiz: {
      q: 'What does a parrotfish help create on tropical beaches?',
      options: ['White sand', 'Seashells', 'Seaweed', 'Pebbles'],
      why: 'Parrotfish grind coral into powder and poop it out as sand.',
    },
    draw(ctx, t, s) {
      const H = s * 0.42;
      ctx.fillStyle = '#ff7ab4';
      ctx.beginPath();
      ctx.moveTo(s * 0.22, -H * 0.42);
      ctx.quadraticCurveTo(0, -H * 0.8, -s * 0.3, -H * 0.35);
      ctx.closePath(); ctx.fill();
      fishShape(ctx, t, s, H, '#22b8a7', '#ff7ab4', 6);
      ctx.strokeStyle = 'rgba(0,60,60,0.25)'; ctx.lineWidth = s * 0.012;
      for (let i = 0; i < 5; i++) {
        for (let j = -1; j <= 1; j++) {
          ctx.beginPath();
          ctx.arc(-s * 0.2 + i * s * 0.08, j * H * 0.22, s * 0.04, -1.2, 1.2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#ff9cc6';
      ellipse(ctx, s * 0.26, H * 0.05, s * 0.07, H * 0.12, 0.4); ctx.fill();
      ctx.fillStyle = '#eafffb';
      ellipse(ctx, s * 0.41, H * 0.06, s * 0.05, H * 0.12); ctx.fill();
      ctx.strokeStyle = '#7fbfb5'; ctx.lineWidth = s * 0.01;
      ctx.beginPath(); ctx.moveTo(s * 0.37, H * 0.06); ctx.lineTo(s * 0.46, H * 0.06); ctx.stroke();
      eye(ctx, s * 0.29, -H * 0.12, s * 0.04);
    },
  },
  {
    id: 'hermitcrab', name: 'Hermit Crab', sci: 'Superfamily Paguroidea', zone: 'sunlit',
    lives: 'Shallow seafloors and reefs', size: 50, behavior: 'bottom', roam: 120, speed: 16,
    home: { x: [2150, 2150] }, floor: 0.2, frame: { w: 0.8, h: 0.6, cx: 0.02, cy: -0.02 },
    facts: [
      'A hermit crab has a soft, curly tail end, so it borrows an empty snail shell to protect itself.',
      'When it outgrows its shell it moves into a bigger one. Sometimes crabs line up by size and swap shells in a chain!',
      'Crabs are a favorite octopus snack, so this one is keeping a close eye on you.',
    ],
    quiz: {
      q: 'Why does a hermit crab move into new shells?',
      options: ['It outgrows its old one', 'Its shell dissolves every week', 'To show off its colors', 'Shells help it breathe'],
      why: 'Hermit crabs keep growing, so they need bigger and bigger borrowed shells.',
    },
    draw(ctx, t, s) {
      ctx.strokeStyle = '#d9573b'; ctx.lineWidth = s * 0.04; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const x = s * (0.04 + i * 0.07);
        const w = Math.sin(t * 8 + i * 2) * s * 0.03;
        ctx.beginPath(); ctx.moveTo(x, s * 0.04); ctx.lineTo(x + s * 0.06 + w, s * 0.12); ctx.lineTo(x + s * 0.08 + w, s * 0.2); ctx.stroke();
      }
      ctx.fillStyle = '#c9a46b';
      ellipse(ctx, -s * 0.1, -s * 0.04, s * 0.28, s * 0.22, -0.2); ctx.fill();
      ctx.strokeStyle = '#8f6c3a'; ctx.lineWidth = s * 0.025;
      ctx.beginPath();
      for (let a = 0; a < TAU * 2.2; a += 0.2) {
        const r = s * 0.2 * (1 - a / (TAU * 2.4));
        ctx.lineTo(-s * 0.12 + Math.cos(a) * r, -s * 0.05 + Math.sin(a) * r * 0.8);
      }
      ctx.stroke();
      ctx.fillStyle = '#e06a45';
      ellipse(ctx, s * 0.17, 0, s * 0.1, s * 0.08); ctx.fill();
      ctx.fillStyle = '#d9573b';
      ellipse(ctx, s * 0.31, s * 0.05, s * 0.09, s * 0.06, -0.3); ctx.fill();
      ctx.strokeStyle = '#e06a45'; ctx.lineWidth = s * 0.02;
      for (const dx of [0, 0.05]) {
        ctx.beginPath(); ctx.moveTo(s * (0.2 + dx), -s * 0.04); ctx.lineTo(s * (0.23 + dx), -s * 0.18); ctx.stroke();
        ctx.fillStyle = '#111'; ellipse(ctx, s * (0.23 + dx), -s * 0.19, s * 0.022, s * 0.022); ctx.fill();
      }
    },
  },
  {
    id: 'turtle', name: 'Green Sea Turtle', sci: 'Chelonia mydas', zone: 'sunlit',
    lives: 'Warm coasts and seagrass meadows', size: 115, behavior: 'swim', speed: 55,
    home: { x: [400, 4500], y: [150, 700] }, frame: { w: 0.98, h: 0.6, cx: 0.03, cy: 0.0 },
    facts: [
      'Adult green sea turtles are vegetarians that graze on seagrass and algae. Their name comes from the greenish color of their fat.',
      'Females swim thousands of kilometers back to the very beach where they hatched to lay their eggs.',
      'The temperature of the sand decides whether a hatchling is male or female. Warmer nests make more females.',
    ],
    quiz: {
      q: 'What decides whether a sea turtle hatchling is male or female?',
      options: ['The temperature of the sand', 'The phase of the moon', 'How deep the eggs are buried', 'Which parent laid the egg'],
      why: 'Warmer sand produces more females and cooler sand produces more males.',
    },
    draw(ctx, t, s) {
      const f = Math.sin(t * 2.2);
      ctx.fillStyle = '#5c7741';
      limb(ctx, s * 0.16, -s * 0.06, 0.4 + f * 0.4, s * 0.06, s * 0.22);
      limb(ctx, -s * 0.24, -s * 0.04, 0.3 + f * 0.15, s * 0.04, s * 0.11);
      ctx.fillStyle = '#89a964';
      ellipse(ctx, s * 0.31, 0, s * 0.08, s * 0.06); ctx.fill();
      ellipse(ctx, s * 0.41, -s * 0.02, s * 0.1, s * 0.075); ctx.fill();
      ctx.fillStyle = '#6a5430';
      ellipse(ctx, 0, -s * 0.02, s * 0.34, s * 0.2); ctx.fill();
      ctx.fillStyle = '#d8c58a';
      ctx.beginPath(); ctx.ellipse(0, s * 0.06, s * 0.3, s * 0.06, 0, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = '#a68a52'; ctx.lineWidth = s * 0.012;
      for (const [x, y, rx, ry] of [[0, -0.09, 0.09, 0.07], [-0.17, -0.04, 0.08, 0.07], [0.17, -0.04, 0.08, 0.07], [-0.08, 0.04, 0.07, 0.04], [0.08, 0.04, 0.07, 0.04]]) {
        ellipse(ctx, x * s, y * s, rx * s, ry * s); ctx.stroke();
      }
      ctx.fillStyle = '#89a964';
      limb(ctx, s * 0.14, s * 0.06, -0.5 + f * 0.5, s * 0.065, s * 0.24);
      limb(ctx, -s * 0.24, s * 0.06, -0.4 - f * 0.15, s * 0.045, s * 0.12);
      eye(ctx, s * 0.45, -s * 0.04, s * 0.02);
    },
  },
  {
    id: 'moonjelly', name: 'Moon Jellyfish', sci: 'Aurelia aurita', zone: 'sunlit',
    lives: 'Coastal waters worldwide', size: 70, behavior: 'drift', speed: 14, noFlip: true,
    home: { x: [2800, 4200], y: [300, 1300] }, frame: { w: 1.1, h: 1.05, cx: 0, cy: 0.3 },
    facts: [
      'Moon jellies have no brain, no heart, no bones and no blood.',
      'Their bodies are more than 95% water.',
      'The four rings you can see through the top of the bell are its reproductive organs.',
      'Leatherback sea turtles feast on jellies. Floating plastic bags look like jellies, which is one reason ocean trash is so dangerous.',
    ],
    quiz: {
      q: 'Which of these does a moon jellyfish NOT have?',
      options: ['A brain', 'Tentacles', 'A bell-shaped body', 'A mouth'],
      why: 'Jellyfish get by with a simple net of nerves instead of a brain.',
    },
    draw(ctx, t, s) {
      const p = Math.sin(t * 2.4);
      const bw = 0.5 * s * (1 + p * 0.06), bh = 0.3 * s * (1 - p * 0.08);
      ctx.strokeStyle = 'rgba(225,238,255,0.5)'; ctx.lineWidth = Math.max(1, s * 0.015);
      for (let i = 0; i < 14; i++) {
        const x0 = -bw * 0.95 + i * (bw * 1.9 / 13);
        ctx.beginPath(); ctx.moveTo(x0, 0);
        for (let k = 1; k <= 10; k++) ctx.lineTo(x0 + Math.sin(t * 2 + k * 0.6 + i) * 0.04 * s * (k / 10), k * 0.06 * s);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,190,225,0.55)'; ctx.lineWidth = s * 0.035;
      for (const x0 of [-0.12, -0.04, 0.04, 0.12]) {
        ctx.beginPath(); ctx.moveTo(x0 * s, 0);
        for (let k = 1; k <= 8; k++) ctx.lineTo(x0 * s * (1 + k * 0.1) + Math.sin(t * 1.6 + k + x0 * 20) * 0.03 * s, k * 0.05 * s);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(205,228,255,0.42)';
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(1, s * 0.015);
      ctx.beginPath();
      ctx.ellipse(0, 0, bw, bh, 0, Math.PI, TAU);
      ctx.quadraticCurveTo(0, bh * 0.3, -bw, 0);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(215,135,230,0.85)'; ctx.lineWidth = s * 0.022;
      for (const x of [-0.18, -0.06, 0.06, 0.18]) { ellipse(ctx, x * s, -bh * 0.4, s * 0.045, s * 0.045); ctx.stroke(); }
    },
  },
  {
    id: 'dolphin', name: 'Bottlenose Dolphin', sci: 'Tursiops truncatus', zone: 'sunlit',
    lives: 'Warm coasts and open ocean', size: 175, behavior: 'swim', speed: 150,
    home: { x: [1500, 5800], y: [40, 450] }, frame: { w: 1.05, h: 0.45, cx: -0.01, cy: -0.05 },
    facts: [
      'Dolphins are mammals, not fish. They breathe air through a blowhole on top of their head.',
      'They “see” with sound using echolocation: they send out clicks and listen for the echoes.',
      'Dolphins rest one half of their brain at a time, so they can keep swimming up to breathe.',
      'Each dolphin has its own “signature whistle”, a bit like a name.',
    ],
    quiz: {
      q: 'How does a dolphin find things using sound?',
      options: ['Echolocation', 'Photosynthesis', 'Bioluminescence', 'Hibernation'],
      why: 'Dolphins send out clicks and listen to the echoes that bounce back.',
    },
    draw(ctx, t, s) {
      const k = Math.sin(t * 4) * s * 0.035;
      poly(ctx, [-s * 0.41, 0, -s * 0.53, -s * 0.08 + k, -s * 0.48, k, -s * 0.53, s * 0.08 + k], '#6f8090');
      poly(ctx, [0, -s * 0.14, -s * 0.13, -s * 0.13, -s * 0.11, -s * 0.27], '#6f8090');
      ctx.fillStyle = '#7d8e9e';
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.03);
      ctx.quadraticCurveTo(s * 0.42, -s * 0.03, s * 0.33, -s * 0.05);
      ctx.quadraticCurveTo(s * 0.26, -s * 0.16, s * 0.05, -s * 0.15);
      ctx.quadraticCurveTo(-s * 0.25, -s * 0.12, -s * 0.42, -s * 0.02 + k * 0.6);
      ctx.lineTo(-s * 0.42, s * 0.02 + k * 0.6);
      ctx.quadraticCurveTo(-s * 0.2, s * 0.12, s * 0.1, s * 0.12);
      ctx.quadraticCurveTo(s * 0.35, s * 0.1, s * 0.5, s * 0.03);
      ctx.fill();
      ctx.fillStyle = '#cdd6de';
      ellipse(ctx, s * 0.12, s * 0.085, s * 0.28, s * 0.035); ctx.fill();
      poly(ctx, [s * 0.18, s * 0.08, s * 0.08, s * 0.1, s * 0.03, s * 0.2], '#6f8090');
      ctx.strokeStyle = 'rgba(40,50,60,0.5)'; ctx.lineWidth = s * 0.008;
      ctx.beginPath(); ctx.moveTo(s * 0.48, s * 0.035); ctx.quadraticCurveTo(s * 0.4, s * 0.05, s * 0.35, s * 0.03); ctx.stroke();
      ctx.fillStyle = '#111';
      ellipse(ctx, s * 0.31, -s * 0.03, s * 0.014, s * 0.014); ctx.fill();
    },
  },

  // ---------------- Twilight Zone ----------------
  {
    id: 'lanternfish', name: 'Lanternfish', sci: 'Family Myctophidae', zone: 'twilight',
    lives: 'Open ocean, 300–1,500 m by day', size: 36, behavior: 'swim', speed: 70,
    home: { x: [3800, 5800], y: [1700, 2600] }, frame: { w: 1.05, h: 0.55, cx: -0.08, cy: 0 },
    facts: [
      'Lanternfish glow with rows of tiny light organs called photophores.',
      'They are among the most common fish on Earth. There may be trillions of them!',
      'Every night they swim hundreds of meters up toward the surface to feed, then sink back into darkness by dawn. It’s the biggest daily migration on the planet.',
    ],
    quiz: {
      q: 'What do lanternfish do every night?',
      options: ['Swim up toward the surface to feed', 'Bury themselves in the sand', 'Sleep in coral caves', 'Turn off their lights and float'],
      why: 'Lanternfish rise toward the surface at night to eat plankton, then sink back down by dawn.',
    },
    draw(ctx, t, s) {
      const H = s * 0.3;
      fishShape(ctx, t, s, H, '#33475b', '#2a3b4c', 12);
      ctx.fillStyle = '#4c6580';
      ellipse(ctx, 0, -H * 0.15, s * 0.36, H * 0.18); ctx.fill();
      ctx.fillStyle = '#a8ecff';
      for (let i = 0; i < 6; i++) { ellipse(ctx, -s * 0.24 + i * s * 0.09, H * 0.3, s * 0.022, s * 0.022); ctx.fill(); }
      eye(ctx, s * 0.27, -H * 0.05, s * 0.075, '#0c1a26');
    },
    glow(ctx, t, s) {
      const H = s * 0.3;
      for (let i = 0; i < 6; i++) glowDot(ctx, -s * 0.24 + i * s * 0.09, H * 0.3, s * 0.12, '110,225,255', 0.85);
      glowDot(ctx, s * 0.36, H * 0.1, s * 0.12, '150,240,255', 0.7 + 0.3 * Math.sin(t * 3));
    },
  },
  {
    id: 'hatchetfish', name: 'Marine Hatchetfish', sci: 'Family Sternoptychidae', zone: 'twilight',
    lives: 'Open ocean, 200–1,500 m', size: 44, behavior: 'swim', speed: 45,
    home: { x: [3700, 5800], y: [2200, 3300] }, frame: { w: 0.9, h: 0.75, cx: -0.07, cy: 0.02 },
    facts: [
      'Its thin, silvery body is shaped like the blade of a hatchet.',
      'Light organs on its belly glow to match the faint light from above. This erases its shadow so predators below can’t spot it. That’s called counter-illumination.',
      'Big tube-shaped eyes point upward, watching for the shadows of prey.',
    ],
    quiz: {
      q: 'Why does a hatchetfish’s belly glow?',
      options: ['To hide its shadow from predators below', 'To keep warm', 'To attract a mate from far away', 'To scare off sharks'],
      why: 'Glowing to match the light from above makes its silhouette disappear. That’s counter-illumination.',
    },
    draw(ctx, t, s) {
      const w = Math.sin(t * 10) * s * 0.03;
      poly(ctx, [-s * 0.3, -s * 0.03, -s * 0.48, -s * 0.15 + w, -s * 0.48, s * 0.1 + w], '#9fb3c6');
      const g = ctx.createLinearGradient(0, -s * 0.3, 0, s * 0.35);
      g.addColorStop(0, '#596b80'); g.addColorStop(0.5, '#dde7f0'); g.addColorStop(1, '#9fb3c6');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(s * 0.32, -s * 0.12); ctx.lineTo(s * 0.12, -s * 0.28); ctx.lineTo(-s * 0.12, -s * 0.18);
      ctx.lineTo(-s * 0.32, -s * 0.05); ctx.lineTo(-s * 0.32, s * 0.02); ctx.lineTo(-s * 0.05, s * 0.32);
      ctx.lineTo(s * 0.22, s * 0.3); ctx.lineTo(s * 0.34, s * 0.02);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(80,100,120,0.5)'; ctx.lineWidth = s * 0.015;
      ctx.beginPath(); ctx.moveTo(s * 0.22, s * 0.0); ctx.lineTo(-s * 0.2, s * 0.05); ctx.stroke();
      ctx.fillStyle = '#c9f3ff';
      for (let i = 0; i < 5; i++) { ellipse(ctx, -s * 0.02 + i * s * 0.055, s * 0.29, s * 0.02, s * 0.02); ctx.fill(); }
      eye(ctx, s * 0.2, -s * 0.13, s * 0.075, '#0b1622');
    },
    glow(ctx, t, s) {
      for (let i = 0; i < 5; i++) glowDot(ctx, -s * 0.02 + i * s * 0.055, s * 0.3, s * 0.12, '140,230,255', 0.75);
    },
  },
  {
    id: 'swordfish', name: 'Swordfish', sci: 'Xiphias gladius', zone: 'twilight',
    lives: 'Open ocean, surface to 600 m+', size: 210, behavior: 'swim', speed: 125,
    home: { x: [3400, 5800], y: [1600, 2400] }, frame: { w: 1.12, h: 0.45, cx: 0.08, cy: -0.04 },
    facts: [
      'A swordfish slashes its flat, sword-like bill side to side to stun prey. It doesn’t stab.',
      'A special organ heats its eyes and brain, helping it see clearly in cold, dark water.',
      'Swordfish dive from the warm surface into the chilly twilight zone every day to hunt.',
    ],
    quiz: {
      q: 'What trick helps swordfish see in cold, deep water?',
      options: ['They heat their eyes and brain', 'They glow like a flashlight', 'They close one eye at a time', 'They use their sword as an antenna'],
      why: 'A heater organ near the eyes keeps them warm, so swordfish see sharply in cold water.',
    },
    draw(ctx, t, s) {
      poly(ctx, [s * 0.12, -s * 0.07, 0, -s * 0.07, -s * 0.02, -s * 0.24], '#253a52');
      fishShape(ctx, t, s * 0.8, s * 0.18, '#33506e', '#253a52', 5);
      poly(ctx, [s * 0.3, -s * 0.03, s * 0.62, 0, s * 0.3, s * 0.03], '#2d4560');
      ctx.fillStyle = '#9fb6c9';
      ellipse(ctx, 0, s * 0.045, s * 0.28, s * 0.03); ctx.fill();
      poly(ctx, [s * 0.15, s * 0.05, s * 0.06, s * 0.06, 0, s * 0.14], '#253a52');
      eye(ctx, s * 0.25, -s * 0.02, s * 0.022);
    },
  },
  {
    id: 'giantsquid', name: 'Giant Squid', sci: 'Architeuthis dux', zone: 'twilight',
    lives: 'Deep open ocean, 300–1,000 m', size: 300, behavior: 'swim', speed: 45,
    home: { x: [4000, 5800], y: [2700, 3450] }, frame: { w: 1.08, h: 0.35, cx: 0.0, cy: 0.0 },
    facts: [
      'Giant squid have eyes as big as dinner plates, among the largest eyes in the animal kingdom.',
      'They can grow up to about 12 meters long, counting their two long feeding tentacles.',
      'Nobody filmed a live giant squid in the deep sea until 2012!',
      'Like octopuses, squid have three hearts and blue blood.',
    ],
    quiz: {
      q: 'What is special about a giant squid’s eyes?',
      options: ['They are among the largest of any animal', 'They can see through rocks', 'It has eight of them', 'They glow bright green'],
      why: 'Giant squid eyes can be as wide as a dinner plate, great for spotting faint glows in the dark.',
    },
    draw(ctx, t, s) {
      const col = '#b4463c';
      for (let i = 0; i < 8; i++) {
        const y = (i - 3.5) * 0.012 * s;
        tendril(ctx, -s * 0.02, y, s * 0.32, Math.PI + (i - 3.5) * 0.06, s * 0.022, s * 0.004, t + i, 2.5, 0.35, col, 10);
      }
      for (const side of [-1, 1]) {
        const [x, y] = tendril(ctx, -s * 0.02, side * s * 0.01, s * 0.5, Math.PI + side * 0.04, s * 0.01, s * 0.005, t + side * 2, 2, 0.25, col, 14);
        ctx.fillStyle = col; ellipse(ctx, x, y, s * 0.03, s * 0.012); ctx.fill();
      }
      ctx.fillStyle = col;
      ellipse(ctx, s * 0.03, 0, s * 0.07, s * 0.055); ctx.fill();
      ctx.fillStyle = '#c4554a';
      ctx.beginPath();
      ctx.moveTo(s * 0.07, -s * 0.06);
      ctx.quadraticCurveTo(s * 0.35, -s * 0.07, s * 0.53, 0);
      ctx.quadraticCurveTo(s * 0.35, s * 0.07, s * 0.07, s * 0.06);
      ctx.closePath(); ctx.fill();
      poly(ctx, [s * 0.38, -s * 0.03, s * 0.53, 0, s * 0.44, -s * 0.11], '#a63c33');
      poly(ctx, [s * 0.38, s * 0.03, s * 0.53, 0, s * 0.44, s * 0.11], '#a63c33');
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ellipse(ctx, s * 0.25, -s * 0.02, s * 0.14, s * 0.015); ctx.fill();
      eye(ctx, s * 0.035, -s * 0.005, s * 0.032, '#1a2a3a');
    },
  },

  // ---------------- Midnight Zone ----------------
  {
    id: 'spermwhale', name: 'Sperm Whale', sci: 'Physeter macrocephalus', zone: 'midnight',
    lives: 'Deep oceans worldwide, dives to 2,000 m+', size: 380, behavior: 'swim', speed: 65,
    home: { x: [3800, 5800], y: [3400, 4300] }, frame: { w: 1.1, h: 0.36, cx: -0.03, cy: 0.0 },
    facts: [
      'Sperm whales have the largest brain of any animal on Earth.',
      'They can dive deeper than 2,000 meters and hold their breath for more than an hour.',
      'They hunt squid in total darkness using echolocation clicks, some of the loudest sounds made by any animal.',
      'Being a mammal, it must swim all the way back up to the surface to breathe.',
    ],
    quiz: {
      q: 'Which animal has the largest brain on Earth?',
      options: ['Sperm whale', 'Blue whale', 'African elephant', 'Human'],
      why: 'A sperm whale’s brain can weigh about 8 kg, more than five times as much as a human brain.',
    },
    draw(ctx, t, s) {
      const k = Math.sin(t * 1.5) * 0.03 * s;
      poly(ctx, [-s * 0.42, s * 0.02, -s * 0.55, -s * 0.06 + k, -s * 0.5, s * 0.03 + k, -s * 0.56, s * 0.1 + k], '#3f4a55');
      ctx.fillStyle = '#4d5965';
      ctx.beginPath();
      ctx.moveTo(s * 0.5, -s * 0.1);
      ctx.quadraticCurveTo(s * 0.53, s * 0.02, s * 0.47, s * 0.1);
      ctx.lineTo(s * 0.15, s * 0.13);
      ctx.quadraticCurveTo(-s * 0.1, s * 0.14, -s * 0.43, s * 0.03 + k * 0.5);
      ctx.lineTo(-s * 0.43, k * 0.5);
      ctx.quadraticCurveTo(-s * 0.2, -s * 0.08, 0, -s * 0.12);
      ctx.quadraticCurveTo(s * 0.3, -s * 0.14, s * 0.5, -s * 0.1);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = s * 0.006;
      for (let i = 0; i < 9; i++) {
        const x = -s * 0.3 + i * s * 0.05;
        ctx.beginPath(); ctx.moveTo(x, -s * 0.06); ctx.quadraticCurveTo(x + s * 0.02, 0, x, s * 0.06); ctx.stroke();
      }
      ctx.fillStyle = '#c9cfd4';
      ctx.beginPath(); ctx.moveTo(s * 0.43, s * 0.105); ctx.lineTo(s * 0.12, s * 0.125); ctx.lineTo(s * 0.12, s * 0.14); ctx.lineTo(s * 0.42, s * 0.115); ctx.fill();
      poly(ctx, [s * 0.1, s * 0.12, s * 0.02, s * 0.13, s * 0.0, s * 0.21], '#3f4a55');
      ctx.fillStyle = '#111';
      ellipse(ctx, s * 0.12, s * 0.07, s * 0.012, s * 0.009); ctx.fill();
    },
  },
  {
    id: 'vampiresquid', name: 'Vampire Squid', sci: 'Vampyroteuthis infernalis', zone: 'midnight',
    lives: 'Deep ocean, 600–1,200 m', size: 90, behavior: 'drift', speed: 18,
    home: { x: [3800, 5600], y: [3700, 4400] }, frame: { w: 0.85, h: 0.6, cx: -0.04, cy: 0 },
    facts: [
      'Despite its spooky name, the vampire squid doesn’t drink blood. It eats “marine snow”, bits of dead plankton drifting down from above.',
      'It isn’t a true squid or an octopus. It’s the only living member of its own group.',
      'When threatened, it flips its webbed arms over its body like a cape, and can release a cloud of glowing mucus instead of ink.',
      'It lives where there’s barely any oxygen, so few predators can follow it there.',
    ],
    quiz: {
      q: 'What does the vampire squid actually eat?',
      options: ['Marine snow', 'Blood', 'Sharks', 'Coral'],
      why: 'It collects “marine snow”, the falling bits of dead plankton and other debris, with sticky filaments.',
    },
    draw(ctx, t, s) {
      const f = Math.sin(t * 2);
      ctx.fillStyle = '#4a1626';
      ctx.beginPath();
      ctx.moveTo(s * 0.02, -s * 0.1);
      ctx.quadraticCurveTo(-s * 0.2, -s * 0.22 - f * 0.04 * s, -s * 0.42, -s * 0.12);
      ctx.quadraticCurveTo(-s * 0.36, 0, -s * 0.42, s * 0.12);
      ctx.quadraticCurveTo(-s * 0.2, s * 0.22 + f * 0.04 * s, s * 0.02, s * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2e0c17'; ctx.lineWidth = s * 0.012;
      for (const [x, y] of [[-0.42, -0.12], [-0.38, -0.06], [-0.37, 0], [-0.38, 0.06], [-0.42, 0.12]]) {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x * s, y * s); ctx.stroke();
      }
      ctx.fillStyle = '#6b2233';
      ellipse(ctx, s * 0.15, 0, s * 0.2, s * 0.13); ctx.fill();
      ctx.fillStyle = '#7d2b3e';
      ellipse(ctx, s * 0.27, -s * 0.12, s * 0.08, s * 0.035, -0.6 + f * 0.3); ctx.fill();
      ellipse(ctx, s * 0.27, s * 0.12, s * 0.08, s * 0.035, 0.6 - f * 0.3); ctx.fill();
      eye(ctx, s * 0.06, -s * 0.02, s * 0.05, '#2f86c9');
    },
    glow(ctx, t, s) {
      const a = 0.6 + 0.4 * Math.sin(t * 2.5);
      for (const [x, y] of [[-0.42, -0.12], [-0.38, -0.06], [-0.37, 0], [-0.38, 0.06], [-0.42, 0.12]]) {
        glowDot(ctx, x * s, y * s, s * 0.08, '90,170,255', a);
      }
      glowDot(ctx, s * 0.24, -s * 0.09, s * 0.06, '120,200,255', 0.6);
      glowDot(ctx, s * 0.24, s * 0.09, s * 0.06, '120,200,255', 0.6);
    },
  },
  {
    id: 'anglerfish', name: 'Deep-Sea Anglerfish', sci: 'Melanocetus johnsonii', zone: 'midnight',
    lives: 'Deep ocean, 1,000–4,000 m', size: 72, behavior: 'swim', speed: 22,
    home: { x: [4200, 5600], y: [4500, 5600] }, frame: { w: 0.95, h: 0.85, cx: -0.04, cy: -0.08 },
    facts: [
      'A female anglerfish has a fishing-rod spine on her head with a glowing lure on the end. Prey swim right up to it!',
      'The glow comes from millions of bioluminescent bacteria living inside the lure.',
      'In some species, tiny males bite onto a female and fuse to her body for life.',
      'Its stretchy stomach lets it swallow prey up to twice its own size.',
    ],
    quiz: {
      q: 'What makes an anglerfish’s lure glow?',
      options: ['Bioluminescent bacteria', 'A tiny battery', 'Reflected moonlight', 'Hot lava from vents'],
      why: 'Glowing bacteria live inside the lure, and the anglerfish gives them a home and food.',
    },
    draw(ctx, t, s) {
      const w = Math.sin(t * 4) * s * 0.04;
      poly(ctx, [-s * 0.3, 0, -s * 0.48, -s * 0.15 + w, -s * 0.48, s * 0.15 + w], '#3a2e3e');
      ctx.fillStyle = '#2e2433';
      ellipse(ctx, 0, 0, s * 0.34, s * 0.3); ctx.fill();
      ctx.fillStyle = '#130c15';
      ctx.beginPath(); ctx.moveTo(s * 0.34, -s * 0.1); ctx.lineTo(s * 0.04, s * 0.05); ctx.lineTo(s * 0.3, s * 0.21); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 5; i++) {
        const u = i / 4;
        const x1 = s * (0.32 - u * 0.22), y1 = s * (-0.09 + u * 0.1);
        poly(ctx, [x1 - s * 0.015, y1, x1 + s * 0.015, y1, x1, y1 + s * 0.06], '#f2efe6');
        const x2 = s * (0.29 - u * 0.2), y2 = s * (0.2 - u * 0.12);
        poly(ctx, [x2 - s * 0.015, y2, x2 + s * 0.015, y2, x2, y2 - s * 0.055], '#f2efe6');
      }
      ctx.strokeStyle = '#4a3a50'; ctx.lineWidth = s * 0.02; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s * 0.04, -s * 0.28); ctx.quadraticCurveTo(s * 0.2, -s * 0.62, s * 0.4, -s * 0.4); ctx.stroke();
      ctx.fillStyle = '#d8fff2';
      ellipse(ctx, s * 0.4, -s * 0.38, s * 0.04, s * 0.04); ctx.fill();
      poly(ctx, [-s * 0.05, s * 0.1, -s * 0.15, s * 0.12, -s * 0.12, s * 0.25], '#3a2e3e');
      eye(ctx, s * 0.12, -s * 0.13, s * 0.03, '#1e2a20');
    },
    glow(ctx, t, s) {
      const a = 0.75 + 0.25 * Math.sin(t * 5) * Math.sin(t * 1.3);
      glowDot(ctx, s * 0.4, -s * 0.38, s * 0.4, '120,255,215', a * 0.6);
      glowDot(ctx, s * 0.4, -s * 0.38, s * 0.1, '220,255,240', a);
    },
  },
  {
    id: 'gulpereel', name: 'Gulper Eel', sci: 'Eurypharynx pelecanoides', zone: 'midnight',
    lives: 'Deep ocean, 500–3,000 m', size: 190, behavior: 'swim', speed: 40,
    home: { x: [3800, 5800], y: [4600, 5600] }, frame: { w: 1.1, h: 0.45, cx: -0.1, cy: 0.02 },
    facts: [
      'The gulper eel’s loosely hinged mouth is much bigger than the rest of its body. It’s also called the pelican eel.',
      'The tip of its whip-like tail has a light organ that glows pink and may lure in prey.',
      'Even with that giant mouth, it mostly eats small shrimp and other crustaceans.',
    ],
    quiz: {
      q: 'What is the gulper eel’s other nickname?',
      options: ['Pelican eel', 'Vacuum eel', 'Balloon fish', 'Shovel snake'],
      why: 'Its huge, pouch-like mouth looks like a pelican’s beak.',
    },
    draw(ctx, t, s) {
      let x = s * 0.04, y = 0;
      ctx.strokeStyle = '#2b2433'; ctx.lineCap = 'round';
      for (let k = 1; k <= 30; k++) {
        const u = k / 30;
        const nx = s * 0.04 - u * s * 0.62;
        const ny = Math.sin(t * 3 - u * 8) * 0.05 * s * u;
        ctx.lineWidth = Math.max(1, s * 0.03 * (1 - u));
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        x = nx; y = ny;
      }
      ctx.fillStyle = '#ff8fb8';
      ellipse(ctx, x, y, s * 0.012, s * 0.012); ctx.fill();
      const m = Math.sin(t * 1.2) * 0.02 * s;
      ctx.fillStyle = '#2b2433';
      ctx.beginPath(); ctx.moveTo(s * 0.02, -s * 0.03); ctx.lineTo(s * 0.42, -s * 0.14 - m);
      ctx.quadraticCurveTo(s * 0.3, s * 0.02, s * 0.42, s * 0.12 + m);
      ctx.quadraticCurveTo(s * 0.2, s * 0.24, s * 0.02, s * 0.03);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0d0a10';
      ctx.beginPath(); ctx.moveTo(s * 0.07, -s * 0.02); ctx.lineTo(s * 0.38, -s * 0.11 - m);
      ctx.quadraticCurveTo(s * 0.28, s * 0.01, s * 0.38, s * 0.09 + m);
      ctx.quadraticCurveTo(s * 0.2, s * 0.18, s * 0.07, s * 0.02);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a3245';
      ellipse(ctx, s * 0.03, 0, s * 0.045, s * 0.04); ctx.fill();
      eye(ctx, s * 0.05, -s * 0.03, s * 0.012);
    },
    glow(ctx, t, s) {
      const u = 1;
      const x = s * 0.04 - u * s * 0.62;
      const y = Math.sin(t * 3 - 8) * 0.05 * s;
      glowDot(ctx, x, y, s * 0.12, '255,110,170', 0.7 + 0.3 * Math.sin(t * 4));
    },
  },
  {
    id: 'dumbo', name: 'Dumbo Octopus', sci: 'Genus Grimpoteuthis', zone: 'midnight',
    lives: 'Deep seafloor, 1,000–7,000 m', size: 64, behavior: 'drift', speed: 16, noFlip: true,
    home: { x: [4000, 5800], y: [5800, 6080] }, frame: { w: 0.9, h: 0.75, cx: 0, cy: -0.03 },
    facts: [
      'Named after Disney’s flying elephant, it flaps two ear-like fins to swim. A cousin of yours!',
      'It’s the deepest-living octopus known. One was filmed nearly 7,000 meters down.',
      'Unlike most octopuses, it swallows its prey whole.',
    ],
    quiz: {
      q: 'How does a dumbo octopus swim?',
      options: ['By flapping ear-like fins', 'By spinning its arms like a propeller', 'By squirting ink', 'It can’t swim — it only crawls'],
      why: 'Dumbo octopuses flap the two fins on their head, like ears, to glide through the deep.',
    },
    draw(ctx, t, s) {
      const f = Math.sin(t * 3);
      ctx.fillStyle = '#e894a6';
      ctx.beginPath(); ctx.moveTo(-s * 0.22, 0);
      for (let i = 0; i <= 8; i++) {
        const x = -s * 0.3 + i * s * 0.075;
        const y = s * (0.2 + (i % 2 ? 0.04 : 0)) + Math.sin(t * 2 + i) * 0.025 * s;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(s * 0.22, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f0a8b8';
      ellipse(ctx, -s * 0.22, -s * 0.18, s * 0.11, s * 0.05, -0.5 + f * 0.45); ctx.fill();
      ellipse(ctx, s * 0.22, -s * 0.18, s * 0.11, s * 0.05, 0.5 - f * 0.45); ctx.fill();
      ctx.fillStyle = '#f6bac6';
      ellipse(ctx, 0, -s * 0.08, s * 0.24, s * 0.2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ellipse(ctx, -s * 0.07, -s * 0.18, s * 0.07, s * 0.05); ctx.fill();
      for (const ex of [-0.09, 0.09]) {
        ctx.fillStyle = '#2a1a22'; ellipse(ctx, ex * s, -s * 0.02, s * 0.035, s * 0.04); ctx.fill();
        ctx.fillStyle = '#fff'; ellipse(ctx, ex * s + s * 0.01, -s * 0.035, s * 0.01, s * 0.01); ctx.fill();
      }
    },
  },
  {
    id: 'isopod', name: 'Giant Isopod', sci: 'Bathynomus giganteus', zone: 'midnight',
    lives: 'Deep seafloor, 170–2,500 m', size: 70, behavior: 'bottom', roam: 220, speed: 10,
    home: { x: [4650, 4650] }, floor: 0.14, frame: { w: 1.0, h: 0.45, cx: 0.06, cy: 0.0 },
    facts: [
      'Giant isopods are relatives of the roly-poly pill bugs you find in gardens, but they can grow up to about 40 cm long!',
      'They are scavengers that feast on dead whales and fish that sink to the seafloor.',
      'Food is scarce down here, so they can go a very long time without eating. One in an aquarium in Japan didn’t eat for over five years!',
    ],
    quiz: {
      q: 'Giant isopods are related to which garden critter?',
      options: ['Pill bugs (roly-polies)', 'Earthworms', 'Snails', 'Ladybugs'],
      why: 'Giant isopods and pill bugs are both isopods, a type of crustacean.',
    },
    draw(ctx, t, s) {
      ctx.strokeStyle = '#8f7fa0'; ctx.lineWidth = s * 0.018; ctx.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const x = -s * 0.26 + i * s * 0.08;
        ctx.beginPath(); ctx.moveTo(x, s * 0.03); ctx.lineTo(x + Math.sin(t * 6 + i) * s * 0.02, s * 0.14); ctx.stroke();
      }
      ctx.lineWidth = s * 0.012;
      for (const d of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(s * 0.36, -s * 0.02);
        ctx.quadraticCurveTo(s * 0.48, -s * 0.12 + d * s * 0.03, s * 0.56, -s * 0.06 + d * s * 0.04 + Math.sin(t * 2 + d) * s * 0.02);
        ctx.stroke();
      }
      ctx.fillStyle = '#c3b4cf';
      ctx.beginPath(); ctx.ellipse(0, s * 0.05, s * 0.38, s * 0.2, 0, Math.PI, TAU); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ad9dbd';
      ctx.beginPath(); ctx.ellipse(-s * 0.37, s * 0.04, s * 0.06, s * 0.05, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(60,40,80,0.35)'; ctx.lineWidth = s * 0.012;
      for (let i = 1; i < 8; i++) {
        const x = -s * 0.32 + i * s * 0.08;
        ctx.beginPath(); ctx.moveTo(x, s * 0.05); ctx.quadraticCurveTo(x + s * 0.02, -s * 0.07, x, -s * 0.15 * Math.sqrt(Math.max(0, 1 - (x / (s * 0.38)) ** 2)) - s * 0.0); ctx.stroke();
      }
      ctx.fillStyle = '#d4c7de';
      ellipse(ctx, s * 0.34, s * 0.0, s * 0.06, s * 0.05); ctx.fill();
      ctx.fillStyle = '#2a2230';
      ellipse(ctx, s * 0.33, -s * 0.02, s * 0.025, s * 0.02); ctx.fill();
    },
  },
];

const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((sp) => [sp.id, sp]));

// How each 3D model (models/<id>.glb) is shown: see-through parts, glowing parts, and the starting camera angle.
const MODEL_STYLE = {
  octopus: { yaw: 0.35, pitch: 0.15 },
  seastar: { pitch: 0.9 },
  dumbo: { yaw: 0.35, pitch: 0.15 },
  moonjelly: { pitch: 0.3, alpha: { Bell: 0.38, Margin: 0.6, Tentacles: 0.7, OralArms: 0.8, Gonads: 0.9 } },
  lanternfish: { glow: ['Lights'] },
  hatchetfish: { glow: ['Lights'], pitch: 0.35 },
  anglerfish: { glow: ['Lure', 'Filaments'] },
  vampiresquid: { glow: ['Lights'] },
  gulpereel: { glow: ['Light', 'Tassels'] },
};
