/* Copyright (C) 2016 NooBaa */

'use strict';
const inquirer = require('inquirer');

class Generator {
    async execute() {
        const answers = await inquirer.prompt(this.prompt());
        const params = await this.preprocess(answers);
        return await this.generate(params);
    }

    // Return an inquirer prompt configuration.
    prompt() {
        return [];
    }

    async confirmOverwrite(message) {
        const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'overwrite',
            message: message,
            default: false
        }]);

        return answer.overwrite;
    }

    // Preprocess the ansers into a param object to be served to execute.
    preprocess(answers) {
        return answers;
    }

    generate(/* params */) {
    }
}

// Export the generator.
module.exports = Generator;
