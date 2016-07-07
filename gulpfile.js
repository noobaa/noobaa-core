'use strict';

const gulp = require('gulp');
const gutil = require('gulp-util');
const gulp_tar = require('gulp-tar');
const gulp_gzip = require('gulp-gzip');
const gulp_rename = require('gulp-rename');
const gulp_json_editor = require('gulp-json-editor');

const _ = require('lodash');
const argv = require('minimist')(process.argv);
const path = require('path');
const dotenv = require('dotenv');
const event_stream = require('event-stream');

const P = require('./src/util/promise');
const pkg = require('./package.json');
const fs_utils = require('./src/util/fs_utils');
const promise_utils = require('./src/util/promise_utils');

if (!process.env.PORT) {
    console.log('loading .env file ( no foreman ;)');
    dotenv.load();
}

const use_local_executable = Boolean(argv.local);
const git_commit = argv.GIT_COMMIT && argv.GIT_COMMIT.substr(0, 7) || 'DEVONLY';
const current_pkg_version = pkg.version + '-' + git_commit;
console.log('current_pkg_version:', current_pkg_version);


const NVA_Package_sources = [
    'src/**/*',
    'binding.gyp',
    'common.gypi'
];

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

    var src_stream = gulp.src(NVA_Package_sources, {
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


function package_build_task() {
    var DEST = 'build/public';
    var NAME = 'noobaa-NVA';

    //Remove previously build package
    return promise_utils.exec('rm -f ' + DEST + '/' + NAME + '*.tar.gz')
        .then(function(res) { //build agent distribution setup
            if (!use_local_executable) {
                gutil.log('before downloading setup and rest');
                return P.resolve()
                    .then(() => fs_utils.create_path(DEST))
                    .then(function() {
                        return promise_utils.exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://127.0.0.1:8080/job/LinuxBuild/lastBuild/artifact/build/linux/noobaa-setup-' + current_pkg_version + ' >build/public/noobaa-setup-' + current_pkg_version);
                    })
                    .then(function() {
                        return promise_utils.exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://127.0.0.1:8080/job/win_agent_remote/lastBuild/artifact/build/windows/noobaa-setup-' + current_pkg_version + '.exe >build/public/noobaa-setup-' + current_pkg_version + '.exe');
                    })
                    .then(function() {
                        return promise_utils.exec('curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://127.0.0.1:8080/job/win_s3_remote/lastBuild/artifact/build/windows/noobaa-s3rest-' + current_pkg_version + '.exe>build/public/noobaa-s3rest-' + current_pkg_version + '.exe');
                    })
                    .then(function() {
                        return promise_utils.exec('chmod 777 build/public/noobaa-setup*');
                    }).catch(function(err) {
                        gutil.log('Failed to download packages. Aborting due to ' + err.message + "     " + err.stack);
                        throw new Error('Failed to download packages. Aborting due to ' + err.message + "     " + err.stack);
                    });
            }
        })
        .then(function() {
            gutil.log('before downloading nvm and node package');
            return promise_utils.exec('curl -o- https://raw.githubusercontent.com/creationix/nvm/master/nvm.sh >build/public/nvm.sh', [], process.cwd());
        })
        .then(function() {
            return promise_utils.exec('curl -o- https://nodejs.org/dist/v4.4.4/node-v4.4.4-linux-x64.tar.xz >build/public/node-v4.4.4-linux-x64.tar.xz', [], process.cwd());
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

gulp.task('package_build', function() {
    return package_build_task();
});
