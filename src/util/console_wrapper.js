/* Copyright (C) 2016 NooBaa */
/*
  Hijack console.log, .info, .error and .warn
  Call the DebugLogger (this way all console output willalso be sent to the debug log)
*/

"use strict";

var _ = require('lodash');

var wrapperConsole = _.create(console);
var origConsole = console;
var clonedConsole = _.clone(console);
var dbg_logger;

/*
 *
 * Taking over the Console printing methods
 *
 */

wrapperConsole.trace = function() {
    dbg_logger.trace.apply(dbg_logger, arguments);
};

wrapperConsole.log = function() {
    dbg_logger.log.apply(dbg_logger, arguments);
};

wrapperConsole.info = function() {
    dbg_logger.info.apply(dbg_logger, arguments);
};

wrapperConsole.error = function() {
    dbg_logger.error.apply(dbg_logger, arguments);
};

wrapperConsole.warn = function() {
    dbg_logger.warn.apply(dbg_logger, arguments);
};


/*
 *
 * Switching between original console and wrapped one
 *
 */
var syslog_levels = ["trace", "log", "info", "error", "warn"];
exports.syslog_levels = syslog_levels;
var log_once_exception = false;

exports.original_console = function() {
    //browser doesn't hold a "regular" console object
    //need special handling => simply switch objectd instead of funcsa
    try {
        if (global.window === global) {
            global.console = origConsole;
            return;
        }
    } catch (ex) {
        if (!log_once_exception) {
            clonedConsole.log(" Caught exception trying to set global.console, mockup window?", ex);
        }
        log_once_exception = true;
    }
    for (var i = 0; i < syslog_levels.length; ++i) {
        console[syslog_levels[i]] = clonedConsole[syslog_levels[i]];
    }
};

exports.wrapper_console = function() {
    //See above
    try {
        if (global.window === global) {
            global.console = wrapperConsole;
            return;
        }
    } catch (ex) {
        if (!log_once_exception) {
            clonedConsole.log(" Caught exception trying to set global.console, mockup window?", ex);
        }
        log_once_exception = true;
    }
    for (var i = 0; i < syslog_levels.length; ++i) {
        console[syslog_levels[i]] = wrapperConsole[syslog_levels[i]];
    }
};

exports.register_logger = function(dbg) {
    dbg_logger = dbg;
    this.wrapper_console();
};
