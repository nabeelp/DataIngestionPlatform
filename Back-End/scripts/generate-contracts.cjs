const fs = require('node:fs/promises');
const path = require('node:path');
const { compileFromFile } = require('json-schema-to-typescript');

const contractsDirectory = path.resolve(__dirname, '..', '..', 'contracts');
const outputDirectory = path.resolve(__dirname, '..', 'src', 'contracts');

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

async function main() {
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
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
