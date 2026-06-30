/* Copyright (C) 2024 NooBaa */
'use strict';

const pool_server = require('../../../server/system_services/pool_server');
const bucket_server = require('../../../server/system_services/bucket_server');
const { RpcError } = require('../../../rpc');

// _resolve_archive_policy is exported from bucket_server for unit testing.
const resolve_archive_policy = bucket_server._resolve_archive_policy;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function get_thrown(fn) {
    try {
        fn();
    } catch (err) {
        return err;
    }
    throw new Error('Expected function to throw but it did not');
}

function make_nsr(id, archive_flag) {
    return {
        _id: id,
        name: 'nsr-' + id,
        archive: archive_flag,
        access_mode: 'READ_WRITE',
        nsfs_config: { fs_root_path: '/data' },
        system: {
            buckets_by_name: {},
            vector_buckets_by_name: {},
        },
    };
}

function make_archive_req(resource_name, path_value, nsr_map = {}) {
    return {
        system: {
            _id: 'sys-id',
            namespace_resources_by_name: nsr_map,
        },
        rpc_params: {
            archive_policy: {
                deep_archive_resource: {
                    resource: resource_name,
                    path: path_value,
                },
            },
        },
    };
}

// ---------------------------------------------------------------------------
// get_namespace_resource_info – archive field exposure
// ---------------------------------------------------------------------------

describe('get_namespace_resource_info – archive field', () => {
    it('includes archive:true when the NSR has archive set to true', () => {
        const info = pool_server.get_namespace_resource_info(make_nsr('id-1', true));
        expect(info.archive).toBe(true);
    });

    it('includes archive:false when the NSR has archive set to false', () => {
        // archive:false is falsy but not undefined, so _.omitBy(_.isUndefined) preserves it
        const info = pool_server.get_namespace_resource_info(make_nsr('id-2', false));
        expect(info.archive).toBe(false);
    });

    it('omits archive when the NSR does not have the archive field', () => {
        const nsr = make_nsr('id-3', undefined);
        delete nsr.archive;
        const info = pool_server.get_namespace_resource_info(nsr);
        expect(info.archive).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// resolve_archive_policy – validation
// ---------------------------------------------------------------------------

describe('resolve_archive_policy – missing deep_archive_resource', () => {
    it('throws INVALID_ARCHIVE_POLICY when deep_archive_resource is absent', () => {
        const req = {
            system: { namespace_resources_by_name: {} },
            rpc_params: { archive_policy: {} },
        };
        const err = get_thrown(() => resolve_archive_policy(req));
        expect(err).toBeInstanceOf(RpcError);
        expect(err.rpc_code).toBe('INVALID_ARCHIVE_POLICY');
    });
});

describe('resolve_archive_policy – NSR not found', () => {
    it('throws INVALID_ARCHIVE_RESOURCE when the NSR does not exist in the system', () => {
        const err = get_thrown(() => resolve_archive_policy(make_archive_req('nonexistent-nsr', '/data', {})));
        expect(err).toBeInstanceOf(RpcError);
        expect(err.rpc_code).toBe('INVALID_ARCHIVE_RESOURCE');
        expect(err.message).toContain('nonexistent-nsr');
    });
});

describe('resolve_archive_policy – archive flag guard', () => {
    it('throws INVALID_ARCHIVE_RESOURCE when NSR exists but archive is undefined', () => {
        const nsr = make_nsr('id-1', undefined);
        const err = get_thrown(() => resolve_archive_policy(make_archive_req('nsr-id-1', '/deep', { 'nsr-id-1': nsr })));
        expect(err).toBeInstanceOf(RpcError);
        expect(err.rpc_code).toBe('INVALID_ARCHIVE_RESOURCE');
        expect(err.message).toContain('archive:true');
    });

    it('throws INVALID_ARCHIVE_RESOURCE when NSR exists but archive is false', () => {
        const nsr = make_nsr('id-2', false);
        const err = get_thrown(() => resolve_archive_policy(make_archive_req('nsr-id-2', '/deep', { 'nsr-id-2': nsr })));
        expect(err).toBeInstanceOf(RpcError);
        expect(err.rpc_code).toBe('INVALID_ARCHIVE_RESOURCE');
        expect(err.message).toContain('archive:true');
    });

    it('throws INVALID_ARCHIVE_RESOURCE when NSR exists but archive is null', () => {
        const nsr = make_nsr('id-3', null);
        const err = get_thrown(() => resolve_archive_policy(make_archive_req('nsr-id-3', '/deep', { 'nsr-id-3': nsr })));
        expect(err).toBeInstanceOf(RpcError);
        expect(err.rpc_code).toBe('INVALID_ARCHIVE_RESOURCE');
        expect(err.message).toContain('archive:true');
    });
});

describe('resolve_archive_policy – happy path', () => {
    it('returns resolved archive policy when NSR has archive:true', () => {
        const nsr = make_nsr('id-4', true);
        const result = resolve_archive_policy(make_archive_req('nsr-id-4', '/deep/path', { 'nsr-id-4': nsr }));
        expect(result).toEqual({
            deep_archive_resource: { resource: 'id-4', path: '/deep/path' },
        });
    });

    it('returns resolved archive policy with undefined path when path is omitted', () => {
        const nsr = make_nsr('id-5', true);
        const result = resolve_archive_policy(make_archive_req('nsr-id-5', undefined, { 'nsr-id-5': nsr }));
        expect(result).toEqual({
            deep_archive_resource: { resource: 'id-5', path: undefined },
        });
    });

    it('uses the NSR _id in the resolved policy, not the name', () => {
        const nsr = make_nsr('object-id-123', true);
        const result = resolve_archive_policy(make_archive_req('nsr-object-id-123', '/path', { 'nsr-object-id-123': nsr }));
        expect(result.deep_archive_resource.resource).toBe('object-id-123');
    });
});
