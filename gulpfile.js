/* Copyright (C) 2016 NooBaa */
'use strict';

const gulp = require('gulp');
const gutil = require('gulp-util');
const gulp_tar = require('gulp-tar');
const gulp_gzip = require('gulp-gzip');
const gulp_rename = require('gulp-rename');
const gulp_json_editor = require('gulp-json-editor');

const _ = require('lodash');
const argv = require('minimist')(process.argv);
const fs = require('fs');
const path = require('path');
const dotenv = require('./src/util/dotenv');
const event_stream = require('event-stream');

const pkg = require('./package.json');
const promise_utils = require('./src/util/promise_utils');

if (!process.env.PORT) {
    console.log('loading .env file ( no foreman ;)');
    dotenv.load();
}

const git_commit = (argv.GIT_COMMIT && argv.GIT_COMMIT.substr(0, 7)) || 'DEVONLY';
const current_pkg_version = pkg.version + '-' + git_commit;
console.log('current_pkg_version:', current_pkg_version);


const NVA_Package_sources = [
    'src/**/*',
    'binding.gyp',
    'common.gypi'
];

function pack(dest, name) {
    var pkg_stream = gulp.src('package.json')
        .pipe(gulp_json_editor(json => {
            var deps = _.omit(
                json.dependencies,
                (val, key) => (/gulp|jshint|eslint|mocha|istanbul/).test(key)
            );
            return {
                name: 'noobaa-NVA',
                version: current_pkg_version,
                private: true,
                main: 'index.js',
                dependencies: deps,
            };
        }))
        .on('error', gutil.log);

    var src_stream = gulp.src(NVA_Package_sources, {
            base: 'src'
        })
        .pipe(gulp_rename(p => {
            p.dirname = path.join('src', p.dirname);
        }))
        .on('error', gutil.log);
    // TODO bring back uglify .pipe(gulp_uglify());

    var node_modules_stream = gulp.src([
            'node_modules/**/*',
            '!node_modules/babel*/**/*',
            '!node_modules/gulp*/**/*',
            '!node_modules/node-inspector/**/*',
            '!node_modules/chromedriver/**/*',
            '!node_modules/selenium-webdriver/**/*',
            '!node_modules/selenium-standalone/**/*',
            '!node_modules/phantomjs-prebuilt/**/*'
        ], {
            base: 'node_modules'
        })
        .pipe(gulp_rename(p => {
            p.dirname = path.join('node_modules', p.dirname);
        }))
        .on('error', gutil.log);

    var basejs_stream = gulp.src([
        'bower.json',
        'config.js',
        'gulpfile.js',
        'EULA.pdf',
        '.jshintrc',
        '.eslintrc',
        '.nvmrc'
    ], {});

    var agent_distro = gulp.src(['src/build/windows/noobaa_setup.exe'], {})
        .pipe(gulp_rename(p => {
            p.dirname = path.join('deployment', p.dirname);
        }))
        .on('error', gutil.log);

    var build_stream = gulp.src(['build/public/**/*'], {})
        .pipe(gulp_rename(p => {
            p.dirname = path.join('build/public', p.dirname);
        }))
        .on('error', gutil.log);

    var build_native_stream = gulp.src(['build/Release/**/*'], {})
        .pipe(gulp_rename(p => {
            p.dirname = path.join('build/Release', p.dirname);
        }))
        .on('error', gutil.log);

    var build_fe_stream = gulp.src(['frontend/dist/**/*'], {})
        .pipe(gulp_rename(p => {
            p.dirname = path.join('frontend/dist', p.dirname);
        }))
        .on('error', gutil.log);

    return event_stream
        .merge(
            pkg_stream,
            src_stream,
            basejs_stream,
            agent_distro,
            build_stream,
            build_native_stream,
            build_fe_stream,
            node_modules_stream
        )
        .pipe(gulp_rename(p => {
            p.dirname = path.join('noobaa-core', p.dirname);
        }))
        .on('error', gutil.log)
        .pipe(gulp_tar(name))
        .on('error', gutil.log)
        .pipe(gulp_gzip())
        .on('error', gutil.log)
        // .pipe(gulp_size({
        //     title: name
        // }))
        //  .on('error', gutil.log)
        .pipe(gulp.dest(dest))
        .on('error', gutil.log);
}


function package_build_task() {
    var DEST = 'build/public';
    var NAME = 'noobaa-NVA';

    return promise_utils.exec('chmod 777 build/public/noobaa-setup*')
        .then(() => fs.statAsync(`build/public/noobaa-setup-${current_pkg_version}.exe`))
        .then(() => fs.statAsync(`build/public/noobaa-setup-${current_pkg_version}`))
        .catch(err => {
            gutil.log('Can\'t find the currect file', err.message);
            process.exit(1);
        })
        .then(() => {
            gutil.log('before downloading nvm and node package');
            return promise_utils.exec('curl -o- https://raw.githubusercontent.com/creationix/nvm/master/nvm.sh >build/public/nvm.sh', [], process.cwd());
        })
        .then(() => promise_utils.exec('curl -o- https://nodejs.org/dist/v6.11.2/node-v6.11.2-linux-x64.tar.xz >build/public/node-v6.11.2-linux-x64.tar.xz', [], process.cwd()))
        .then(() => {
            //call for packing
            gutil.log('Packing ' + DEST + ' to ' + NAME + "-" + current_pkg_version + '.tar');
            return pack(DEST, NAME + "-" + current_pkg_version + '.tar');
        })
        .then(null, error => {
            gutil.log("error ", error, error.stack);
        });
}

gulp.task('package_build', package_build_task);
