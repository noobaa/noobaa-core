/* Copyright (C) 2016 NooBaa */

'use strict';
const inquirer = require('inquirer');
const generators = require('./generators');

const options = generators.map(
    ({ display, generator }) => {
        const name = display;
        const value = new generator();

        return { name, value };
    }
);

inquirer.prompt([
    {
        type: 'list',
        name: 'generator',
        message: 'Which generator would you like to use:',
        choices: options,
        default: options[0]
    }
])
    .then(answers => answers.generator.execute())
    .then(completed => console.log(
        completed ?
            'Scaffolding completed successfully' :
            'Scaffolding aborted'
    ))
    .catch(err => console.error(err.stack));

