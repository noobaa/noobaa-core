/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');
const ip_module = require('ip');

const P = require('../../util/promise');
const api = require('../../api');
const dbg = require('../../util/debug_module')(__filename);
const FuncNode = require('../../agent/func_services/func_node');
const url_utils = require('../../util/url_utils');
const server_rpc = require('../server_rpc');
const func_store = require('./func_store');
const func_stats_store = require('./func_stats_store');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');

const FUNC_CONFIG_FIELDS_MUTABLE = [
    'description',
    'role',
    'handler',
    'runtime',
    'memory_size',
    'timeout',
];
const FUNC_CONFIG_DEFAULTS = {
    handler: 'index',
    runtime: 'nodejs6',
    memory_size: 128,
    timeout: 60,
};
const FUNC_CONFIG_FIELDS_IMMUTABLE = [
    'code_size',
    'code_sha256',
    'last_modified',
    'resource_name',
];

function create_func(req) {
    const func_config = req.params.config;
    const func_code = req.params.code;
    const func = _.defaults(
        _.pick(func_config, FUNC_CONFIG_FIELDS_MUTABLE),
        FUNC_CONFIG_DEFAULTS);
    func._id = func_store.instance().make_func_id();
    func.system = req.system._id;
    func.name = func_config.name;
    func.version = '$LATEST';
    func.last_modified = new Date();
    func.resource_name = `arn:noobaa:lambda:region:${func.system}:function:${func.name}:${func.version}`;
    if (req.params.config.pools) {
        func.pools = _.map(req.params.config.pools, pool_name =>
            req.system.pools_by_name[pool_name]._id);
    } else {
        func.pools = [req.account.default_pool._id];
    }
    if (!func.pools.length) {
        throw new Error('No pools');
    }

    return P.resolve()
        .then(() => {
            if (!func_code.zipfile_b64) throw new Error('Unsupported code');
            return new stream.Readable({
                read(size) {
                    this.push(Buffer.from(func_code.zipfile_b64, 'base64'));
                    this.push(null);
                }
            });
        })
        .then(code_stream => func_store.instance().create_code_gridfs({
            system: func.system,
            name: func.name,
            version: func.version,
            code_stream,
        }))
        .then(res => {
            func.code_gridfs_id = res.id;
            func.code_sha256 = res.sha256;
            func.code_size = res.size;
        })
        .then(() => func_store.instance().create_func(func))
        .then(() => _load_func(req))
        .then(() => _get_func_info(req.func));
}

function update_func(req) {
    const func_config = req.params.config;
    const config_updates = _.pick(func_config, FUNC_CONFIG_FIELDS_MUTABLE);
    if (func_config.pools) {
        config_updates.pools = _.map(func_config.pools, pool_name =>
            req.system.pools_by_name[pool_name]._id);
    }
    return _load_func(req)
        .then(() => {
            const func = req.func;
            const func_code = req.params.code;
            if (!func_code) return;
            return P.resolve()
                .then(() => func_store.instance().delete_code_gridfs(func.code_gridfs_id))
                .then(() => {
                    if (!func_code.zipfile_b64) throw new Error('Unsupported code');
                    return new stream.Readable({
                        read(size) {
                            this.push(Buffer.from(func_code.zipfile_b64, 'base64'));
                            this.push(null);
                        }
                    });
                })
                .then(code_stream => func_store.instance().create_code_gridfs({
                    system: func.system,
                    name: func.name,
                    version: func.version,
                    code_stream,
                }))
                .then(res => {
                    config_updates.code_gridfs_id = res.id;
                    config_updates.code_sha256 = res.sha256;
                    config_updates.code_size = res.size;
                });
        })
        .then(() => func_store.instance().update_func(
            req.func._id,
            config_updates
        ))
        .then(() => _load_func(req))
        .then(() => _get_func_info(req.func));
}

function delete_func(req) {
    return _load_func(req)
        .then(() => func_store.instance().delete_code_gridfs(req.func.code_gridfs_id))
        .then(() => func_store.instance().delete_func(req.func._id));
}

function read_func(req) {
    return _load_func(req)
        .then(() => _get_func_info(req.func))
        .then(reply => {
            if (!req.params.read_code) return reply;
            return func_store.instance().read_code_gridfs(req.func.code_gridfs_id)
                .then(buffer => {
                    reply.code = {
                        zipfile_b64: buffer.toString('base64')
                    };
                    return reply;
                });
        })
        .then(reply => {
            if (!req.params.read_stats) return reply;
            const MINUTE = 60 * 1000;
            const HOUR = 60 * MINUTE;
            const DAY = 24 * HOUR;
            const now = Date.now();
            const last_10_minutes = now - (10 * MINUTE);
            const last_hour = now - HOUR;
            const last_day = now - DAY;
            return func_stats_store.instance().sample_func_stats({
                    system: req.func.system,
                    func: req.func._id,
                    since_time: new Date(last_day),
                    sample_size: 1000,
                })
                .then(stats => {
                    const stats_sorted_by_took =
                        _.chain(stats)
                        .reject('error')
                        .sortBy('took')
                        .value();
                    reply.stats = {
                        response_time_last_10_minutes: _calc_percentiles(
                            _.filter(stats_sorted_by_took,
                                s => s.time >= last_10_minutes),
                            'took'),
                        response_time_last_hour: _calc_percentiles(
                            _.filter(stats_sorted_by_took,
                                s => s.time >= last_hour),
                            'took'),
                        response_time_last_day: _calc_percentiles(
                            stats_sorted_by_took, 'took'),
                        requests_over_time: _.chain(stats)
                            .groupBy(s => Math.ceil(s.time.getTime() / MINUTE))
                            .map((g, t) => ({
                                time: t * MINUTE,
                                requests: g.length,
                                errors: _.filter(g, 'error').length
                            }))
                            .value()
                    };
                    return reply;
                });
        });
}

function _calc_percentiles(list, prop) {
    const percentiles = list.length ?
        _.map([
            0, 10, 20, 30, 40,
            50, 60, 70, 80, 90,
            95, 99, 99.9, 100
        ], i => ({
            percent: i,
            value: list[Math.min(
                list.length - 1,
                Math.floor(list.length * i * 0.01)
            )][prop]
        })) : [];
    return {
        count: list.length,
        percentiles: percentiles,
    };

}

function list_funcs(req) {
    return P.resolve()
        .then(() => func_store.instance().list_funcs(req.system._id))
        .then(funcs => ({
            functions: _.map(funcs, _get_func_info)
        }));
}

function list_func_versions(req) {
    return P.resolve()
        .then(() => func_store.instance().list_func_versions(
            req.system._id,
            req.params.name
        ))
        .then(funcs => ({
            versions: _.map(funcs, _get_func_info)
        }));
}

const server_func_node = new FuncNode({
    rpc_client: server_rpc.client,
    storage_path: '/tmp/',
});

function invoke_func(req) {
    const time = new Date();
    return _load_func(req)
        .then(() => P.map(req.func.pools,
            pool => node_allocator.refresh_pool_alloc(pool)))
        .then(() => {
            const func = req.func;
            const node = node_allocator.allocate_node(func.pools);
            const params = {
                name: func.name,
                version: func.version,
                code_size: func.code_size,
                code_sha256: func.code_sha256,
                event: req.params.event,
                aws_config: _make_aws_config(req),
                rpc_options: _make_rpc_options(req),
            };
            if (!node) {
                dbg.log0('invoking on server', func.name, req.params.event);
                return server_func_node.invoke_func({ params });
            }
            dbg.log0('invoking on node',
                func.name, req.params.event,
                node.name, node.pool);
            return server_rpc.client.func_node.invoke_func(params, {
                address: node.rpc_address
            });
        })
        .then(res => func_stats_store.instance().create_func_stat({
                system: req.func.system,
                func: req.func._id,
                time: time,
                took: Date.now() - time.getTime(),
                error: res.error ? true : undefined,
            })
            .return(res)
        );
}

function _load_func(req) {
    const system = req.system._id;
    const name = req.params.name || _.get(req, 'params.config.name');
    const version = req.params.version || _.get(req, 'params.config.version');
    return P.resolve()
        .then(() => func_store.instance().read_func(system, name, version))
        .then(func => {
            req.func = func;
            func.pools = _.map(func.pools, pool_id => system_store.data.get_by_id(pool_id));
            return func;
        });
}

function _get_func_info(func) {
    const config = _.pick(func,
        'name',
        'version',
        FUNC_CONFIG_FIELDS_MUTABLE,
        FUNC_CONFIG_FIELDS_IMMUTABLE);
    config.last_modified = func.last_modified.getTime();
    config.pools = _.map(func.pools, pool => {
        if (pool.name) return pool.name;
        return system_store.data.get_by_id(pool).name;
    });
    const code_location = {
        url: '',
        repository: ''
    };
    return {
        config,
        code_location
    };
}

function _make_rpc_options(req) {
    // TODO copied from base_address calc from system_server, better define once
    const base_address = req.system.base_address || api.get_base_address(ip_module.address());
    return {
        address: base_address,
        auth_token: req.auth_token,
    };
}

function _make_aws_config(req) {
    // TODO copied from base_address calc from system_server, better define once
    const ep_host =
        req.system.base_address ?
        url_utils.quick_parse(req.system.base_address).hostname :
        ip_module.address();
    const ep_port = parseInt(process.env.ENDPOINT_PORT, 10) || 80;
    const account_keys = req.account.access_keys[0];
    return {
        region: 'us-east-1',
        endpoint: `http://${ep_host}:${ep_port}`,
        sslEnabled: false,
        s3ForcePathStyle: true,
        accessKeyId: account_keys.access_key,
        secretAccessKey: account_keys.secret_key,
    };
}


exports.create_func = create_func;
exports.update_func = update_func;
exports.delete_func = delete_func;
exports.read_func = read_func;
exports.list_funcs = list_funcs;
exports.list_func_versions = list_func_versions;
exports.invoke_func = invoke_func;
