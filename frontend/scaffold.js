'use strict';

let path = require('path');
let inquirer = require('inquirer');
let fs = require('fs');
let gulp = require('gulp');
let $ = require('gulp-load-plugins')();
let pathExists = require('path-exists');

let generators = {};


// -----------------------------
// Utils
// -----------------------------

function generator(name, impl) {
    generators[name] = impl;
}

function scaffold(src, dest, params) {
    const replaceRegExp = /\[\[(.*?)\]\]/g;

    return streamToPromise(
        gulp.src(`${src}/**/*`)
            .pipe($.rename(
                path => {
                    path.basename = path.basename.replace(
                        replaceRegExp,
                        (_, m) => params[m] || m
                    );
                }
            ))
            .pipe($.replace(replaceRegExp, (_, m) => params[m] || m))
            .pipe(gulp.dest(dest))
    );
}

function inject(src, tag, text, allowDuplicates) {
    let match = `/** INJECT:${tag} **/`;
    let dest = path.dirname(src);
    let textFound = false;

    return streamToPromise(
        gulp.src(src)
            .pipe($.contains({
                search: text,
                onFound: () => {
                    textFound = true;
                    return false;
                }
            }))
            .pipe($.if(
                () => allowDuplicates || !textFound,
                $.injectString.beforeEach(match, text)
            ))
            .pipe(gulp.dest(dest))
    );
}

function toCammelCase(str) {
    return ('-' + str).replace(/-\w/g, match => match[1].toUpperCase());
}

function streamToPromise(stream) {
    return new Promise(
        (resolve, reject) => {
            stream.on('end', resolve);
            stream.on('error', reject);
        }
    );
}

function listSubDirectiories(base) {
    return fs.readdirSync(base).filter(
        file => fs.statSync(path.join(base, file)).isDirectory()
    );
}

// -----------------------------
// Generators
// -----------------------------
class Generator {
    execute() {
        return Promise.resolve()
            .then(
                () => this.prompt()
            )
            .then(
                inquirer.prompt
            )
            .then(
                answers => this.preprocess(answers)
            )
            .then(
                params => this.generate(params)
            );
    }

    // Return an inquirer prompt configuration.
    prompt() {
        return [];
    }

    // Preprocess the ansers into a param object to be served to execute.
    preprocess(answers) {
        return answers;
    }

    generate(/* params */) {
    }
}

class ComponentGenerator extends Generator {
    get displayName() {
        return 'component';
    }

    get template() {
        return 'component';
    }

    constructor() {
        super();
        this.templatePath = `src/scaffolding/${this.template}`;
        this.componentsPath = 'src/app/components';
        this.registryPath = 'src/app/components/register.js';
    }

    prompt() {
        return [
            {
                type: 'list',
                name: 'area',
                message: `To which area the new ${this.displayName} belong:`,
                choices: () => listSubDirectiories(this.componentsPath)
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
        let src = this.templatePath;
        let dest = `${this.componentsPath}/${params.area}/${params.folderName}`;

        return pathExists(dest)
            .then(
                exists => !exists || inquirer.prompt([{
                    type: 'confirm',
                    name: 'overwrite',
                    message: () => `A component at ${dest} already exists, overwrite:`,
                    default: false
                }])
                    .then(
                        answer => answer.overwrite
                    )
            )
            .then(
                execute => execute && scaffold(src, dest, params)
                    .then(
                        () => inject(
                            this.registryPath,
                            params.area,
                            this.generateRegisterLine(params.area, params.folderName),
                            false
                        )
                    )
                    .then(

                        () => true
                    )
            );
    }

    validateName(name) {
        return /^[a-z][a-z\-]*[a-z]$/.test(name) ||
            'Name must start and end with a lowercased letter and may contain only dashes and lowercase letters';
    }

    generateRegisterLine(area, name) {
        return `ko.components.register('${name}', require('./${area}/${name}/${name}'));\n    `;
    }
}

class ModalGenerator extends ComponentGenerator {
    get displayName() {
        return 'modal';
    }

    get template() {
        return 'modal';
    }

    prompt() {
        return Promise.resolve()
            .then(
                () => super.prompt()
            )
            .then(
                questions => questions.concat([
                    {
                        type: 'input',
                        name: 'title',
                        message: `What is the title of the ${this.displayName}:`
                    },
                    {
                        type: 'list',
                        name: 'action',
                        message: 'What is action verb of the modal:',
                        choices: [ 'save', 'create', 'configure', 'done']
                    }
                ])
            );
    }

    preprocess(answers) {
        return Object.assign(
            super.preprocess(answers),
            {
                name: answers.name,
                title: answers.title,
                action: answers.action,
                actionCammelCased: toCammelCase(answers.action),
                folderName: `${answers.name}-modal`
            }
        );
    }
}

generator('General component', new ComponentGenerator());
generator('Modal', new ModalGenerator());


// -----------------------------
// Main
// -----------------------------
function main() {
    let generatorNames = Object.keys(generators);

    inquirer.prompt([
        {
            type: 'list',
            name: 'generator',
            message: 'Which generator would you like to use:',
            choices: generatorNames,
            default: generatorNames[0]
        }
    ])
        .then(
            answers => {
                let gen = generators[answers.generator];
                return gen.execute();
            }
        )
        .then(
            completed => console.log(
                completed ?
                    'Scaffolding completed successfully' :
                    'Scaffolding aborted'
            )
        )
        .catch(
            err => console.error(err.stack)
        );
}

main();

