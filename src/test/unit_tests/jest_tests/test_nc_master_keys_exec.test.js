/* Copyright (C) 2024 NooBaa */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../../../config');
const fs_utils = require('../../../util/fs_utils');
const cloud_utils = require('../../../util/cloud_utils');
const { TMP_PATH } = require('../../system_tests/test_utils');
const crypto = require('crypto');
const db_client = require('../../../util/db_client').instance();

const MKM_GET_EXEC_PATH = path.join(config.NSFS_NC_DEFAULT_CONF_DIR, 'file_get');
const MKM_PUT_EXEC_PATH = path.join(config.NSFS_NC_DEFAULT_CONF_DIR, 'file_put');

const put_script_content = `
#!/bin/bash

key="$1"
file_name="${TMP_PATH}/noobaa.$key"
current_version="$2"

if [ -e "$file_name" ]; then
    echo '{ "status": "VERSION_MISMATCH" }'
else
    out=$(cat > "$file_name" 2>/dev/null)
    rc=$?
    if [ $rc -eq 0 ]; then
        echo '{ "status": "OK" }'
    else
        echo '{ "status": "INTERNAL" }'
    fi
fi
exit 0
`;

const get_script_content = `
#!/bin/bash

key="$1"
file_name="${TMP_PATH}/noobaa.$key"

if [ -e "$file_name" ]; then
    TMPFILE="$(mktemp)"
    trap 'rm -f &>/dev/null -- "$TMPFILE"' EXIT

    out=$(cat "$file_name" > "$TMPFILE" 2>/dev/null)
    rc=$?

    if [ $rc -eq 0 ]; then
        vers=1
        echo '{ "status": "OK", "version": '$vers', "data": '$(cat "$TMPFILE")' }'
    else
        echo '{ "status": "INTERNAL" }'
    fi
else 
    echo '{ "status": "NOT_FOUND" }'
fi
exit 0
`;


describe('NC master key manager tests - exec store type', () => {
    const MASTER_KEYS_JSON_PATH = path.join(TMP_PATH, 'noobaa.master_keys');

    beforeAll(async () => {
        await fs_utils.create_fresh_path(config.NSFS_NC_DEFAULT_CONF_DIR);
        await fs.promises.writeFile(MKM_GET_EXEC_PATH, Buffer.from(get_script_content));
        await fs.promises.writeFile(MKM_PUT_EXEC_PATH, Buffer.from(put_script_content));
        await fs.promises.chmod(MKM_GET_EXEC_PATH, 0o777);
        await fs.promises.chmod(MKM_PUT_EXEC_PATH, 0o777);
        config.NC_MASTER_KEYS_STORE_TYPE = 'executable';
        config.NC_MASTER_KEYS_GET_EXECUTABLE = MKM_GET_EXEC_PATH;
        config.NC_MASTER_KEYS_PUT_EXECUTABLE = MKM_PUT_EXEC_PATH;
    });

    afterAll(async () => {
        await fs.promises.rm(MASTER_KEYS_JSON_PATH);
        await fs.promises.rm(MKM_GET_EXEC_PATH);
        await fs.promises.rm(MKM_PUT_EXEC_PATH);
    });

    let initial_master_key;
    let initial_master_keys_by_id;
    const nc_mkm = require('../../../manage_nsfs/nc_master_key_manager');

    const nc_mkm_instance = nc_mkm.get_instance();

    it('init nc_mkm first time', async () => {
        await nc_mkm_instance.init();
        const master_keys = await read_master_keys_json(MASTER_KEYS_JSON_PATH);
        const active_master_key = nc_mkm_instance.active_master_key;
        validate_mkm_instance(nc_mkm_instance);
        compare_master_keys_json_and_active_root_key(active_master_key, master_keys);
        initial_master_key = active_master_key;
        initial_master_keys_by_id = nc_mkm_instance.master_keys_by_id;
    });

    it('init nc_mkm second time - master_keys.json exists', async () => {
        await nc_mkm_instance.init();
        const master_keys = await read_master_keys_json(MASTER_KEYS_JSON_PATH);
        const active_master_key = nc_mkm_instance.active_master_key;

        validate_mkm_instance(nc_mkm_instance);
        compare_master_keys_json_and_active_root_key(active_master_key, master_keys);

        // check active_master_key was not changed
        expect(JSON.stringify(initial_master_key)).toEqual(JSON.stringify(active_master_key));
        expect(JSON.stringify(initial_master_keys_by_id)).toEqual(JSON.stringify(nc_mkm_instance.master_keys_by_id));
    });

    it('_create_master_keys_exec when master keys exist -', async () => {
        const new_key = {
            id: db_client.new_object_id(),
            cipher_key: crypto.randomBytes(32).toString('base64'),
            cipher_iv: crypto.randomBytes(16).toString('base64'),
            encryption_type: 'aes-256-gcm'
        };
        await nc_mkm_instance._create_master_keys_exec(new_key);
        const master_keys = await read_master_keys_json(MASTER_KEYS_JSON_PATH);
        const active_master_key = nc_mkm_instance.active_master_key;

        validate_mkm_instance(nc_mkm_instance);
        compare_master_keys_json_and_active_root_key(active_master_key, master_keys);

        // check active_master_key was not changed
        expect(JSON.stringify(initial_master_key)).toEqual(JSON.stringify(active_master_key));
        expect(JSON.stringify(initial_master_keys_by_id)).toEqual(JSON.stringify(nc_mkm_instance.master_keys_by_id));
    });

    it('encrypt & decrypt value using nc_mkm', async () => {
        const { secret_key } = cloud_utils.generate_access_keys();
        const unwrapped_secret_key = secret_key.unwrap();
        const encrypted_secret_key = await nc_mkm_instance.encrypt(unwrapped_secret_key);
        const decrypted_secret_key = await nc_mkm_instance.decrypt(encrypted_secret_key, nc_mkm_instance.active_master_key.id);
        expect(unwrapped_secret_key).toEqual(decrypted_secret_key);
    });
});
/** 
 * validate_mkm_instance checks that - 
 * 1. is_initialized = true
 * 2. active_master_key is populated
 * 3. master_keys_by_id.active_master_key is populated with active_master_key
 * @param {object} nc_mkm_instance
 */
function validate_mkm_instance(nc_mkm_instance) {
    const active_master_key = nc_mkm_instance.active_master_key;
    const master_keys_cache = nc_mkm_instance.master_keys_by_id;
    const active_master_key_by_cache = master_keys_cache[active_master_key.id];

    expect(nc_mkm_instance.active_master_key).toBeDefined();
    expect(nc_mkm_instance.active_master_key.id).toBeDefined();
    expect(nc_mkm_instance.active_master_key.cipher_key).toBeDefined();
    expect(nc_mkm_instance.active_master_key.cipher_iv).toBeDefined();
    expect(Object.entries(master_keys_cache).length === 1).toBeTruthy();
    expect(nc_mkm_instance.active_master_key).toEqual(active_master_key_by_cache);
}

/** 
 * compare_master_keys_json_and_active_root_key compares the master_keys.json content with 
 * the active_master_key hanged on the nc_mkm instance
 * @param {object} active_master_key
 * @param {object} master_keys
 */
function compare_master_keys_json_and_active_root_key(active_master_key, master_keys) {
    const active_master_key_id = master_keys.active_master_key;
    const active_master_key_obj = master_keys.master_keys_by_id[active_master_key_id];
    expect(active_master_key_id.toString()).toEqual(active_master_key.id.toString());
    const buffered_cipher_iv = Buffer.from(active_master_key_obj.cipher_iv, 'base64');
    const buffered_cipher_key = Buffer.from(active_master_key_obj.cipher_key, 'base64');
    expect(buffered_cipher_key).toEqual(active_master_key.cipher_key);
    expect(buffered_cipher_iv).toEqual(active_master_key.cipher_iv);
}

/** 
 * read_master_keys_json reads master_keys.json data and parse it
 * @returns {Promise<Object>}
 */
async function read_master_keys_json(master_keys_json_path) {
    const nb_native = require('../../../util/nb_native');
    const { get_process_fs_context } = require('../../../util/native_fs_utils');
    const DEFAULT_FS_CONFIG = get_process_fs_context();
    const { data } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, master_keys_json_path);
    const master_keys = JSON.parse(data.toString());
    return master_keys;
}
