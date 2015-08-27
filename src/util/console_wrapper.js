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
    var args = Array.prototype.slice.call(arguments);
    dbg_logger.trace.apply(dbg_logger, args);
};

wrapperConsole.log = function() {
    var args = Array.prototype.slice.call(arguments);
    dbg_logger.log.apply(dbg_logger, args);
};

wrapperConsole.info = function() {
    var args = Array.prototype.slice.call(arguments);
    dbg_logger.info.apply(dbg_logger, args);
};

wrapperConsole.error = function() {
    var args = Array.prototype.slice.call(arguments);
    dbg_logger.error.apply(dbg_logger, args);
};

wrapperConsole.warn = function() {
    var args = Array.prototype.slice.call(arguments);
    dbg_logger.warn.apply(dbg_logger, args);
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
        if (typeof window !== 'undefined') {
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
        if (typeof window !== 'undefined') {
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
