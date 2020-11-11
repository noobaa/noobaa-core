/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');

const P = require('../../util/promise');
const metric_utils = require('../utils/metrics');
const { RpcError } = require('../../rpc');
const buffer_utils = require('../../util/buffer_utils');
const NamespaceCache = require('../../sdk/namespace_cache');
const cache_config = require('../../../config').NAMESPACE_CACHING;

const EVENT_UPLOAD_FINISH = 'event_upload_finish';
const EVENT_DELETE_OBJ = 'event_delete_object';
const EVENT_CREATE_UPLOAD = 'event_create_upload';
const EVENT_CREATE_OBJ_MD = 'event_create_object_md';
const EVENT_UPDATE_OBJ_MD = 'event_update_object_md';
const EVENT_READ_OBJECT_STREAM = 'event_read_object_stream';

const block_size = cache_config.DEFAULT_BLOCK_SIZE;

function random_object(size) {
    const rand_number = Math.floor(Math.random() * 10000);
    const buf = crypto.pseudoRandomBytes(size);
    const etag = crypto.createHash('md5').update(buf).digest('hex');
    const bucket = `bucket${rand_number}`;
    const key = `obj${rand_number}`;
    console.log(`creating object for test: key: bucket: ${bucket} key: ${key} size: ${size}`);
    return { bucket, key, size, buf, etag, last_modified: new Date()};
}

function reset_metrics(ns_cache) {
    metric_utils.reset_metrics(ns_cache.stats_collector.prom_metrics_report);
}

function validate_metric(bucket, ns_cache, metric_name, expect_value) {
    console.log(metric_utils.get_metric(ns_cache.stats_collector.prom_metrics_report,
        metric_name));
    assert(metric_utils.get_metric(ns_cache.stats_collector.prom_metrics_report,
        metric_name).hashMap[`bucket_name:${bucket}`].value === expect_value);
}

class Recorder {
    constructor() {
        this._object_mds = {
            cache: {},
            hub: {},
        };

        this._events = {
            cache: {},
            hub: {},
        };
    }

    record_event(type, bucket, key, event_name) {
        this._events[type][`${bucket}.${key}.${event_name}`] = new Date().getTime();
    }

    get_event(type, bucket, key, event_name) {
        return this._events[type][`${bucket}.${key}.${event_name}`];
    }

    add_obj(type, bucket, key, obj) {
        this._events[type][`${bucket}.${key}.${EVENT_CREATE_OBJ_MD}`] = new Date().getTime();
        const _obj = _.clone(obj);
        _obj.cache_last_valid_time = obj.create_time ? obj.create_time : (new Date()).getTime();
        _obj.obj_id = `${bucket}.${key}`;
        this._object_mds[type][`${bucket}.${key}`] = _obj;
        _obj.num_parts = 0;
        return _obj;
    }

    update_obj(type, bucket, key, obj) {
        this._events[type][`${bucket}.${key}.${EVENT_UPDATE_OBJ_MD}`] = new Date().getTime();
        const _obj = _.clone(obj);
        if (obj.parts) {
            _obj.num_parts = obj.parts.length;
            _obj.upload_size = _.reduce(obj.parts, (sum, part) => sum + part.end - part.start, 0);
        }
        this._object_mds[type][`${bucket}.${key}`] = _obj;
        return _obj;
    }

    get_obj(type, bucket, key) {
        const _obj = this._object_mds[type][`${bucket}.${key}`];
        if (_.isUndefined(_obj)) {
            throw (new RpcError('NO_SUCH_UPLOAD', 'no such object'));
        }
        if (_obj.parts) {
            _obj.num_parts = _obj.parts.length;
            _obj.upload_size = _.reduce(_obj.parts, (sum, part) => sum + part.end - part.start, 0);
        }
        return _obj;
    }

    delete_obj(type, bucket, key) {
        this._events[type][`${bucket}.${key}.${EVENT_DELETE_OBJ}`] = new Date().getTime();
        delete this._object_mds[type][`${bucket}.${key}`];
    }

}

class MockReaderStream {
    constructor({ type, source_buf }) {
        this.type = type;
        this.reader = buffer_utils.buffer_to_read_stream(Buffer.from(_.defaultTo(source_buf, 'sample data')));
        this.reader.on('error', err => {
            console.log(`mockstream reader ${this.type}: got err:`, err);
        });
        this.reader.on('close', () => {
            console.log(`mockstream reader ${this.type}: close`);
        });
        this.reader.on('end', () => {
            console.log(`mockstream reader ${this.type}: end`);
        });
    }
}

function mock_cache_create_object_upload(recorder, params) {
    console.log(`mock_cache_create_object_upload called for bucket:${params.bucket} key:${params.key} start:${params.start} end:${params.end}`);
    return recorder.add_obj('cache', params.bucket, params.key, params);
}

function mock_upload_object_range(recorder, params, object_sdk) {
    console.log(`mock_upload_object_range called for bucket:${params.bucket} key:${params.key} start:${params.start} end:${params.end}`);
    const bucket = params.bucket;
    const key = params.key;
    const obj = recorder.get_obj('cache', bucket, key);
    if (obj.parts) {
        obj.parts.push({ start: params.start, end: params.end });
    } else {
        obj.parts = [{ start: params.start, end: params.end }];
    }
    recorder.update_obj('cache', bucket, key, obj);
    return obj;
}

class MockNamespace {
    constructor({ type, trigger_err, recorder, slow_write, inline_read }) {
        this.type = type;
        this._recorder = recorder;
        this._buf = null;
        this._trigger_err = trigger_err;
        this._slow_write = slow_write;
        this._write_err = null;
        this._md5 = crypto.createHash('md5');
        this._inline_read = inline_read;
    }

    add_obj(obj) {
        console.log(`${this.type} mock: add_obj called: bucket`, obj);
        return this._recorder.add_obj(this.type, obj.bucket, obj.key, obj);
    }

    update_obj(obj) {
        console.log(`${this.type} mock: update_obj called: bucket`, obj);
        return this._recorder.update_obj(this.type, obj.bucket, obj.key, obj);
    }

    get_obj(bucket, key) {
        const obj = this._recorder.get_obj(this.type, bucket, key);
        return obj;
    }

    async set_trigger_err(trigger_err) {
        this._trigger_err = trigger_err;
    }

    async clear_trigger_err() {
        this._trigger_err = undefined;
    }

    read_object_md(params, object_sdk) {
        console.log(`${this.type} mock: read_object_md called: bucket ${params.bucket} key ${params.key}`);
        if (this._trigger_err === 'md') {
            const err = new Error(`${this.type}: md error triggered: bucket ${params.bucket} key ${params.key}`);
            err.name = `${this.type}_md_error`;
            throw err;
        }
        const md = this._recorder.get_obj(this.type, params.bucket, params.key);
        if (this._inline_read) {
            md.first_range_data = md.buf;
        }
        return md;
    }

    async read_object_stream(params, object_sdk) {
        console.log(`${this.type} mock: read_object_stream called: bucket ${params.bucket} key ${params.key}`, params.missing_part_getter);
        if (this._trigger_err === 'read') {
            const err = new Error(`${this.type}: read error triggered: bucket ${params.bucket} key ${params.key}`);
            err.name = `${this.type}_read_error`;
            throw (err);
        }
        if (this._trigger_err === 'if-match-etag') {
            throw (new RpcError('IF_MATCH_ETAG', 'if etag mismatch'));
        }

        this._recorder.record_event(this.type, params.bucket, params.key, EVENT_READ_OBJECT_STREAM);
        const obj = this._recorder.get_obj(this.type, params.bucket, params.key);
        if (_.isUndefined(params.start) && _.isUndefined(params.end)) {
            return (new MockReaderStream({ type: this.type, source_buf: obj.buf }).reader);
        } else {
            const start = _.defaultTo(params.start, 0);
            const end = _.defaultTo(params.end, params.size);
            if (this.type === 'hub') {
                return (new MockReaderStream({ type: this.type, source_buf: obj.buf.slice(start, end) }).reader);
            }
            // Mock simple range read case
            if (obj.parts) {
                for (const part of obj.parts) {
                    if (part.start <= start && part.end >= end) {
                        return (new MockReaderStream({ type: this.type, source_buf: crypto.pseudoRandomBytes(end - start) }).reader);
                    }
                }
            }
            const buf = await params.missing_part_getter(start, end);
            return (new MockReaderStream({ type: this.type, source_buf: buf }).reader);
        }
    }

    create_object_upload(params, object_sdk) {
        this._recorder.record_event(this.type, params.bucket, params.key, EVENT_CREATE_UPLOAD);
    }

    async upload_object(params, object_sdk) {
        return new Promise((resolve, reject) => {
            const recv_buf = [];
            params.source_stream.on('data', data => {
                console.log(`${this.type} mock: got data in upload_object: bucket ${params.bucket} key ${params.key}`, data);
                this._md5.update(data);
                recv_buf.push(data);
            });
            params.source_stream.on('error', err => {
                console.log(`${this.type} mock: got err in upload_object: bucket ${params.bucket} key ${params.key}`, err);
                this._write_err = err;
                reject(err);
            });
            params.source_stream.on('close', () => {
                console.log(`${this.type} mock: got close in upload_object: bucket ${params.bucket} key ${params.key}`);
            });
            params.source_stream.on('end', async () => {
                console.log(`${this.type} mock: got end in upload_object: bucket ${params.bucket} key ${params.key}`);
                if (this._trigger_err === 'write') {
                    setTimeout(() => {
                        console.log(`${this.type} mock: trigger error in upload_object: bucket ${params.bucket} key ${params.key}`);
                        const err = new Error(`${this.type}: write error triggered: bucket ${params.bucket} key ${params.key}`);
                        err.name = `${this.type}_write_error`;
                        reject(err);
                    }, 100);
                    return;
                }

                this._buf = Buffer.concat(recv_buf);
                const etag = this._md5.digest('hex');
                let create_time = Date.now();
                if (this._write_err) {
                    // Simulate success in the case that the error is caused by other stream
                    console.log(`${this.type} mock: write err bucket ${params.bucket} key ${params.key}`);
                    resolve({ etag, last_modified_time: create_time });
                    return;
                }

                if (this._slow_write) {
                    console.log(`${this.type} mock: bucket ${params.bucket} key ${params.key} slowing down write......`);
                    await P.delay(100);
                }
                if (params.last_modified_time) {
                    create_time = params.last_modified_time;
                } else if (params.async_get_last_modified_time) {
                    create_time = await params.async_get_last_modified_time();
                }
                this._recorder.add_obj(this.type, params.bucket, params.key,
                    {
                        etag: etag,
                        create_time: create_time,
                        buf: this._buf,
                        size: params.size,
                    });
                resolve({ etag, last_modified_time: create_time });
            });
            params.source_stream.on('finish', async () => {
                console.log(`${this.type} mock: got finish in upload_object: bucket ${params.bucket} key ${params.key}`, recv_buf);
                this._recorder.record_event(this.type, params.bucket, params.key, EVENT_UPLOAD_FINISH);
            });
        });
    }

    delete_object(params, object_sdk) {
        console.log(`${this.type} mock: delete_object called: bucket ${params.bucket} key ${params.key}`);
        if (this._trigger_err === 'delete') {
            console.log(`${this.type} mock: delete_object err triggered: bucket ${params.bucket} key ${params.key}`);
            const err = new Error(`${this.type}: delete error triggered: bucket ${params.bucket} key ${params.key}`);
            err.name = `${this.type}_delete_error`;
            throw err;
        }
        this._recorder.delete_obj(this.type, params.bucket, params.key);
    }

    delete_multiple_objects(params, object_sdk) {
        console.log(`${this.type} mock: delete_multiple_objects called: bucket ${params.bucket} key ${params.key}`);
        if (this._trigger_err === 'multi-deletes') {
            console.log(`${this.type} mock: delete_multiple_objects err triggered: bucket ${params.bucket} keys ${params.objects}`);
            const err = new Error(`${this.type}: delete_multiple_objects error triggered: bucket ${params.bucket} keys ${params.objects}`);
            err.name = `${this.type}_multi_deletes_error`;
            throw err;
        }
        console.log('delete_multiple_objects: deleting objects TODO');
    }
}

async function create_namespace_cache_and_read_obj({ recorder, object_sdk, ttl_ms, size, start, end,
    trigger_cache_err, trigger_hub_err }) {
    const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true, trigger_err: trigger_hub_err });
    const cache = new MockNamespace({ type: 'cache', recorder, trigger_err: trigger_cache_err });
    const ns_cache = new NamespaceCache({
        namespace_hub: hub,
        namespace_nb: cache,
        caching: { ttl_ms },
    });
    reset_metrics(ns_cache);

    const obj = random_object(size);
    hub.add_obj(obj);
    const params = {
        bucket: obj.bucket,
        key: obj.key,
        start,
        end,
    };

    params.object_md = await ns_cache.read_object_md(params, object_sdk);

    const stream = await ns_cache.read_object_stream(params, object_sdk);
    const read_buf = await buffer_utils.read_stream_join(stream);
    const read_etag = crypto.createHash('md5').update(read_buf).digest('hex');
    let expect_etag = obj.etag;
    if (params.start || params.end) {
        expect_etag = crypto.createHash('md5').update(obj.buf.slice(start, end)).digest('hex');
    }
    assert(read_etag === expect_etag);

    const hub_obj_create_time = recorder.get_event('hub', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
    assert(!_.isUndefined(hub_obj_create_time));

    return { ns_cache, obj, hub, cache };
}

mocha.describe('namespace caching: upload scenarios', () => {
    let recorder;
    const ttl_ms = 2000;
    const object_sdk = {
        should_run_triggers: () => null,
        read_bucket_usage_info: () => ({ free: 400000 }),
    };

    mocha.before(() => {
        recorder = new Recorder();
    });

    mocha.it('cache object during upload', async () => {
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: new MockNamespace({ type: 'hub', recorder, slow_write: true }),
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const { bucket, key, size, buf, etag } = random_object(8);
        const params = {
            bucket, key, size,
            source_stream: new MockReaderStream({ type: 's3_client', source_buf: buf }).reader,
        };
        _.set(object_sdk, 'rpc_client.object.update_object_md', _obj => {
            cache.update_obj(_obj);
        });
        const ret = await ns_cache.upload_object(params, object_sdk);
        assert(ret.etag === etag);
        const hub_obj_create_time = recorder.get_event('hub', bucket, key, EVENT_CREATE_OBJ_MD);
        assert(!_.isUndefined(hub_obj_create_time));
        await P.wait_until(() => {
            const cache_obj_create_time = recorder.get_event('cache', bucket, key, EVENT_CREATE_OBJ_MD);
            return !_.isUndefined(cache_obj_create_time);
        }, 5000);
        const cache_obj = cache.get_obj(bucket, key);
        assert(cache_obj.create_time === ret.last_modified_time);
    });

    mocha.it('hub upload failure: object not cached', async () => {
        const ns_cache = new NamespaceCache({
            namespace_hub: new MockNamespace({ type: 'hub', recorder, trigger_err: 'write' }),
            namespace_nb: new MockNamespace({ type: 'cache', recorder, trigger_err: 'write'}),
            caching: { ttl_ms },
        });

        const { bucket, key, size, buf } = random_object(8);
        const params = {
            bucket, key, size,
            source_stream: new MockReaderStream({ type: 's3_client', source_buf: buf }).reader,
        };

        try {
            await ns_cache.upload_object(params, object_sdk);
            assert(false);
        } catch (err) {
            assert(err.name === 'hub_write_error');
            assert(_.isUndefined(recorder.get_event('hub', bucket, key, EVENT_CREATE_OBJ_MD)));
            assert(_.isUndefined(recorder.get_event('cache', bucket, key, EVENT_CREATE_OBJ_MD)));
        }
    });

    mocha.it('cache upload failure: return hub status and object not cached', async () => {
        const cache = new MockNamespace({ type: 'cache', recorder, trigger_err: 'write' });
        const ns_cache = new NamespaceCache({
            namespace_hub: new MockNamespace({ type: 'hub', recorder }),
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        _.set(object_sdk, 'rpc_client.object.update_object_md', _obj => {
            cache.update_obj(_obj);
        });

        const { bucket, key, size, buf, etag } = random_object(8);
        const params = {
            bucket, key, size,
            source_stream: new MockReaderStream({ type: 's3_client', source_buf: buf }).reader,
        };

        const ret = await ns_cache.upload_object(params, object_sdk);
        assert(ret.etag === etag);
        assert(!_.isUndefined(recorder.get_event('hub', bucket, key, EVENT_CREATE_OBJ_MD)));
        assert(_.isUndefined(recorder.get_event('cache', bucket, key, EVENT_CREATE_OBJ_MD)));
    });

});

mocha.describe('namespace caching: read scenarios and fresh objects', () => {
    let recorder;
    const ttl_ms = 2000;
    const object_sdk = {
        should_run_triggers: () => null,
    };

    mocha.before(() => {
        recorder = new Recorder();
    });

    mocha.it('cache object during read', async () => {
        const size = 8;
        const { ns_cache, obj } = await create_namespace_cache_and_read_obj({ recorder, size, ttl_ms, object_sdk });

        await P.wait_until(() => {
            const cache_obj_create_time = recorder.get_event('cache', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
            return !_.isUndefined(cache_obj_create_time);
        }, 2000, 100);


        //validate_metric(obj.bucket, ns_cache, 'cache_write_bytes', size);
        validate_metric(obj.bucket, ns_cache, 'cache_object_read_miss_count', 1);
        validate_metric(obj.bucket, ns_cache, 'cache_object_read_count', 1);

        const params = {
            bucket: obj.bucket,
            key: obj.key,
        };

        params.object_md = await ns_cache.read_object_md(params, object_sdk);
        await ns_cache.read_object_stream(params, object_sdk);

        //validate_metric(obj.bucket, ns_cache, 'cache_read_bytes', size);
        //validate_metric(obj.bucket, ns_cache, 'cache_write_bytes', size);
        validate_metric(obj.bucket, ns_cache, 'cache_object_read_miss_count', 1);
        validate_metric(obj.bucket, ns_cache, 'cache_object_read_count', 2);
    });

    mocha.it('failure in cache upload while success in hub read', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder, trigger_err: 'write' });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const obj = random_object(8);
        hub.add_obj(obj);
        const params = {
            bucket: obj.bucket,
            key: obj.key,
        };

        params.object_md = await ns_cache.read_object_md(params, object_sdk);
        const stream = await ns_cache.read_object_stream(params, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(stream);
        const read_etag = crypto.createHash('md5').update(read_buf).digest('hex');
        assert(read_etag === obj.etag);

        const hub_obj_create_time = recorder.get_event('hub', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
        const cache_obj_create_time = recorder.get_event('cache', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
        assert(!_.isUndefined(hub_obj_create_time));
        assert(_.isUndefined(cache_obj_create_time));
    });

    mocha.it('failure in hub upload', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true, trigger_err: 'read' });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const obj = random_object(8);
        hub.add_obj(obj);
        const params = {
            bucket: obj.bucket,
            key: obj.key,
        };

        params.object_md = await ns_cache.read_object_md(params, object_sdk);
        try {
            await ns_cache.read_object_stream(params, object_sdk);
            assert(false);
        } catch (err) {
            assert(err.name === 'hub_read_error');
        }
        const cache_obj_create_time = recorder.get_event('cache', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
        assert(_.isUndefined(cache_obj_create_time));
    });

    mocha.it('fresh object still cached if precondition (e.g. if-etag) is set by s3 client', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const size = block_size * 5;
        const obj = random_object(size);
        hub.add_obj(obj);
        let params = {
            bucket: obj.bucket,
            key: obj.key,
            md_conditions: { if_match_etag: 'match etag' },
        };

        let object_md = await ns_cache.read_object_md(params, object_sdk);
        params.object_md = object_md;
        await ns_cache.read_object_stream(params, object_sdk);

        await P.delay(100);
        const cache_obj = recorder.get_obj('cache', obj.bucket, obj.key);
        assert(!_.isUndefined(cache_obj));
    });

});

mocha.describe('namespace caching: read scenarios that object is cached', () => {
    let recorder;
    const ttl_ms = 100;
    const object_sdk = {
        should_run_triggers: () => null,
    };

    mocha.before(() => {
        recorder = new Recorder();
    });

    mocha.it('update cache_last_valid_time', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const obj = random_object(8);
        hub.add_obj(obj);
        const obj_md = cache.add_obj(obj);
        const params = {
            bucket: obj.bucket,
            key: obj.key,
        };

        const old_cache_last_valid_time = obj_md.cache_last_valid_time;
        await P.delay(ttl_ms + 100);
        _.set(object_sdk, 'rpc_client.object.update_object_md', _obj => {
            cache.update_obj(_obj);
        });
        params.object_md = await ns_cache.read_object_md(params, object_sdk);

        await P.wait_until(() => {
            const _obj = cache.get_obj(obj.bucket, obj.key);
            return _obj.cache_last_valid_time > old_cache_last_valid_time;
        }, 2000, 100);
    });

    mocha.it('cache_last_valid_time updated after etag mismatch', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const cache_obj = random_object(8);
        const cache_obj_md = cache.add_obj(cache_obj);
        const hub_obj = random_object(10);
        hub_obj.bucket = cache_obj.bucket;
        hub_obj.key = cache_obj.key;
        const hub_obj_md = hub.add_obj(hub_obj);

        const params = {
            bucket: cache_obj_md.bucket,
            key: cache_obj_md.key,
        };

        const old_cache_last_valid_time = cache_obj_md.cache_last_valid_time;
        await P.delay(ttl_ms + 100);
        _.set(object_sdk, 'rpc_client.object.update_object_md', _obj => {
            cache.update_obj(_obj);
        });
        params.object_md = await ns_cache.read_object_md(params, object_sdk);
        assert(params.object_md.etag === hub_obj_md.etag);

        const stream = await ns_cache.read_object_stream(params, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(stream);
        const read_etag = crypto.createHash('md5').update(read_buf).digest('hex');
        assert(read_etag === hub_obj.etag);

        await P.wait_until(() => {
            const _obj = cache.get_obj(cache_obj_md.bucket, cache_obj_md.key);
            return _obj.cache_last_valid_time > old_cache_last_valid_time && _obj.etag === hub_obj_md.etag;
        }, 2000, 100);
    });

    mocha.it('read from hub if read from cache fails', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder, trigger_err: 'read' });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const obj = random_object(8);
        cache.add_obj(obj);
        hub.add_obj(obj);

        const params = {
            bucket: obj.bucket,
            key: obj.key,
        };

        params.object_md = await ns_cache.read_object_md(params, object_sdk);
        assert(params.object_md.etag === obj.etag);

        const stream = await ns_cache.read_object_stream(params, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(stream);
        const read_etag = crypto.createHash('md5').update(read_buf).digest('hex');
        assert(read_etag === obj.etag);

        const read_obj_stream_time = recorder.get_event('hub', obj.bucket, obj.key, EVENT_READ_OBJECT_STREAM);
        assert(!_.isUndefined(read_obj_stream_time));
        assert(read_obj_stream_time > params.object_md.cache_last_valid_time);
    });

    mocha.it('cache object that has inline read performed', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, inline_read: true });
        const cache = new MockNamespace({ type: 'cache', recorder, trigger_err: 'read' });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });
        reset_metrics(ns_cache);

        const size = 8;
        const obj = random_object(size);
        hub.add_obj(obj);

        const params = {
            bucket: obj.bucket,
            key: obj.key,
        };

        params.object_md = await ns_cache.read_object_md(params, object_sdk);
        assert(params.object_md.etag === obj.etag);
        assert(params.object_md.first_range_data.length === 8);

        const read_etag = crypto.createHash('md5').update(params.object_md.first_range_data).digest('hex');
        assert(read_etag === obj.etag);

        await P.wait_until(() => {
            try {
                const cache_obj = cache.get_obj(obj.bucket, obj.key);
                return cache_obj.etag === obj.etag;
            } catch (err) {
                if (err.rpc_code !== 'NO_SUCH_UPLOAD') throw err;
            return false;
            }
        }, 2000, 100);

        //validate_metric(obj.bucket, ns_cache, 'cache_write_bytes', size);
        //validate_metric(obj.bucket, ns_cache, 'cache_object_read_miss_count', 1);
        //validate_metric(obj.bucket, ns_cache, 'cache_object_read_count', 1);
    });

});

mocha.describe('namespace caching: proxy get request with partNumber query to hub', () => {
    let recorder;
    const ttl_ms = 2000;
    const object_sdk = {
        should_run_triggers: () => null,
    };

    mocha.before(() => {
        recorder = new Recorder();
    });

    mocha.it('proxy get request with partNumber query to hub', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const obj = random_object(16);
        hub.add_obj(obj);
        const params = {
            bucket: obj.bucket,
            key: obj.key,
            part_number: 1,
        };

        params.object_md = await ns_cache.read_object_md(params, object_sdk);
        const stream = await ns_cache.read_object_stream(params, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(stream);
        const read_etag = crypto.createHash('md5').update(read_buf).digest('hex');
        let expect_etag = obj.etag;
        if (params.start || params.end) {
            expect_etag = crypto.createHash('md5').update(obj.buf).digest('hex');
        }
        assert(read_etag === expect_etag);

        const hub_obj_create_time = recorder.get_event('hub', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
        assert(!_.isUndefined(hub_obj_create_time));

        await P.delay(50);
        const cache_obj_create_time = recorder.get_event('cache', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
        assert(_.isUndefined(cache_obj_create_time));
    });

});

mocha.describe('namespace caching: large objects', () => {
    let recorder;
    const ttl_ms = 2000;
    const free = 10;
    const object_sdk = {
        should_run_triggers: () => null,
        // Set free to small number
        read_bucket_usage_info: () => ({ free }),
    };

    assert(!cache_config.DISABLE_BUCKET_FREE_SPACE_CHECK);

    mocha.before(() => {
        recorder = new Recorder();
    });

    mocha.it('large object not cached during upload', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const { bucket, key, size, buf, etag } = random_object(free);
        const params = {
            bucket, key, size,
            source_stream: new MockReaderStream({ type: 's3_client', source_buf: buf }).reader,
        };
        const ret = await ns_cache.upload_object(params, object_sdk);
        assert(ret.etag === etag);
        await P.delay(10);
        const cache_obj_create_time = recorder.get_event('cache', bucket, key, EVENT_CREATE_OBJ_MD);
        assert(_.isUndefined(cache_obj_create_time));
    });

    mocha.it('large object not cached during read', async () => {
        const { obj } = await create_namespace_cache_and_read_obj({
            recorder, size: free + 10, ttl_ms, object_sdk });
        await P.delay(100);
        const cache_obj_create_time = recorder.get_event('cache', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
        assert(_.isUndefined(cache_obj_create_time));
    });
});

mocha.describe('namespace caching: range read scenarios', () => {
    let recorder;
    const ttl_ms = 2000;
    const object_sdk = {
        should_run_triggers: () => null,
    };

    mocha.before(() => {
        recorder = new Recorder();
        _.set(object_sdk, 'rpc_client.object.create_object_upload', _.curry(mock_cache_create_object_upload)(recorder));
        _.set(object_sdk, 'object_io.upload_object_range', params => mock_upload_object_range(recorder, params, object_sdk));
    });

    mocha.it('range read case success', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });
        reset_metrics(ns_cache);

        const size = block_size * 5;
        const obj = random_object(size);
        hub.add_obj(obj);
        let start = block_size + 100;
        // end is exclusive
        let end = start + 100;
        let params = {
            bucket: obj.bucket,
            key: obj.key,
            start,
            end,
        };

        let object_md = await ns_cache.read_object_md(params, object_sdk);
        params.object_md = object_md;
        let stream = await ns_cache.read_object_stream(params, object_sdk);
        let read_buf = await buffer_utils.read_stream_join(stream);
        let read_etag = crypto.createHash('md5').update(read_buf).digest('hex');
        let expect_etag = crypto.createHash('md5').update(obj.buf.slice(start, end)).digest('hex');
        assert(read_etag === expect_etag);

        const hub_obj_create_time = recorder.get_event('hub', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
        assert(!_.isUndefined(hub_obj_create_time));
        await P.wait_until(() => {
            const cache_obj = recorder.get_obj('cache', obj.bucket, obj.key);
            return !_.isUndefined(cache_obj) && cache_obj.num_parts === 1 && cache_obj.upload_size === block_size;
        }, 2000, 100);

        validate_metric(obj.bucket, ns_cache, 'cache_range_read_miss_count', 1);
        validate_metric(obj.bucket, ns_cache, 'cache_range_read_count', 1);
        //validate_metric(obj.bucket, ns_cache, 'cache_write_bytes', block_size);

        // After the second range read, we should have 2 parts cached.
        start = (block_size * 3) - 100;
        // end is exclusive
        end = start + 200;
        params = {
            bucket: obj.bucket,
            key: obj.key,
            start,
            end,
            size,
        };

        object_md = await ns_cache.read_object_md(params, object_sdk);
        params.object_md = object_md;
        stream = await ns_cache.read_object_stream(params, object_sdk);

        read_buf = await buffer_utils.read_stream_join(stream);
        read_etag = crypto.createHash('md5').update(read_buf).digest('hex');
        expect_etag = crypto.createHash('md5').update(obj.buf.slice(start, end)).digest('hex');
        assert(read_etag === expect_etag);

        await P.wait_until(() => {
            const cache_obj = recorder.get_obj('cache', obj.bucket, obj.key);
            return (cache_obj.num_parts === 2) && (cache_obj.upload_size === block_size * 3);
        }, 2000, 100);

        validate_metric(obj.bucket, ns_cache, 'cache_range_read_miss_count', 2);
        validate_metric(obj.bucket, ns_cache, 'cache_range_read_count', 2);
        //validate_metric(obj.bucket, ns_cache, 'cache_write_bytes', block_size * 3);

        // Cache hit on range read
        params = {
            bucket: obj.bucket,
            key: obj.key,
            start,
            end,
            size,
        };

        object_md = await ns_cache.read_object_md(params, object_sdk);
        params.object_md = object_md;
        await ns_cache.read_object_stream(params, object_sdk);

        validate_metric(obj.bucket, ns_cache, 'cache_range_read_count', 3);
        //validate_metric(obj.bucket, ns_cache, 'cache_write_bytes', block_size * 3);
        validate_metric(obj.bucket, ns_cache, 'cache_range_read_miss_count', 2);
    });

    mocha.it('range read case if-etag mismatch', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true, trigger_err: 'if-match-etag' });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const size = block_size * 5;
        const obj = random_object(size);
        hub.add_obj(obj);
        let start = block_size + 100;
        // end is exclusive
        let end = start + 100;
        let params = {
            bucket: obj.bucket,
            key: obj.key,
            start,
            end,
        };

        let object_md = await ns_cache.read_object_md(params, object_sdk);
        params.object_md = object_md;
        try {
            await ns_cache.read_object_stream(params, object_sdk);
            assert(false);
        } catch (err) {
            assert(err.rpc_code === 'IF_MATCH_ETAG');
        }

        try {
            recorder.get_obj('cache', obj.bucket, obj.key);
            assert(false);
        } catch (err) {
            assert(err.rpc_code === 'NO_SUCH_UPLOAD');
        }
    });

    mocha.it('range read case: part cached if precondition if-match set by s3 client matches object md', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const size = block_size * 5;
        const obj = random_object(size);
        hub.add_obj(obj);
        let start = block_size + 100;
        // end is exclusive
        let end = start + 100;
        let params = {
            bucket: obj.bucket,
            key: obj.key,
            start,
            end,
            md_conditions: { if_match_etag: obj.etag },
        };

        let object_md = await ns_cache.read_object_md(params, object_sdk);
        params.object_md = object_md;
        await ns_cache.read_object_stream(params, object_sdk);

        await P.wait_until(() => {
            const cache_obj = recorder.get_obj('cache', obj.bucket, obj.key);
            return (cache_obj.num_parts === 1) && (cache_obj.upload_size === block_size);
        }, 2000, 100);
    });

    mocha.it('range read case: part not cached if precondition if-match set by s3 client does not match object md', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const size = block_size * 5;
        const obj = random_object(size);
        hub.add_obj(obj);
        let start = block_size + 100;
        // end is exclusive
        let end = start + 100;
        let params = {
            bucket: obj.bucket,
            key: obj.key,
            start,
            end,
            md_conditions: { if_match_etag: 'non match etag' },
        };

        let object_md = await ns_cache.read_object_md(params, object_sdk);
        params.object_md = object_md;
        await ns_cache.read_object_stream(params, object_sdk);

        await P.delay(100);
        const cache_obj = recorder.get_obj('cache', obj.bucket, obj.key);
        assert(cache_obj.num_parts === 0);
    });

    mocha.it('range read case: part not cached if other precondition than if-match is set by s3 client', async () => {
        const hub = new MockNamespace({ type: 'hub', recorder, slow_write: true });
        const cache = new MockNamespace({ type: 'cache', recorder });
        const ns_cache = new NamespaceCache({
            namespace_hub: hub,
            namespace_nb: cache,
            caching: { ttl_ms },
        });

        const size = block_size * 5;
        const obj = random_object(size);
        hub.add_obj(obj);
        let start = block_size + 100;
        // end is exclusive
        let end = start + 100;
        let params = {
            bucket: obj.bucket,
            key: obj.key,
            start,
            end,
            md_conditions: { if_unmodified_since: obj.last_modified },
        };

        let object_md = await ns_cache.read_object_md(params, object_sdk);
        params.object_md = object_md;
        await ns_cache.read_object_stream(params, object_sdk);

        await P.delay(100);
        const cache_obj = recorder.get_obj('cache', obj.bucket, obj.key);
        assert(cache_obj.num_parts === 0);
    });

    mocha.it('cache entire small file after range read', async () => {
        const size = block_size - 100;
        const start = size - 100;
        // end is exclusive
        const end = start + 200;
        const { obj } = await create_namespace_cache_and_read_obj({
            recorder, size, ttl_ms, object_sdk, start, end });

        await P.wait_until(() => {
            try {
                const cache_obj = recorder.get_obj('cache', obj.bucket, obj.key);
                return !_.isUndefined(cache_obj) && cache_obj.num_parts === 0;
            } catch (err) {
                return false;
            }
        }, 2000, 100);
    });

    mocha.it('large range not cached', async () => {
        const free = 100;
        const object_sdk_large_range_read = {
            should_run_triggers: () => null,
            // Set free to small number
            read_bucket_usage_info: () => ({ free }),
        };

        const size = block_size * 2;
        const start = block_size - 100;
        // end is exclusive
        const end = start + free + 100;
        const { obj } = await create_namespace_cache_and_read_obj({
            recorder, size, ttl_ms, object_sdk: object_sdk_large_range_read, start, end });

        await P.delay(100);
        try {
            recorder.get_obj('cache', obj.bucket, obj.key);
            assert(false);
        } catch (err) {
            assert(err.rpc_code === 'NO_SUCH_UPLOAD');
        }
    });

    mocha.it('range read falls back to hub read if read from cache fails', async () => {
        const size = block_size * 2;
        let start = block_size - 2;
        // end is exclusive
        let end = start + 100;
        const { ns_cache, obj, cache } = await create_namespace_cache_and_read_obj({
            recorder, size, ttl_ms,
            object_sdk: object_sdk,
            start, end,
        });
        await P.wait_until(() => {
            try {
                const cache_obj = recorder.get_obj('cache', obj.bucket, obj.key);
                return !_.isUndefined(cache_obj);
            } catch (err) {
                return false;
            }
        }, 2000, 100);

        start = block_size;
        end = block_size + 199;
        const params = {
            bucket: obj.bucket,
            key: obj.key,
            start,
            end,
        };

        params.object_md = await ns_cache.read_object_md(params, object_sdk);
        cache.set_trigger_err('read');
        const err_trigger_time = new Date().getTime();
        const stream = await ns_cache.read_object_stream(params, object_sdk);
        cache.clear_trigger_err();
        const read_buf = await buffer_utils.read_stream_join(stream);
        const read_etag = crypto.createHash('md5').update(read_buf).digest('hex');
        const expect_etag = crypto.createHash('md5').update(obj.buf.slice(start, end)).digest('hex');
        assert(read_etag === expect_etag);

        const read_hub_time = recorder.get_event('hub', obj.bucket, obj.key, EVENT_READ_OBJECT_STREAM);
        assert(read_hub_time > err_trigger_time);
    });

});

mocha.describe('namespace caching: delete scenario', () => {
    let recorder;
    const ttl_ms = 2000;
    const object_sdk = {
        should_run_triggers: () => null,
    };

    mocha.before(() => {
        recorder = new Recorder();
    });

    mocha.it('delete object from both cache and hub', async () => {
        const { ns_cache, obj } = await create_namespace_cache_and_read_obj({ recorder, size: 8, ttl_ms, object_sdk });

        await P.wait_until(() => {
            const cache_obj_create_time = recorder.get_event('cache', obj.bucket, obj.key, EVENT_CREATE_OBJ_MD);
            return !_.isUndefined(cache_obj_create_time);
        }, 2000, 100);

        const params = {
            bucket: obj.bucket,
            key: obj.key
        };
        await ns_cache.delete_object(params, object_sdk);
        try {
            recorder.get_obj('cache', obj.bucket, obj.key);
            assert(false);
        } catch (err) {
            assert(err.rpc_code === 'NO_SUCH_UPLOAD');
        }
        try {
            recorder.get_obj('hub', obj.bucket, obj.key);
            assert(false);
        } catch (err) {
            assert(err.rpc_code === 'NO_SUCH_UPLOAD');
        }
    });

    mocha.it('cache obj is still deleted if hub delete failure (should cache obj be kept?)', async () => {
        const { ns_cache, obj } = await create_namespace_cache_and_read_obj({ recorder, size: 8, ttl_ms, object_sdk,
            trigger_hub_err: 'delete'});

         const params = {
            bucket: obj.bucket,
            key: obj.key
        };
        try {
            await ns_cache.delete_object(params, object_sdk);
            assert(false);
        } catch (err) {
            assert(err.name === 'hub_delete_error');
        }
        const hub_obj = recorder.get_obj('hub', obj.bucket, obj.key);
        assert(!_.isUndefined(hub_obj));
        try {
            recorder.get_obj('cache', obj.bucket, obj.key);
            assert(false);
        } catch (err) {
            assert(err.rpc_code === 'NO_SUCH_UPLOAD');
        }
        /*
        const cache_obj = recorder.get_obj('cache', obj.bucket, obj.key);
        assert(!_.isUndefined(cache_obj));
        */
    });

    mocha.it('delete multiple objects: error in cache', async () => {
        const { ns_cache, obj } = await create_namespace_cache_and_read_obj({ recorder, size: 8, ttl_ms, object_sdk,
            trigger_cache_err: 'multi-deletes' });

        const params = {
            bucket: obj.bucket,
            objects: [ {
                key: obj.key
            }],
        };
        try {
            await ns_cache.delete_multiple_objects(params, object_sdk);
            assert(false);
        } catch (err) {
            assert(err.name === 'cache_multi_deletes_error');
        }
    });

    mocha.it('delete multiple objects: error in hub', async () => {
        const { ns_cache, obj } = await create_namespace_cache_and_read_obj({ recorder, size: 8, ttl_ms, object_sdk,
            trigger_hub_err: 'multi-deletes' });

        const params = {
            bucket: obj.bucket,
            objects: [ {
                key: obj.key
            }],
        };
        try {
            await ns_cache.delete_multiple_objects(params, object_sdk);
            assert(false);
        } catch (err) {
            assert(err.name === 'hub_multi_deletes_error');
        }
    });

});
