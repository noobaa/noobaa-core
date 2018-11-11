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
const LRU = require('./lru');

const DEV_MODE = (process.env.DEV_MODE === 'true');

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
    }
    winston = require('winston');


    processType = "node";
    console_wrapper = require('./console_wrapper');
}


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

var LOG_FUNC_PER_LEVEL = {
    LOG: 'log',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
};


const THROTTLING_PERIOD_SEC = 30;
const MESSAGES_LRU_SIZE = 10000;

class InternalDebugLogger {

    constructor() {


        // an LRU table to hold last used messages for throttling
        this.lru = new LRU({
            name: 'debug_log_lru',
            max_usage: MESSAGES_LRU_SIZE, // hold up to 10000 messages
            expiry_ms: THROTTLING_PERIOD_SEC * 1000, // 30 seconds before repeating any message
        });

        this._file_path = undefined;
        this._logs_by_file = [];
        this._modules = {
            __level: 0
        };
        this._levels = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            LOG: 3,
            TRACE: 4,
            L0: 5,
            L1: 6,
            L2: 7,
            L3: 8,
            L4: 9,
            LAST: 100
        };
        // map the levels we use to syslog protocol levels
        // ERROR --> LOG_ERR (3)
        // WARN --> LOG_WARNING (4)
        // INFO\LOG\TRACE\L[0-4] --> LOG_NOTICE (5)
        this._levels_to_syslog = {
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
        this._proc_name = '';
        this._pid = process.pid;
        if (!winston) {
            return;
        }

        //if logs directory doesn't exist, create it
        try {
            fs.mkdirSync('./logs');
        } catch (e) {
            if (e.code !== 'EEXIST') {
                throw e;
            }
        }
        //Define Transports
        const transports = [new winston.transports.Console({
            name: 'console_transp',
            level: 'LAST',
            showLevel: false,
            formatter: options => {
                var proc = '[' + this._proc_name + '/' + this._pid + ']';
                var formatted_level = ' \x1B[31m';
                if (this._levels[options.level]) {
                    formatted_level = this._levels[options.level] === 1 ? ' \x1B[33m' : ' \x1B[36m';
                }
                const padded_level = `[${options.level}]`.padStart(7);
                const prefix = '\x1B[32m' + formatted_time() + '\x1B[35m ' + proc + formatted_level + padded_level + '\x1B[39m ';
                var message = (options.message || '').replace(/\n/g, `\n${prefix}`);
                var suffix = (options.meta && Object.keys(options.meta).length ? JSON.stringify(options.meta) : '');
                // remove newlines from message?
                // message = message.replace(/(\r\n|\n|\r)/gm, '');
                return prefix + message + suffix;
            }
        })];

        // if not logging to syslog add a file transport
        if (!syslog) {
            const suffix = DEV_MODE ? `_${process.argv[1].split('/').slice(-1)[0]}` : '';

            transports.push(new winston.transports.File({
                name: 'file_transp',
                level: 'LAST',
                showLevel: false,
                filename: `noobaa${suffix}.log`,
                dirname: './logs/',
                json: false,
                maxsize: (10 * 1024 * 1024),
                maxFiles: 100,
                tailable: true,
                zippedArchive: true,
                formatter: options => {
                    //prefix - time, level, module & pid
                    var proc = '[' + this._proc_name + '/' + this._pid + ']';
                    var formatted_level = ' \x1B[31m[';
                    if (this._levels[options.level]) {
                        formatted_level = this._levels[options.level] === 1 ? ' \x1B[33m[' : ' \x1B[36m[';
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
            }));
        }

        this._log = new(winston.Logger)({
            levels: this._levels,
            transports
        });
    }

    static instance() {
        if (!InternalDebugLogger._instance) {
            InternalDebugLogger._instance = new InternalDebugLogger();
        }
        return InternalDebugLogger._instance;
    }


    build_module_context(mod, mod_object) {
        var mod_name;
        var new_mod;
        // skip empty modules
        while (mod[0] === '.') {
            mod = mod.substr(1);
        }
        var ind = mod.indexOf(".");
        if (ind === -1) {
            mod_name = mod;
            new_mod = "";
        } else {
            mod_name = mod.substr(0, ind);
            new_mod = mod.substr(ind + 1); //skipping the . and continuing the processing
        }
        if (mod_name) {
            if (!mod_object[mod_name]) {
                mod_object[mod_name] = {
                    __level: 0
                };
            }
        }
        if (new_mod) {
            return this.build_module_context(new_mod, mod_object[mod_name]);
        } else {
            return mod_object[mod_name];
        }
    }

    //Traverse on modules tree, set level
    populate_subtree(mod, level) {
        mod.__level = level;
        _.each(mod, (sub_mod, name) => {
            if (name[0] !== '_') {
                this.populate_subtree(sub_mod, level);
            }
        });
    }

    // Setting level for a node in the tree sets all the subtree to the same level
    set_level(mod, level) {
        var parts = mod.split(".");
        var tmp_mod = this._modules;
        //find the desired node to set level for
        for (var ind = 0; ind < parts.length; ++ind) {
            if (!tmp_mod[parts[ind]]) {
                if (console_wrapper) {
                    console_wrapper.original_console();
                }
                console.log("No such module " + mod + " registered");
                if (console_wrapper) {
                    console_wrapper.wrapper_console();
                }
                return;
            }
            tmp_mod = tmp_mod[parts[ind]];
        }
        tmp_mod.__level = level;
        //If subtree exists, set __level for all nodes in it
        this.populate_subtree(tmp_mod, level);
    }

    //Getting level for a node in the tree
    get_level(mod) {
        var parts = mod.split(".");
        var tmp_mod = this._modules;
        //find the desired node to set level for
        for (var ind = 0; ind < parts.length; ++ind) {
            if (!tmp_mod[parts[ind]]) {
                if (console_wrapper) {
                    console_wrapper.original_console();
                }
                console.log("No such module " + mod + " registered");
                if (console_wrapper) {
                    console_wrapper.wrapper_console();
                }
                return;
            }
            tmp_mod = tmp_mod[parts[ind]];
        }
        return tmp_mod.__level;
    }

    syslog_formatter(level, args) {
        let msg = args[1] || '';
        if (args.length > 2) {
            msg = util.format.apply(msg, Array.prototype.slice.call(args, 1));
        }
        let formmated_level = ' \x1B[31m[';
        if (this._levels[level]) {
            formmated_level = this._levels[level] === 1 ? ' \x1B[33m[' : ' \x1B[36m[';
        }
        let level_str = formmated_level + level + ']\x1B[39m ';
        let proc = '[' + this._proc_name + '/' + this._pid + ']';
        let prefix = '\x1B[32m' + formatted_time() +
            '\x1B[35m ' + proc;
        return {
            console_prefix: prefix,
            message: level_str + msg.replace(/(\r\n|\n|\r)/gm, "")
        };
    }

    log_always(level) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (console_wrapper) {
            console_wrapper.original_console();
        }

        let syslog_msg = this.syslog_formatter(level, arguments);
        return this.log_internal(level, args, syslog_msg);
    }


    log_throttled(level) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (console_wrapper) {
            console_wrapper.original_console();
        }

        let syslog_msg = this.syslog_formatter(level, arguments);
        try {
            // get formatted message to use as key for lru
            const lru_item = this.lru.find_or_add_item(syslog_msg.message);
            if (lru_item.hit_count) {
                lru_item.hit_count += 1;
                // the message is already in the lru
                // every 200 messages print message count, otherwise return
                if (lru_item.hit_count > 2 && lru_item.hit_count % 200 !== 0) {
                    if (console_wrapper) {
                        console_wrapper.wrapper_console();
                    }
                    return;
                }

                const msg_suffix = lru_item.hit_count === 2 ?
                    ` - \x1B[33m[Duplicated message. Suppressing for ${THROTTLING_PERIOD_SEC} seconds]\x1B[39m` :
                    ` - \x1B[33m[message repeated ${lru_item.hit_count} times since ${new Date(lru_item.time)}]\x1B[39m`;
                syslog_msg.message += msg_suffix;
                args[args.length - 1] += msg_suffix;
            } else {
                // message not in lru. set hit count to 1
                lru_item.hit_count = 1;
            }
        } catch (err) {
            console.log('got error on log suppression:', err.message);
        }

        return this.log_internal(level, args, syslog_msg);
    }

    log_internal(level, args, syslog_msg) {

        if (this._file_path) {
            var winston_log = this._logs_by_file[this._file_path.name];
            if (!winston_log) {
                let winston = require('winston'); // eslint-disable-line no-shadow
                //Define Transports
                winston_log = new winston.Logger({
                    levels: this._levels,
                    transports: [
                        new winston.transports.File({
                            name: 'file_transport',
                            level: 'LAST',
                            showLevel: false,
                            filename: this._file_path.base,
                            dirname: this._file_path.dir,
                            json: false,
                            //maxsize: (10 * 1024 * 1024), //10 MB
                            //maxFiles: 100,
                            //tailable: true,
                            //zippedArchive: true,
                            formatter: options => {
                                //prefix - time, level, module & pid
                                var proc = '[' + this._proc_name + '/' + this._pid + ']';
                                var formatted_level = ' \x1B[31m[';
                                if (this._levels[options.level]) {
                                    formatted_level = this._levels[options.level] === 1 ? ' \x1B[33m[' : ' \x1B[36m[';
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
                this._logs_by_file[this._file_path.name] = winston_log;
            }
            args.push("");
            winston_log[level].apply(winston_log, args);
        } else if (this._log) {
            if (syslog) {
                // syslog path
                syslog(this._levels_to_syslog[level], syslog_msg.message, 'LOG_LOCAL0');
            }
            // winston path (non browser)
            args.push("");
            this._log[level].apply(this._log, args);
        } else {
            // browser workaround, don't use winston. Add timestamp and level
            var logfunc = LOG_FUNC_PER_LEVEL[level] || 'log';
            if (typeof(args[0]) === 'string') {
                args[0] = formatted_time() + ' [' + level + '] ' + args[0];
            } else {
                args.unshift(formatted_time() + ' [' + level + '] ');
            }
            // if (level === 'ERROR' || level === 'WARN') {
            // logfunc = 'error';
            // }
            console[logfunc].apply(console, args);
        }
        if (console_wrapper) {
            console_wrapper.wrapper_console();
        }
    }
}



const int_dbg = InternalDebugLogger.instance();






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
var log_func_name = "log";
var i;

function log_builder(idx, options) {

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
            if (options.throttled) {
                int_dbg.log_throttled.apply(int_dbg, args);
            } else {
                int_dbg.log_always.apply(int_dbg, args);
            }
        }
    };
}
for (i = 0; i < 5; ++i) {
    DebugLogger.prototype[log_func_name + i] = log_builder(i, { throttled: false });
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
            int_dbg.log_throttled.apply(int_dbg, args);
        }
    };
}
for (i = 0; i < 5; ++i) {
    DebugLogger.prototype[log_func_name + i + "_withbt"] = log_bt_builder(i);
}

/*
 * Populate syslog levels logging functions. i.e warn/info/error ...
 */
function log_syslog_builder(syslevel) {

    /**
     * @this instance of DebugLogger
     */
    return function() {
        if (this._cur_level.__level < 0) return;
        var args = Array.prototype.slice.call(arguments);
        if (typeof(args[0]) === 'string') { //Keep string formatting if exists
            args[0] = " " + this._name + ":: " + (args[0] ? args[0] : '');
        } else {
            args.unshift(" " + this._name + ":: ");
        }
        args.unshift(syslevel.toUpperCase());
        int_dbg.log_always.apply(int_dbg, args);
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

DebugLogger.prototype.wrapper_console = function() {
    console_wrapper.wrapper_console();
};

if (console_wrapper) {
    //Register a "console" module DebugLogger for the console wrapper
    var conlogger = new DebugLogger("CONSOLE.js");
    console_wrapper.register_logger(conlogger);
}
