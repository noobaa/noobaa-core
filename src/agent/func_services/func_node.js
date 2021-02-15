/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const P = require('../../util/promise');
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

    async invoke_func(req) {
        const func = await this._load_func_code(req);
        let res;
        try {
            // const res = await new Promise((resolve, reject) => {
            res = await new Promise((resolve, reject) => {
                const proc = child_process.fork(FUNC_PROC_PATH, [], {
                        cwd: func.code_dir,
                        stdio: 'inherit',
                        // main node root modules library for the forked lambda function, so function can use modules (like aws-s3)
                        // from wherever located (func.code_dir)
                        env: {
                            NODE_PATH: FUNC_NODE_PATH,
                            container: process.env.container
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
                    AWS_EXECUTION_ENV: 'NOOBAA_FUNCTION'
                };
                dbg.log1('invoke_func: send message', msg);
                proc.send(msg);
            });
        } catch (e) {
            dbg.error('invoke_func:: got error:', e);
            throw e;
        }
        return res;
    }

    async _load_func_code(req) {
        const name = req.params.config.name;
        const version = req.params.config.version;
        const code_sha256 = req.params.config.code_sha256;
        const version_dir = path.join(this.functions_path, name, version);
        const func_json_path = path.join(version_dir, 'func.json');
        // replacing the base64 encoded sha256 from using / to - in order to use as folder name
        const code_dir = path.join(version_dir, code_sha256.replace(/\//g, '-'));
        return this.loading_serial.surround(async () => {
            let func;
            try {
                try {
                    await fs.promises.stat(code_dir);
                    const func_json_buf = await fs.promises.readFile(func_json_path, 'utf8');
                    func = JSON.parse(func_json_buf);
                    //if we can't load the function from the code dir (or it is not exist) we will create the dir and put the code there
                } catch (err) {
                    if (err.code !== 'ENOENT') throw err;
                    func = await this._write_func_into_dir(code_dir, name, version, code_sha256, version_dir, func_json_path, req);
                }
                func.code_dir = code_dir;
                dbg.log1('_load_func_code: loaded', func.config, code_dir);
                return func;
            } catch (err) {
                console.error('_load_func_code: FAILED', err.stack || err);
                throw err;
            }
        });
    }

    async _write_func_into_dir(code_dir, name, version, code_sha256, version_dir, func_json_path, req) {
        const loading_dir = path.join(this.functions_loading_path, Date.now().toString(36));
        dbg.log0('_load_func_code: loading', loading_dir, code_dir);
        const func = await this.rpc_client.func.read_func({
            name,
            version,
            read_code: true
        }, req.params.rpc_options);
        if (code_sha256 !== func.config.code_sha256 ||
            req.params.config.code_size !== func.config.code_size) {
            throw new RpcError('FUNC_CODE_MISMATCH',
                `Function code does not match for ${func.name} version ${func.version} code_size ${func.config.code_size} code_sha256 ${func.config.code_sha256} 
                    requested code_size ${req.params.config.code_size} code_sha256 ${req.params.config.code_sha256}`);
        }
        const zipfile = await zip_utils.unzip_from_buffer(func[RPC_BUFFERS].zipfile);
        await zip_utils.unzip_to_dir(zipfile, loading_dir);
        await fs_utils.create_fresh_path(version_dir);
        await fs_utils.folder_delete(code_dir);
        await fs.promises.writeFile(
            func_json_path,
            JSON.stringify(func));
        await P.retry({
            attempts: 3,
            delay_ms: 500,
            func: async () => {
                try {
                    await fs.promises.rename(loading_dir, code_dir);
                } catch (e) {
                    dbg.error('Got error when trying to place new function, will retry', e);
                    throw e;
                }
            }
        });
        return func;
    }
}

module.exports = FuncNode;
