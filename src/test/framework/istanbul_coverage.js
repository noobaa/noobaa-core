'use strict';
//NO REQUIRES for NooBaa's code

var hook = require('istanbul').hook;
var path = require('path');
var basepath = path.resolve(__dirname, '..', '..', '..');
var regexp = new RegExp('^' + basepath + '/(node_modules|src/deploy|src/licenses|util/mongo_functions)');

var IstMatcher = function(file) {
    if (file.match(regexp)) {
        return false;
    }
    return true;
};

var IstTransformer = function(code, file) {
    return code;
};

hook.hookRequire(IstMatcher, IstTransformer);

/*gulp.task('mocha', ['coverage_hook'], function() {
    var mocha_options = {
        reporter: 'spec'
    };
    // return gulp.src('./src/test/test_system_servers.js', SRC_DONT_READ)
    return gulp.src(PATHS.test_all, SRC_DONT_READ)
        .pipe(gulp_mocha(mocha_options))
        .pipe(gulp_istanbul.writeReports());
});*/
