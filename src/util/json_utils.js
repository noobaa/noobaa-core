/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const fs_utils = require('./fs_utils');
const Semaphore = require('./semaphore');

class JsonFileWrapper {

    constructor(json_path) {
        this.json_path = json_path;
        this.json_sem = new Semaphore(1);
    }

    read() {
        // maybe we can change to allow multiple readers if necessary.
        return this.json_sem.surround(() =>
            this._read_internal()
        );
    }

    update(params) {
        // serialize json updates with Sempahore(1)
        return this.json_sem.surround(() =>
            P.resolve()
            .then(() => this._read_internal())
            .then(obj => JSON.stringify(_.assign(obj, params)))
            .then(data => fs_utils.replace_file(this.json_path, data))
        );
    }

    _read_internal() {
        return P.resolve()
            .then(() => fs.promises.readFile(this.json_path, 'utf8'))
            .then(data => JSON.parse(data))
            .catch(err => {
                if (err.code === 'ENOENT') {
                    dbg.warn(`could not find json file ${this.json_path}. returning empty data`);
                    return {};
                }
                dbg.error(`error when trying to read json file ${this.json_path}. ${err}`);
                throw err;
            });
    }
}

/**
 * JsonObjectWrapper is a memory backed implementation like JsonFileWrapper
 */
class JsonObjectWrapper {

    constructor(initial) {
        this.obj = initial || {};
    }

    read() {
        return P.resolve(_.cloneDeep(this.obj));
    }

    update(params) {
        _.assign(this.obj, _.cloneDeep(params));
    }

}

exports.JsonFileWrapper = JsonFileWrapper;
exports.JsonObjectWrapper = JsonObjectWrapper;
