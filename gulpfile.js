'use strict';

const gulp = require('gulp');
const gutil = require('gulp-util');
const gulp_tar = require('gulp-tar');
const gulp_gzip = require('gulp-gzip');
const gulp_mocha = require('gulp-mocha');
const gulp_notify = require('gulp-notify');
const gulp_rename = require('gulp-rename');
const gulp_jshint = require('gulp-jshint');
const gulp_eslint = require('gulp-eslint');
const gulp_plumber = require('gulp-plumber');
const gulp_istanbul = require('gulp-istanbul');
const gulp_json_editor = require('gulp-json-editor');

const _ = require('lodash');
const Q = require('q');
const argv = require('minimist')(process.argv);
const path = require('path');
const dotenv = require('dotenv');
const through2 = require('through2');
const event_stream = require('event-stream');
const child_process = require('child_process');
const jshint_stylish = require('jshint-stylish');

const pkg = require('./package.json');
const promise_utils = require('./src/util/promise_utils');

if (!process.env.PORT) {
    console.log('loading .env file ( no foreman ;)');
    dotenv.load();
}

const active_services = {};
const skip_install = Boolean(argv.skip_install);
const use_local_executable = Boolean(argv.local);
const git_commit = argv.GIT_COMMIT && argv.GIT_COMMIT.substr(0, 7) || 'DEVONLY';
const cov_dir = argv.COV_DIR || '';
const current_pkg_version = pkg.version + '-' + git_commit;
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


const PATHS = {
    unit_tests_main: 'src/test/unit_tests/index.js',
    js_for_lint: ['src/**/*.js', '*.js'],
    js_for_coverage: [
        'src/**/*.js',
        '!src/deploy/**/*',
        '!src/licenses/**/*',
        '!src/util/mongo_functions.js'
    ],

    server_main: 'src/server/web_server.js',
    bg_workers_main: 'src/bg_workers/bg_workers_starter.js',
    agent_main: 'src/agent/agent_cli.js',
    s3_main: 'src/s3/s3rver.js',

    agent_sources: [
        'src/agent/**/*.js',
        'src/rpc/**/*.js',
        'src/api/**/*.js',
        'src/util/**/*.js',
        'src/tools/**/*.js',
    ],

    NVA_Package_sources: [
        'src/**/*',
        'binding.gyp',
        'common.gypi'
    ],
};

const SRC_DONT_READ = {
    read: false
};


function pack(dest, name) {
    var pkg_stream = gulp.src('package.json')
        .pipe(gulp_json_editor(function(json) {
            var deps = _.omit(json.dependencies, function(val, key) {
                return /^gulp/.test(key) ||
                    /^jshint/.test(key) ||
                    /^eslint/.test(key) ||
                    _.contains([
                        'mocha',
                        'form-data',
                        'istanbul'
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

    var src_stream = gulp.src(PATHS.NVA_Package_sources, {
            base: 'src'
        })
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('src', p.dirname);
        })).on('error', gutil.log);
    // TODO bring back uglify .pipe(gulp_uglify());

    var node_modules_stream = gulp.src([
            'node_modules/**/*',
            '!node_modules/babel*/**/*',
            '!node_modules/gulp*/**/*',
            '!node_modules/node-inspector/**/*'
        ], {
            base: 'node_modules'
        })
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('node_modules', p.dirname);
        })).on('error', gutil.log);

    var basejs_stream = gulp.src([
        'bower.json',
        'config.js',
        'gulpfile.js',
        '.jshintrc',
        '.eslintrc'
    ], {});

    var agent_distro = gulp.src(['src/build/windows/noobaa_setup.exe'], {})
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('deployment', p.dirname);
        })).on('error', gutil.log);

    var build_stream = gulp.src(['build/public/**/*'], {})
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('build/public', p.dirname);
        })).on('error', gutil.log);

    var build_native_stream = gulp.src(['build/Release/**/*'], {})
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('build/Release', p.dirname);
        })).on('error', gutil.log);

    var build_fe_stream = gulp.src(['frontend/dist/**/*'], {})
        .pipe(gulp_rename(function(p) {
            p.dirname = path.join('frontend/dist', p.dirname);
        })).on('error', gutil.log);

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
        .pipe(gulp_rename(function(p) {
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

var PLUMB_CONF = {
    errorHandler: gulp_notify.onError("Error: <%= error.message %>")
};

gulp.task('lint', [
    // 'jshint',
    'eslint'
]);

gulp.task('eslint', function() {
    return gulp.src(PATHS.js_for_lint)
        // eslint() attaches the lint output to the eslint property
        // of the file object so it can be used by other modules.
        .pipe(gulp_eslint())
        // eslint.format() outputs the lint results to the console.
        // Alternatively use eslint.formatEach() (see Docs).
        .pipe(gulp_eslint.format())
        // To have the process exit with an error code (1) on
        // lint error, return the stream and pipe to failAfterError last.
        .pipe(gulp_eslint.failAfterError());
});

gulp.task('jshint', function() {
    return gulp.src(PATHS.js_for_lint)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_jshint.extract())
        .pipe(gulp_jshint())
        .pipe(gulp_jshint.reporter(jshint_stylish))
        .pipe(gulp_jshint.reporter('fail'));
});

gulp.task('agent', ['lint'], function() {
    var DEST = 'build/public';
    var BUILD_DEST = 'build/windows';
    var NAME = 'noobaa-agent.tar';

    var pkg_stream = gulp.src('package.json')
        .pipe(gulp_json_editor(function(json) {
            var deps = _.omit(json.dependencies, function(val, key) {
                return /^gulp/.test(key) ||
                    /^vinyl/.test(key) ||
                    /^jshint/.test(key) ||
                    /^eslint/.test(key) ||
                    _.contains([
                        'mocha',
                        'mongoose',
                        'bcrypt',
                        'heapdump',
                        'gulp',
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

    var src_stream = gulp.src(PATHS.agent_sources, {
        base: 'src'
    });

    var basejs_stream = gulp.src(['config.js'], {});

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
        // .pipe(gulp_size({
        // title: NAME
        // }))
        .pipe(gulp.dest(DEST));
});

gulp.task('frontend', function() {
    return gulp_spawn('npm', ['install'], {
        cwd: 'frontend'
    });
});

function gulp_spawn(cmd, args, options) {
    return new Promise(function(resolve, reject) {
        options = options || {};
        options.stdio = options.stdio || 'inherit';
        var proc = child_process.spawn(cmd, args, options);
        proc.on('error', reject);
        proc.on('exit', function(code) {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error('"' + cmd + ' ' + args.join(' ') +
                    '" exit with error code ' + code));
            }
        });
    });
}

function package_build_task() {
    var DEST = 'build/public';
    var NAME = 'noobaa-NVA';

    //Remove previously build package
    return Q.nfcall(child_process.exec, 'rm -f ' + DEST + '/' + NAME + '*.tar.gz')
        .then(function(res) { //build agent distribution setup
            if (!use_local_executable) {
                gutil.log('before downloading setup and rest');
                return Q.fcall(function() {
                        return promise_utils.promised_exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://127.0.0.1:8080/job/LinuxBuild/lastBuild/artifact/build/linux/noobaa-setup-' + current_pkg_version + ' >build/public/noobaa-setup-' + current_pkg_version);
                    })
                    .then(function() {
                        return promise_utils.promised_exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://127.0.0.1:8080/job/win_agent_remote/lastBuild/artifact/build/windows/noobaa-setup-' + current_pkg_version + '.exe >build/public/noobaa-setup-' + current_pkg_version + '.exe');
                    })
                    .then(function() {
                        return promise_utils.promised_exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://127.0.0.1:8080/job/win_s3_remote/lastBuild/artifact/build/windows/noobaa-s3rest-' + current_pkg_version + '.exe>build/public/noobaa-s3rest-' + current_pkg_version + '.exe');
                    })
                    .then(function() {
                        return promise_utils.promised_exec('chmod 777 build/public/noobaa-setup*');
                    }).catch(function(err) {
                        gutil.log('Failed to download packages. Aborting due to ' + err.message + "     " + err.stack);
                        throw new Error('Failed to download packages. Aborting due to ' + err.message + "     " + err.stack);
                    });
            }
        })
        .then(function() {
            gutil.log('before downloading nvm and node package');
            return promise_utils.promised_exec('curl -o- https://raw.githubusercontent.com/creationix/nvm/master/nvm.sh >build/public/nvm.sh', [], process.cwd());
        })
        .then(function() {
            return promise_utils.promised_exec('curl -o- https://nodejs.org/dist/v4.4.4/node-v4.4.4-linux-x64.tar.xz >build/public/node-v4.4.4-linux-x64.tar.xz', [], process.cwd());
        })
        .then(function() {
            //call for packing
            gutil.log('Packing ' + DEST + ' to ' + NAME + "-" + current_pkg_version + '.tar');
            return pack(DEST, NAME + "-" + current_pkg_version + '.tar');
        })
        .then(null, function(error) {
            gutil.log("error ", error, error.stack);
        });
}

var deps = skip_install ? ['lint', 'agent', 'frontend'] : ['lint', 'install', 'agent', 'frontend'];

gulp.task('package_build', deps, function() {
    return package_build_task();
});


var basepath = path.resolve(__dirname);

gulp.task('coverage_hook', function() {
    // Force `require` to return covered files
    return gulp.src(PATHS.js_for_coverage)
        .pipe(through2.obj(function(file, enc, callback) {
            if (file.path.startsWith(basepath)) {
                file.path = file.path.slice(basepath.length + 1); // +1 for / seperator
            }
            this.push(file);
            callback();
        }))
        .pipe(gulp_istanbul({
            includeUntested: true
        }))
        .pipe(gulp_istanbul.hookRequire());
});

gulp.task('mocha', ['coverage_hook'], function() {
    var mocha_options = {
        reporter: 'spec'
    };
    var writer_options = {};
    if (cov_dir) {
        writer_options.dir = cov_dir;
        writer_options.reportOpts = {
            dir: cov_dir,
        };
    }
    return gulp.src(PATHS.unit_tests_main, SRC_DONT_READ)
        .pipe(gulp_mocha(mocha_options)
            .on('error', function(err) {
                console.log('Mocha Failed With Error', err.toString());
                process.exit(1);
            }))
        .pipe(gulp_istanbul.writeReports(writer_options));
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
    'lint',
    'agent',
    'frontend'
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
gulp.task('install_frontend_and_serve', ['frontend'], serve);

gulp.task('watch', ['serve'], function() {
    gulp.watch([
        'src/server/**/*',
        'src/api/**/*',
        'src/rpc/**/*',
        'src/util/**/*',
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
