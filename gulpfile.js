'use strict';

var gulp = require('gulp');
var gutil = require('gulp-util');
var gulp_debug = require('gulp-debug');
var gulp_size = require('gulp-size');
var gulp_concat = require('gulp-concat');
var gulp_replace = require('gulp-replace');
var gulp_cached = require('gulp-cached');
var gulp_newer = require('gulp-newer');
var gulp_filter = require('gulp-filter');
var gulp_plumber = require('gulp-plumber');
var gulp_notify = require('gulp-notify');
var gulp_less = require('gulp-less');
var gulp_uglify = require('gulp-uglify');
var gulp_minify_css = require('gulp-minify-css');
var gulp_rename = require('gulp-rename');
var gulp_ng_template = require('gulp-angular-templatecache');
var gulp_jshint = require('gulp-jshint');
var jshint_stylish = require('jshint-stylish');
var vinyl_buffer = require('vinyl-buffer');
var vinyl_source_stream = require('vinyl-source-stream');
var browserify = require('browserify');
var event_stream = require('event-stream');
var gulp_mocha = require('gulp-mocha');
var gulp_istanbul = require('gulp-istanbul');
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var dotenv = require('dotenv');
var through2 = require('through2');
var bower = require('bower');
var Q = require('q');
var _ = require('lodash');

if (!process.env.PORT) {
    console.log('loading .env file ( no foreman ;)');
    dotenv.load();
}

var active_server;

function leave_no_wounded(err) {
    if (err) {
        console.log(err.stack);
    }
    if (active_server) {
        console.log('LEAVE NO WOUNDED - kill active server', active_server.pid);
        active_server.removeAllListeners('error');
        active_server.removeAllListeners('exit');
        active_server.kill('SIGKILL');
    }
    gutil.beep();
    gutil.beep();
    process.exit();
}
process.on("uncaughtException", leave_no_wounded);
process.on("SIGINT", leave_no_wounded);
process.on("SIGTERM", leave_no_wounded);


var PATHS = {
    css: './src/css/**/*',
    css_candidates: ['./src/css/styles.less'],
    fonts: [
        './node_modules/bootstrap/dist/fonts/*',
        './node_modules/font-awesome/fonts/*',
    ],
    fonts2: [
        './node_modules/video.js/dist/video-js/font/*',
    ],
    assets: [
        './node_modules/video.js/dist/video-js/video-js.swf',
    ],

    ngview: './src/ngview/**/*',
    scripts: ['./src/**/*.js', './*.js'],
    test_scripts: './src/**/test*.js',
    html_scripts: [
        // './src/views/adminoobaa.html'
    ],

    server_main: './src/server/web_server.js',
    client_bundle: './src/client/bundle.js',
    agent_bundle: './src/agent/bundle.js',
    client_externals: [
        './node_modules/bootstrap/dist/js/bootstrap.min.js',
        './bower_components/ladda/dist/spin.min.js',
        './bower_components/ladda/dist/ladda.min.js',
        './node_modules/masonry.js/dist/masonry.pkgd.min.js',
        './bower_components/alertify.js/lib/alertify.min.js',
        './node_modules/video.js/dist/video-js/video.dev.js',
        // './vendor/flowplayer-5.4.6/flowplayer.js',
    ],
};

var SRC_DONT_READ = {
    read: false
};

function gulp_size_log(title) {
    return gulp_size({
        title: title
    });
}

function simple_bower() {
    // create a pass through stream
    var done;
    var stream = through2.obj(function(file, enc, callback) {
        var self = this;
        if (done) {
            self.push(file);
            callback();
            return;
        }
        done = true;
        bower.commands.install([], {}, {
            directory: './bower_components'
        }).on('log', function(result) {
            gutil.log('bower', gutil.colors.cyan(result.id), result.message);
        }).on('error', function(error) {
            stream.emit('error', new gutil.PluginError('simple_bower', error));
            stream.end();
            callback();
        }).on('end', function() {
            self.push(file);
            stream.end();
            callback();
        });
    });
    return stream;
}

function candidate(candidate_src) {
    var done;
    var stream = through2.obj(function(file, enc, callback) {
        var self = this;
        if (done) {
            return callback();
        }
        done = true;
        gulp.src(candidate_src).pipe(through2.obj(function(c_file, c_enc, c_callback) {
            self.push(c_file);
            c_callback();
        }, function() {
            callback();
        }));
    });
    return stream;
}

var PLUMB_CONF = {
    errorHandler: gulp_notify.onError("Error: <%= error.message %>")
};

gulp.task('bower', function() {
    var DEST = 'build';
    var NAME = 'bower.json';
    return gulp.src(NAME)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(path.join(DEST, NAME)))
        .pipe(simple_bower())
        .pipe(gulp.dest(DEST));
});

gulp.task('assets', ['bower'], function() {
    var DEST = 'build/public';
    var FONTS_DEST = 'build/public/fonts';
    var FONTS2_DEST = 'build/public/css/font';
    return Q.all([
        gulp.src(PATHS.assets)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(DEST))
        .pipe(gulp.dest(DEST)),
        gulp.src(PATHS.fonts)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(FONTS_DEST))
        .pipe(gulp.dest(FONTS_DEST)),
        gulp.src(PATHS.fonts2)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(FONTS2_DEST))
        .pipe(gulp.dest(FONTS2_DEST))
    ]);
});

gulp.task('css', ['bower'], function() {
    var DEST = 'build/public/css';
    var NAME = 'styles.css';
    var NAME_MIN = 'styles.min.css';
    return gulp.src(PATHS.css, SRC_DONT_READ)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(path.join(DEST, NAME)))
        .pipe(candidate(PATHS.css_candidates))
        .pipe(gulp_less())
        .pipe(gulp_rename(NAME))
        .pipe(gulp_size_log(NAME))
        .pipe(gulp.dest(DEST))
        .pipe(gulp_minify_css())
        .pipe(gulp_rename(NAME_MIN))
        .pipe(gulp_size_log(NAME_MIN))
        .pipe(gulp.dest(DEST));
});

gulp.task('ng', function() {
    var DEST = 'build/';
    var NAME = 'templates.js';
    return gulp.src(PATHS.ngview)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(path.join(DEST, NAME)))
        .pipe(gulp_ng_template({
            standalone: true
        }))
        .pipe(gulp_size_log(NAME))
        .pipe(gulp.dest(DEST));
});

gulp.task('jshint', function() {
    return gulp.src(_.flatten([PATHS.scripts, PATHS.html_scripts]))
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_cached('jshint'))
        .pipe(gulp_jshint.extract('always'))
        .pipe(gulp_jshint())
        .pipe(gulp_jshint.reporter(jshint_stylish));
    // avoid failing for watch to continue
    // .pipe(gulp_jshint.reporter('fail'));
});

gulp.task('client', ['bower', 'ng'], function() {
    var DEST = 'build/public/js';
    var NAME = 'bundle.js';
    var NAME_MIN = 'bundle.min.js';
    var bundler = browserify({
        entries: [PATHS.client_bundle, PATHS.agent_bundle],
        debug: (process.env.DEBUG_MODE === 'true'),

        // TODO this browserify config will not work in node-webkit....

        // bare is alias for both --no-builtins, --no-commondir,
        // and sets --insert-global-vars to just "__filename,__dirname".
        // This is handy if you want to run bundles in node.
        // bare: true,
        // detectGlobals: false,
        // list: true,
    });
    // using gulp_replace to fix collision of requires
    var client_bundle_stream = bundler.bundle()
        .pipe(vinyl_source_stream(NAME))
        .pipe(vinyl_buffer())
        .pipe(gulp_replace(/\brequire\b/g, 'require_browserify'))
        .pipe(gulp_replace(/\brequire_node\b/g, 'require'));
    var client_merged_stream = event_stream.merge(
        client_bundle_stream,
        gulp.src(PATHS.client_externals)
    );
    return client_merged_stream
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_concat(NAME))
        .pipe(gulp_size_log(NAME))
        .pipe(gulp.dest(DEST))
        .pipe(gulp_cached(NAME))
        .pipe(gulp_uglify())
        .pipe(gulp_rename(NAME_MIN))
        .pipe(gulp_size_log(NAME_MIN))
        .pipe(gulp.dest(DEST));
});


gulp.task('mocha', function() {
    var mocha_options = {
        reporter: 'spec'
    };
    return gulp.src(PATHS.scripts)
        .pipe(gulp_istanbul())
        .on('finish', function() {
            return gulp.src(PATHS.test_scripts, SRC_DONT_READ)
                .pipe(gulp_mocha(mocha_options))
                .pipe(gulp_istanbul.writeReports());
        });
});

gulp.task('test', ['jshint', 'mocha']);


function serve() {
    if (active_server) {
        console.log(' ');
        console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        console.log('~~~      KILL SERVER       ~~~ (pid=' + active_server.pid + ')');
        console.log('~~~ (wait exit to respawn) ~~~');
        console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        console.log(' ');
        active_server.kill();
        return;
    }
    console.log(' ');
    console.log('~~~~~~~~~~~~~~~~~~~~~~');
    console.log('~~~  START SERVER  ~~~');
    console.log('~~~~~~~~~~~~~~~~~~~~~~');
    console.log(' ');
    active_server = child_process.fork(
        path.basename(PATHS.server_main), [], {
            cwd: path.dirname(PATHS.server_main)
        }
    );
    active_server.on('error', function(err) {
        console.error(' ');
        console.error('~~~~~~~~~~~~~~~~~~~~~~');
        console.error('~~~  SERVER ERROR  ~~~', err);
        console.error('~~~~~~~~~~~~~~~~~~~~~~');
        console.error(' ');
        gutil.beep();
    });
    active_server.on('exit', function(code, signal) {
        console.error(' ');
        console.error('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        console.error('~~~       SERVER EXIT       ~~~ (rc=' + code + ')');
        console.error('~~~  (respawn in 1 second)  ~~~');
        console.error('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        console.error(' ');
        active_server = null;
        setTimeout(serve, 1);
    });
    gulp_notify('noobaa serving...').end('stam');
}

gulp.task('install', ['bower', 'assets', 'css', 'ng', 'jshint', 'client']);
gulp.task('install_and_serve', ['install'], serve);
gulp.task('install_css_and_serve', ['css'], serve);
gulp.task('install_server_and_serve', ['jshint'], serve);
gulp.task('install_client_and_serve', ['jshint', 'client'], serve);

gulp.task('start_dev', ['install_and_serve'], function() {
    gulp.watch('src/css/**/*', ['install_css_and_serve']);
    gulp.watch([
        'src/server/**/*',
        'src/views/**/*'
    ], ['install_server_and_serve']);
    gulp.watch([
        'src/client/**/*',
        'src/agent/**/*',
        'src/api/**/*',
        'src/util/**/*',
        'src/ngview/**/*',
    ], ['install_client_and_serve']);
});

gulp.task('start_prod', function() {
    console.log('~~~ START PROD ~~~');
    require(path.join('..', PATHS.server_main));
});

if (process.env.DEV_MODE === 'true') {
    gulp.task('start', ['start_dev']);
} else {
    gulp.task('start', ['start_prod']);
}

gulp.task('default', ['start']);
