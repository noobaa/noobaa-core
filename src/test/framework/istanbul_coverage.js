'use strict';
//NO REQUIRES for NooBaa's code

var path = require('path');
var basepath = path.resolve(__dirname, '..', '..', '..');
var regexp = new RegExp('^' + basepath + '/(node_modules|src/deploy|src/licenses|src/util/mongo_functions)');
var istanbul = require('istanbul');

module.exports = {
    start_istanbul_coverage: start_istanbul_coverage
};

var _instrumenter;
var _istMatcher;
var _istTransformer;

function start_istanbul_coverage() {
    _instrumenter = new istanbul.Instrumenter({
        coverageVariable: 'NOOBAA_COV'
    });

    _istMatcher = function(file) {
        if (file.match(regexp)) {
            return false;
        }
        return true;
    };

    _istTransformer = function(code, file) {
        if (file.startsWith(basepath)) {
            file = file.slice(basepath.length +1 /*for / seperator*/);
        }
        return _instrumenter.instrumentSync(code, file);
    };

    istanbul.hook.hookRequire(_istMatcher, _istTransformer);
}
