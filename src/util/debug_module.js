/* Copyright (C) 2016 NooBaa */
/*
  DebugLogger is a wrapper for winston.
  It provides multi nested modules definitions for easier module->level management.
  DebugLogger exposes logX and logX_withbt functions.
  InternalDebugLogger is a "singleton" used by all DebugLogger objects,
  performing the actuall logic and calls to winston.
*/
/* eslint-disable global-require */
"use strict";

/*
 *
 * Global : require, exports and global variables init
 *
 */
module.exports = DebugLogger;

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const nb_native = require('./nb_native');

var config = {
    dbg_log_level: 0,
};

try {
    config = require('../../config.js');
} catch (err) {
    // ignore
}

//Detect our context, node/atom/browser
//Different context requires different handling, for example winston usage or console wrapping
var processType; // eslint-disable-line no-unused-vars
var winston;
var syslog;
var console_wrapper;
if (typeof process !== 'undefined' &&
    process.versions &&
    process.versions['atom-shell']) { //atom shell
    winston = require('winston');
    processType = "atom";
    console_wrapper = require('./console_wrapper');
} else if (global.document) {
    //browser
    processType = "browser";
} else {
    // node

    // check if we run on md_server <=> /etc/rsyslog.d/noobaa_syslog.conf exists
    let should_log_to_syslog = true;
    try {
        var file = fs.statSync('/etc/rsyslog.d/noobaa_syslog.conf');
        if (!file.isFile()) {
            should_log_to_syslog = false;
        }
    } catch (err) {
        should_log_to_syslog = false;
    }

    if (should_log_to_syslog) {
        syslog = nb_native().syslog;
    } else {
        winston = require('winston');
    }

    processType = "node";
    console_wrapper = require('./console_wrapper');
}

const int_dbg = new InternalDebugLogger();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Pretty time format
function formatted_time() {
    const now = new Date();
    var timemsg = MONTHS[now.getMonth()] + '-' + now.getDate() + ' ' + now.getHours() + ':';
    //not pretty but more effecient than convert to array and slice
    timemsg += (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();
    timemsg += ":" + (now.getSeconds() < 10 ? "0" : "") + now.getSeconds();
    timemsg += "." + (now.getMilliseconds() < 100 ? "0" : "") + (now.getMilliseconds() < 10 ? "0" : "") +
        now.getMilliseconds();
    return timemsg;
}

function extract_module(mod, ignore_extension) {
    // the 'core.' prefix is helpful for setting the level for all modules
    const stems = {
        "/src/": "core.",
        "\\src\\": "core."
    };

    //for initial module construction, filename is passed, remove extension
    //for set_level, name of module is passed, don't try to remove extension
    var name;
    if (ignore_extension) {
        name = mod;
    } else {
        // remove the extension
        var last_dot = mod.lastIndexOf('.');
        name = last_dot >= 0 ? mod.substr(0, last_dot) : mod;
    }

    var ind;
    //compact stem directory structure
    _.each(stems, function(val, s) {
        ind = name.lastIndexOf(s);
        if (ind !== -1) {
            name = stems[s] + name.substr(ind + s.length);
        }
    });

    // replace non-word chars with dots
    // then replace multi dot which might have appeared into a single dot
    name = name.replace(/\W/g, '.').replace(/\.\.+/g, '.');

    // remove leading dots
    while (name[0] === '.') {
        name = name.substr(1);
    }

    return name;
}

/*
 *
 * Internal Debug Logger (not exported)
 *
 */
function InternalDebugLogger() {
    const self = this;

    self._file_path = undefined;
    self._logs_by_file = [];

    self._modules = {
        __level: 0
    };

    self._levels = {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        LOG: 3,
        TRACE: 4,
        L0: 5,
        L1: 6,
        L2: 7,
        L3: 8,
        L4: 9
    };

    // map the levels we use to syslog protocol levels
    // ERROR --> LOG_ERR (3)
    // WARN --> LOG_WARNING (4)
    // INFO\LOG\TRACE\L[0-4] --> LOG_NOTICE (5)
    self._levels_to_syslog = {
        ERROR: 3,
        WARN: 4,
        INFO: 5,
        LOG: 5,
        TRACE: 5,
        L0: 5,
        L1: 5,
        L2: 5,
        L3: 5,
        L4: 5
    };

    self._proc_name = '';
    self._pid = process.pid;

    if (!winston) {
        return;
    }

    //if logs directory doesn't exist, create it
    try {
        fs.mkdirSync('./logs');
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
    }

    //Define Transports
    self._log = new(winston.Logger)({
        levels: self._levels,
        transports: [
            new winston.transports.File({
                name: 'file_transp',
                level: 'ERROR',
                showLevel: false,
                filename: 'noobaa.log',
                dirname: './logs/',
                json: false, //Must be otherwise formatter is not working
                maxsize: (10 * 1024 * 1024), //10 MB
                maxFiles: 100,
                tailable: true,
                zippedArchive: true,
                formatter: function(options) {
                    //prefix - time, level, module & pid
                    var proc = '[' + self._proc_name + '/' + self._pid + ']';
                    var formatted_level = ' \x1B[31m[';
                    if (self._levels[options.level]) {
                        formatted_level = self._levels[options.level] === 1 ? ' \x1B[33m[' : ' \x1B[36m[';
                    }
                    var prefix = '\x1B[32m' + formatted_time() +
                        '\x1B[35m ' + proc +
                        formatted_level +
                        options.level + ']\x1B[39m ';
                    var message = options.message || '';
                    var postfix = (options.meta && Object.keys(options.meta).length ? JSON.stringify(options.meta) : '');
                    // remove newlines from message
                    message = message.replace(/(\r\n|\n|\r)/gm, '');
                    return prefix + message + postfix;
                }
            }),
            new winston.transports.Console({
                name: 'console_transp',
                level: 'ERROR',
                showLevel: false,
                formatter: function(options) {
                    var proc = '[' + self._proc_name + '/' + self._pid + ']';
                    var formatted_level = ' \x1B[31m[';
                    if (self._levels[options.level]) {
                        formatted_level = self._levels[options.level] === 1 ? ' \x1B[33m[' : ' \x1B[36m[';
                    }
                    var message = options.message || '';
                    var postfix = (options.meta && Object.keys(options.meta).length ? JSON.stringify(options.meta) : '');
                    // remove newlines from message?
                    // message = message.replace(/(\r\n|\n|\r)/gm, '');
                    return '\x1B[32m' + formatted_time() +
                        '\x1B[35m ' + proc +
                        formatted_level +
                        options.level + ']\x1B[39m ' +
                        message +
                        postfix;
                }
            })
        ]
    });

}

InternalDebugLogger.prototype.build_module_context = function(mod, mod_object) {
    const self = this;
    var mod_name;
    var new_mod;

    // skip empty modules
    while (mod[0] === '.') {
        mod = mod.substr(1);
    }

    var ind = mod.indexOf(".");

    if (ind === -1) { //leaf module
        mod_name = mod;
        new_mod = "";
    } else {
        mod_name = mod.substr(0, ind);
        new_mod = mod.substr(ind + 1); //skipping the . and continuing the processing
    }

    if (mod_name) {
        if (!mod_object[mod_name]) { //create the cur_part scope if needed
            mod_object[mod_name] = {
                __level: 0
            };
        }
    }

    if (new_mod) {
        return self.build_module_context(new_mod, mod_object[mod_name]);
    } else { //return the leaf module so it can be cached in the DebugLogger
        return mod_object[mod_name];
    }
};



//Traverse on modules tree, set level
InternalDebugLogger.prototype.populate_subtree = function(mod, level) {
    const self = this;
    mod.__level = level;
    _.each(mod, function(sub_mod, name) {
        if (name[0] !== '_') {
            self.populate_subtree(sub_mod, level);
        }
    });
};

// Setting level for a node in the tree sets all the subtree to the same level
InternalDebugLogger.prototype.set_level = function(mod, level) {
    var parts = mod.split(".");
    var tmp_mod = this._modules;

    //find the desired node to set level for
    for (var ind = 0; ind < parts.length; ++ind) {
        if (!tmp_mod[parts[ind]]) {
            if (console_wrapper) console_wrapper.original_console();
            console.log("No such module " + mod + " registered");
            if (console_wrapper) console_wrapper.wrapper_console();
            return;
        }
        tmp_mod = tmp_mod[parts[ind]];
    }

    tmp_mod.__level = level;
    //If subtree exists, set __level for all nodes in it

    this.populate_subtree(tmp_mod, level);
};

//Getting level for a node in the tree
InternalDebugLogger.prototype.get_level = function(mod) {
    var parts = mod.split(".");
    var tmp_mod = this._modules;

    //find the desired node to set level for
    for (var ind = 0; ind < parts.length; ++ind) {
        if (!tmp_mod[parts[ind]]) {
            if (console_wrapper) console_wrapper.original_console();
            console.log("No such module " + mod + " registered");
            if (console_wrapper) console_wrapper.wrapper_console();
            return;
        }
        tmp_mod = tmp_mod[parts[ind]];
    }

    return tmp_mod.__level;
};

var LOG_FUNC_PER_LEVEL = {
    LOG: 'log',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
};

InternalDebugLogger.prototype.syslog_formatter = function(level, args) {
    const self = this;
    let msg = args[1] || '';
    if (args.length > 2) {
        msg = util.format.apply(msg, Array.prototype.slice.call(args, 1));
    }
    let formmated_level = ' \x1B[31m[';
    if (self._levels[level]) {
        formmated_level = self._levels[level] === 1 ? ' \x1B[33m[' : ' \x1B[36m[';
    }
    let level_str = formmated_level + level + ']\x1B[39m ';

    let proc = '[' + self._proc_name + '/' + self._pid + ']';
    let prefix = '\x1B[32m' + formatted_time() +
        '\x1B[35m ' + proc;

    return {
        console_prefix: prefix,
        message: level_str + msg.replace(/(\r\n|\n|\r)/gm, "")
    };
};

InternalDebugLogger.prototype.log_internal = function(level) {
    const self = this;
    var args;
    if (console_wrapper) console_wrapper.original_console();
    if (self._file_path) {
        var winston_log = self._logs_by_file[self._file_path.name];
        if (!winston_log) {
            let winston = require('winston'); // eslint-disable-line no-shadow
            //Define Transports
            winston_log = new winston.Logger({
                levels: self._levels,
                transports: [
                    new winston.transports.File({
                        name: 'file_transport',
                        level: 'ERROR',
                        showLevel: false,
                        filename: self._file_path.base,
                        dirname: self._file_path.dir,
                        json: false, //Must be otherwise formatter is not working
                        //maxsize: (10 * 1024 * 1024), //10 MB
                        //maxFiles: 100,
                        //tailable: true,
                        //zippedArchive: true,
                        formatter: function(options) {
                            //prefix - time, level, module & pid
                            var proc = '[' + self._proc_name + '/' + self._pid + ']';
                            var formatted_level = ' \x1B[31m[';
                            if (self._levels[options.level]) {
                                formatted_level = self._levels[options.level] === 1 ? ' \x1B[33m[' : ' \x1B[36m[';
                            }
                            var prefix = '\x1B[32m' + formatted_time() +
                                '\x1B[35m ' + proc +
                                formatted_level +
                                options.level + ']\x1B[39m ';
                            var message = options.message || '';
                            var postfix = (options.meta && Object.keys(options.meta).length ? JSON.stringify(options.meta) : '');

                            // remove newlines from message
                            message = message.replace(/(\r\n|\n|\r)/gm, '');

                            return prefix + message + postfix;
                        }
                    })
                ]
            });
            self._logs_by_file[self._file_path.name] = winston_log;
        }

        args = Array.prototype.slice.call(arguments, 1);
        args.push("");
        winston_log[level].apply(winston_log, args);
    } else if (!_.isUndefined(syslog)) {
        // syslog path
        let msg = self.syslog_formatter(level, arguments);
        syslog(this._levels_to_syslog[level], msg.message, 'LOG_LOCAL0');
        // when not redirecting to file console.log is async:
        // https://nodejs.org/api/console.html#console_asynchronous_vs_synchronous_consoles
        if (level === 'ERROR') {
            console.error(msg.console_prefix + msg.message);
        } else {
            console.log(msg.console_prefix + msg.message);
        }
    } else if (this._log) {
        // winston path (non browser)
        args = Array.prototype.slice.call(arguments, 1);
        args.push("");
        this._log[level].apply(this._log, args);
    } else {
        // browser workaround, don't use winston. Add timestamp and level
        var logfunc = LOG_FUNC_PER_LEVEL[level] || 'log';
        args = Array.prototype.slice.call(arguments, 1);
        if (typeof(args[0]) === 'string') { //Keep string formatting if exists
            args[0] = formatted_time() + ' [' + level + '] ' + args[0];
        } else {
            args.unshift(formatted_time() + ' [' + level + '] ');
        }
        // if (level === 'ERROR' || level === 'WARN') {
        // logfunc = 'error';
        // }
        console[logfunc].apply(console, args);
    }
    if (console_wrapper) console_wrapper.wrapper_console();
};

/*
 *
 * Debug Logger (external, public)
 * .logX('this will print if log level >= X')
 * .logX_withbt('this will print and will add the backtrace if log level >=X')
 * .trace/log/info/error/warn('these methods will always log')
 *
 */

function DebugLogger(mod) {
    // allow calling this ctor without new keyword
    if (!(this instanceof DebugLogger)) {
        return new DebugLogger(mod);
    }

    var name = extract_module(mod);
    this._name = name;

    this._cur_level = int_dbg.build_module_context(this._name, int_dbg._modules);

    //set debug level for all modules, if defined
    if (process.env.DEBUG_MODE === 'true' && config.dbg_log_level !== 0) {
        console.warn('setting log level of', mod, config.dbg_log_level);
        int_dbg.set_level(this._name, config.dbg_log_level);
    }
}

/*
 * Populate the logX and logX_withbt functions automatically
 */
var fnName = "log";
var i;

function log_builder(idx) {

    /**
     * @this instance of DebugLogger
     */
    return function() {
        if (this.should_log(idx)) {
            var args = Array.prototype.slice.call(arguments);
            if (typeof(args[0]) === 'string') { //Keep string formatting if exists
                args[0] = " " + this._name + ":: " + (args[0] ? args[0] : '');
            } else {
                args.unshift(" " + this._name + ":: ");
            }
            args.unshift("L" + idx);
            int_dbg.log_internal.apply(int_dbg, args);
        }
    };
}
for (i = 0; i < 5; ++i) {
    DebugLogger.prototype[fnName + i] = log_builder(i);
}

function log_bt_builder(idx) {

    /**
     * @this instance of DebugLogger
     */
    return function() {
        if (this.should_log(idx)) {
            var err = new Error();
            var bt = err.stack.substr(err.stack.indexOf(")") + 1).replace(/(\r\n|\n|\r)/gm, " ");
            var args = Array.prototype.slice.call(arguments);
            if (typeof(args[0]) === 'string') { //Keep string formatting if exists
                args[0] = " " + this._name + ":: " + (args[0] ? args[0] : '') + bt;
            } else {
                args.unshift(" " + this._name + ":: ");
                args.push(bt);
            }
            args.unshift("L" + idx);
            int_dbg.log_internal.apply(int_dbg, args);
        }
    };
}
for (i = 0; i < 5; ++i) {
    DebugLogger.prototype[fnName + i + "_withbt"] = log_bt_builder(i);
}

/*
 * Populate syslog levels logging functions. i.e warn/info/error ...
 */
function log_syslog_builder(syslevel) {

    /**
     * @this instance of DebugLogger
     */
    return function() {
        var args = Array.prototype.slice.call(arguments);
        if (typeof(args[0]) === 'string') { //Keep string formatting if exists
            args[0] = " " + this._name + ":: " + (args[0] ? args[0] : '');
        } else {
            args.unshift(" " + this._name + ":: ");
        }
        args.unshift(syslevel.toUpperCase());
        int_dbg.log_internal.apply(int_dbg, args);
    };
}

if (console_wrapper) {
    for (i = 0; i < console_wrapper.syslog_levels.length; ++i) {
        DebugLogger.prototype[console_wrapper.syslog_levels[i]] =
            log_syslog_builder(console_wrapper.syslog_levels[i]);
    }
} else {
    var syslog_levels = ["trace", "log", "info", "error", "warn"];
    for (i = 0; i < syslog_levels.length; ++i) {
        DebugLogger.prototype[syslog_levels[i]] = log_syslog_builder(syslog_levels[i]);
    }
}

DebugLogger.prototype.set_level = function(level, mod) {
    if (typeof mod === 'undefined') {
        int_dbg.set_level(this._name, level);
    } else {
        int_dbg.set_level(extract_module(mod, true), level);
    }
};

DebugLogger.prototype.should_log = function(level) {
    if (this._cur_level.__level >= level) {
        return true;
    }
    return false;
};

DebugLogger.prototype.get_module_structure = function() {
    return int_dbg._modules;
};

DebugLogger.prototype.get_module_level = function(mod) {
    return int_dbg.get_level(mod);
};

DebugLogger.prototype.set_logger_name = function(name) {
    this._name = name;
};

DebugLogger.prototype.set_process_name = function(name) {
    int_dbg._proc_name = name;
    if (syslog) {
        nb_native().closelog();
        nb_native().openlog(name);
    }
};

DebugLogger.prototype.set_log_to_file = function(log_file) {
    if (log_file) {
        int_dbg._file_path = path.parse(log_file);
    } else {
        int_dbg._file_path = undefined;
    }
};

DebugLogger.prototype.set_console_output = function(is_enabled) {
    int_dbg._log.transports.console_transp.silent = !is_enabled;
};

DebugLogger.prototype.original_console = function() {
    console_wrapper.original_console();
};

if (console_wrapper) {
    //Register a "console" module DebugLogger for the console wrapper
    var conlogger = new DebugLogger("CONSOLE.js");
    console_wrapper.register_logger(conlogger);
}
