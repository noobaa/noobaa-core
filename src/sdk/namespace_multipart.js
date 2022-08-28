/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../util/promise');
const _ = require('lodash');

const EXCEPT_REASONS = [
    'NO_SUCH_OBJECT'
];
class NamespaceMultipart {

    constructor(write_ns, multipart_ns) {
        this.write_ns = write_ns;
        this.multipart_ns = multipart_ns;
        // TODO: Should the multipart be in first priority or not?
        // Currently I assume that the multipart is the highest priority
        // Since we are interested in writing to NooBaa (multipart files obviously)
        this.total_resources = [this.multipart_ns, this.write_ns];
    }

    get_write_resource() {
        return this.write_ns;
    }

    is_readonly_namespace() {
        return false;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    list_objects(params, object_sdk) {
        return this._ns_map(ns => ns.list_objects(params, object_sdk))
            .then(res => this._handle_list(res, params));
    }

    list_uploads(params, object_sdk) {
        return this._ns_map(ns => ns.list_uploads(params, object_sdk))
            .then(res => this._handle_list(res, params));
    }

    list_object_versions(params, object_sdk) {
        return this._ns_map(ns => ns.list_object_versions(params, object_sdk))
            .then(res => this._handle_list(res, params));
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    read_object_md(params, object_sdk) {
        return this._ns_map(ns => P.resolve(ns.read_object_md(params, object_sdk))
                .then(res => {
                    // save the ns in the response for optimizing read_object_stream
                    res.ns = ns;
                    return res;
                }))
            .then(reply => {
                const working_set = _.sortBy(
                    this._throw_if_all_failed_or_get_succeeded(reply),
                    'create_time'
                );
                return _.last(working_set);
            });
    }

    read_object_stream(params, object_sdk) {
        // use the saved ns from read_object_md
        if (params.object_md && params.object_md.ns) return params.object_md.ns.read_object_stream(params, object_sdk);
        throw new Error('NO OBJECT_MD NAMESPACE PASSED');
        //return this._ns_get(ns => ns.read_object_stream(params, object_sdk));
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    upload_object(params, object_sdk) {
        return this.write_ns.upload_object(params, object_sdk);
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    create_object_upload(params, object_sdk) {
        return this.multipart_ns.create_object_upload(params, object_sdk);
    }

    upload_multipart(params, object_sdk) {
        return this.multipart_ns.upload_multipart(params, object_sdk);
    }

    list_multiparts(params, object_sdk) {
        return this.multipart_ns.list_multiparts(params, object_sdk);
    }

    complete_object_upload(params, object_sdk) {
        return this.multipart_ns.complete_object_upload(params, object_sdk);
    }

    abort_object_upload(params, object_sdk) {
        return this.multipart_ns.abort_object_upload(params, object_sdk);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    delete_object(params, object_sdk) {
        return this._ns_map(ns => ns.delete_object(params, object_sdk))
            .then(reply => {
                const succeeded = this._throw_if_any_failed_or_get_succeeded(reply, EXCEPT_REASONS);
                return _.first(succeeded);
            });
    }

    delete_multiple_objects(params, object_sdk) {
        return this._ns_map(ns => ns.delete_multiple_objects(params, object_sdk))
            .then(reply => {
                const succeeded = this._throw_if_any_failed_or_get_succeeded(reply, EXCEPT_REASONS);
                return _.first(succeeded);
            });
    }

    _ns_map(func) {
        return P.map(this.total_resources, ns =>
            P.try(() => func(ns))
            .then(reply => ({
                reply,
                success: true
            }))
            .catch(error => ({
                error,
                success: false
            }))
        );
    }

    _ns_get(func) {
        var i = -1;
        const try_next = err => {
            i += 1;
            if (i >= this.total_resources.length) {
                return P.reject(err || new Error('NamespaceMultipart._ns_get exhausted'));
            }
            const ns = this.total_resources[i];
            return P.try(() => func(ns)).catch(try_next);
        };
        return try_next();
    }

    _get_succeeded_responses(reply_array) {
        return reply_array.filter(res => res.success).map(rec => rec.reply);
    }

    _get_failed_responses(reply_array, except_reasons) {
        return reply_array.filter(res => !res.success).map(rec => rec.error)
            .filter(error => !_.includes(except_reasons || [], error.rpc_code || 'UNKNOWN_ERR'));
    }

    _throw_if_all_failed_or_get_succeeded(reply_array, except_reasons) {
        const failed = this._get_failed_responses(reply_array, except_reasons);
        const succeeded = this._get_succeeded_responses(reply_array);
        if (_.isEmpty(succeeded)) {
            throw _.first(failed);
        } else {
            return succeeded;
        }
    }

    _throw_if_any_failed_or_get_succeeded(reply_array, except_reasons) {
        const failed = this._get_failed_responses(reply_array, except_reasons);
        const succeeded = this._get_succeeded_responses(reply_array);
        if (_.isEmpty(failed)) {
            return succeeded;
        } else {
            throw _.first(failed);
        }
    }

    // TODO: Currently it only takes the most recent objects without duplicates
    // This means that in list_object_versions we will only see the is_latest objects
    // Which is not what we wanted since we want to see all of the versions
    _handle_list(res, params) {
        res = this._throw_if_all_failed_or_get_succeeded(res);
        if (res.length === 1) return res[0];
        var i;
        var j;
        const map = {};
        var is_truncated;
        for (i = 0; i < res.length; ++i) {
            for (j = 0; j < res[i].objects.length; ++j) {
                const obj = res[i].objects[j];
                if (!map[obj.key] ||
                    (map[obj.key] && obj.create_time > map[obj.key].create_time)
                ) map[obj.key] = obj;
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
        // In case of prefix there will be no object (which means undefined)
        const last_obj_or_prefix = map[names[names.length - 1]];
        const next_version_id_marker = is_truncated && (typeof last_obj_or_prefix === 'object') ? last_obj_or_prefix.version_id : undefined;
        const next_upload_id_marker = is_truncated && (typeof last_obj_or_prefix === 'object') ? last_obj_or_prefix.obj_id : undefined;

        return {
            objects,
            common_prefixes,
            is_truncated,
            next_marker,
            next_upload_id_marker,
            next_version_id_marker
        };
    }

}


module.exports = NamespaceMultipart;
