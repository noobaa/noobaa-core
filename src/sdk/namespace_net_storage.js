/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');

const P = require('../util/promise');
const mime = require('mime');
const dbg = require('../util/debug_module')(__filename);
const NetStorage = require('../util/NetStorageKit-Node-master/lib/netstorage');

const CONFIG_FIELDS = [
    'hostname',
    'keyName',
    'key',
    'cpCode',
    'ssl'
];

// TODO: This does not work after the versioning changes
class NamespaceNetStorage {

    constructor(options) {
        this.options = options;
        this.ns_config = _.pick(options, CONFIG_FIELDS);
        this.net_storage = new NetStorage(this.ns_config);
    }

    // /////////////////
    // // OBJECT LIST //
    // /////////////////

    list_object_versions(params, object_sdk) {
        dbg.log0('NamespaceNetStorage.list_object_versions:', this.ns_config.cpCode, inspect(params));
        // TODO list object versions
        return P.resolve({
            objects: [],
            common_prefixes: [],
            is_truncated: false,
        });
    }

    list_uploads(params, object_sdk) {
        dbg.log0('NamespaceNetStorage.list_uploads:', this.ns_config.cpCode, inspect(params));
        // TODO list uploads
        return P.resolve({
            objects: [],
            common_prefixes: [],
            is_truncated: false,
        });
    }

    list_objects(params, object_sdk) {
        dbg.log0('NamespaceNetStorage.list_objects:', this.ns_config.cpCode, inspect(params));
        // return this.s3.listObjects({
        //         Prefix: params.prefix,
        //         Delimiter: params.delimiter,
        //         Marker: params.key_marker,
        //         MaxKeys: params.limit,
        //     })
        const actions = _.omitBy({
            max_entries: params.limit,
            // start: params.key_marker,
            // prefix: params.prefix //=== '' ? undefined : params.prefix,
            // slash: 'both'
            // encoding: 'utf-8'
        }, _.isUndefined);

        return P.fromCallback(callback => this.net_storage.dir({
                path: `${this.ns_config.cpCode}`,
                actions
            }, callback))
            .then(res => {
                dbg.log0('NamespaceNetStorage.list_objects:', this.ns_config.cpCode, inspect(params), 'list', inspect(res.body));
                return this._parse_net_storage_dir(res.body, params.bucket);
            })
            .catch(err => {
                this._translate_error_code(err);
                throw err;
            });
    }

    // /////////////////
    // // OBJECT READ //
    // /////////////////

    read_object_md(params, object_sdk) {
        return P.fromCallback(callback => this.net_storage.stat({
                path: `${this.ns_config.cpCode}/${params.key}`
            }, callback))
            .then(res => this._get_net_storage_md(res.body.stat.file[0], params.bucket))
            .catch(err => {
                this._translate_error_code(err);
                throw err;
            });
    }

    read_object_stream(params, object_sdk) {
        return P.fromCallback(callback => this.net_storage.download({
            path: `${this.ns_config.cpCode}/${params.key}`
        }, callback));
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    upload_object(params, object_sdk) {
        dbg.log0('NamespaceNetStorage.upload_object:',
            this.ns_config.cpCode,
            _.omit(params, 'source_stream')
        );

        if (params.copy_source) {
            throw new Error('NamespaceNetStorage.upload_object: copy object not yet supported');
        }

        return P.fromCallback(callback => this.net_storage.upload({
                source: params.source_stream,
                path: `${this.ns_config.cpCode}/${params.key}`
            }, callback))
            .then(() => this.read_object_md(params, object_sdk))
            .then(res => {
                dbg.log0('NamespaceNetStorage.upload_object:', this.ns_config.cpCode, _.omit(params, 'source_stream'));
                return {
                    etag: res.etag,
                };
            });
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    delete_object(params, object_sdk) {
        dbg.log0('NamespaceNetStorage.delete_object:', this.ns_config.cpCode, inspect(params));
        return P.fromCallback(callback => this.net_storage.delete({
                path: `${this.ns_config.cpCode}/${params.key}`
            }, callback))
            .then(res => {
                dbg.log0('NamespaceNetStorage.delete_object:', this.ns_config.cpCode, inspect(params), 'res', inspect(res.body));
            })
            .catch(err => {
                this._translate_error_code(err);
                throw err;
            });
    }

    _get_net_storage_md(res, bucket) {
        const etag = res.md5;
        const xattr = _.extend({}, {
            'noobaa-namespace-netstorage-bucket': this.ns_config.cpCode,
        });
        return {
            obj_id: etag,
            bucket: bucket,
            key: res.name,
            size: res.size,
            etag,
            create_time: new Date(Number(res.mtime || 0) * 1000),
            content_type: mime.getType(res.name) || 'application/octet-stream',
            xattr,
        };
    }

    _parse_net_storage_dir(res, bucket) {
        const files = res.stat.file;
        return {
            objects: _.map(files.filter(f => f.type === 'file'), obj => this._get_net_storage_md(obj, bucket)),
            common_prefixes: _.map(files.filter(f => f.type !== 'file'), prefix => prefix.name),
            is_truncated: Boolean(res.resume),
            next_marker: res.resume && res.resume.start,
        };
    }

    _translate_error_code(err) {
        if (err.message.indexOf('not found') > -1) err.rpc_code = 'NO_SUCH_OBJECT';
    }

}

function inspect(x) {
    return util.inspect(x, true, 5, true);
}

module.exports = NamespaceNetStorage;
