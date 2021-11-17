/* Copyright (C) 2016 NooBaa */
/*
  DebugLogger is a wrapper for rotating file stream.
  It provides multi nested modules definitions for easier module->level management.
  DebugLogger exposes logX and logX_withbt functions.
  InternalDebugLogger is a "singleton" used by all DebugLogger objects,
  performing the actual logic and calls to rotating file stream.
*/
/* eslint-disable global-require */
'use strict';

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
const os = require('os');
const debug_config = require('./debug_config');

const nb_native = require('./nb_native');
const LRU = require('./lru');

let dbg_conf;
let LOG_LEVEL = 0;
if (process.env.NOOBAA_LOG_LEVEL) {
    dbg_conf = debug_config.get_debug_config(process.env.NOOBAA_LOG_LEVEL);
    if (process.env.NOOBAA_LOG_LEVEL !== 'nsfs') {
        LOG_LEVEL = dbg_conf.level;
    }
}

let config = {
    dbg_log_level: 0,
};

try {
    config = require('../../config.js');
} catch (err) {
    // ignore
}

function _should_log_to_file() {
    if (process.env.container === 'docker') return false;
    if (process.env.CONTAINER_PLATFORM === 'KUBERNETES') return false;
    if (global.document) return false;
    return true;
}

// override the default inspect options
if (!util.inspect.defaultOptions) util.inspect.defaultOptions = {};
util.inspect.defaultOptions.depth = 10;
util.inspect.defaultOptions.colors = true;
util.inspect.defaultOptions.breakLength = Infinity;


//Detect our context, node/atom/browser
//Different context requires different handling, for example rotating file steam usage or console wrapping
let syslog;
let console_wrapper;
if (typeof process !== 'undefined' &&
    process.versions &&
    process.versions['atom-shell']) { //atom shell
    console_wrapper = require('./console_wrapper');
} else if (global.document) {
    //browser
} else {
    // node

    // check if we run on md_server <=> /etc/rsyslog.d/noobaa_syslog.conf exists
    let should_log_to_syslog = true;
    try {
        const file = fs.statSync('/etc/rsyslog.d/noobaa_syslog.conf');
        if (!file.isFile()) {
            should_log_to_syslog = false;
        }
    } catch (err) {
        should_log_to_syslog = false;
    }

    if (should_log_to_syslog) {
        syslog = nb_native().syslog;
    }

    console_wrapper = require('./console_wrapper');
}


const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Pretty time format
function formatted_time() {
    const now = new Date();
    let timemsg = MONTHS[now.getMonth()] + '-' + now.getDate() + ' ' + now.getHours() + ':';
    //not pretty but more efficient than convert to array and slice
    timemsg += (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();
    timemsg += ":" + (now.getSeconds() < 10 ? "0" : "") + now.getSeconds();
    timemsg += "." + (now.getMilliseconds() < 100 ? "0" : "") + (now.getMilliseconds() < 10 ? "0" : "") +
        now.getMilliseconds();
    return timemsg;
}

function strip_newlines(msg) {
    return msg.replace(/(\r\n|\n|\r)/gm, "");
}

function extract_module(mod, ignore_extension) {
    // the 'core.' prefix is helpful for setting the level for all modules
    const stems = {
        "/src/": "core.",
        "\\src\\": "core."
    };

    //for initial module construction, filename is passed, remove extension
    //for set_level, name of module is passed, don't try to remove extension
    let name;
    if (ignore_extension) {
        name = mod;
    } else {
        // remove the extension
        const last_dot = mod.lastIndexOf('.');
        name = last_dot >= 0 ? mod.substr(0, last_dot) : mod;
    }

    let ind;
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

const LOG_FUNC_PER_LEVEL = {
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
        // this.mod_list = {

        // }
        this._proc_name = '';
        this._pid = process.pid;
        this._log_console = console;
        if (!_should_log_to_file()) {
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

    }

    static instance() {
        if (!InternalDebugLogger._instance) {
            InternalDebugLogger._instance = new InternalDebugLogger();
        }
        return InternalDebugLogger._instance;
    }

    build_module_context(mod, mod_object) {
        let mod_name;
        let new_mod;
        // skip empty modules
        while (mod[0] === '.') {
            mod = mod.substr(1);
        }
        const ind = mod.indexOf(".");
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
                    __level: LOG_LEVEL
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
        const parts = mod.split(".");
        let tmp_mod = this._modules;
        //find the desired node to set level for
        for (let ind = 0; ind < parts.length; ++ind) {
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
        const parts = mod.split(".");
        let tmp_mod = this._modules;
        //find the desired node to set level for
        for (let ind = 0; ind < parts.length; ++ind) {
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

    message_format(level, args) {
        let msg;
        if (args.length > 1) {
            msg = util.format(...args);
        } else {
            msg = args[0] || '';
        }

        //Level coloring
        let level_color = '\x1B[31m';
        if (this._levels[level]) {
            level_color = this._levels[level] === 1 ? '\x1B[33m' : '\x1B[36m';
        }

        //Level String
        const level_str = level_color + `[${level}]`.padStart(7) + '\x1B[39m';

        const proc = '[' + this._proc_name + '/' + this._pid + '] ';
        const ftime = formatted_time();
        const prefix = '\x1B[32m' + ftime + '\x1B[35m ' + proc;
        msg = level_str + msg;
        const msg_oneline = strip_newlines(msg);

        //Browser
        const browser_args = args.slice(0);
        if (typeof(browser_args[0]) === 'string') {
            browser_args[0] = ftime + ' [' + level + '] ' + browser_args[0];
        } else {
            browser_args.unshift(ftime + ' [' + level + '] ');
        }

        return {
            level: level,
            message_console: prefix + msg,
            message_file: prefix + msg_oneline,
            message_syslog: proc + msg_oneline,
            message_browser: browser_args
        };
    }

    log_always(level, ...args) {
        if (console_wrapper) {
            console_wrapper.original_console();
        }

        const msg_info = this.message_format(level, args);
        return this.log_internal(msg_info);
    }


    log_throttled(level, ...args) {
        if (console_wrapper) {
            console_wrapper.original_console();
        }

        const msg_info = this.message_format(level, args);
        try {
            // get formatted message to use as key for lru
            const lru_item = this.lru.find_or_add_item(msg_info.message_syslog);
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
                msg_info.message_console += msg_suffix;
                msg_info.message_file += msg_suffix;
                msg_info.message_syslog += msg_suffix;
            } else {
                // message not in lru. set hit count to 1
                lru_item.hit_count = 1;
            }
        } catch (err) {
            console.log('got error on log suppression:', err.message);
        }

        return this.log_internal(msg_info);
    }

    log_internal(msg_info) {
        if (syslog) {
            // syslog path
            syslog(this._levels_to_syslog[msg_info.level], msg_info.message_syslog, 'LOG_LOCAL0');
        } else if (this._log_file) {
            // rotating file steam path (non browser)
            this._log_file.write(msg_info.message_file + os.EOL);
        }
        // This is also used in order to log to the console
        // browser workaround, don't use rotating file steam. Add timestamp and level
        const logfunc = LOG_FUNC_PER_LEVEL[msg_info.level] || 'log';
        if (this._log_console.silent) {
            if (console_wrapper) {
                console_wrapper.wrapper_console();
            }
        } else if (console_wrapper) {
            console[logfunc](msg_info.message_console);
            console_wrapper.wrapper_console();
        } else {
            console[logfunc](...msg_info.message_browser);
        }
    }
}

InternalDebugLogger._instance = null;

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

    const name = extract_module(mod);
    this._name = name;

    this._cur_level = int_dbg.build_module_context(this._name, int_dbg._modules);

    //set debug level for all modules, if defined
    if (process.env.DEBUG_MODE === 'true' && config.dbg_log_level !== 0) {
        console.warn('setting log level of', mod, config.dbg_log_level);
        int_dbg.set_level(this._name, config.dbg_log_level);
    }
}

function log_builder(idx, options) {

    /**
     * @this instance of DebugLogger
     */
    return function(...args) {
        if (this.should_log(idx)) {
            const level = 'L' + idx;
            if (typeof(args[0]) === 'string') { //Keep string formatting if exists
                args[0] = " " + this._name + ":: " + (args[0] ? args[0] : '');
            } else {
                args.unshift(" " + this._name + ":: ");
            }
            if (options.throttled) {
                int_dbg.log_throttled(level, ...args);
            } else {
                int_dbg.log_always(level, ...args);
            }
        }
    };
}

function log_bt_builder(idx) {

    /**
     * @this instance of DebugLogger
     */
    return function(...args) {
        if (this.should_log(idx)) {
            const level = 'L' + idx;
            const err = new Error();
            const bt = err.stack.substr(err.stack.indexOf(")") + 1).replace(/(\r\n|\n|\r)/gm, " ");
            if (typeof(args[0]) === 'string') { //Keep string formatting if exists
                args[0] = " " + this._name + ":: " + (args[0] ? args[0] : '') + bt;
            } else {
                args.unshift(" " + this._name + ":: ");
                args.push(bt);
            }
            int_dbg.log_throttled(level, ...args);
        }
    };
}

/*
 * Populate syslog levels logging functions. i.e warn/info/error ...
 */
function log_syslog_builder(syslevel) {

    /**
     * @this instance of DebugLogger
     */
    return function(...args) {
        if (this._cur_level.__level < 0) return;
        if (typeof(args[0]) === 'string') { //Keep string formatting if exists
            args[0] = " " + this._name + ":: " + (args[0] ? args[0] : '');
        } else {
            args.unshift(" " + this._name + ":: ");
        }
        int_dbg.log_always(syslevel.toUpperCase(), ...args);
    };
}

DebugLogger.prototype.error = log_syslog_builder('error');
DebugLogger.prototype.warn = log_syslog_builder('warn');
DebugLogger.prototype.info = log_syslog_builder('info');
DebugLogger.prototype.log = log_syslog_builder('log');
DebugLogger.prototype.trace = log_syslog_builder('trace');
DebugLogger.prototype.log0 = log_builder(0, { throttled: false });
DebugLogger.prototype.log0_throttled = log_builder(0, { throttled: true });
DebugLogger.prototype.log1 = log_builder(1, { throttled: false });
DebugLogger.prototype.log2 = log_builder(2, { throttled: false });
DebugLogger.prototype.log3 = log_builder(3, { throttled: false });
DebugLogger.prototype.log4 = log_builder(4, { throttled: false });
DebugLogger.prototype.log0_withbt = log_bt_builder(0);
DebugLogger.prototype.log1_withbt = log_bt_builder(1);
DebugLogger.prototype.log2_withbt = log_bt_builder(2);
DebugLogger.prototype.log3_withbt = log_bt_builder(3);
DebugLogger.prototype.log4_withbt = log_bt_builder(4);


DebugLogger.prototype.set_module_level = function(level, mod) {
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
};

DebugLogger.prototype.get_process_name = function() {
    return int_dbg._proc_name;
};

DebugLogger.prototype.set_log_to_file = function(log_file) {
    if (log_file) {
        int_dbg._file_path = path.parse(log_file);
    } else {
        int_dbg._file_path = undefined;
    }
};

DebugLogger.prototype.set_console_output = function(is_enabled) {
    int_dbg._log_console.silent = !is_enabled;
};

DebugLogger.prototype.original_console = function() {
    console_wrapper.original_console();
};

DebugLogger.prototype.wrapper_console = function() {
    console_wrapper.wrapper_console();
};

if (console_wrapper) {
    //Register a "console" module DebugLogger for the console wrapper
    const conlogger = new DebugLogger("CONSOLE.js");
    console_wrapper.register_logger(conlogger);
}

let native_log_level = LOG_LEVEL;
if (process.env.NOOBAA_LOG_LEVEL) {
    native_log_level = dbg_conf.level;
}
if (Number(native_log_level)) {
    nb_native().fs.set_debug_level(Number(native_log_level));
}
