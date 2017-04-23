/* Copyright (C) 2016 NooBaa */

/* global __dirname */
'use strict';
const Path = require('path');
const Generator = require('./base-generator');
const { scaffold, pathExists } = require('../utils');

const reducerTemplate = Path.join(__dirname, '../templates/reducer');
const reducersPath = Path.join(__dirname, '../../app/reducers');

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

    generate(params) {
        const src = reducerTemplate;
        const dest = reducersPath;
        const reducerFile = Path.join(dest, `${params.name}-reducer.js`);

        return pathExists(reducerFile)
            .then(exists => !exists || this.confirmOverwrite(
                'A reducer with the same name already exists, overwrite:'
            ))
            .then(execute => execute && scaffold(src, dest, params))
            .then(() => true);

    }
}

// Export the generator.
module.exports = ReducerGenerator;
