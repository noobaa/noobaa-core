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
let runSequence = require('run-sequence');
let through = require('through2'); 
let fs = require('fs');
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
// Full task
// ---------------------------------- 

gulp.task('full', cb => {
    runSequence(
        'build',
        'watch',
        cb
    );
});

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

gulp.task('build-app', ['build-js-style', 'ensure-server-conf'], () => {
    let b = browserify({ debug: true, paths: ['./src/app'] })
        .require(buildPath + '/style.json', { expose: 'style' })
        .transform(babelify, { optional: ['runtime', 'es7.decorators'] })
        .transform(stringify({ minify: uglify }))
        .add('src/app/main');

    libs.forEach( lib => b.external(lib.name) );
    b.external('nb-api');

    return b.bundle()
        .on('error', errorHandler)
        .pipe(sourceStream('app.js'))
        .pipe(buffer())
        .pipe($.sourcemaps.init({ loadMaps: true }))
            .pipe($.if(uglify, $.uglify()))
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest(buildPath));
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

gulp.task('ensure-server-conf', cb => {
    try { 
        fs.readFileSync('src/app/server-conf.json')
    } catch (e) {
        fs.writeFileSync('src/app/server-conf.json', '{}');
    }
    cb();
});

gulp.task('install-deps', () => {
    return gulp.src('./bower.json')
        .pipe($.install());
});

// ----------------------------------
// Watch Tasks
// ---------------------------------- 

gulp.task('watch', [ 'watch-lib', 'watch-app', 'watch-styles', 'watch-assets' ]);

gulp.task('watch-lib', () => {
    $.watch('bower.json', () => {
        // Invalidate the cached bower.json.
        delete require.cache[require.resolve('bower.json')];
        runSequence('build-lib');
    }); 
});

gulp.task('watch-app', () => {
    // Watch separated because of a gulp-watch bug.

    $.watch('src/app/**/*.js', () => {
        runSequence('build-app');
    }); 
    
    $.watch('src/app/**/*.json', () => {
        runSequence('build-app');
    });

    $.watch('src/app/**/*.html', () => {
        runSequence('build-app');
    });     

    $.watch('src/styles/variables.less', () => {
        runSequence('build-app');
    });     
});

gulp.task('watch-styles', () => {
    $.watch(['src/app/**/*.less'], () => {
        runSequence('compile-styles')
    });
});

gulp.task('watch-assets', () => {
    $.watch(['src/index.html', 'src/assets/**/*'], function(vinyl) {
        // Copy the file that changed.
        gulp.src(vinyl.path, { base: 'src' })
            .pipe(gulp.dest(buildPath));
    }); 
})

// ----------------------------------
// Web Server Tasks
// ----------------------------------
let wsStream;
gulp.task('serve', () => {
    wsStream && esStream.emit('kill');

    wsStream = gulp.src(buildPath)
        .pipe($.webserver({
            fallback: '/index.html',
            open: '/fe',
            path: '/fe',
            middleware: cacheControl(60),
        }));

    return wsStream;
})

// ----------------------------------
// Helper functions
// ---------------------------------- 
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

function cacheControl(seconds) {
    let millis = 1000 * seconds;
    return function(req, res, next) {
        res.setHeader("Cache-Control", "public, max-age=" + seconds);
        res.setHeader("Expires", new Date(Date.now() + millis).toUTCString());
        return next();
    };
}