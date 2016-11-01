/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const vm = require('vm');
const crypto = require('crypto');
const P = require('../util/promise');

const BUILTIN_MODULES_NAMES = [
    'assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto',
    'dns', 'domain', 'events', 'fs', 'http', 'https', 'net', 'os', 'path',
    'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'tls',
    'tty', 'dgram', 'url', 'util', 'v8', 'vm', 'zlib'
];

const BUILTIN_MODULES_MAP = new Map(_.map(BUILTIN_MODULES_NAMES,
    name => [name, {
        id: name,
        filename: name,
        exports: require(name),
        loaded: true,
        parent: null,
        children: [],
    }]
));

class LambdaVM {

    constructor({
        files,
        handler,
        lambda_io,
        rpc_client,
    }) {
        this.lambda_io = lambda_io;
        this.rpc_client = rpc_client;
        this.vm_require = mod_name => this._require(mod_name);
        this.timers = new WeakMap();
        this.vm_global = vm.createContext({
            setTimeout: (...args) => this._set_timer(setTimeout, clearTimeout, ...args),
            setInterval: (...args) => this._set_timer(setInterval, clearInterval, ...args),
            setImmediate: (...args) => this._set_timer(setImmediate, clearImmediate, ...args),
            clearTimeout: local => this._clear_timer(local),
            clearInterval: local => this._clear_timer(local),
            clearImmediate: local => this._clear_timer(local),
            require: this.vm_require,
            Buffer: Buffer, // TODO sandbox Buffer
            console: console, // TODO sandbox console
            process: process, // TODO sandbox process
        });
        // global is recursively pointing to itself
        this.vm_global.global = this.vm_global;
        this.modules = new Map(_.map(files,
            (code, filename) => [filename, {
                // https://nodejs.org/api/modules.html
                id: filename,
                filename: filename,
                exports: {},
                loaded: false,
                parent: null,
                children: [],
                require: this.vm_require,
                script: new vm.Script(code, {
                    filename: filename,
                }),
            }]
        ));
        const handler_split = handler.split('.');
        this.module_name = handler_split[0] + '.js';
        this.export_name = handler_split[1];
        this.vm_require.main = this.modules.get(this.module_name);
    }

    _require(name) {
        const mod = this._load_module(name);
        if (!mod) return;
        return mod.exports;
    }

    _load_module(name) {
        // TODO sandbox builtin modules
        const builtin = BUILTIN_MODULES_MAP.get(name);
        if (builtin) return builtin;
        const mod = this.modules.get(name);
        if (!mod) throw new Error(`Cannot find module \'${name}\'`);
        if (mod.loaded) return mod;
        this.vm_global.module = mod;
        this.vm_global.exports = mod.exports;
        this.vm_global.__dirname = '';
        this.vm_global.__filename = mod.filename;
        mod.script.runInContext(this.vm_global);
        mod.loaded = true;
        return mod;
    }

    _set_timer(setter, clearer, callback, ...args) {
        let local;
        const timer = setter(() => {
            this.timers.delete(local);
            return callback(...args);
        }, ...args);
        local = {
            ref() {
                return timer.ref();
            },
            unref() {
                return timer.unref();
            }
        };
        this.timers.set(local, {
            timer,
            clearer,
        });
        return local;
    }

    _clear_timer(local) {
        const t = this.timers.get(local);
        this.timers.delete(local);
        if (t) t.clearer(t.timer);
        if (!this.timers.size) {
            // should we reject running function?
        }
        return null;
    }

    _clear_all_timers() {
        for (const t of this.timers.values()) {
            t.clearer(t.timer);
        }
        this.timers.clear();
    }

    invoke(event) {
        return new P((resolve, reject) => {

            // http://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
            const func_context = {
                callbackWaitsForEmptyEventLoop: true,
                functionName: '',
                functionVersion: '',
                invokedFunctionArn: '',
                memoryLimitInMB: 0,
                awsRequestId: '',
                logGroupName: '',
                logStreamName: '',
                identity: null,
                clientContext: null,
                getRemainingTimeInMillis: () => 60 * 1000,
                // hacking the context to invoke another lambda
                invoke_lambda: (name, ev, callback) => {
                    this.lambda_io.invoke(this.rpc_client, name, ev)
                        .then(res => callback(null, {
                            StatusCode: 200,
                            // skip stringify of Payload and just return the parsed response
                            Response: res.result,
                        }))
                        .catch(err => callback(err));
                },
            };
            const func_callback = (err, reply) => {
                if (err) {
                    console.log('LambdaVM err', err);
                    reject(err);
                } else {
                    console.log('LambdaVM reply', reply);
                    resolve(reply);
                }
                if (!func_context.callbackWaitsForEmptyEventLoop) {
                    this._clear_all_timers();
                    setImmediate(() => this._clear_all_timers());
                }
            };
            // generate a random name since we hang it on the global object
            const hidden_key = '__' + crypto.randomBytes(16).toString('hex');
            const hidden = {
                context: func_context,
                event: event,
                callback: func_callback,
            };
            const main = this.vm_require.main;
            this.vm_global[hidden_key] = hidden;
            this.vm_global.module = main;
            this.vm_global.exports = main.exports;
            this.vm_global.__dirname = '';
            this.vm_global.__filename = main.filename;
            vm.runInContext(`
                var main = require('${this.module_name}');
                var handler = main['${this.export_name}'];
                var hidden = ${hidden_key};
                handler.call(null, hidden.event, hidden.context, hidden.callback);
            `, this.vm_global);
        });
    }

}



module.exports = LambdaVM;
