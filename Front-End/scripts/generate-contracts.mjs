import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFromFile } from 'json-schema-to-typescript';

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const contractsDirectory = path.resolve(projectDirectory, '..', '..', 'contracts');
const outputDirectory = path.resolve(projectDirectory, '..', 'src', 'contracts');

async function schemaFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries
    .filter(entry => entry.isDirectory())
    .map(entry => schemaFiles(path.join(directory, entry.name))));
  return [
    ...entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.schema.json'))
      .map(entry => path.join(directory, entry.name)),
    ...nested.flat(),
  ].sort();
}

await fs.mkdir(outputDirectory, { recursive: true });
for (const schemaPath of await schemaFiles(contractsDirectory)) {
  const name = path.basename(schemaPath).replace(/\.schema\.json$/, '');
  const declaration = await compileFromFile(schemaPath, {
    cwd: contractsDirectory,
    bannerComment: '/* This file is generated from contracts/*.schema.json. Do not edit. */',
    style: { singleQuote: true },
  });
  await fs.writeFile(path.join(outputDirectory, `${name}.ts`), declaration, 'utf8');
}
