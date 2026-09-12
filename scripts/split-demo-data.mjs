import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../public');
const projectRoot = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(await fs.readFile(path.join(root, 'data.json'), 'utf8'));
const media = JSON.parse(await fs.readFile(path.join(root, 'media.json'), 'utf8'));
const detailsDir = path.join(root, 'plant-details');
const r2Prefix = 'https://pub-3517da5ed83f46628c557cd926a014a5.r2.dev/imgs';
const r2ImageUrl = scientificName => `${r2Prefix}/${encodeURIComponent(String(scientificName || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '-'))}.webp`;

const pickListPlant = plant => ({
  id: plant.id,
  slug: plant.slug,
  displayOrder: plant.displayOrder,
  scientificName: plant.scientificName,
  authorship: plant.authorship,
  rank: plant.rank,
  commonNames: plant.commonNames,
  synonyms: plant.synonyms,
  group: plant.group,
  family: plant.family,
  genus: plant.genus,
  habit: plant.habit,
  useCategories: plant.useCategories,
  tagline: plant.tagline,
  mediaId: plant.mediaId,
  imageUrl: r2ImageUrl(plant.scientificName),
});

const hero = data.plants.find(plant => plant.slug === 'adiantum-capillus-veneris') ?? data.plants[0];
const families = [...new Map(data.plants.map(plant => [plant.family.name, {
  id: plant.family.name,
  name: plant.family.name,
  zh: plant.family.zh,
  count: data.plants.filter(item => item.family.name === plant.family.name).length,
}])).values()].sort((a, b) => a.zh.localeCompare(b.zh, 'zh-CN') || a.name.localeCompare(b.name, 'en'));

await fs.rm(detailsDir, { recursive: true, force: true });
await fs.mkdir(detailsDir, { recursive: true });
await fs.copyFile(path.join(projectRoot, 'migrations/main/0001_catalog_schema.sql'), path.join(root, 'schema.wcvp.sql'));
await fs.writeFile(path.join(root, 'summary.json'), JSON.stringify({
  schemaVersion: data.schemaVersion,
  dataset: data.dataset,
  groups: data.groups,
  stats: {
    plants: data.plants.length,
    species: data.plants.length,
    families: families.length,
    groups: data.groups.length,
  },
  families,
  hero: {
    slug: hero.slug,
    mediaId: hero.mediaId,
    path: r2ImageUrl(hero.scientificName),
    creator: media[hero.mediaId].creator,
    license: media[hero.mediaId].license,
  },
}, null, 2));
await fs.writeFile(path.join(root, 'plant-list.json'), JSON.stringify({
  schemaVersion: data.schemaVersion,
  dataset: data.dataset,
  groups: data.groups,
  plants: data.plants.map(pickListPlant),
}, null, 2));

for (const plant of data.plants) {
  await fs.writeFile(
    path.join(detailsDir, `${plant.slug}.json`),
    JSON.stringify({ plant: { ...plant, imageUrl: r2ImageUrl(plant.scientificName) }, media: media[plant.mediaId] }, null, 2),
  );
}

console.log(`Split ${data.plants.length} plants into summary, list, and detail payloads.`);
