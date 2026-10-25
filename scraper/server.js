const http = require('http');

// API officielle et gratuite du gouvernement américain (NHTSA vPIC), sans clé
const API = 'https://vpic.nhtsa.dot.gov/api/vehicles';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, ''); // "Mercedes-Benz" -> "mercedesbenz"
const wiki = (text) => 'https://fr.wikipedia.org/w/index.php?search=' + encodeURIComponent(text);

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

// q = "audi", "audi a4", "toy"... (vide = la liste des marques)
async function search(q) {
  const words = q.split(/\s+/).map(norm).filter(Boolean);
  const makes = [...new Set((await getList('GetMakesForVehicleType/car')).map((m) => m.MakeName || m.Make_Name))].sort();

  if (!words.length) {
    return makes.slice(0, 48).map((make) => ({
      type: 'Marque', name: make, info: 'Tapez son nom pour voir ses modèles', link: wiki(make),
    }));
  }

  // le premier mot = la marque, les suivants filtrent les modèles
  let found = makes.filter((m) => norm(m).startsWith(words[0]));
  if (!found.length) found = makes.filter((m) => norm(m).includes(words[0]));
  found = found.slice(0, 3);

  const lists = await Promise.all(found.map((m) => getList(`getmodelsformake/${encodeURIComponent(m)}`)));
  const seen = new Set();
  const models = [];
  lists.flat().forEach((r) => {
    const make = r.Make_Name, model = r.Model_Name;
    if (!found.includes(make) || seen.has(make + model)) return; // l'API renvoie parfois des marques voisines
    if (!words.slice(1).every((w) => norm(model).includes(w))) return;
    seen.add(make + model);
    models.push({ type: 'Modèle', name: `${make} ${model}`, info: `Marque : ${make}`, link: wiki(`${make} ${model}`) });
  });
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models.slice(0, 200);
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
