/* Copyright (C) 2016 NooBaa */
// Original author: Astin Choi <achoi@akamai.com>

// Copyright 2016 Akamai Technologies http://developer.akamai.com.

// Licensed under the Apache License, Version 2.0 (the "License")
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';
const APIRequest = require('./api-request');

class Netstorage {
    constructor(netstorageOpts) {
        this.netstorageOpts = netstorageOpts;
        if (!(this.netstorageOpts instanceof Object)) {
            throw new TypeError('[Netstorage Error] options should be an object');
        }
        if (!(this.netstorageOpts.hostname && this.netstorageOpts.keyName && this.netstorageOpts.key)) {
            throw new Error('[Netstorage Error] You should input netstorage hostname, keyname and key all');
        }
        if (this.netstorageOpts.ssl === undefined) {
            this.netstorageOpts.ssl = false;
        } else if (typeof(this.netstorageOpts.ssl) !== 'boolean') {
            throw new TypeError('[Netstorage Error] "ssl" argument should be boolean type');
        }

        this.requestor = new APIRequest(this.netstorageOpts);
    }

    dir(opts, callback) {
        return this.requestor.makeRequest(this.buildRequestOptions(this.dir.name, opts), callback);
    }

    // list(opts, callback) {
    //     return P.fromCallback(() =>
    //         this.requestor.makeRequest(this.buildRequestOptions(this.list.name, opts), callback)
    //     );
    // }

    download(params, callback) {
        if (params.path.endsWith('/')) {
            return callback(new Error('[Netstorage Error] cannot download a directory'));
        }

        return this.requestor.makeRequest({
                action: 'download',
                method: 'GET',
                path: params.path,
            },
            callback);
    }

    // du(ns_path, callback) {
    //     return P.fromCallback(() =>
    //         this.requestor.makeRequest({
    //                 action: 'du&format=xml',
    //                 method: 'GET',
    //                 path: ns_path
    //             },
    //             callback)
    //     );
    // }

    stat(opts, callback) {
        return this.requestor.makeRequest({
                action: 'stat&format=xml',
                method: 'GET',
                path: opts.path
            },
            callback);
    }

    mkdir(opts, callback) {
        return this.requestor.makeRequest({
                action: 'mkdir',
                method: 'POST',
                path: opts.path
            },
            callback);
    }

    rmdir(opts, callback) {
        return this.requestor.makeRequest({
                action: 'rmdir',
                method: 'POST',
                path: opts.path
            },
            callback);
    }

    // mtime(ns_path, mtime, callback) {
    //     return P.fromCallback(() =>
    //         this.requestor.makeRequest({
    //                 action: `mtime&format=xml&mtime=${mtime}`,
    //                 method: 'POST',
    //                 path: ns_path
    //             },
    //             callback)
    //     );
    // }

    delete(ops, callback) {
        return this.requestor.makeRequest({
                action: 'delete',
                method: 'POST',
                path: ops.path
            },
            callback);
    }

    // quick_delete(ns_path, callback) {
    //     return P.fromCallback(() =>
    //         this.requestor.makeRequest({
    //                 action: 'quick-delete&quick-delete=imreallyreallysure',
    //                 method: 'POST',
    //                 path: ns_path
    //             },
    //             callback)
    //     );
    // }

    // rename(ns_target, ns_destination, callback) {
    //     return P.fromCallback(() =>
    //         this.requestor.makeRequest({
    //                 action: `rename&destination=${encodeURIComponent(ns_destination)}`,
    //                 method: 'POST',
    //                 path: ns_target
    //             },
    //             callback)
    //     );
    // }

    // symlink(ns_target, ns_destination, callback) {
    //     return P.fromCallback(() =>
    //         this.requestor.makeRequest({
    //                 action: `symlink&target=${encodeURIComponent(ns_target)}`,
    //                 method: 'POST',
    //                 path: ns_destination
    //             },
    //             callback)
    //     );
    // }

    upload(params, callback) {
        return this.requestor.makeRequest({
                action: 'upload',
                method: 'PUT',
                source: params.source,
                path: params.path
            },
            callback);
    }

    buildRequestOptions(vmethod, vopts) {
        var method = vmethod;
        var opts = vopts;
        var baseActions = `${method}&format=xml`;
        if (typeof opts === 'object') {
            if (opts.path) {
                if (opts.actions instanceof Object && Object.keys(opts.actions).length > 0) {
                    return {
                        action: baseActions + this.buildRequestActions(opts.actions),
                        method: 'GET',
                        path: opts.path
                    };
                } else {
                    throw new Error('[Netstorage Error] If an options object is passed, it must contain an "actions" object with key/value pairs for each action option');
                }
            } else {
                throw new Error('[Netstorage Error] If an options object is passed, it must contain a "path" key/value pair');
            }
        } else if (typeof opts === 'string') {
            return {
                action: baseActions,
                method: 'GET',
                path: opts
            };
        } else {
            throw new Error('[Netstorage Error] Options must be either a string path, or an object containing all desired options');
        }
    }

    buildRequestActions(vactions) {
        var actions = vactions;
        var parsedActions = '';
        Object.keys(actions).forEach(action => {
            parsedActions += `&${action}=${actions[action]}`;
        });
        return parsedActions;
    }

}

module.exports = Netstorage;
