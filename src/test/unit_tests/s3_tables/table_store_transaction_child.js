/* Copyright (C) 2026 NooBaa */
'use strict';

// A separate catalog server process, paused after its mutation but before COMMIT.
const db_client = require('../../../util/db_client');
const { TableStore } = require('../../../server/table_services/table_store');

process.once('message', async ({ db_name, suffix, operation, bucket, pointer, namespace, target }) => {
    try {
        const db = db_client.instance();
        db.set_db_name(db_name);
        const store = new TableStore(suffix);
        await db.connect();
        const transaction = store._transaction.bind(store);
        store._transaction = action => transaction(async view => {
            const result = await action(view);
            const res = await view._table_pointers.single_query('SELECT pg_backend_pid() AS pid');
            process.send({ paused: true, backend_pid: res.rows[0].pid });
            await new Promise(resolve => process.once('message', resolve));
            return result;
        });
        const id = store.make_table_id(bucket);
        if (operation === 'insert') {
            await store.insert_table_pointer({ _id: store.make_table_id(pointer), table_bucket: id,
                namespace_name: namespace, name: 'child', kind: 'table', version_token: 'v0' });
        } else if (operation === 'rename') {
            await store.rename_table_pointer(store.make_table_id(pointer),
                { namespace_name: namespace, name: 'child' }, { new_namespace_name: target });
        } else if (operation === 'namespace') {
            await store.insert_table_namespace({ _id: store.new_table_id(), table_bucket: id, name: namespace });
        } else if (operation === 'bucket') {
            await store.update_table_bucket(id, { state: 'deleting' }, { expected_state: 'ready' });
        } else {
            await store.delete_table_namespace(id, namespace);
        }
        await db.disconnect();
        process.send({ done: true });
        process.disconnect();
    } catch (err) {
        process.send({ error: String(err) });
        process.exit(1);
    }
});
