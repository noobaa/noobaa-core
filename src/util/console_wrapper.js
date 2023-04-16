/* Copyright (C) 2016 NooBaa */
/*
  Hijack console.log, .info, .error and .warn
  Call the DebugLogger (this way all console output willalso be sent to the debug log)
*/

"use strict";

const _ = require('lodash');

const wrapperConsole = _.create(console);
const origConsole = console;
let dbg_logger;

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
const syslog_levels = ["trace", "log", "info", "error", "warn"];
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
