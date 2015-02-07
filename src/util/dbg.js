// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');
var path = require('path');
var util = require('util');
var debug = require('debug');

/**
 *
 * DBG
 *
 * debugging tools which are available also in production.
 * use in your module as follows:
 *
 * var dbg = require('dbg')(__filename);
 * dbg.log_level = 1;
 * dbg.log0('this will print since log_level >= 0');
 * dbg.log1('this will print since log_level >= 1');
 * dbg.log2('this will not print unless log_level >= 2');
 * dbg.log3('this will not print unless log_level >= 3');
 *
 */
module.exports = DebugModule;

// keep all modules in global map
DebugModule.modules = {};


function DebugModule(module) {
    // use the module's filename to detect a debug module name
    // take the relative path to the projects source dir
    var name = path.relative(path.resolve(__dirname, '..'), module);
    // replacing any non-word chars with _ to make it a qualified js name
    // to make it friendlier inside REPL:
    // repl> dbg.modules.server_web_server.log_level = 1
    name = name.replace(/\W/g, '_');

    // register modules once
    if (DebugModule.modules[name]) {
        return DebugModule.modules[name];
    }

    // allow calling this ctor without new keyword
    if (!(this instanceof DebugModule)) {
        return new DebugModule(module);
    }

    // keep in modules map
    DebugModule.modules[name] = this;
    // link to root to access modules from anywhere
    this.root = DebugModule;
    this.name = name;
    this.log_level = 0;
    debug.enable(name);
    this.debug = debug(name);
}

DebugModule.prototype.log0 = function() {
    if (this.log_level >= 0) {
        this.debug.apply(console, arguments);
    }
};

DebugModule.prototype.log1 = function() {
    if (this.log_level >= 1) {
        this.debug.apply(console, arguments);
    }
};

DebugModule.prototype.log2 = function() {
    if (this.log_level >= 2) {
        this.debug.apply(console, arguments);
    }
};

DebugModule.prototype.log3 = function() {
    if (this.log_level >= 3) {
        this.debug.apply(console, arguments);
    }
};

DebugModule.prototype.log4 = function() {
    if (this.log_level >= 4) {
        this.debug.apply(console, arguments);
    }
};

DebugModule.prototype.log_progress = function(fraction) {
    var percents = (100 * fraction) | 0;
    var msg = 'progress: ' + percents.toFixed(0) + ' %';
    if (!process.stdout) {
        this.debug(msg);
    } else {
        process.stdout.write(msg + '\r');
    }
};
