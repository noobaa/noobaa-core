/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
// const crypto = require('crypto');

const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const dbg = require('../../util/debug_module')(__filename);
const { RpcError, RPC_BUFFERS } = require('../../rpc');
const fs_utils = require('../../util/fs_utils');
const Semaphore = require('../../util/semaphore');
const zip_utils = require('../../util/zip_utils');

const FUNC_PROC_PATH = path.resolve(__dirname, 'func_proc.js');
const FUNC_NODE_PATH = path.resolve(__dirname, '..', '..', '..', 'node_modules');

class FuncNode {

    constructor(params) {
        this.rpc_client = params.rpc_client;
        this.storage_path = params.storage_path || '.';
        this.functions_path = path.join(this.storage_path, 'functions');
        this.functions_loading_path = path.join(this.storage_path, 'functions_loading');
        this.loading_serial = new Semaphore(1);
    }

    invoke_func(req) {
        return this._load_func_code(req)
            .then(func => new P((resolve, reject) => {
                const proc = child_process.fork(FUNC_PROC_PATH, [], {
                        cwd: func.code_dir,
                        stdio: 'inherit',
                        // main node root modules library for the forked lambda function, so function can use modules (like aws-s3)
                        // from wherever located (func.code_dir)
                        env: {
                            NODE_PATH: FUNC_NODE_PATH
                        }
                    })
                    .once('error', reject)
                    .once('exit', code => resolve({
                        error: {
                            message: `Func process exit unexpectedly (should use callback function) with code ${code}`,
                            code: String(code),
                        }
                    }))
                    .once('message', msg => {
                        dbg.log1('invoke_func: received message', msg);
                        if (msg.error) {
                            return resolve({
                                error: {
                                    message: msg.error.message || 'Unknown error from func process',
                                    stack: msg.error.stack,
                                    code: String(msg.error.code),
                                }
                            });
                        }
                        return resolve({
                            result: msg.result
                        });
                    });
                const msg = {
                    config: req.params.config,
                    event: req.params.event,
                    aws_config: req.params.aws_config,
                    rpc_options: req.params.rpc_options,
                };
                dbg.log1('invoke_func: send message', msg);
                proc.send(msg);
            }));
    }

    _load_func_code(req) {
        const name = req.params.config.name;
        const version = req.params.config.version;
        const code_sha256 = req.params.config.code_sha256;
        const version_dir = path.join(this.functions_path, name, version);
        const func_json_path = path.join(version_dir, 'func.json');
        // replacing the base64 encoded sha256 from using / to - in order to use as folder name
        const code_dir = path.join(version_dir, code_sha256.replace(/\//g, '-'));
        return this.loading_serial.surround(() => P.resolve()
            .then(() => fs.statAsync(code_dir))
            .then(() => fs.readFileAsync(func_json_path))
            .then(func_json_buf => JSON.parse(func_json_buf))
            .catch(err => {
                if (err.code !== 'ENOENT') throw err;
                const loading_dir = path.join(this.functions_loading_path, Date.now().toString(36));
                let func;
                dbg.log0('_load_func_code: loading', loading_dir, code_dir);
                return P.resolve()
                    .then(() => this.rpc_client.func.read_func({
                        name: name,
                        version: version,
                        read_code: true
                    }, req.params.rpc_options))
                    .then(res => {
                        func = res;
                        if (code_sha256 !== func.config.code_sha256 ||
                            req.params.config.code_size !== func.config.code_size) {
                            throw new RpcError('FUNC_CODE_MISMATCH',
                                `Function code does not match for ${func.name} version ${func.version} code_size ${func.config.code_size} code_sha256 ${func.config.code_sha256} 
                                requested code_size ${req.params.config.code_size} code_sha256 ${req.params.config.code_sha256}`);
                        }
                    })
                    .then(() => zip_utils.unzip_from_buffer(func[RPC_BUFFERS].zipfile))
                    .then(zipfile => zip_utils.unzip_to_dir(zipfile, loading_dir))
                    .then(() => fs_utils.create_fresh_path(version_dir))
                    .then(() => fs_utils.folder_delete(code_dir))
                    .then(() => fs.writeFileAsync(
                        func_json_path,
                        JSON.stringify(func)))
                    .then(() => promise_utils.retry(3, 500, () =>
                        fs.renameAsync(loading_dir, code_dir)
                        .catch(e => {
                            dbg.error('Got error when trying to place new function, will retry', e);
                            throw e;
                        })
                    ))
                    .then(() => func);
            })
            .then(func => {
                func.code_dir = code_dir;
                dbg.log1('_load_func_code: loaded', func.config, code_dir);
                return func;
            })
            .catch(err => {
                console.error('_load_func_code: FAILED', err.stack || err);
                throw err;
            }));
    }

}

module.exports = FuncNode;
