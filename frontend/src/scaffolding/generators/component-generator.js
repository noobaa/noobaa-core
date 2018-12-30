/* Copyright (C) 2016 NooBaa */

/* global __dirname */
'use strict';
const Path = require('path');
const Generator = require('./base-generator');
const {
    listSubDirectiories,
    toCammelCase,
    toPascalCase,
    scaffold,
    inject,
    pathExists
} = require('../utils');

const templatesPath = Path.join(__dirname, '../templates');
const componentsPath = Path.join(__dirname, '../../app/components');
const componentRegistery = Path.join(componentsPath, 'register.js');

class ComponentGenerator extends Generator {
    get displayName() {
        return 'component';
    }

    get template() {
        return 'component';
    }

    prompt() {
        return [
            {
                type: 'list',
                name: 'area',
                message: `To which area the new ${this.displayName} belong:`,
                choices: () => listSubDirectiories(componentsPath)
                    .concat([ { value: null, name: '- Create new area -' } ])
            },
            {
                type: 'input',
                name: 'area',
                message: 'What is the name of the new area:',
                when: answers => !answers.area,
                validate: this.validateName
            },
            {
                type: 'input',
                name: 'name',
                message: `What is the name of the new ${this.displayName}:`,
                validate: this.validateName
            }
        ];
    }

    preprocess(answers) {
        return {
            area: answers.area,
            filename: answers.name,
            folder: answers.name,
            tagName: answers.name,
            viewModelName: `${toPascalCase(answers.name)}ViewModel`,
            importName: toCammelCase(answers.name)
        };
    }

    async generate(params) {
        const src = Path.join(templatesPath, this.template);
        const dest = Path.join(componentsPath, params.area, params.folder);

        const exists = await pathExists(dest);
        if (!exists || this.confirmOverwrite(`A component at ${dest} already exists, overwrite:`)) {
            await scaffold(src, dest, params);

            // Inject an import statement.
            await inject(
                componentRegistery,
                `${params.area}.import`,
                this.generateImportLine(params),
                false
            );

            // Inject a register statement.
            await inject(
                componentRegistery,
                `${params.area}.list`,
                this.generateListLine(params),
                false
            );
            return true;
        }
    }

    validateName(name) {
        return /^[a-z][a-z0-9\-]*[a-z0-9]$/.test(name) ||
            'Name must start and end with a lowercased letter and may contain only dashes and lowercase letters';
    }

    generateImportLine(params) {
        const { area, importName, folder, filename } = params;
        return `import ${importName} from './${area}/${folder}/${filename}';\n`;
    }

    generateListLine(params) {
        return `${params.importName},\n        `;
    }
}

// Export the generator.
module.exports = ComponentGenerator;
