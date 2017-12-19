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
const $ = require('gulp-load-plugins')();

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
    { name: 'knockout',             path: './src/lib/knockout/dist/knockout.debug.js' },
    { name: 'knockout-projections', path: './src/lib/knockout-projections/dist/knockout-projections.min.js' },
    { name: 'knockout-validation',  path: './src/lib/knockout-validation/dist/knockout.validation.js' },
    { name: 'numeral',              path: './src/lib/numeral/numeral.js' },
    { name: 'page',                 path: './src/lib/page/page.js' },
    { name: 'moment',               path: './src/lib/moment/moment.js' },
    { name: 'moment-timezone',      path: './src/lib/moment-timezone/builds/moment-timezone-with-data.js' },
    { name: 'shifty',               path: './src/lib/shifty/dist/shifty.js' },
    { name: 'aws-sdk',              path: './src/lib/aws-sdk/dist/aws-sdk.js' },
    { name: 'jszip',                path: './src/lib/jszip/dist/jszip.js' },
    { name: 'chartjs',              path: './src/lib/chart.js/dist/Chart.js' },
    { name: 'rx',                   path: './src/lib/rxjs/dist/rx.lite.js' },
    { name: 'big-integer',          path: './src/lib/big-integer/BigInteger.min.js' }
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

gulp.task('build-lib', ['install-deps'], () => {
    const b = browserify({
        debug: true,
        noParse: true
    });

    libs.forEach(
        lib => b.require(lib.path, { expose: lib.name })
    );

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
    return bundleApp(false);
});

gulp.task('compile-styles', () => {
    return gulp.src(['src/app/**/*.less'], { base: '.' })
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
    return gulp.src(
        staticAssetsSelector,
        { base: 'src' }
    )
        .pipe(gulp.dest(buildPath));
});

gulp.task('build-js-style', () => {
    return gulp.src('src/app/styles/variables.less', { base: 'src/app/styles' })
        .pipe(letsToLessClass())
        .pipe($.less())
        .pipe(cssClassToJson())
        .pipe(gulp.dest(buildPath));
});

gulp.task('install-deps', () => {
    return gulp.src('./bower.json')
        .pipe($.install());
});

gulp.task('lint-app', () => {
    return gulp.src('src/app/**/*.js')
        .pipe($.eslint())
        .pipe($.eslint.format())
        .pipe($.eslint.results(
            result => { lintErrors = result.errorCount; }
        ));
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
    return bundleApp(true);
});

gulp.task('watch-styles', ['compile-styles'], () => {
    return $.watch(['src/app/**/*.less'], () => {
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
        vinyl => {
            // Copy the file that changed.
            gulp.src(vinyl.path, { base: 'src' })
                .pipe(gulp.dest(buildPath));
        }
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
function createBundler(useWatchify) {
    let bundler;
    if (useWatchify) {
        bundler = browserify({
            debug: true,
            paths: ['./src/app'],
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
        bundler = browserify({
            debug: true,
            paths: ['./src/app']
        });
    }

    return bundler;
}

function bundleApp(watch) {
    const bundler = createBundler(watch);
    bundler
        .require(buildPath + '/style.json', { expose: 'style' })
        .transform(babelify, {
            plugins: [
                'transform-es2015-modules-commonjs',
                'transform-async-to-generator',
                'transform-object-rest-spread',
                ['transform-runtime', { polyfill: false }]
            ]
        })
        .transform(stringify({ minify: uglify }))
        .add('src/app/main');

    libs.forEach(lib => bundler.external(lib.name));
    bundler.external('nb-api');

    const bundle = () => bundler.bundle()
        .on('error', errorHandler)
        .pipe(sourceStream('app.js'))
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

function errorHandler(err) {
    ++buildErrors;
    console.log(err.toString(), '\u0007');
    this.emit('end');
}
