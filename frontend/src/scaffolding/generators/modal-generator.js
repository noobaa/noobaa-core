/* Copyright (C) 2016 NooBaa */

'use strict';
const ComponentGenerator = require('./component-generator');

class ModalGenerator extends ComponentGenerator {
    get displayName() {
        return 'modal';
    }

    get template() {
        return 'modal';
    }

    prompt() {
        return super.prompt().concat([
            {
                type: 'list',
                name: 'size',
                message: 'Select a size for the modal:',
                choices: [
                    'xsmall',
                    'small',
                    'medium',
                    'large',
                    { value: 'auto-height', name: 'Auto height' }
                ]
            },
            {
                type: 'input',
                name: 'title',
                message: `What is the title of the ${this.displayName}:`
            },
            {
                type: 'list',
                name: 'action',
                message: 'Select a main action for the modal:',
                choices: [
                    'save',
                    'create',
                    'configure',
                    'done',
                    { value: null, name: '- Custom action -' }
                ]
            },
            {
                type: 'input',
                name: 'action',
                when: answers => !answers.action,
                message: 'Give the custom action a label:'
            }
        ]);
    }

    preprocess(answers) {
        const actionMethodName = answers.action
            .toLowerCase()
            .replace(/\s*/, m => m && m[1].toUpperCase());

        return Object.assign(
            super.preprocess(answers),
            {
                name: answers.name,
                size: answers.size,
                title: answers.title,
                action: actionMethodName,
                actionLabel: answers.action,
                folderName: `${answers.name}-modal`
            }
        );
    }
}

// Export the generator.
module.exports = ModalGenerator;
