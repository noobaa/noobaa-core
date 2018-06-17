/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const NetStorage = require('../util/NetStorageKit-Node-master/lib/netstorage');

const CONFIG_FIELDS = [
    'hostname',
    'keyName',
    'key',
    'cpCode',
    'ssl'
];

class AccountSpaceNetStorage {

    constructor(options) {
        this.options = options;
        this.ns_config = _.pick(options, CONFIG_FIELDS);
        this.net_storage = new NetStorage(this.ns_config);
    }

    ////////////
    // BUCKET //
    ////////////

    list_buckets() {
        return P.fromCallback(callback => this.net_storage.dir(`${this.ns_config.cpCode}`, callback))
            .then(reply => {
                dbg.log0('AccountSpaceNetStorage.list_buckets:', this.ns_config.cpCode, 'list_buckets', inspect(reply.body));
                return {
                    buckets: this._parse_net_storage_bucket_list(reply.body)
                };
            })
            .catch(err => {
                this._translate_error_code(err);
                throw err;
            });
    }

    read_bucket(params) {
        return P.fromCallback(callback => this.net_storage.dir(`${this.ns_config.cpCode}/${params.name}`, callback))
            .then(res => {
                dbg.log0('AccountSpaceNetStorage.read_bucket:', this.ns_config.cpCode, inspect(params), 'read_bucket', inspect(res.body));
            })
            .catch(err => {
                this._translate_error_code(err);
                throw err;
            });
    }

    create_bucket(params) {
        return P.fromCallback(callback => this.net_storage.mkdir({
                path: `${this.ns_config.cpCode}/${params.name}`
            }, callback))
            .then(res => {
                dbg.log0('AccountSpaceNetStorage.create_bucket:', this.ns_config.cpCode, inspect(params), 'create_bucket', inspect(res.body));
            })
            .catch(err => {
                this._translate_error_code(err);
                throw err;
            });
    }

    delete_bucket(params) {
        return P.fromCallback(callback => this.net_storage.rmdir({
                path: `${this.ns_config.cpCode}/${params.name}`
            }, callback))
            .then(res => {
                dbg.log0('AccountSpaceNetStorage.delete_bucket:', this.ns_config.cpCode, inspect(params), 'delete_bucket', inspect(res.body));
            })
            .catch(err => {
                this._translate_error_code(err);
                throw err;
            });
    }

    _translate_error_code(err) {
        if (err.message.indexOf('not found') > -1) err.rpc_code = 'NO_SUCH_OBJECT';
    }

    _parse_net_storage_bucket_list(res) {
        const files = res.stat.file;
        return _.map(files.filter(f => f.type === 'dir'), prefix => ({ name: prefix.name }));
    }

}

function inspect(x) {
    return util.inspect(x, true, 5, true);
}

module.exports = AccountSpaceNetStorage;
