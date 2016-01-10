'use strict';

var gulp = require('gulp');
var gutil = require('gulp-util');
// var gulp_debug = require('gulp-debug');
var gulp_replace = require('gulp-replace');
// var gulp_filter = require('gulp-filter');
var gulp_size = require('gulp-size');
var gulp_concat = require('gulp-concat');
var gulp_cached = require('gulp-cached');
var gulp_newer = require('gulp-newer');
var gulp_plumber = require('gulp-plumber');
var gulp_notify = require('gulp-notify');
var gulp_less = require('gulp-less');
var gulp_uglify = require('gulp-uglify');
var gulp_minify_css = require('gulp-minify-css');
var gulp_sourcemaps = require('gulp-sourcemaps');
var gulp_rename = require('gulp-rename');
var gulp_tar = require('gulp-tar');
var gulp_gzip = require('gulp-gzip');
var gulp_json_editor = require('gulp-json-editor');
var gulp_ng_template = require('gulp-angular-templatecache');
var gulp_jshint = require('gulp-jshint');
var gulp_eslint = require('gulp-eslint');
var jshint_stylish = require('jshint-stylish');
var vinyl_buffer = require('vinyl-buffer');
var vinyl_source_stream = require('vinyl-source-stream');
var browserify = require('browserify');
var event_stream = require('event-stream');
var gulp_mocha = require('gulp-mocha');
var gulp_istanbul = require('gulp-istanbul');
// var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var dotenv = require('dotenv');
var through2 = require('through2');
var bower = require('bower');
var Q = require('q');
var _ = require('lodash');
var promise_utils = require('./src/util/promise_utils');
var pkg = require('./package.json');
var current_pkg_version;

if (!process.env.PORT) {
    console.log('loading .env file ( no foreman ;)');
    dotenv.load();
}

var active_services = {};
var build_on_premise = true;
var skip_install = false;
var use_local_executable = false;
var git_commit = "DEVONLY";

for (var arg_idx = 0; arg_idx < process.argv.length; arg_idx++) {
    if (process.argv[arg_idx] === '--on_premise') {
        build_on_premise = true;
    }
    if (process.argv[arg_idx] === '--saas') {
        build_on_premise = false;
    }
    if (process.argv[arg_idx] === '--skip_install') {
        skip_install = true;
    }
    if (process.argv[arg_idx] === '--local') {
        use_local_executable = true;
    }
    if (process.argv[arg_idx] === '--GIT_COMMIT') {
        git_commit = process.argv[arg_idx + 1].substr(0, 7);
    }
}

current_pkg_version = pkg.version + '-' + git_commit;
console.log('current_pkg_version:', current_pkg_version);

function leave_no_wounded(err) {
    if (err) {
        console.log(err.stack);
    }
    _.each(active_services, function(service, service_name) {
        delete active_services[service_name];
        if (!service) return;
        console.log('LEAVE NO WOUNDED - kill active server', service.pid);
        service.removeAllListeners('error');
        service.removeAllListeners('exit');
        service.kill('SIGKILL');
    });
    gutil.beep();
    gutil.beep();
    process.exit();
}
process.on("uncaughtException", leave_no_wounded);
process.on("SIGINT", leave_no_wounded);
process.on("SIGTERM", leave_no_wounded);


var PATHS = {
    css: 'src/css/**/*',
    less_css: ['src/css/styles.less'],

    assets: {
        'build/public': [
            'node_modules/video.js/dist/video-js/video-js.swf'
        ],
        'build/public/css': [],
        'build/public/fonts': [
            'node_modules/bootstrap/dist/fonts/*',
            'node_modules/font-awesome/fonts/*',
            'bower_components/bootstrap-material-design/fonts/*',
        ],
        'build/public/css/font': [
            'node_modules/video.js/dist/video-js/font/*',
        ],
    },

    ngview: 'src/ngview/**/*',
    scripts: ['src/**/*.js', '*.js'],
    test_scripts: 'src/**/test*.js',
    html_scripts: [
        // 'src/views/adminoobaa.html'
    ],

    server_main: 'src/server/web_server.js',
    bg_workers_main: 'src/bg_workers/bg_workers_starter.js',
    agent_main: 'src/agent/agent_cli.js',
    s3_main: 'src/s3/s3rver.js',
    client_bundle: 'src/client/index.js',
    client_libs: [
        // browserify nodejs wrappers
        'fs',
        'os',
        'url',
        'util',
        'path',
        'http',
        'https',
        'buffer',
        'crypto',
        'stream',
        'assert',
        'events',
        'querystring',
        // other libs
        'lodash',
        'moment',
        'ws',
        'ip',
        'q',
        'aws-sdk',
        'bluebird',
        'generate-function',
        'performance-now',
        'is-my-json-valid',
        'concat-stream',
        'dev-null',
        'chance',
        'winston',
    ],
    client_externals: [
        'node_modules/bootstrap/dist/js/bootstrap.js',
        'vendor/arrive-2.0.0.min.js', // needed by material for dynamic content
        'bower_components/bootstrap-material-design/scripts/material.js',
        'bower_components/bootstrap-material-design/scripts/ripples.js',
        'bower_components/bootstrap-sidebar/dist/js/sidebar.js',
        'bower_components/datetimepicker/jquery.datetimepicker.js',
        'bower_components/ladda/js/spin.js',
        'bower_components/ladda/js/ladda.js',
        'bower_components/alertify.js/lib/alertify.js',
        'node_modules/selectize/dist/js/standalone/selectize.js',
        'node_modules/video.js/dist/video-js/video.dev.js',
        // 'vendor/flowplayer-5.4.6/flowplayer.js',
    ],

    agent_sources: [
        'src/agent/**/*.js',
        'src/rpc/**/*.js',
        'src/api/**/*.js',
        'src/util/**/*.js',
    ],

    NVA_Package_sources: [
        'src/api/**/*.*',
        'src/client/**/*.*',
        'src/css/**/*.*',
        'src/deploy/**/*.*',
        'src/ngview/**/*.*',
        'src/rpc/**/*.*',
        'src/s3/**/*.*',
        'src/server/**/*.*',
        'src/bg_workers/**/*.*',
        'src/util/**/*.*',
        'src/views/**/*.*',
        'src/native/**/*.*',
        'tools/**/*.*',
        'binding.gyp',
        'common.gypi'
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
    var done = false;
    return through2.obj(function(file, enc, callback) {
        var self = this;
        // only run for the first file in the stream,
        // and for the rest of the files just push them forward
        if (done) {
            self.push(file);
            callback();
            return;
        }
        done = true;
        bower.commands.install()
            .on('log', function(result) {
                gutil.log('bower', gutil.colors.cyan(result.id), result.message);
            })
            .on('error', function(err) {
                console.log('BOWER ERROR');
                self.emit('error', new gutil.PluginError('simple_bower', err));
            })
            .on('end', function() {
                console.log('BOWER END');
                self.push(file);
                callback();
            });
    });
}

/**
 * manipulates the stream so that if any file exists in the stream
 * it will push the given candidates instead of any of the files in the original stream.
 * this is useful for doing checks like gulp_newer from a group of
 * source files vs target file and if any of the sources are newer
 * then replace the stream with a specific candidate to be compiled.
 */
function candidate(candidate_src) {
    var done;
    var stream = through2.obj(function(file, enc, callback) {
        var self = this;
        if (done) {
            return callback();
        }
        done = true;
        gulp.src(candidate_src)
            .pipe(through2.obj(function(c_file, c_enc, c_callback) {
                self.push(c_file);
                c_callback();
            }, function() {
                callback();
            }));
    });
    return stream;
}

function pack(dest, name) {
    var pkg_stream = gulp
        .src('package.json')
        .pipe(gulp_json_editor(function(json) {
            var deps = _.omit(json.dependencies, function(val, key) {
                return /^gulp/.test(key) ||
                    /^vinyl/.test(key) ||
                    /^jshint/.test(key) ||
                    /^eslint/.test(key) ||
                    /^browserify/.test(key) ||
                    _.contains([
                        'bower',
                        'mocha',
                        'form-data'
                    ], key);
            });
            return {
                name: 'noobaa-NVA',
                version: current_pkg_version,
                private: true,
                main: 'index.js',
                dependencies: deps,
            };
        })).on('error', gutil.log);

    var src_stream = gulp
        .src(PATHS.NVA_Package_sources, {
            base: 'src'
        })
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('src', p.dirname);
        }));
    // TODO bring back uglify .pipe(gulp_uglify());

    var images_stream = gulp
        .src(['images/**/*', ], {
            base: 'images'
        })
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('images', p.dirname);
        }));

    var node_modules_stream = gulp
        .src(['node_modules/**/*',
            '!node_modules/babel*/**/*',    
            '!node_modules/gulp*/**/*',
            '!node_modules/bower/**/*',
            '!node_modules/node-inspector/**/*'
        ], {
            base: 'node_modules'
        })
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('node_modules', p.dirname);
        }));



    var basejs_stream = gulp.src([
        'bower.json',
        'config.js',
        'gulpfile.js',
        '.jshintrc',
        '.eslintrc'
    ], {});

    var vendor_stream = gulp
        .src(['vendor/**/*', ], {})
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('vendor', p.dirname);
        }));

    var agent_distro = gulp
        .src(['src/build/windows/noobaa_setup.exe'], {})
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('deployment', p.dirname);
        }));

    var build_stream = gulp
        .src(['build/public/**/*', ], {})
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('build/public', p.dirname);
        }));

    var build_native_stream = gulp
        .src(['build/Release/**/*', ], {})
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('build/Release', p.dirname);
        }));

    var build_fe_stream = gulp
        .src(['frontend/dist/**/*'], {})
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('frontend/dist', p.dirname);
        }));

    return event_stream
        .merge(
            pkg_stream, 
            src_stream, 
            images_stream, 
            basejs_stream,
            vendor_stream, 
            agent_distro, 
            build_stream, 
            build_native_stream, 
            build_fe_stream, 
            node_modules_stream
        )
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('noobaa-core', p.dirname);
        }))
        .pipe(gulp_tar(name))
        .pipe(gulp_gzip())
        // .pipe(gulp_size_log(NAME))
        .pipe(gulp.dest(dest));
}

var PLUMB_CONF = {
    errorHandler: gulp_notify.onError("Error: <%= error.message %>")
};

gulp.task('bower', function() {
    var DEST = 'build';
    var NAME = 'bower.json';
    return gulp
        .src(NAME)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(path.join(DEST, NAME)))
        .pipe(simple_bower())
        .pipe(gulp.dest(DEST));
});

gulp.task('assets', ['bower'], function() {
    return Q.all(_.map(PATHS.assets,
        function(src, target) {
            return gulp.src(src)
                .pipe(gulp_plumber(PLUMB_CONF))
                .pipe(gulp_newer(target))
                .pipe(gulp.dest(target));
        }
    ));
});

gulp.task('less_css', ['bower'], function() {
    var DEST = 'build/public/css';
    var NAME = 'styles.css';
    return gulp
        .src(PATHS.css, SRC_DONT_READ)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(path.join(DEST, NAME)))
        .pipe(candidate(PATHS.less_css))
        .pipe(gulp_sourcemaps.init())
        .pipe(gulp_less())
        .pipe(gulp_sourcemaps.write())
        .pipe(gulp_rename(NAME))
        .pipe(gulp_size_log(NAME))
        .pipe(gulp.dest(DEST));
});

gulp.task('css', ['less_css'], function() {
    var DEST = 'build/public/css';
    var NAME = 'styles.css';
    var NAME_MIN = 'styles.min.css';
    return gulp
        .src(path.join(DEST, NAME))
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(path.join(DEST, NAME_MIN)))
        .pipe(gulp_minify_css())
        .pipe(gulp_rename(NAME_MIN))
        .pipe(gulp_size_log(NAME_MIN))
        .pipe(gulp.dest(DEST));
});

gulp.task('ng', function() {
    var DEST = 'build/public/js';
    var NAME = 'templates.js';
    return gulp
        .src(PATHS.ngview)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_newer(path.join(DEST, NAME)))
        .pipe(gulp_ng_template({
            standalone: true
        }))
        .pipe(gulp_size_log(NAME))
        .pipe(gulp.dest(DEST));
});

gulp.task('lint', [
    'jshint',
    // 'eslint'
]);

gulp.task('eslint', function() {
    return gulp
        .src(_.flatten([PATHS.scripts, PATHS.html_scripts]))
        // eslint() attaches the lint output to the eslint property
        // of the file object so it can be used by other modules.
        .pipe(gulp_eslint())
        // eslint.format() outputs the lint results to the console.
        // Alternatively use eslint.formatEach() (see Docs).
        .pipe(gulp_eslint.format())
        // To have the process exit with an error code (1) on
        // lint error, return the stream and pipe to failOnError last.
        .pipe(gulp_eslint.failOnError());
});

gulp.task('jshint', function() {
    return gulp
        .src(_.flatten([PATHS.scripts, PATHS.html_scripts]))
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_cached('jshint'))
        .pipe(gulp_jshint.extract())
        .pipe(gulp_jshint())
        .pipe(gulp_jshint.reporter(jshint_stylish));
    // TODO uncomment once we fix issues
    // .pipe(gulp_jshint.reporter('fail'));
});

gulp.task('agent', ['lint'], function() {
    var DEST = 'build/public';
    var BUILD_DEST = 'build/windows';
    var NAME = 'noobaa-agent.tar';

    var pkg_stream = gulp
        .src('package.json')
        .pipe(gulp_json_editor(function(json) {
            var deps = _.omit(json.dependencies, function(val, key) {
                return /^gulp/.test(key) ||
                    /^vinyl/.test(key) ||
                    /^jshint/.test(key) ||
                    /^eslint/.test(key) ||
                    /^browserify/.test(key) ||
                    _.contains([
                        'bower',
                        'mocha',
                        'mongoose',
                        'bcrypt',
                        'font-awesome',
                        'bootstrap',
                        'animate.css',
                        'video.js',
                        'heapdump',
                        'atom-shell',
                        'gulp',
                        'browserify',
                        'rebuild',
                        'nodetime',
                        'newrelic',
                        'memwatch',
                        'form-data'
                    ], key);
            });
            return {
                name: 'noobaa-agent',
                version: current_pkg_version,
                private: true,
                bin: 'agent/agent_cli.js',
                main: 'agent/agent_cli.js',
                dependencies: deps,
            };
        })).on('error', gutil.log);

    var src_stream = gulp
        .src(PATHS.agent_sources, {
            base: 'src'
        });

    var basejs_stream = gulp
        .src(['config.js', ], {});

    // TODO bring back uglify .pipe(gulp_uglify());

    event_stream.pipe(gulp_rename(function(p) {
            p.dirname = path.join('package', p.dirname);
        }))
        .pipe(gulp.dest(BUILD_DEST));

    return event_stream
        .merge(pkg_stream, src_stream, basejs_stream)
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('package', p.dirname);
        }))
        .pipe(gulp_tar(NAME))
        .pipe(gulp_gzip())
        // .pipe(gulp_size_log(NAME))
        .pipe(gulp.dest(DEST));
});


function build_agent_distro() {
    gutil.log('build_agent_distro');

    var build_params = [];
    if (build_on_premise === true) {
        build_params = ['--on_premise',
            '--clean=false'
        ];
    }

    return Q.fcall(function() {
            gutil.log('build_atom_agent_win:' + JSON.stringify(build_params));
            return promise_utils.promised_spawn('src/deploy/build_atom_agent_win.sh',
                build_params, process.cwd());
        })
        .then(function() {
            gutil.log('done src/deploy/build_atom_agent_win.sh');
        })
        .then(function() {
            gutil.log('before downloading linux setup');
            return promise_utils.promised_exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://146.148.16.59:8080/job/LinuxBuild/lastBuild/artifact/build/linux/noobaa-setup' + current_pkg_version + ' >build/public/noobaa-setup',
                build_params, process.cwd());
        })
        .then(function() {
            return promise_utils.promised_exec('chmod 777 build/public/noobaa-setup*',
                build_params, process.cwd());
        })
        .then(function() {
            gutil.log('done downloading noobaa-setup for linux');
        })
        .then(null, function(error) {
            gutil.log('WARN: command src/deploy/build_atom_agent_win.sh failed ', error, error.stack);
        });
}

function build_rest_distro() {
    var build_params = [];
    if (build_on_premise === true) {
        build_params = ['--on_premise',
            '--clean=false'
        ];
    }

    return Q.fcall(function() {
            return promise_utils.promised_spawn('src/deploy/build_atom_rest_win.sh',
                build_params, process.cwd());
        })
        .then(function() {
            gutil.log('done src/deploy/build_atom_rest_win.sh');
        })
        .then(null, function(error) {
            gutil.log('WARN: command src/deploy/build_atom_rest_win.sh failed ', error);
        });
}


gulp.task('run_fe_build', function(cb) {
    // Run the fe gulp build.
    var proc = child_process.spawn(
        path.join(process.cwd(),'node_modules','.bin','gulp.cmd'),
        ['build'], 
        path.join(process.cwd(),'frontend')
    ); 

    // Redirect the process output and error streams.
    proc.stdout.pipe(process.stdout);
    proc.stderr.pipe(process.stderr);

    // Finish the task on process error or exit.
    proc.on('error', function(err) { cb(err) });
    proc.on('exit', function(code) { cb(code !== 0) });
});


function package_build_task() {
    var DEST = 'build/public';
    var NAME = 'noobaa-NVA';

    //Remove previously build package
    return Q.nfcall(child_process.exec, 'rm -f ' + DEST + '/' + NAME + '*.tar.gz')
        .then(function(res) { //build agent distribution setup
            if (!use_local_executable) {
                gutil.log('before downloading setup and rest');
                return Q.fcall(function() {
                        return promise_utils.promised_exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://127.0.0.1:8080/job/LinuxBuild/lastBuild/artifact/build/linux/noobaa-setup-' + current_pkg_version + ' >build/public/noobaa-setup-' + current_pkg_version, [], process.cwd());
                    })
                    .then(function() {
                        return promise_utils.promised_exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://127.0.0.1:8080/job/win_agent_remote/lastBuild/artifact/build/windows/noobaa-setup-' + current_pkg_version + '.exe >build/public/noobaa-setup-' + current_pkg_version + '.exe', [], process.cwd());
                    })
                    .then(function() {
                        return promise_utils.promised_exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://127.0.0.1:8080/job/win_s3_remote/lastBuild/artifact/build/windows/noobaa-s3rest-' + current_pkg_version + '.exe>build/public/noobaa-s3rest-' + current_pkg_version + '.exe', [], process.cwd());
                    })
                    .then(function() {
                        return promise_utils.promised_exec('chmod 777 build/public/noobaa-setup', [], process.cwd());
                    });
            } else {
                return;
            }
        })
        .then(function() {
            gutil.log('before downloading nvm and node package');
            return promise_utils.promised_exec('curl -o- https://raw.githubusercontent.com/creationix/nvm/master/nvm.sh >build/public/nvm.sh', [], process.cwd());
        })
        .then(function() {
            return promise_utils.promised_exec('curl -o- https://nodejs.org/dist/v4.2.2/node-v4.2.2-linux-x64.tar.xz >build/public/node-v4.2.2-linux-x64.tar.xz', [], process.cwd());
        })
        .then(function() {
            //call for packing
            return pack(DEST, NAME + "-" + current_pkg_version + '.tar');
        })
        .then(null, function(error) {
            gutil.log("error ", error, error.stack);
        });
}

if (skip_install === true) {
    gulp.task('package_build', ['lint', 'agent', 'run_fe_build'], function() {
        package_build_task();
    });
} else {
    gulp.task('package_build', ['lint', 'install', 'agent'], function() {
        package_build_task();
    });
}


gulp.task('client_libs', ['bower'], function() {
    var DEST = 'build/public/js';
    var NAME = 'libs.js';
    var NAME_MIN = 'libs.min.js';
    var bundler = browserify({
        debug: true,
    });
    _.each(PATHS.client_libs, function(lib) {
        bundler.require(lib, {
            expose: lib
        });
    });

    // using gulp_replace to fix collision of requires
    var client_libs_bundle_stream = bundler.bundle()
        .pipe(vinyl_source_stream(NAME))
        .pipe(vinyl_buffer());
    var client_merged_stream = event_stream.merge(
        client_libs_bundle_stream,
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

gulp.task('client', function() {
    var DEST = 'build/public/js';
    var NAME = 'app.js';
    var NAME_MIN = 'app.min.js';
    var bundler = browserify('./' + PATHS.client_bundle, {
            debug: true,
        })
        .transform('babelify', {
            presets: ['es2015']
        });
    _.each(PATHS.client_libs, function(lib) {
        bundler.external(lib);
    });
    gutil.log('setting upgrade', pkg.version, current_pkg_version);

    return bundler.bundle()
        .pipe(vinyl_source_stream(NAME))
        .pipe(vinyl_buffer())
        .pipe(gulp_replace('"version": "' + pkg.version + '"', '"version": "' + current_pkg_version + '"'))
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_size_log(NAME))
        .pipe(gulp.dest(DEST))
        .pipe(gulp_cached(NAME))
        .pipe(gulp_uglify())
        .pipe(gulp_replace('noobaa-core",version:"' + pkg.version + '"', 'noobaa-core",version:"' + current_pkg_version + '"'))
        .pipe(gulp_rename(NAME_MIN))
        .pipe(gulp_size_log(NAME_MIN))
        .pipe(gulp.dest(DEST));
});


gulp.task('mocha', function() {
    var mocha_options = {
        reporter: 'spec'
    };
    return gulp
        .src(PATHS.scripts)
        .pipe(gulp_istanbul())
        .pipe(gulp_istanbul.hookRequire()) // Force `require` to return covered files
        .on('finish', function() {
            return gulp.src(PATHS.test_scripts, SRC_DONT_READ)
                .pipe(gulp_mocha(mocha_options))
                .pipe(gulp_istanbul.writeReports());
        });
});

gulp.task('test', ['lint', 'mocha']);


function run_service(service_name, main_script) {
    var service = active_services[service_name];
    if (service) {
        console.log(' ');
        console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        console.log('~~~      ' + service_name + ' KILL (pid=' + service.pid + ')');
        console.log('~~~ (wait exit to respawn) ~~~');
        console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        console.log(' ');
        service.kill();
        return;
    }
    console.log(' ');
    console.log('~~~~~~~~~~~~~~~~~~~~~~');
    console.log('~~~  ' + service_name + ' START');
    console.log('~~~~~~~~~~~~~~~~~~~~~~');
    console.log(' ');
    service = active_services[service_name] = child_process.fork(
        main_script, process.argv.slice(2)
    );
    service.on('error', function(err) {
        console.error(' ');
        console.error('~~~~~~~~~~~~~~~~~~~~~~');
        console.error('~~~  ' + service_name + ' ERROR:', err);
        console.error('~~~~~~~~~~~~~~~~~~~~~~');
        console.error(' ');
        gutil.beep();
    });
    service.on('exit', function(code, signal) {
        console.error(' ');
        console.error('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        console.error('~~~       ' + service_name + ' EXIT (rc=' + code + ')');
        console.error('~~~  (respawn in 1 second)  ~~~');
        console.error('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        console.error(' ');
        service = null;
        delete active_services[service_name];
        setTimeout(run_service, 1, service_name, main_script);
    });
    gulp_notify(service_name + ' is serving...').end('stam');
}

gulp.task('install', [
    'bower',
    'assets',
    'ng',
    'css',
    'lint',
    'client_libs',
    'client',
    'agent'
]);

var serve = run_service.bind(null, 'md-server', PATHS.server_main);
var serve_bg = run_service.bind(null, 'bg-worker', PATHS.bg_workers_main);
var serve_agent = run_service.bind(null, 'agent', PATHS.agent_main);
var serve_s3 = run_service.bind(null, 's3', PATHS.s3_main);

gulp.task('serve', [], serve);
gulp.task('serve_bg', [], serve_bg);
gulp.task('serve_agent', [], serve_agent);
gulp.task('serve_s3', [], serve_s3);
gulp.task('install_and_serve', ['install'], serve);
gulp.task('install_css_and_serve', ['css'], serve);
gulp.task('install_ng_and_serve', ['ng'], serve);
gulp.task('install_client_and_serve', ['client', 'ng'], serve);

gulp.task('watch', ['serve'], function() {
    gulp.watch([
        'src/css/**/*'
    ], ['install_css_and_serve']);
    gulp.watch([
        'src/ngview/**/*',
    ], ['install_ng_and_serve']);
    gulp.watch([
        'src/client/**/*',
        'src/api/**/*',
        'src/rpc/**/*',
        'src/util/**/*',
    ], ['install_client_and_serve']);
    gulp.watch([
        'src/server/**/*',
        'src/views/**/*',
    ], ['serve']);
});
gulp.task('watch_bg', ['serve_bg'], function() {
    gulp.watch([
        'src/bg_workers/**/*',
        'src/server/**/*',
        'src/api/**/*',
        'src/rpc/**/*',
        'src/util/**/*',
    ], ['serve_bg']);
});
gulp.task('watch_agent', ['serve_agent'], function() {
    gulp.watch([
        'src/agent/**/*',
        'src/api/**/*',
        'src/rpc/**/*',
        'src/util/**/*',
    ], ['serve_agent']);
});
gulp.task('watch_s3', ['serve_s3'], function() {
    gulp.watch([
        'src/s3/**/*',
        'src/api/**/*',
        'src/rpc/**/*',
        'src/util/**/*',
    ], ['serve_s3']);
});

gulp.task('start', function() {
    require('.' + path.sep + PATHS.server_main);
});
gulp.task('start_bg', function() {
    require('.' + path.sep + PATHS.bg_workers_main);
});
gulp.task('start_agent', function() {
    require('.' + path.sep + PATHS.agent_main).main();
});
gulp.task('start_s3', function() {
    require('.' + path.sep + PATHS.s3_main);
});

gulp.task('default', ['start']);
