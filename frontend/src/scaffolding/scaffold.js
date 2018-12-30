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

async function main() {
    try {
        const answers = await inquirer.prompt([
            {
                type: 'list',
                name: 'generator',
                message: 'Which generator would you like to use:',
                choices: options,
                default: options[0]
            }
        ]);

        const completed = await answers.generator.execute();
        const message = completed ?
            'Scaffolding completed successfully' :
            'Scaffolding aborted';

        console.log(message);

    } catch (err) {
        console.error(err.stack);
    }
}

main();
