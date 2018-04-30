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

// Add bower dependnecies as aliases to node modules
require('module-alias')
    .addAlias('rx', path.join(__dirname, '../lib/rxjs/dist/rx.lite.js'));

// Extend Observable.
const { Observable } = require('rx');
Observable.prototype.ofType = function(...types) {
    return this.filter(action => types.includes(action.type));
};

// Require the tests.
require('./test-restore-session');
