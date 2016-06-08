'use strict';
let argv = require('yargs').argv;
let gulp = require('gulp');
let del = require('del');
let VFile = require('vinyl');
let sourceStream = require('vinyl-source-stream');
let buffer = require('vinyl-buffer');
let browserify = require('browserify');
let stringify = require('stringify');
let babelify = require('babelify');
let watchify = require('watchify');
let runSequence = require('run-sequence');
let through = require('through2'); 
let fs = require('fs');
let moment = require('moment');
let $ = require('gulp-load-plugins')();

let buildPath = './dist';
let uglify = !!argv.uglify;

let libs = [
    { name: 'knockout',             path: './src/lib/knockout/dist/knockout.debug.js' },
    { name: 'knockout-mapping',     path: './src/lib/knockout-mapping/knockout.mapping' },
    { name: 'knockout-projections', path: './src/lib/knockout-projections/dist/knockout-projections.min.js' },
    { name: 'knockout-validation',  path: './src/lib/knockout-validation/dist/knockout.validation.js' },
    { name: 'numeral',              path: './src/lib/numeral/numeral.js' },
    { name: 'page',                 path: './src/lib/page/page.js' },
    { name: 'moment',               path: './src/lib/moment/moment.js' },
    { name: 'moment-timezone',      path: './src/lib/moment-timezone/builds/moment-timezone-with-data.js' },
    { name: 'shifty',               path: './src/lib/shifty/dist/shifty.js' },
    { name: 'aws-sdk',              path: './src/lib/aws-sdk/dist/aws-sdk.js' },
];

// ----------------------------------
// Build Tasks
// ---------------------------------- 

gulp.task('build', cb => {
    runSequence(
        'clean',
        ['build-lib', 'build-api', 'build-app', 'compile-styles', 'copy'],
        cb
    );
});

gulp.task('clean', cb => {
    del([buildPath]).then(() => {
        cb();
    });
});

gulp.task('build-lib', ['install-deps'], () => {
    let b = browserify({ debug: true, noParse: true });
    
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
    let b = browserify({ debug: true });
    
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

gulp.task('build-app', ['build-js-style'], () => {
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

gulp.task('copy', () => {
    return gulp.src(['src/index.html', 'src/assets/**/*'], { base: 'src' })
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

// ----------------------------------
// Watch Tasks
// ---------------------------------- 

gulp.task('watch', cb => {
    runSequence(
        'clean',
        ['build-api', 'watch-lib', 'watch-app', 'watch-styles', 'watch-assets'],
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

gulp.task('watch-app', ['build-js-style'], () => {
    return bundleApp(true);
});

gulp.task('watch-styles', ['compile-styles'], () => {
    return $.watch(['src/app/**/*.less'], () => {
        runSequence('compile-styles')
    });
});

gulp.task('watch-assets', ['copy'], () => {
    return $.watch(['src/index.html', 'src/assets/**/*'], function(vinyl) {
        // Copy the file that changed.
        gulp.src(vinyl.path, { base: 'src' })
            .pipe(gulp.dest(buildPath));
    }); 
})

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
    let bundler = createBundler(watch);
    bundler
        .require(buildPath + '/style.json', { expose: 'style' })
        .transform(babelify, { optional: ['runtime', 'es7.decorators'] })
        .transform(stringify({ minify: uglify }))
        .add('src/app/main');

    libs.forEach(
        lib => bundler.external(lib.name) 
    );
    bundler.external('nb-api');

    let bundle = function() {
         return bundler.bundle()
            .on('error', errorHandler)
            .pipe(sourceStream('app.js'))
            .pipe(buffer())
            .pipe($.sourcemaps.init({ loadMaps: true }))
                .pipe($.if(uglify, $.uglify()))
            .pipe($.sourcemaps.write('./'))
            .pipe(gulp.dest(buildPath));
    }

    if (watch) {
        bundler.on('update', () => bundle())
    }
    return bundle();
}

function letsToLessClass() {
    return through.obj(function(file, encoding, callback) {
        let contents = file.contents.toString('utf-8');
        let regExp = /@([A-Za-z0-9\-]+)\s*\:\s*(.+?)\s*;/g;
        let output =  [];

        let matches = regExp.exec(contents);
        while (matches) {
            output.push(matches[1] + ': @' + matches[1] + ';')
            matches = regExp.exec(contents);
        }

        let str = [].concat(contents, 'json {', output, '}').join('\n');
        this.push(new VFile({
            contents: new Buffer(str, 'utf-8'),
            path: "temp.less"
        }));
            
        callback();
    });
}

function cssClassToJson() {
    return through.obj(function(file, encoding, callback) {
        let contents = file.contents.toString('utf-8');
        let regExp = /([A-Za-z0-9\-]+)\s*:\s*(.+?)\s*;/g;
        let output = {};

        let matches = regExp.exec(contents);
        while (matches) {
            output[matches[1]] = matches[2];
            matches = regExp.exec(contents);
        }

        this.push(new VFile({
            contents: new Buffer(JSON.stringify(output), 'utf-8'),
            path: "style.json"
        }));

        callback();
    });
}

function errorHandler(err) {
    console.log(err.toString(), '\u0007');
    this.emit('end');
}
