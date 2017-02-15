'use strict';
const inquirer = require('inquirer');

class Generator {
    execute() {
        return Promise.resolve()
            .then(() => this.prompt())
            .then(inquirer.prompt)
            .then(answers => this.preprocess(answers))
            .then(params => this.generate(params));
    }

    // Return an inquirer prompt configuration.
    prompt() {
        return [];
    }

    confirmOverwrite(message) {
        return inquirer.prompt([{
            type: 'confirm',
            name: 'overwrite',
            message: message,
            default: false
        }])
            .then(answer => answer.overwrite);
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
