/* Copyright (C) 2024 NooBaa */
/* eslint-disable no-undef */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../../../config');
const fs_utils = require('../../../util/fs_utils');
const nb_native = require('../../../util/nb_native');
const cloud_utils = require('../../../util/cloud_utils');
const nc_mkm = require('../../../manage_nsfs/nc_master_key_manager');
const { get_process_fs_context } = require('../../../util/native_fs_utils');

const DEFAULT_FS_CONFIG = get_process_fs_context();
const MASTER_KEYS_JSON_PATH = path.join(config.NSFS_NC_DEFAULT_CONF_DIR, 'master_keys.json');

describe('NC master key manager tests - file store type', () => {

    beforeAll(async () => {
        await fs_utils.create_fresh_path(config.NSFS_NC_DEFAULT_CONF_DIR);
    });

    afterAll(async () => {
        await fs.promises.rm(MASTER_KEYS_JSON_PATH);
        //await fs.promises.rm(config.NSFS_NC_DEFAULT_CONF_DIR, { recursive: true, force: true });
    });

    let initial_master_key;
    let initial_master_keys_by_id;
    const nc_mkm_instance = nc_mkm.get_instance();

    describe('NC master key manager tests - happy path', () => {

        it('init nc_mkm first time', async () => {
            await nc_mkm_instance.init();
            const master_keys = await read_master_keys_json();
            const active_master_key = nc_mkm_instance.active_master_key;
            validate_mkm_instance(nc_mkm_instance);
            compare_master_keys_json_and_active_root_key(active_master_key, master_keys);
            initial_master_key = active_master_key;
            initial_master_keys_by_id = nc_mkm_instance.master_keys_by_id;
        });

        it('init nc_mkm second time - master_keys.json exists', async () => {
            await nc_mkm_instance.init();
            const master_keys = await read_master_keys_json();
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

    it('should fail - init nc_mkm - invalid master_keys.json - missing active_master_key', async () => {
        await fs.promises.rm(MASTER_KEYS_JSON_PATH);
        await fs.promises.writeFile(MASTER_KEYS_JSON_PATH, JSON.stringify({ 'non_active': 1 }));
        const new_nc_mkm_instance = nc_mkm.get_instance();
        try {
            await new_nc_mkm_instance.init();
            fail('should have failed on invalid master_keys.json file');
        } catch (err) {
            expect(err.rpc_code).toEqual('INVALID_MASTER_KEYS_FILE');
            expect(err.message).toEqual('Invalid master_keys.json file');
        }
    });

    it('should fail - init nc_mkm - invalid master_keys.json - invalid active_master_key value', async () => {
        await fs.promises.rm(MASTER_KEYS_JSON_PATH);
        await fs.promises.writeFile(MASTER_KEYS_JSON_PATH, JSON.stringify({ 'active_master_key': 'blabla' }));
        const new_nc_mkm_instance = nc_mkm.get_instance();
        try {
            await new_nc_mkm_instance.init();
            fail('should have failed on invalid master_keys.json file');
        } catch (err) {
            expect(err.rpc_code).toEqual('INVALID_MASTER_KEYS_FILE');
            expect(err.message).toEqual('Invalid master_keys.json file');
        }
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
async function read_master_keys_json() {
    const { data } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, MASTER_KEYS_JSON_PATH);
    const master_keys = JSON.parse(data.toString());
    return master_keys;
}
