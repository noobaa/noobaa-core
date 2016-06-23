/*global process */
'use strict';

let path = require('path');
let argv = require('yargs').argv;
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
        gulp.src(src)
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

function logAndRject(message) {
    console.log(message);
    return Promise.reject();
}

// -----------------------------
// Generators
// -----------------------------
generator('component', argv =>  {
    let area = argv._[1];
    let name = argv._[2];
    let force = argv.force;

    if (!area || !name) {
        return logAndRject('usage: node scaf component <area> <name> [--force]');
    }

    let src = 'src/scaffolding/component/**/*';
    let dest = `src/app/components/${area}/${name}`;
    let registry = 'src/app/components/register.js';
    let params = {
        area: area,
        name: name,
        nameCammelCased: toCammelCase(name)
    };

    return pathExists(dest)
        .then(
            exists => {
                if (!force && exists) {
                    return logAndRject(`Component ${dest} already exists, use --force to override current component`);
                }
            }
        )
        .then(
            () => scaffold(src, dest, params)
        )
        .then(
            () => {
                let line = `ko.components.register('${name}', require('./${area}/${name}/${name}'));\n    `;
                return inject(registry, area, line, false);
            }
        );
});


// -----------------------------
// Main
// -----------------------------
function main(argv) {
    let genName = argv._[0];
    let gen = generators[genName];
    if (!gen) {
        return logAndRject('usage: node scaf <generator>');
    }

    return gen(argv)
        .then(
            () => console.log(`Scaffolding ${genName} completed successfully`)
        )
        .catch(
            err => {
                err instanceof Error && console.error(err.stack);
                process.exit(1);
            }
        );
}

main(argv);

