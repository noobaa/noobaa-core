/* Copyright (C) 2026 NooBaa */

'use strict';

const { VERSIONING } = require('../../../common/constants').S3;
const SensitiveString = require('../../../util/sensitive_string');
const system_utils = require('../../../server/utils/system_utils');
const { MDStore } = require('../../../server/object_services/md_store');
const object_server = require('../../../server/object_services/object_server');

describe('object_lock - put_object_retention', () => {
    const system_store = require('../../../server/system_services/system_store').get_instance();

    let mdstore_instance_stub;
    let update_object_by_id_stub;
    const bucket_id = 'bucket_id_retention';
    const system_id = 'system_id_retention';

    function make_obj({ mode, retain_until_date }) {
        const retain = retain_until_date || new Date(Date.now() + 7 * 24 * 3600 * 1000);
        return {
            _id: {
                toHexString: () => 'objidhex',
                getTimestamp: () => new Date(),
            },
            system: system_id,
            bucket: bucket_id,
            key: 'locked-key',
            size: 1,
            lock_settings: {
                retention: {
                    mode,
                    retain_until_date: retain,
                },
            },
        };
    }

    function make_req({ mode, retain_until_date, bypass_governance }) {
        return {
            role: 'admin',
            system: {
                _id: system_id,
                buckets_by_name: {
                    'test-bucket': {
                        _id: bucket_id,
                        name: 'test-bucket',
                        versioning: VERSIONING.ENABLED,
                        object_lock_configuration: { object_lock_enabled: 'Enabled' },
                    },
                },
            },
            rpc_params: {
                bucket: new SensitiveString('test-bucket'),
                key: 'locked-key',
                bypass_governance,
                retention: {
                    mode,
                    retain_until_date,
                },
            },
        };
    }

    beforeEach(() => {
        mdstore_instance_stub = {
            find_object_latest: jest.fn(),
            update_object_by_id: jest.fn().mockResolvedValue(undefined),
            get_object_version_id: jest.fn().mockReturnValue('v1'),
            make_md_id: jest.fn(),
        };
        update_object_by_id_stub = mdstore_instance_stub.update_object_by_id;
        jest.spyOn(MDStore, 'instance').mockReturnValue(mdstore_instance_stub);
        jest.spyOn(system_utils, 'system_in_maintenance').mockReturnValue(false);
        if (!system_store.data) {
            system_store.data = {};
        }
        system_store.data.get_by_id = jest.fn().mockReturnValue({
            name: new SensitiveString('test-bucket'),
            versioning: VERSIONING.ENABLED,
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('rejects COMPLIANCE to GOVERNANCE downgrade with same retain date', async () => {
        const retain_until = new Date(Date.now() + 15 * 24 * 3600 * 1000);
        mdstore_instance_stub.find_object_latest.mockResolvedValue(
            make_obj({ mode: 'COMPLIANCE', retain_until_date: retain_until })
        );
        const req = make_req({
            mode: 'GOVERNANCE',
            retain_until_date: retain_until,
            bypass_governance: true,
        });

        await expect(object_server.put_object_retention(req))
            .rejects.toMatchObject({ rpc_code: 'OBJECT_LOCKED' });
        expect(update_object_by_id_stub).not.toHaveBeenCalled();
    });

    test('rejects COMPLIANCE to GOVERNANCE downgrade with longer retain date', async () => {
        const current_until = new Date(Date.now() + 15 * 24 * 3600 * 1000);
        const longer_until = new Date(Date.now() + 90 * 24 * 3600 * 1000);
        mdstore_instance_stub.find_object_latest.mockResolvedValue(
            make_obj({ mode: 'COMPLIANCE', retain_until_date: current_until })
        );
        const req = make_req({
            mode: 'GOVERNANCE',
            retain_until_date: longer_until,
            bypass_governance: true,
        });

        await expect(object_server.put_object_retention(req))
            .rejects.toMatchObject({ rpc_code: 'OBJECT_LOCKED' });
        expect(update_object_by_id_stub).not.toHaveBeenCalled();
    });

    test('allows GOVERNANCE to COMPLIANCE upgrade with same retain date', async () => {
        const retain_until = new Date(Date.now() + 15 * 24 * 3600 * 1000);
        mdstore_instance_stub.find_object_latest.mockResolvedValue(
            make_obj({ mode: 'GOVERNANCE', retain_until_date: retain_until })
        );
        const req = make_req({
            mode: 'COMPLIANCE',
            retain_until_date: retain_until,
        });

        await expect(object_server.put_object_retention(req)).resolves.toBeUndefined();
        expect(update_object_by_id_stub).toHaveBeenCalled();
    });

    test('allows extending COMPLIANCE retention while keeping COMPLIANCE mode', async () => {
        const current_until = new Date(Date.now() + 15 * 24 * 3600 * 1000);
        const longer_until = new Date(Date.now() + 60 * 24 * 3600 * 1000);
        mdstore_instance_stub.find_object_latest.mockResolvedValue(
            make_obj({ mode: 'COMPLIANCE', retain_until_date: current_until })
        );
        const req = make_req({
            mode: 'COMPLIANCE',
            retain_until_date: longer_until,
        });

        await expect(object_server.put_object_retention(req)).resolves.toBeUndefined();
        expect(update_object_by_id_stub).toHaveBeenCalled();
    });

    test('allows setting GOVERNANCE after COMPLIANCE retention has expired', async () => {
        const expired_until = new Date(Date.now() - 24 * 3600 * 1000);
        const new_until = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        mdstore_instance_stub.find_object_latest.mockResolvedValue(
            make_obj({ mode: 'COMPLIANCE', retain_until_date: expired_until })
        );
        const req = make_req({
            mode: 'GOVERNANCE',
            retain_until_date: new_until,
        });

        await expect(object_server.put_object_retention(req)).resolves.toBeUndefined();
        expect(update_object_by_id_stub).toHaveBeenCalled();
    });

    test('rejects shortening active COMPLIANCE retention', async () => {
        const current_until = new Date(Date.now() + 15 * 24 * 3600 * 1000);
        const shorter_until = new Date(Date.now() + 1 * 24 * 3600 * 1000);
        mdstore_instance_stub.find_object_latest.mockResolvedValue(
            make_obj({ mode: 'COMPLIANCE', retain_until_date: current_until })
        );
        const req = make_req({
            mode: 'COMPLIANCE',
            retain_until_date: shorter_until,
            bypass_governance: true,
        });

        await expect(object_server.put_object_retention(req))
            .rejects.toMatchObject({ rpc_code: 'OBJECT_LOCKED' });
        expect(update_object_by_id_stub).not.toHaveBeenCalled();
    });
});
