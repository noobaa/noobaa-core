/* Copyright (C) 2016 NooBaa */

'use strict';
const fs = require('fs');
const gulp = require('gulp');
const path = require('path');
const pathExists = require('path-exists');
const gulpRename = require('gulp-rename');
const gulpReplace = require('gulp-replace');
const gulpInject = require('gulp-inject-string');
const gulpContains = require('gulp-contains');
const gulpIf = require('gulp-if');

function scaffold(src, dest, params) {
    const replaceRegExp = /\[\[(.*?)\]\]/g;

    return _streamToPromise(
        gulp.src(`${src}/**/*`)
            .pipe(gulpRename(
                path => {
                    path.basename = path.basename.replace(
                        replaceRegExp,
                        (_, m) => params[m] || m
                    );
                }
            ))
            .pipe(gulpReplace(replaceRegExp, (_, m) => params[m] || m))
            .pipe(gulp.dest(dest))
    );
}

function inject(src, tag, text, allowDuplicates) {
    const match = `/** INJECT:${tag} **/`;
    const dest = path.dirname(src);
    let textFound = false;

    return _streamToPromise(
        gulp.src(src)
            .pipe(gulpContains({
                search: text,
                onFound: () => {
                    textFound = true;
                    return false;
                }
            }))
            .pipe(gulpIf(
                () => allowDuplicates || !textFound,
                gulpInject.beforeEach(match, text)
            ))
            .pipe(gulp.dest(dest))
    );
}

function toCammelCase(str) {
    return str.replace(
        /-\w/g,
        match => match[1].toUpperCase()
    );
}

function toPascalCase(str) {
    return ('-' + str).replace(
        /-\w/g,
        match => match[1].toUpperCase()
    );
}

function listSubDirectiories(base) {
    return fs.readdirSync(base).filter(
        file => fs.statSync(path.join(base, file)).isDirectory()
    );
}

function _streamToPromise(stream) {
    return new Promise(
        (resolve, reject) => {
            stream.on('end', resolve);
            stream.on('error', reject);
        }
    );
}

// Exported utils.
exports.scaffold = scaffold;
exports.inject = inject;
exports.toCammelCase = toCammelCase;
exports.toPascalCase = toPascalCase;
exports.listSubDirectiories = listSubDirectiories;
exports.pathExists = pathExists;
