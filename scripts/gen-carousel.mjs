import fs from "node:fs";
import path from "node:path";

const siteRoot = process.cwd();
const imagesRoot = path.join(siteRoot, "public", "images");
const outRoot = path.join(siteRoot, "src", "data", "carousels");

fs.mkdirSync(outRoot, { recursive: true });

// only web-safe formats
const isImage = (f) => /\.(png|jpe?g|webp|gif)$/i.test(f);

const listImages = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((f) => isImage(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const folders = fs.existsSync(imagesRoot)
  ? fs
      .readdirSync(imagesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  : [];

for (const folder of folders) {
  const folderPath = path.join(imagesRoot, folder);
  const convertedPath = path.join(folderPath, "converted");

  // Prefer /converted if it has images
  const convertedFiles = listImages(convertedPath);
  const rootFiles = listImages(folderPath);

  const useConverted = convertedFiles.length > 0;
  const chosenFiles = useConverted ? convertedFiles : rootFiles;

  // Emit web paths (what the browser should request)
  const baseWebPath = useConverted
    ? `/images/${folder}/converted/`
    : `/images/${folder}/`;

  const images = chosenFiles.map((f) => `${baseWebPath}${f}`);

  const payload = {
    folder,
    useConverted,
    images,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(outRoot, `${folder}.json`), JSON.stringify(payload, null, 2));
}

console.log(`Generated ${folders.length} carousel file(s) in src/data/carousels/`);

