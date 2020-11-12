/* Copyright (C) 2016 NooBaa */
/*
  Hijack console.log, .info, .error and .warn
  Call the DebugLogger (this way all console output willalso be sent to the debug log)
*/

"use strict";

var _ = require('lodash');

var wrapperConsole = _.create(console);
var origConsole = console;
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
// var log_once_exception = false;

exports.original_console = function() {
    global.console = origConsole;
};
exports.wrapper_console = function() {
    global.console = wrapperConsole;
};

exports.register_logger = function(dbg) {
    dbg_logger = dbg;
    this.wrapper_console();
};
