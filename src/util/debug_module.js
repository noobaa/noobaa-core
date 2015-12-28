/*
  DebugLogger is a wrapper for winston.
  It provides multi nested modules definitions for easier module->level management.
  DebugLogger exposes logX and logX_withbt functions.
  InternalDebugLogger is a "singleton" used by all DebugLogger objects,
  performing the actuall logic and calls to winston.
*/

"use strict";

/*
 *
 * Global : require, exports and global variables init
 *
 */
module.exports = DebugLogger;

var _ = require('lodash');
var fs = require('fs');

var config = {
    dbg_log_level: 0,
};
try {
    config = require('../../config.js');
} catch (err) {
    // ignore
}


//Detect our context, node/atom/browser
var processType;
if (typeof process !== 'undefined' &&
    process.versions &&
    process.versions['atom-shell']) { //atom shell
    var winston = require('winston');
    processType = "atom";
} else if (!global.document) {
    // node
    var winston = require('winston');
    processType = "node";
} else {
    //browser
    processType = "browser";
}

var int_dbg = new InternalDebugLogger();

var con = require('./console_wrapper');

var MONTHS = {
    "1": "Jan",
    "2": "Feb",
    "3": "Mar",
    "4": "Apr",
    "5": "May",
    "6": "Jun",
    "7": "Jul",
    "8": "Aug",
    "9": "Sep",
    "10": "Oct",
    "11": "Nov",
    "12": "Dec",
};

// Pretty time format
function formatted_time() {
    var now = new Date();
    var timemsg = MONTHS[now.getMonth() + 1] + '-' + now.getDate() + ' ' + now.getHours() + ':';
    //not pretty but more effecient than convert to array and slice
    timemsg += (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();
    timemsg += ":" + (now.getSeconds() < 10 ? "0" : "") + now.getSeconds();
    timemsg += "." + (now.getMilliseconds() < 100 ? "0" : "") + (now.getMilliseconds() < 10 ? "0" : "") +
        now.getMilliseconds();
    return timemsg;
}

function extract_module(mod, ignore_extension) {
    // the 'core.' prefix is helpful for setting the level for all modules
    var stems = {
        "/src/": "core.",
        "Program Files\\NooBaa": "core."
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
    var self = this;
    self._modules = {
        __level: 0
    };

    self._levels = {
        'ERROR': 0,
        'WARN': 1,
        'INFO': 2,
        'LOG': 3,
        'TRACE': 4,
        'L0': 5,
        'L1': 6,
        'L2': 7,
        'L3': 8,
        'L4': 9
    };

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
            new(winston.transports.File)({
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
                    var prefix = '\x1B[32m' + formatted_time() +
                        '\x1B[35m ' + proc +
                        ((self._levels[options.level] === 0) ?
                            ' \x1B[31m[' :
                            ((self._levels[options.level] === 1) ? ' \x1B[33m[' : ' \x1B[36m[')) +
                        options.level + ']\x1B[39m ';
                    //message - one liner for file transport
                    var message = (options.message !== undefined ? (options.message.replace(/(\r\n|\n|\r)/gm, "")) : '');

                    var postfix = (options.meta && Object.keys(options.meta).length ?
                        JSON.stringify(options.meta) : '');
                    return prefix + message + postfix;
                }
            }),
            new(winston.transports.Console)({
                name: 'console_transp',
                level: 'ERROR',
                showLevel: false,
                formatter: function(options) {
                    var proc = '[' + self._proc_name + '/' + self._pid + ']';
                    return '\x1B[32m' + formatted_time() +
                        '\x1B[35m ' + proc +
                        ((self._levels[options.level] === 0) ?
                            ' \x1B[31m[' :
                            ((self._levels[options.level] === 1) ? ' \x1B[33m[' : ' \x1B[36m[')) +
                        options.level + ']\x1B[39m ' +
                        (undefined !== options.message ? options.message : '') +
                        (options.meta && Object.keys(options.meta).length ?
                            JSON.stringify(options.meta) : '');
                }
            })
        ]
    });

    self._proc_name = '';
    self._pid = process.pid;
}

InternalDebugLogger.prototype.build_module_context = function(mod, mod_object) {
    var self = this;
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
    var self = this;
    mod.__level = level;
    _.each(mod, function(sub_mod, name) {
        if (name[0] !== '_') {
            self.populate_subtree(sub_mod, level);
        }
    });
};

//Setting level for a node in the tree sets all the subtree to the same level
InternalDebugLogger.prototype.set_level = function(mod, level) {
    var parts = mod.split(".");
    var tmp_mod = this._modules;

    //find the desired node to set level for
    for (var ind = 0; ind < parts.length; ++ind) {
        if (!tmp_mod[parts[ind]]) {
            con.original_console();
            console.log("No such module " + mod + " registered");
            con.wrapper_console();
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
            con.original_console();
            console.log("No such module " + mod + " registered");
            con.wrapper_console();
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

InternalDebugLogger.prototype.log_internal = function(level) {
    var args;
    con.original_console();
    if (this._log) {
        // normal path (non browser)
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
    con.wrapper_console();
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

function log_builder(i) {
    return function() {
        if (this.should_log(i)) {
            var args = Array.prototype.slice.call(arguments);
            if (typeof(args[0]) === 'string') { //Keep string formatting if exists
                args[0] = " " + this._name + ":: " + (args[0] ? args[0] : '');
            } else {
                args.unshift(" " + this._name + ":: ");
            }
            args.unshift("L" + i);
            int_dbg.log_internal.apply(int_dbg, args);
        }
    };
}
for (i = 0; i < 5; ++i) {
    DebugLogger.prototype[fnName + i] = log_builder(i);
}

function log_bt_builder(i) {
    return function() {
        if (this.should_log(i)) {
            var err = new Error();
            var bt = err.stack.substr(err.stack.indexOf(")") + 1).replace(/(\r\n|\n|\r)/gm, " ");
            var args = Array.prototype.slice.call(arguments);
            if (typeof(args[0]) === 'string') { //Keep string formatting if exists
                args[0] = " " + this._name + ":: " + (args[0] ? args[0] : '') + bt;
            } else {
                args.unshift(" " + this._name + ":: ");
                args.push(bt);
            }
            args.unshift("L" + i);
            int_dbg.log_internal.apply(int_dbg, args);
        }
    };
}
for (i = 0; i < 5; ++i) {
    DebugLogger.prototype[fnName + i + "_withbt"] = log_bt_builder(i);
}

/*
 * Populate syslog levels logging functions. i.e warn/info/error ...
 */
function log_syslog_builder(syslevel) {
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
for (i = 0; i < con.syslog_levels.length; ++i) {
    DebugLogger.prototype[con.syslog_levels[i]] = log_syslog_builder(con.syslog_levels[i]);
}


DebugLogger.prototype.set_level = function(level, mod) {
    if (typeof mod !== 'undefined') {
        int_dbg.set_level(extract_module(mod, true), level);
    } else {
        int_dbg.set_level(this._name, level);
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

DebugLogger.prototype.set_process_name = function(name) {
    int_dbg._proc_name = name;
};

DebugLogger.prototype.log_progress = function(fraction) {
    var percents = (100 * fraction) | 0;
    var msg = "progress: " + percents.toFixed(0) + " %";
    if (!process.stdout) {
        this.info(msg);
    } else {
        process.stdout.write(msg + '\r');
    }
};

//Register a "console" module DebugLogger for the console wrapper
var conlogger = new DebugLogger("CONSOLE.js");
con.register_logger(conlogger);
