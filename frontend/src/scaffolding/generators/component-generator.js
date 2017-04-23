/* Copyright (C) 2016 NooBaa */

/* global __dirname */
'use strict';
const Path = require('path');
const Generator = require('./base-generator');
const { listSubDirectiories, toCammelCase, scaffold, inject,
    pathExists } = require('../utils');

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
            name: answers.name,
            nameCammelCased: toCammelCase(answers.name),
            folderName: answers.name
        };
    }

    generate(params) {
        const src = Path.join(templatesPath, this.template);
        const dest = Path.join(componentsPath, params.area, params.folderName);

        return pathExists(dest)
            .then(exists => !exists || this.confirmOverwrite(
                `A component at ${dest} already exists, overwrite:`
            ))
            .then(
                execute => execute && scaffold(src, dest, params)
                    .then(() => inject(
                        componentRegistery,
                        params.area,
                        this.generateRegisterLine(params.area, params.folderName),
                        false
                    ))
                    .then(() => true)
            );
    }

    validateName(name) {
        return /^[a-z][a-z0-9\-]*[a-z0-9]$/.test(name) ||
            'Name must start and end with a lowercased letter and may contain only dashes and lowercase letters';
    }

    generateRegisterLine(area, name) {
        return `ko.components.register('${name}', require('./${area}/${name}/${name}').default);\n    `;
    }
}

// Export the generator.
module.exports = ComponentGenerator;
