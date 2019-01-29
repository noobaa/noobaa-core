/* Copyright (C) 2016 NooBaa */

/*global Buffer process */
'use strict';
const argv = require('yargs').argv;
const gulp = require('gulp');
const del = require('del');
const path = require('path');
const VFile = require('vinyl');
const sourceStream = require('vinyl-source-stream');
const buffer = require('vinyl-buffer');
const browserify = require('browserify');
const stringify = require('stringify');
const babelify = require('babelify');
const watchify = require('watchify');
const runSequence = require('run-sequence');
const through = require('through2');
const moment = require('moment');
const spawn = require('child_process').spawn;
const less = require('less');
const $ = require('gulp-load-plugins')();
const { version } = require('../package.json');

const cwd = process.cwd();
const libsPath = './src/lib';
const buildPath = './dist';
const uglify = !!argv.uglify;
let buildErrors = 0;
let lintErrors = 0;

const staticAssetsSelector = [
    'src/*.html',
    'src/ping-server.js',
    'src/preload.js',
    'src/assets/**/*',
    '!src/assets/icons',
    '!src/assets/icons/*.svg'
];

const libs = [
    {
        name: 'knockout',
        module: 'dist/knockout.debug.js'
    },
    {
        name: 'knockout-projections',
        module: 'dist/knockout-projections.min.js'
    },
    {
        name: 'knockout-validation',
        module: 'dist/knockout.validation.js'
    },
    {
        name: 'numeral',
        module: '../../../node_modules/numeral/numeral.js'
    },
    {
        name: 'page',
        module: 'page.js'
    },
    {
        name: 'moment',
        module: 'moment.js'
    },
    {
        name: 'moment-timezone',
        module: 'builds/moment-timezone-with-data.js'
    },
    {
        name: 'shifty',
        module: 'dist/shifty.js',
        build: 'npm run build'
    },
    {
        name: 'aws-sdk',
        module: '../../../../node_modules/aws-sdk/dist/aws-sdk.min.js'
    },
    {
        name: 'jszip',
        module: 'dist/jszip.js'
    },
    {
        name: 'chart.js',
        exposeAs: 'chartjs',
        module: 'dist/Chart.js'
    },
    {
        name: 'big-integer',
        module: 'BigInteger.min.js'
    },
    {
        name: 'prism',
        module: 'prism.js'
    }
];

const apiBlackList = [
    'rpc_ws_server',
    'rpc_n2n_agent',
    'rpc_tcp_server',
    'rpc_http_server',
    'rpc_ntcp_server',
    'rpc_tcp',
    'rpc_n2n',
    'rpc_http',
    'rpc_nudp',
    'rpc_ntcp',
    'rpc_fcall'
];

// ----------------------------------
// Build Tasks
// ----------------------------------

gulp.on('error', () => console.log('ERROR'));

gulp.task('build', cb => {
    runSequence(
        'clean',
        [
            'build-lib',
            'build-api',
            'build-app',
            'build-debug',
            'compile-styles',
            'generate-svg-icons',
            'copy'
        ],
        'verify-build',
        cb
    );
});

gulp.task('clean', cb => {
    del([buildPath]).then(() => {
        cb();
    });
});

gulp.task('build-lib', ['build-deps'], () => {
    const b = browserify({
        debug: true,
        noParse: true
    });

    libs.forEach(lib =>  {
        const { module, name, exposeAs = name } = lib;
        const fullPath = path.join(cwd, libsPath, name, module);
        b.require(fullPath, { expose: exposeAs });
    });

    return b.bundle()
        .on('error', errorHandler)
        .pipe(sourceStream('lib.js'))
        .pipe(buffer())
        .pipe($.sourcemaps.init({ loadMaps: true }))
        .pipe($.if(uglify, $.uglify()))
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest(buildPath));
});

gulp.task('build-api', () => {
    const b = browserify({
        paths: ['./node_modules'],
        debug: true
    });

    // Ignore unused files.
    apiBlackList.forEach(
        file => {
            const path = require.resolve(`../src/rpc/${file}`);
            console.log(`[${moment().format('HH:mm:ss')}] build-api: Ignoring ${path}`);
            b.ignore(path);
        }
    );

    b.transform(babelify, {
        presets: ['es2015'],
        plugins: ['transform-runtime']
    });

    b.require('../node_modules/ajv', { expose: 'ajv' });
    b.require('../src/api/index.js', { expose: 'nb-api' });

    return b.bundle()
        .on('error', errorHandler)
        .pipe(sourceStream('api.js'))
        .pipe(buffer())
        .pipe($.sourcemaps.init({ loadMaps: true }))
        .pipe($.if(uglify, $.uglify()))
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest(buildPath));
});

gulp.task('build-app', ['lint-app', 'build-js-style'], () => {
    return bundleCode('app', false);
});

gulp.task('build-debug', ['lint-debug'], () => {
    return bundleCode('debug', false);
});

gulp.task('compile-styles', () => {
    return gulp.src('src/app/**/*.less', { base: '.' })
        .pipe($.lessImport('styles.less'))
        .pipe($.sourcemaps.init())
        .pipe($.less())
        .on('error', errorHandler)
        .pipe($.if(uglify, $.minifyCss()))
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest(buildPath));
});

gulp.task('generate-svg-icons', () => {
    return gulp.src('src/assets/icons/*.svg')
        .pipe($.rename({ suffix: '-icon' }))
        .pipe($.svgstore({ inlineSvg: true }))
        .pipe(gulp.dest(path.join(buildPath, 'assets')));
});

gulp.task('copy', () => {
    return injectVersion(staticAssetsSelector);
});

gulp.task('build-js-style', () => {
    return gulp.src('src/app/styles/constants.less', { base: 'src/app/styles' })
        .pipe(letsToLessClass())
        .pipe($.less())
        .pipe(cssClassToJson())
        .pipe(gulp.dest(buildPath));
});

gulp.task('build-deps', ['install-deps'], cb => {
    const libsToBuild = libs
        .filter(lib => lib.build)
        .map(lib => {
            const workingDir = path.join(cwd, libsPath, lib.name);
            const pkgFile = path.join(workingDir, 'package.json');
            const command = lib.build;
            return { workingDir, pkgFile, command };
        });

    gulp.src(libsToBuild.map(lib => lib.pkgFile))
        .pipe($.install(() => {
            const builds = libsToBuild
                .map(lib => spawnAsync(lib.command, { cwd: lib.workingDir }));

            Promise.all(builds)
                .then(() => cb(), cb);
        }))
        .on('error', errorHandler);
});

gulp.task('install-deps', () => {
    return gulp.src('./bower.json')
        .pipe($.install());
});

gulp.task('lint-app', () => {
    return lint('app');
});

gulp.task('lint-debug', () => {
    return lint('debug');
});

gulp.task('verify-build', cb => {
    if (lintErrors > 0) {
        console.error(`[${moment().format('HH:mm:ss')}] Build encountered ${lintErrors} lint errors`);
    }

    if (buildErrors > 0) {
        console.error(`[${moment().format('HH:mm:ss')}] Build encountered ${buildErrors} build errors`);
    }

    if (buildErrors > 0 || lintErrors > 0) {
        process.exit(1);
    }

    cb();
});

// ----------------------------------
// Watch Tasks
// ----------------------------------

gulp.task('watch', cb => {
    runSequence(
        'clean',
        [
            'build-api',
            'watch-lib',
            'watch-app',
            'watch-debug',
            'watch-styles',
            'watch-svg-icons',
            'watch-assets'
        ],
        cb
    );
});

gulp.task('watch-lib', ['build-lib'], () => {
    return $.watch('bower.json', () => {
        // Invalidate the cached bower.json.
        delete require.cache[require.resolve('bower.json')];
        runSequence('build-lib');
    });
});

gulp.task('watch-app', ['lint-app', 'build-js-style'], () => {
    return bundleCode('app', true);
});

gulp.task('watch-debug', ['lint-debug'], () => {
    return bundleCode('debug', true);
});

gulp.task('watch-styles', ['compile-styles'], () => {
    return $.watch(['src/app/**/*.less'], event => {
        // A workaround for https://github.com/stevelacy/gulp-less/issues/283#ref-issue-306992692
        // (with underlaying bug https://github.com/less/less.js/issues/3185)
        const fileManagers = less.environment && less.environment.fileManagers || [];
        fileManagers.forEach(function (fileManager) {
            const relativePath = path.relative(process.cwd(), event.path);
            if (fileManager.contents && fileManager.contents[relativePath]) {
                // clear the changed file cache;
                fileManager.contents[relativePath] = null;
            }
        });

        runSequence('compile-styles');
    });
});

gulp.task('watch-svg-icons', ['generate-svg-icons'], () => {
    return $.watch([ 'src/assets/icons/*.svg' ], () => {
        runSequence('generate-svg-icons');
    });
});

gulp.task('watch-assets', ['copy'], () => {
    return $.watch(
        staticAssetsSelector,
        vinyl => injectVersion(vinyl.path)
    );
});

// ----------------------------------
// Test tasks
// ----------------------------------
gulp.task('test', () => {
    return gulp.src('src/tests/index.js')
        .pipe($.mocha({ reporter: 'spec' }));
});

// ----------------------------------
// Helper functions
// ----------------------------------

function spawnAsync(command, options) {
    return new Promise((resolve, reject) => {
        const [cmd, ...args] = command.split(/\s+/);
        spawn(cmd, args, Object.assign({ stdio: 'inherit' }, options))
            .on('exit', code => code === 0 ?
                resolve() :
                reject(new Error(`spawn "${command}" exit with error code ${code}`))
            )
            .on('error', err => reject(
                new Error(`spawn "${command}"" exited with error ${err}`)
            ));
    });
}

function createBundler(folder, useWatchify) {
    const paths = [`./src/${folder}`];

    if (useWatchify) {
        return browserify({
            debug: true,
            paths: paths,
            cache: {},
            packageCache: {},
            plugin: [ watchify ]
        })
            .on('update', modules => console.log(
                `[${moment().format('HH:mm:ss')}] Change detected in '${modules}' rebundling...`
            ))
            .on('time', t => console.log(
                `[${moment().format('HH:mm:ss')}] Bundling ended after ${t/1000} s`
            ));

    } else {
        return browserify({
            debug: true,
            paths: paths
        });
    }
}

function bundleCode(folder, watch) {
    const bundler = createBundler(folder, watch);
    bundler
        .require(buildPath + '/style.json', { expose: 'style' })
        .transform(babelify, {
            plugins: [
                'transform-es2015-modules-commonjs',
                'transform-object-rest-spread',
                'transform-class-properties',
                'syntax-async-generators',
                ['transform-runtime', { polyfill: false }]
            ]
        })
        .transform(stringify({ minify: uglify }))
        .add(`src/${folder}/main`);

    libs.forEach(lib => bundler.external(lib.exposeAs || lib.name));
    bundler.external('nb-api');

    const bundle = () => bundler.bundle()
        .on('error', errorHandler)
        .pipe(sourceStream(`${folder}.js`))
        .pipe(buffer())
        .pipe($.sourcemaps.init({ loadMaps: true }))
        .pipe($.if(uglify, $.uglify()))
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest(buildPath));

    if (watch) {
        bundler.on('update', () => bundle());
    }
    return bundle();
}

function letsToLessClass() {
    return through.obj(function(file, encoding, callback) {
        const contents = file.contents.toString('utf-8');
        const regExp = /@([A-Za-z0-9\-]+)\s*\:\s*(.+?)\s*;/g;
        const output =  [];

        let matches = regExp.exec(contents);
        while (matches) {
            output.push(matches[1] + ': @' + matches[1] + ';');
            matches = regExp.exec(contents);
        }

        const str = [].concat(contents, 'json {', output, '}').join('\n');
        this.push(new VFile({
            contents: new Buffer(str, 'utf-8'),
            path: 'temp.less'
        }));

        callback();
    });
}

function cssClassToJson() {
    return through.obj(function (file, encoding, callback) {
        const contents = file.contents.toString('utf-8');
        const regExp = /([A-Za-z0-9\-]+)\s*:\s*(.+?)\s*;/g;
        const output = {};

        let matches = regExp.exec(contents);
        while (matches) {
            output[matches[1]] = matches[2];
            matches = regExp.exec(contents);
        }

        this.push(new VFile({
            contents: new Buffer(JSON.stringify(output), 'utf-8'),
            path: 'style.json'
        }));

        callback();
    });
}

function injectVersion(selector) {
    return gulp.src(selector, { base: 'src' })
        .pipe($.if(
            '*.html',
            $.replace('%%NOOBAA_VERSION%%', version)
        ))
        .pipe(gulp.dest(buildPath));
}

function lint(folder) {
    return gulp.src(`src/${folder}/**/*.js`)
        .pipe($.eslint())
        .pipe($.eslint.format())
        .pipe($.eslint.results(
            result => { lintErrors = result.errorCount; }
        ));
}

function errorHandler(err) {
    ++buildErrors;
    console.log(err.toString(), '\u0007');
    this.emit('end');
}
