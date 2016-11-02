'use strict';

const _ = require('lodash');
const fs = require('fs');

const dbg = require('./debug_module')(__filename);
const Semaphore = require('./semaphore');


class JsonWrapper {
    constructor(json_path) {
        this.json_path = json_path;
        this.json_sem = new Semaphore(1);
    }


    read() {
        if (!this.json_path) return {};
        // maybe we can change to allow multiple readers if necessary.
        return this.json_sem.surround(() => fs.readFileAsync(this.json_path))
            .catch(err => {
                if (err.code === 'ENOENT') {
                    dbg.warn(`could not find json file ${this.json_path}. returning empty data`);
                    return {};
                }
                dbg.error(`error when trying to read json file ${this.json_path}. ${err}`);
                throw err;
            })
            .then(data => JSON.parse(data));
    }

    update(params) {
        if (!this.json_path) return;
        // serialize json updates with Sempahore(1)
        return this.json_sem.surround(() => {
            dbg.log0(`updating json file ${this.json_path} with params: ${params}`);
            return fs.readFileAsync(this.json_path)
                .then(data => {
                    const json_obj = JSON.parse(data);
                    dbg.log1(`old values in json file ${this.json_path}: ${json_obj}`);
                    _.assign(json_obj, params);
                    return json_obj;
                }, err => {
                    if (err.code === 'ENOENT') {
                        dbg.log0(`could not find json file ${this.json_path}. creating new one...`);
                        return {};
                    } else {
                        throw err;
                    }
                })
                .then(json_obj => {
                    _.assign(json_obj, params);
                    const data = JSON.stringify(json_obj);
                    dbg.log1(`writing new values to json file ${this.json_path}: ${json_obj}`);
                    return fs.writeFileAsync(this.json_path, data);
                });
        });
    }
}


exports.JsonWrapper = JsonWrapper;
