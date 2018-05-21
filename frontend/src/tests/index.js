/* Copyright (C) 2016 NooBaa */

/* global __dirname */
const path = require('path');

// Add app directory as a search path for module
require('app-module-path').addPath(path.join(__dirname, '../app'));

// Transpile es2016 when requiring a module
require('babel-register')({
    plugins: [
        'transform-es2015-modules-commonjs',
        'transform-object-rest-spread',
        ['transform-runtime', { polyfill: false }]
    ]
});

// Require the tests.
require('./test-restore-session');
