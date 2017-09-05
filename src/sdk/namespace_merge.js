/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const P = require('../util/promise');

class NamespaceMerge {

    constructor(namespaces) {
        this.namespaces = namespaces;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    list_objects(params, object_sdk) {
        return P.map(this.namespaces.read_resources, ns => ns.list_objects(params))
            .then(res => {
                if (res.length === 1) return res[0];
                var i;
                var j;
                const map = {};
                var is_truncated;
                for (i = 0; i < res.length; ++i) {
                    for (j = 0; j < res[i].objects.length; ++j) {
                        const obj = res[i].objects[j];
                        if (!map[obj.key]) map[obj.key] = obj;
                    }
                    for (j = 0; j < res[i].common_prefixes.length; ++j) {
                        const prefix = res[i].common_prefixes[j];
                        map[prefix] = prefix;
                    }
                    if (res[i].is_truncated) is_truncated = true;
                }
                const all_names = Object.keys(map);
                all_names.sort();
                const names = all_names.slice(0, params.limit || 1000);
                const objects = [];
                const common_prefixes = [];
                for (i = 0; i < names.length; ++i) {
                    const name = names[i];
                    const obj_or_prefix = map[name];
                    if (typeof obj_or_prefix === 'string') {
                        common_prefixes.push(obj_or_prefix);
                    } else {
                        objects.push(obj_or_prefix);
                    }
                }
                if (names.length < all_names.length) {
                    is_truncated = true;
                }
                // TODO picking the name as marker is not according to spec of both S3 and Azure
                // because the marker is opaque to the client and therefore it is not safe to assume that using this as next marker
                // will really provide a stable iteration.
                const next_marker = is_truncated ? names[names.length - 1] : undefined;
                return {
                    objects,
                    common_prefixes,
                    is_truncated,
                    next_marker,
                };
            });
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    read_object_md(params, object_sdk) {
        return this._ns_get(ns => P.resolve(ns.read_object_md(params))
            .then(res => {
                // save the ns in the response for optimizing read_object_stream
                res.ns = ns;
                return res;
            }));
    }

    read_object_stream(params, object_sdk) {
        // use the saved ns from read_object_md
        if (params.object_md && params.object_md.ns) return params.object_md.ns.read_object_stream(params);
        return this._ns_get(ns => ns.read_object_stream(params));
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    upload_object(params, object_sdk) {
        return this._ns_put(ns => ns.upload_object(params));
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    create_object_upload(params, object_sdk) {
        return this._ns_put(ns => ns.create_object_upload(params));
    }

    upload_multipart(params, object_sdk) {
        return this._ns_put(ns => ns.upload_multipart(params));
    }

    list_multiparts(params, object_sdk) {
        return this._ns_put(ns => ns.list_multiparts(params));
    }

    complete_object_upload(params, object_sdk) {
        return this._ns_put(ns => ns.complete_object_upload(params));
    }

    abort_object_upload(params, object_sdk) {
        return this._ns_put(ns => ns.abort_object_upload(params));
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    // TODO should we: (1) delete from all ns ? (2) delete from writable ns ? (3) create a "delete marker" on writable ns

    delete_object(params, object_sdk) {
        return this._ns_put(ns => ns.delete_object(params));
    }

    delete_multiple_objects(params, object_sdk) {
        return this._ns_put(ns => ns.delete_multiple_objects(params));
    }

    //////////////
    // INTERNAL //
    //////////////

    _ns_get(func) {
        var i = -1;
        const try_next = err => {
            i += 1;
            if (i >= this.namespaces.read_resources.length) {
                return P.reject(err || new Error('NamespaceMerge._ns_get exhausted'));
            }
            const ns = this.namespaces.read_resources[i];
            return P.try(() => func(ns)).catch(try_next);
        };
        return try_next();
    }

    _ns_put(func) {
        const ns = this.namespaces.write_resource;
        return P.try(() => func(ns));
    }

}


module.exports = NamespaceMerge;
