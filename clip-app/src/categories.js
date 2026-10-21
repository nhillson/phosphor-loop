'use strict';
// The categories a new library starts with. Each has a short description for the picture recogniser
// ("prompt": what a frame of such a video looks like, in plain words) and the words that point to it in a
// video's title, tags and description. Nick can add, rename and remove categories in the app; a new one gets
// "a video of <its name>" as its description and its own name as its only word.

const DEFAULT_CATEGORIES = [
  {
    id: 'nature', n: 'Nature',
    p: 'a video of nature: a forest, trees, flowers, plants, mountains or a landscape',
    k: ['nature', 'forest', 'tree', 'trees', 'flower', 'flowers', 'bloom', 'blooming', 'plant', 'plants', 'leaf', 'leaves',
      'moss', 'fern', 'garden', 'meadow', 'field', 'mountain', 'mountains', 'landscape', 'valley', 'jungle', 'rainforest',
      'desert', 'canyon', 'autumn', 'spring', 'grass', 'mushroom', 'fungi', 'timelapse', 'time-lapse', 'botanical', 'wildflowers'],
  },
  {
    id: 'animals', n: 'Animals',
    p: 'a video of animals: birds, insects, fish, jellyfish or wildlife',
    k: ['animal', 'animals', 'wildlife', 'bird', 'birds', 'insect', 'insects', 'butterfly', 'bee', 'fish', 'jellyfish',
      'octopus', 'whale', 'shark', 'dolphin', 'cat', 'dog', 'horse', 'deer', 'owl', 'eagle', 'snake', 'frog', 'coral',
      'zoo', 'safari', 'macro', 'murmuration', 'starlings', 'cuttlefish', 'squid', 'seahorse'],
  },
  {
    id: 'water', n: 'Water',
    p: 'a video of water: ocean waves, a river, a waterfall, rain or underwater',
    k: ['water', 'ocean', 'sea', 'wave', 'waves', 'surf', 'beach', 'river', 'stream', 'waterfall', 'lake', 'rain',
      'raindrops', 'underwater', 'droplet', 'drops', 'splash', 'ripple', 'ripples', 'ice', 'snow', 'reef', 'tide'],
  },
  {
    id: 'sky', n: 'Sky & space',
    p: 'a video of the sky or outer space: clouds, stars, the moon, planets, a galaxy or the aurora',
    k: ['sky', 'cloud', 'clouds', 'cloudscape', 'storm', 'lightning', 'thunderstorm', 'sunset', 'sunrise', 'aurora',
      'northern lights', 'space', 'nasa', 'galaxy', 'nebula', 'star', 'stars', 'milky way', 'planet', 'moon', 'earth',
      'astronomy', 'cosmos', 'universe', 'telescope', 'hubble', 'webb', 'sun', 'solar', 'eclipse', 'orbit', 'iss'],
  },
  {
    id: 'fire', n: 'Fire & light',
    p: 'a video of fire, flames, sparks, fireworks, neon or glowing lights',
    k: ['fire', 'flame', 'flames', 'campfire', 'bonfire', 'burning', 'sparks', 'sparkler', 'fireworks', 'lava', 'volcano',
      'candle', 'neon', 'laser', 'lasers', 'light', 'lights', 'glow', 'bokeh', 'light painting', 'led'],
  },
  {
    id: 'abstract', n: 'Abstract',
    p: 'an abstract video of colourful shapes, patterns, fractals, liquid colours or psychedelic visuals',
    k: ['abstract', 'fractal', 'fractals', 'mandelbrot', 'psychedelic', 'trippy', 'kaleidoscope', 'visualizer', 'visualiser',
      'vj', 'vj loop', 'loop', 'loops', 'motion graphics', 'generative', 'shader', 'shaders', 'pattern', 'patterns',
      'geometric', 'geometry', 'ink', 'paint', 'fluid', 'liquid', 'colors', 'colours', 'gradient', 'particles',
      'tunnel', 'hypnotic', 'optical illusion', 'feedback', 'oscilloscope', 'touchdesigner', 'cymatics', 'ferrofluid'],
  },
  {
    id: 'city', n: 'City & machines',
    p: 'a video of a city, buildings, streets, traffic, trains, machines or technology',
    k: ['city', 'cities', 'urban', 'street', 'streets', 'traffic', 'highway', 'building', 'buildings', 'skyline',
      'skyscraper', 'downtown', 'tokyo', 'new york', 'train', 'subway', 'car', 'cars', 'machine', 'machines', 'factory',
      'industrial', 'robot', 'technology', 'computer', 'circuit', 'engine', 'drone', 'aerial', 'night drive', 'cyberpunk'],
  },
  {
    id: 'people', n: 'People & dance',
    p: 'a video of people: dancing, a crowd, a face, a performer or a concert',
    k: ['people', 'person', 'dance', 'dancer', 'dancers', 'dancing', 'ballet', 'crowd', 'concert', 'festival', 'rave',
      'party', 'face', 'portrait', 'model', 'skate', 'skateboard', 'surfer', 'performance', 'live', 'singer', 'band'],
  },
  {
    id: 'retro', n: 'Retro & glitch',
    p: 'a retro video: VHS noise, a glitch, old film, an old cartoon, pixel art or a video game',
    k: ['retro', 'vintage', 'vhs', 'glitch', 'datamosh', 'datamoshing', 'crt', 'analog', 'analogue', 'old film', 'film grain',
      '8mm', '16mm', 'super 8', 'archive', 'public domain', 'cartoon', 'animation', 'anime', 'pixel', 'pixel art', '8-bit',
      'arcade', 'video game', 'gameplay', 'synthwave', 'vaporwave', '80s', '90s', 'black and white', 'silent film'],
  },
  {
    id: 'other', n: 'Other',
    p: '',
    k: [],
  },
];

// A category's id from its name: lower case, letters and digits only
function slug(name) {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'category';
}

// What the picture recogniser is told a category looks like
function promptFor(cat) {
  if (cat.p) return cat.p;
  if (cat.id === 'other') return '';
  return 'a video of ' + String(cat.n || cat.id).toLowerCase();
}

// Words that point to a category, for categories Nick made himself
function wordsFor(cat) {
  if (Array.isArray(cat.k) && cat.k.length) return cat.k;
  if (cat.id === 'other') return [];
  return String(cat.n || '').toLowerCase().split(/\s*(?:&|,|\band\b|\/)\s*/).map((w) => w.trim()).filter(Boolean);
}

module.exports = { DEFAULT_CATEGORIES, slug, promptFor, wordsFor };
