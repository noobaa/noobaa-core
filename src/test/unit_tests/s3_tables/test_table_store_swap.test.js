/* Copyright (C) 2026 NooBaa */
'use strict';
process.env.CONTAINER_PLATFORM = 'TEST';
const { TableStore } = require('../../../server/table_services/table_store');

describe('table pointer swap outcomes', () => {
    const id = 'id';
    let store;
    beforeEach(() => {
        store = Object.create(TableStore.prototype);
        store._table_pointers = { updateOne: jest.fn(), findOne: jest.fn() };
    });
    const swap = () => store.swap_table_pointer(id, 'old', {
        metadata_location: 's3://bucket/table/metadata/new.metadata.json', metadata_etag: 'etag', table_uuid: 'uuid',
    });

    it('stores metadata and generates a fresh version on a matching token without reading', async () => {
        store._table_pointers.updateOne.mockResolvedValue({ rowCount: 1 });
        const result = await swap();
        expect(result).toEqual({ outcome: 'swapped', version_token: expect.any(String) });
        expect(result.version_token).not.toBe('old');
        expect(store._table_pointers.updateOne).toHaveBeenCalledWith(
            { _id: id, version_token: 'old', deleted: null },
            { $set: { metadata_location: 's3://bucket/table/metadata/new.metadata.json', metadata_etag: 'etag',
                table_uuid: 'uuid', version_token: result.version_token } });
        expect(store._table_pointers.findOne).not.toHaveBeenCalled();
    });

    it.each([[null, 'no_such_table'], [{ deleted: new Date() }, 'no_such_table'], [{}, 'not_swapped']])(
        'resolves zero matched rows by a fresh id read (%p)', async (doc, outcome) => {
            store._table_pointers.updateOne.mockResolvedValue({ rowCount: 0 });
            store._table_pointers.findOne.mockResolvedValue(doc);
            expect(await swap()).toEqual({ outcome });
            expect(store._table_pointers.findOne).toHaveBeenCalledWith({ _id: id });
        });

    it('rejects a rename with no target before issuing a database statement', async () => {
        await expect(store.rename_table_pointer(id, { namespace_name: 'db', name: 't' }, {}))
            .rejects.toMatchObject({ rpc_code: 'INVALID_REQUEST' });
        expect(store._table_pointers.updateOne).not.toHaveBeenCalled();
    });

    it('ignores a legacy caller-selected token so a stale writer cannot succeed after two swaps', async () => {
        const doc = { version_token: 'old' };
        store._table_pointers.updateOne.mockImplementation(async (selector, update) => {
            if (selector.version_token !== doc.version_token) return { rowCount: 0 };
            Object.assign(doc, update.$set);
            return { rowCount: 1 };
        });
        store._table_pointers.findOne.mockResolvedValue(doc);
        const first = await swap();
        // JavaScript callers can still pass an extra argument; the store must ignore it.
        const second = await Reflect.apply(store.swap_table_pointer, store, [id, first.version_token, {}, 'old']);
        expect(new Set(['old', first.version_token, second.version_token]).size).toBe(3);
        expect(await swap()).toEqual({ outcome: 'not_swapped' });
        expect(doc.version_token).toBe(second.version_token);
    });

    it('reports an unobserved update as unknown and never attempts to infer it from a read', async () => {
        store._table_pointers.updateOne.mockRejectedValue(new Error('connection lost after update'));
        await expect(swap()).rejects.toMatchObject({ rpc_code: 'TABLE_SWAP_UNKNOWN' });
        expect(store._table_pointers.findOne).not.toHaveBeenCalled();
    });
});
