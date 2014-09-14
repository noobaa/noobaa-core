'use strict';

var gulp = require('gulp');
var gutil = require('gulp-util');
var gulp_cached = require('gulp-cached');
var gulp_plumber = require('gulp-plumber');
var gulp_notify = require('gulp-notify');
var gulp_jshint = require('gulp-jshint');
var gulp_coverage = require('gulp-coverage');
var jshint_stylish = require('jshint-stylish');
var gulp_mocha = require('gulp-mocha');

var PATHS = {
    scripts: './src/**/*.js',
    test_scripts: './src/**/test*.js',
};
var SRC_DONT_READ = {
    read: false
};
var PLUMB_CONF = {
    errorHandler: gulp_notify.onError("Error: <%= error.message %>")
};

gulp.task('jshint', function() {
    return gulp.src(PATHS.scripts)
        .pipe(gulp_plumber(PLUMB_CONF))
        .pipe(gulp_cached('jshint'))
        .pipe(gulp_jshint())
        .pipe(gulp_jshint.reporter(jshint_stylish));
    // avoid failing for watch to continue
    // .pipe(gulp_jshint.reporter('fail'));
});

gulp.task('mocha', function() {
    var mocha_options = {
        reporter: 'spec'
    };
    return gulp.src(PATHS.test_scripts, SRC_DONT_READ)
        .pipe(gulp_coverage.instrument({
            pattern: PATHS.scripts,
            // debugDirectory: '.coverdata'
        }))
        .pipe(gulp_mocha(mocha_options))
        .pipe(gulp_coverage.report({
            outFile: 'coverage-report.html'
        }));
});

gulp.task('install', []);
gulp.task('test', ['jshint', 'mocha']);
gulp.task('start', []);
gulp.task('default', ['test']);
