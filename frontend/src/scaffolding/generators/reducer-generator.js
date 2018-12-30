/* Copyright (C) 2016 NooBaa */

/* global __dirname */
'use strict';
const Path = require('path');
const Generator = require('./base-generator');
const {
    scaffold,
    inject,
    pathExists,
    toCammelCase
} = require('../utils');

const reducerTemplate = Path.join(__dirname, '../templates/reducer');
const reducersPath = Path.join(__dirname, '../../app/reducers');
const reducerRegistery = Path.join(reducersPath, 'index.js');

class ReducerGenerator extends Generator {
    prompt() {
        return [{
            type: 'input',
            name: 'name',
            message: 'What is the name of the new reducer:',
            validate: this.validateName
        }];
    }

    validateName(name) {
        return /^[a-z][a-z0-9\-]*[a-z0-9]$/.test(name) ||
            'Name must start and end with a lowercased letter and may contain only dashes and lowercase letters';
    }

    preprocess(answers) {
        const { name } = answers;
        return {
            key: toCammelCase(name),
            importName: `${toCammelCase(name)}Reducer`,
            filename: `${name}-reducer`
        };
    }

    async generate(params) {
        const src = reducerTemplate;
        const dest = reducersPath;
        const reducerFile = Path.join(dest, `${params.filename}.js`);
        const exists = await pathExists(reducerFile);
        const execute = !exists || await this.confirmOverwrite('A reducer with the same name already exists, overwrite:');
        if (execute) {
            await scaffold(src, dest, params);

            await inject(
                reducerRegistery,
                'import',
                this.generateImportLine(params),
                false
            );

            await inject(
                reducerRegistery,
                'list',
                this.generateListLine(params),
                false
            );

        }

        return true;
    }

    generateImportLine(params) {
        const { importName, filename } = params;
        return `import ${importName} from './${filename}';\n`;
    }

    generateListLine(params) {
        const { key, importName } = params;
        return `${key}: ${importName},\n    `;
    }
}

// Export the generator.
module.exports = ReducerGenerator;
