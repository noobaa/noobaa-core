/* Copyright (C) 2016 NooBaa */
'use strict';

let yaml = require('yaml');
const argv = require('minimist')(process.argv);
const fs = require('fs');
const path = require('path');


main();

async function main() {
    if (!argv.split || !argv.out) {
        console.error(`Usage: node ${process.argv[1]} --split [yaml to split] --out [output dir]`);
    }
    if (argv.split) {
        await split_yaml_file(argv.split, argv.out);
    }
    process.exit(0);
}

async function split_yaml_file(file, out_dir) {
    try {
        const file_content = fs.readFileSync(file).toString();
        const all_docs = yaml.parseAllDocuments(file_content);
        for (const doc of all_docs) {
            let doc_str = await doc.toString();
            const doc_json = await yaml.parse(doc_str);
            const out_file = path.join(out_dir, doc_json.metadata.name) + '.yaml';
            await fs.writeFileSync(out_file, doc_str);
            console.log(`generated ${out_file}`);
        }
    } catch (err) {
        console.error(`failed parsing file ${file}`, err.message);
        process.exit(1);
    }
}
