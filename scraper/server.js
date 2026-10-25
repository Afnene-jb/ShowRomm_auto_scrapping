const http = require('http');

// API officielle et gratuite du gouvernement américain (NHTSA vPIC), sans clé
const API = 'https://vpic.nhtsa.dot.gov/api/vehicles';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, ''); // "Mercedes-Benz" -> "mercedesbenz"
const ACRONYMS = ['BMW', 'GMC', 'MG', 'AMC'];
// "MERCEDES-BENZ" -> "Mercedes-Benz" (le nom de la page Wikipédia)
const pretty = (s) => (ACRONYMS.includes(s) ? s : s.toLowerCase().replace(/(^|[\s-])\w/g, (c) => c.toUpperCase()));

// marques connues, affichées en premier quand on ne tape rien
const POPULAR = ['Toyota', 'Honda', 'Ford', 'Chevrolet', 'Nissan', 'BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Hyundai',
  'Kia', 'Mazda', 'Subaru', 'Lexus', 'Tesla', 'Jeep', 'Dodge', 'Volvo', 'Porsche', 'Jaguar', 'Land Rover', 'Mini', 'Fiat',
  'Alfa Romeo', 'Peugeot', 'Renault', 'Suzuki', 'Mitsubishi', 'Infiniti', 'Cadillac', 'Ferrari', 'Lamborghini', 'Bentley',
  'Rolls-Royce', 'Maserati', 'Acura', 'Buick', 'Chrysler', 'Lincoln', 'Genesis'];

// Photos : image principale de la page Wikipédia de chaque titre (50 titres par requête)
async function getImages(titles) {
  const out = {};
  const batches = [];
  for (let i = 0; i < titles.length; i += 50) batches.push(titles.slice(i, i + 50));
  await Promise.all(batches.map(async (batch) => {
    try {
      const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail'
        + '&pithumbsize=500&redirects=1&titles=' + encodeURIComponent(batch.join('|'));
      const res = await fetch(url, { headers: { 'User-Agent': 'ShowroomAuto/1.0 (projet etudiant)' } });
      const q = (await res.json()).query || {};
      const alias = {}; // titre demandé -> titre final (majuscules corrigées, redirections)
      [...(q.normalized || []), ...(q.redirects || [])].forEach((x) => { alias[x.from] = x.to; });
      const thumbs = {};
      Object.values(q.pages || {}).forEach((p) => { if (p.thumbnail) thumbs[p.title] = p.thumbnail.source; });
      batch.forEach((t) => {
        let n = t;
        for (let k = 0; k < 3 && alias[n]; k++) n = alias[n];
        if (thumbs[n]) out[t] = thumbs[n];
      });
    } catch (e) { /* sans photo : la carte affichera une initiale */ }
  }));
  return out;
}

const cache = new Map(); // 1 h de cache : on ne sollicite pas l'API à chaque recherche
async function getList(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.time < 60 * 60 * 1000) return hit.data;
  const res = await fetch(`${API}/${path}?format=json`);
  if (!res.ok) throw new Error(`NHTSA a répondu ${res.status}`);
  const data = (await res.json()).Results || [];
  cache.set(path, { time: Date.now(), data });
  return data;
}

// q = "audi", "audi a4", "toy"... (vide = les marques les plus connues)
async function search(q) {
  const words = q.split(/\s+/).map(norm).filter(Boolean);
  const makes = [...new Set((await getList('GetMakesForVehicleType/car')).map((m) => m.MakeName || m.Make_Name))].sort();
  let items;

  if (!words.length) {
    const brands = POPULAR.map((p) => makes.find((m) => norm(m) === norm(p))).filter(Boolean);
    items = brands.map((make) => ({ type: 'Marque', name: pretty(make), title: pretty(make), info: 'Tapez son nom pour voir ses modèles' }));
  } else {
    // le premier mot = la marque, les suivants filtrent les modèles
    let found = makes.filter((m) => norm(m).startsWith(words[0]));
    if (!found.length) found = makes.filter((m) => norm(m).includes(words[0]));
    found = found.slice(0, 3);

    const lists = await Promise.all(found.map((m) => getList(`getmodelsformake/${encodeURIComponent(m)}`)));
    const seen = new Set();
    items = [];
    lists.flat().forEach((r) => {
      const make = r.Make_Name, model = r.Model_Name;
      if (!found.includes(make) || seen.has(make + model)) return; // l'API renvoie parfois des marques voisines
      if (!words.slice(1).every((w) => norm(model).includes(w))) return;
      seen.add(make + model);
      const title = `${pretty(make)} ${model}`;
      items.push({ type: 'Modèle', name: title, title, info: `Marque : ${pretty(make)}` });
    });
    items = items.slice(0, 100);
  }

  const images = await getImages(items.map((i) => i.title));
  items.forEach((i) => { i.image = images[i.title] || ''; delete i.title; });
  // les voitures avec photo d'abord, puis l'ordre alphabétique
  if (words.length) items.sort((a, b) => !!b.image - !!a.image || a.name.localeCompare(b.name));
  return items.slice(0, 60);
}

// Fonction appelée à chaque requête (par Vercel, ou par le serveur local ci-dessous)
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
    res.end(JSON.stringify(await search(q)));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
}

// en local : node server.js (ou npm start)
if (require.main === module) {
  const port = process.env.PORT || 3000;
  http.createServer(handler).listen(port, () => console.log('Scraper prêt sur le port ' + port));
}

module.exports = handler; // Vercel utilise cette fonction
module.exports.search = search;
