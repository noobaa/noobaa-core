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
const through = require('through2');
const moment = require('moment');
const spawn = require('child_process').spawn;
const $ = require('gulp-load-plugins')();
const { version } = require('../package.json');

const cwd = process.cwd();
const libPath = './src/lib';
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

const dependencies = [
    {
        name: 'knockout',
        dir: 'bower_components/knockout',
        codeFile: 'dist/knockout.debug.js'
    },
    {
        name: 'knockout-projections',
        dir: 'bower_components/knockout-projections',
        codeFile: 'dist/knockout-projections.min.js'
    },
    {
        name: 'knockout-validation',
        dir: 'bower_components/knockout-validation',
        codeFile: 'dist/knockout.validation.js'
    },
    {
        name: 'numeral',
        dir: 'node_modules/numeral',
        codeFile: 'numeral.js'
    },
    {
        name: 'page',
        dir: 'bower_components/page',
        codeFile: 'page.js'
    },
    {
        name: 'moment',
        dir: 'bower_components/moment',
        codeFile: 'moment.js'
    },
    {
        name: 'moment-timezone',
        dir: 'bower_components/moment-timezone',
        codeFile: 'builds/moment-timezone-with-data.js'
    },
    {
        name: 'shifty',
        dir: 'bower_components/shifty',
        build: 'npm run build',        
        codeFile: 'dist/shifty.js'
    },
    {
        name: 'aws-sdk',
        dir: '../node_modules/aws-sdk',
        codeFile: '/dist/aws-sdk.min.js'
    },
    {
        name: 'jszip',
        dir: 'bower_components/jszip',
        codeFile: 'dist/jszip.js'
    },
    {
        name: 'chartjs',
        dir: 'bower_components/chart.js',
        codeFile: 'dist/Chart.js',
    },
    {
        name: 'big-integer',
        dir: 'bower_components/big-integer',
        codeFile: 'BigInteger.min.js'
    },
    {
        name: 'prism',
        dir: 'bower_components/prism',
        codeFile: 'prism.js',
        assets: [
            'themes/prism-tomorrow.css'
        ]
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

const installOptions = {
    bower: {}
};

if (process.env.ALLOW_ROOT) {
    installOptions.bower.allowRoot = true;
}

// ----------------------------------
// Dependencies build tesks
// ----------------------------------

function cleanDeps() {
    return del([libPath]);
}

function installDeps() {
    return gulp.src('./bower.json')
        .pipe($.install(installOptions));
}

function compileDeps(done) {
    const depsToBuild = dependencies
        .filter(dep => dep.build)
        .map(dep => {
            const workingDir = path.join(cwd, dep.dir);
            const pkgFile = path.join(workingDir, 'package.json');
            const command = dep.build;
            return { workingDir, pkgFile, command };
        });

    gulp.src(depsToBuild.map(dep => dep.pkgFile))
        .pipe($.install(installOptions, () => {
            const builds = depsToBuild.map(dep => 
                spawnAsync(dep.command, { cwd: dep.workingDir })
            );
            Promise.all(builds).then(
                () => done(),
                done
            );
        }))
        .on('error', errorHandler);
}

function bundleDeps() {
    const b = browserify({
        debug: true,
        noParse: true
    });

    for (const { name, dir, codeFile } of dependencies) {
        const fullPath = path.join(cwd, dir, codeFile);
        b.require(fullPath, { expose: name });
    }

    return b.bundle()
        .on('error', errorHandler)
        .pipe(sourceStream('lib.js'))
        .pipe(buffer())
        .pipe($.sourcemaps.init({ loadMaps: true }))
        .pipe($.if(uglify, $.uglify()))
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest(libPath));
}

function copyDepsAssets() {
    const assetsToCopy = [];
    for (const { dir, assets = [] } of dependencies) {
        const workginDir = path.join(cwd, dir);
        for (const assetPath of assets) {
            assetsToCopy.push(path.join(workginDir, assetPath));
        }
    }

    return gulp.src(assetsToCopy)
        .pipe(gulp.dest(libPath));
}

// ----------------------------------
// Main build tesks
// ----------------------------------

function clean() {
    return del([buildPath]);
}

function buildAPI() {
    const b = browserify({
        paths: ['./node_modules'],
        debug: true
    });

    // Ignore unused files.
    apiBlackList.forEach(
        file => {
            const path = require.resolve(`../src/rpc/${file}`);
            formattedLog('buildAPI', `Ignoring ${path}`);
            b.ignore(path);
        }
    );

    b.transform(babelify, {
        plugins: ['@babel/plugin-transform-runtime']
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
}

function lintApp() {
    return lintFolder('app');
}

function buildJSStyle() {
    return gulp.src('src/app/styles/constants.less', { base: 'src/app/styles' })
        .pipe(letsToLessClass())
        .pipe($.less())
        .pipe(cssClassToJson())
        .pipe(gulp.dest(buildPath));
}

function bundleApp() {
    return bundleCode('app', false);
}

function copyLib() {
    return gulp.src(path.join(libPath, '*'))
        .pipe($.rename(({ dirname: '' })))
        .pipe(gulp.dest(buildPath));
}

function compileStyles() {
    return gulp.src('src/app/**/*.less', { base: '.' })
        .pipe($.lessImport('styles.less'))
        .pipe($.sourcemaps.init())
        .pipe($.less())
        .on('error', errorHandler)
        .pipe($.if(uglify, $.cleanCss()))
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest(buildPath));
}

function generateSVGIcons() {
    return gulp.src('src/assets/icons/*.svg')
        .pipe($.rename({ suffix: '-icon' }))
        .pipe($.svgstore({ inlineSvg: true }))
        .pipe(gulp.dest(path.join(buildPath, 'assets')));
}

function copyAssets() {
    return injectVersion(staticAssetsSelector);
}

function lintDebug() {
    return lintFolder('debug');
}

function bundleDebug() {
    return bundleCode('debug', false);
}

function verifyBuild() {
    if (lintErrors > 0) {
        console.error(`[${moment().format('HH:mm:ss')}] Build encountered ${lintErrors} lint errors`);
    }

    if (buildErrors > 0) {
        console.error(`[${moment().format('HH:mm:ss')}] Build encountered ${buildErrors} build errors`);
    }

    if (buildErrors > 0 || lintErrors > 0) {
        process.exit(1);
    }

    return Promise.resolve();
}

// ----------------------------------
// Continuous developnent tasks 
// ----------------------------------

function watchApp(){
    return bundleCode('app', true);
}

function watchLib() {
    return gulp.watch([path.join(libPath, '*')])
        .on('all', (_, path) => {
            formattedLog('watchLib', `Change detected in '${path}' recopying...`);
            gulp.src(path)
                .pipe($.rename({ dirname: '' }))
                .pipe(gulp.dest(buildPath));
        });
}

function watchDebug() {
    return bundleCode('debug', true);
}

function watchStyles() {
    return gulp.watch(
        ['src/app/**/*.less'],
        compileStyles
    );
}

function watchSVGIcons() {
    return gulp.watch(
        [ 'src/assets/icons/*.svg' ],
        generateSVGIcons
    );
}

function watchAssets() {
    return gulp.watch(staticAssetsSelector)
        .on('all', (_, path) => {
            formattedLog('watchAssets', `Change detected in '${path}' recopying...`);
            injectVersion(path);
        });
}

// ----------------------------------
// Test tesks
// ----------------------------------

function test() {
    return gulp.src('src/tests/index.js')
        .pipe($.mocha({ reporter: 'spec' }));
}

// ----------------------------------
// Composite Tasks
// ----------------------------------

const buildDeps = gulp.series(
    cleanDeps,
    installDeps,
    compileDeps,
    gulp.parallel(
        bundleDeps,
        copyDepsAssets
    )
);

const buildApp = gulp.series(
    gulp.parallel(
        lintApp,
        buildJSStyle
    ),
    bundleApp
);

const buildDebug = gulp.series(
    lintDebug,
    bundleDebug
);

const lint = gulp.parallel(
    lintApp,
    lintDebug
);

const build = gulp.series(
    clean,
    gulp.parallel(
        buildAPI,
        buildApp,
        buildDebug,
        copyLib,
        compileStyles,
        generateSVGIcons,
        copyAssets
    ),
    verifyBuild
);

const watch = gulp.series(
    build,
    gulp.parallel(
        watchLib,
        watchApp,
        watchDebug,
        watchStyles,
        watchSVGIcons,
        watchAssets
    )
);

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
            .on('update', modules => {
                formattedLog('browserify', `Change detected in '${modules}' rebundling...`);
            })
            .on('time', t => {
                formattedLog('browserify', `Bundling ended after ${t/1000} s`);
            });

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
                '@babel/plugin-transform-modules-commonjs',
                '@babel/plugin-proposal-class-properties',
                '@babel/plugin-syntax-async-generators',
                '@babel/plugin-transform-runtime'
            ]
        })
        .transform(stringify({ minify: uglify }))
        .add(`src/${folder}/main`);

    dependencies.forEach(lib => bundler.external(lib.name));
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
        const output = [];

        let matches = regExp.exec(contents);
        while (matches) {
            output.push(matches[1] + ': @' + matches[1] + ';');
            matches = regExp.exec(contents);
        }

        const str = [].concat(contents, 'json {', output, '}').join('\n');
        this.push(new VFile({
            contents: Buffer.from(str, 'utf-8'),
            path: 'temp.less'
        }));

        callback();
    });
}

function cssClassToJson() {
    return through.obj(function(file, encoding, callback) {
        const contents = file.contents.toString('utf-8');
        const regExp = /([A-Za-z0-9\-]+)\s*:\s*(.+?)\s*;/g;
        const output = {};

        let matches = regExp.exec(contents);
        while (matches) {
            output[matches[1]] = matches[2];
            matches = regExp.exec(contents);
        }

        this.push(new VFile({
            contents: Buffer.from(JSON.stringify(output), 'utf-8'),
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

function lintFolder(folder) {
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

function formattedLog(task, message) {
    console.log(`[${moment().format('HH:mm:ss')}] ${task}: ${message}`);
}

// ----------------------------------
// Exported task list
// ----------------------------------

Object.assign(exports, {
    cleanDeps,
    buildDeps,
    clean,
    build,
    buildAPI,
    buildApp,
    buildDebug,
    copyLib,
    compileStyles,
    lint,
    watch,
    test
});

