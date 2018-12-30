/* Copyright (C) 2016 NooBaa */

/* global __dirname */
'use strict';
const ComponentGenerator = require('./component-generator');
const Path = require('path');
const { inject, toPascalCase } = require('../utils');

const modalActionsPath = Path.join(__dirname, '../../app/action-creators/modals-actions.js');

class ModalGenerator extends ComponentGenerator {
    get displayName() {
        return 'modal';
    }

    get template() {
        return 'modal';
    }

    prompt() {
        return [
            {
                type: 'input',
                name: 'name',
                message: 'What is the name of the new modal:',
                validate: this.validateName
            },
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
                    'Configure',
                    'Create',
                    'Done',
                    'Invoke',
                    'Save',
                    'Set',
                    { value: null, name: '- Custom action -' }
                ]
            }
        ];
    }

    preprocess(answers) {
        return {
            ...super.preprocess({
                area: 'modals',
                name: `${answers.name}-modal`
            }),
            size: answers.size,
            title: answers.title,
            action: answers.action,
            acName: `open${toPascalCase(answers.name)}Modal`
        };
    }

    async generate(params) {
        super.generate(params);

        await inject(
            modalActionsPath,
            'actionCreator',
            this.generateActionCreator(params),
            false
        );

        return true;
    }

    generateActionCreator(params) {
        const { acName, tagName, title, size } = params;
        return `
export function ${acName}() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: '${tagName}',
                params: { }
            },
            options: {
                title: '${title}',
                size: '${size}'
            }
        }
    };
}
`;
    }
}

// Export the generator.
module.exports = ModalGenerator;
