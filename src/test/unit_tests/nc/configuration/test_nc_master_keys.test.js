/* Copyright (C) 2024 NooBaa */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../../../../config');
const fs_utils = require('../../../../util/fs_utils');
const nb_native = require('../../../../util/nb_native');
const cloud_utils = require('../../../../util/cloud_utils');
const nc_mkm = require('../../../../manage_nsfs/nc_master_key_manager');
const { get_process_fs_context } = require('../../../../util/native_fs_utils');
const nsfs_schema_utils = require('../../../../manage_nsfs/nsfs_schema_utils');
const { fail_test_if_default_config_dir_exists } = require('../../../system_tests/test_utils');

const DEFAULT_FS_CONFIG = get_process_fs_context();
const MASTER_KEYS_JSON_PATH = path.join(config.NSFS_NC_DEFAULT_CONF_DIR, 'master_keys.json');

describe('NC master key manager tests - file store type', () => {

    beforeAll(async () => {
        await fail_test_if_default_config_dir_exists('test_nc_master_keys');
        await fs_utils.create_fresh_path(config.NSFS_NC_DEFAULT_CONF_DIR);
    });

    afterAll(async () => {
        await fs.promises.rm(MASTER_KEYS_JSON_PATH);
        await fs.promises.rm(config.NSFS_NC_DEFAULT_CONF_DIR, { recursive: true, force: true });
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

        it('encrypt_access_keys of account (with extra properties)', async () => {
            const master_key_id = nc_mkm_instance.active_master_key.id;
            const account = get_account_data(master_key_id);
            account.access_keys[0] = get_access_key_object();
            account.access_keys[1] = get_access_key_object();
            const account_after_encryption = await nc_mkm_instance.encrypt_access_keys(account);
            const account_string = JSON.stringify(account_after_encryption);
            nsfs_schema_utils.validate_account_schema(JSON.parse(account_string));
            expect(account_after_encryption._id).toBe(account._id);
            expect(account_after_encryption.name).toBe(account.name);
            expect(account_after_encryption.creation_date).toBe(account.creation_date);
            expect(account_after_encryption.allow_bucket_creation).toBe(account.allow_bucket_creation);
            expect(account_after_encryption.master_key_id).toBeDefined();
            expect(account_after_encryption.nsfs_account_config.uid).toBe(account.nsfs_account_config.uid);
            expect(account_after_encryption.nsfs_account_config.gid).toBe(account.nsfs_account_config.gid);
            expect(account_after_encryption.access_keys.length).toBe(account.access_keys.length);
            for (let i = 0; i < account_after_encryption.access_keys.length; i++) {
                expect(account_after_encryption.access_keys[i].access_key).toBe(account.access_keys[i].access_key);
                expect(account_after_encryption.access_keys[i].encrypted_secret_key).toBeDefined(); // instead of secret_key
                expect(account_after_encryption.access_keys[i].creation_date).toBe(account.access_keys[i].creation_date);
                expect(account_after_encryption.access_keys[i].deactivated).toBe(account.access_keys[i].deactivated);
            }
        });

        it('decrypt_access_keys of account (with extra properties)', async () => {
            const master_key_id = nc_mkm_instance.active_master_key.id;
            const account = get_account_data(master_key_id);
            account.access_keys[0] = get_access_key_object();
            account.access_keys[1] = get_access_key_object();
            const account_after_encryption = await nc_mkm_instance.encrypt_access_keys(account);
            const account_string = JSON.stringify(account_after_encryption);
            nsfs_schema_utils.validate_account_schema(JSON.parse(account_string));
            const decrypted_access_keys = await nc_mkm_instance.decrypt_access_keys(account_after_encryption);
            for (let i = 0; i < decrypted_access_keys.length; i++) {
                expect(decrypted_access_keys[i].access_key).toBe(account.access_keys[i].access_key);
                expect(decrypted_access_keys[i].secret_key).toBeDefined(); // instead of encrypted_secret_key
                expect(decrypted_access_keys[i].creation_date).toBe(account.access_keys[i].creation_date);
                expect(decrypted_access_keys[i].deactivated).toBe(account.access_keys[i].deactivated);
            }
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
            expect(err.rpc_code).toEqual('INVALID_MASTER_KEY');
            expect(err.message).toEqual('Invalid master_keys.json');
        }
    });

    it('should fail - init nc_mkm - invalid master_keys.json - invalid active_master_key value', async () => {
        await fs.promises.rm(MASTER_KEYS_JSON_PATH);
        await fs.promises.writeFile(MASTER_KEYS_JSON_PATH, JSON.stringify({ 'active_master_key': 'blabla' }));
        const new_nc_mkm_instance = nc_mkm.get_instance();
        try {
            await new_nc_mkm_instance.init();
            fail('should have failed on invalid master_keys.json');
        } catch (err) {
            expect(err.rpc_code).toEqual('INVALID_MASTER_KEY');
            expect(err.message).toEqual('Invalid master_keys.json');
        }
    });

    it('should fail - init nc_mkm - empty master_keys.json', async () => {
        await fs.promises.rm(MASTER_KEYS_JSON_PATH);
        await fs.promises.writeFile(MASTER_KEYS_JSON_PATH, JSON.stringify({}));

        const new_nc_mkm_instance = nc_mkm.get_instance();
        try {
            await new_nc_mkm_instance.init();
            fail('should have failed on invalid master_keys.json file');
        } catch (err) {
            expect(err.rpc_code).toEqual('INVALID_MASTER_KEY');
            expect(err.message).toEqual('Invalid master_keys.json');
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
    expect(Object.entries(master_keys_cache).length === 1).toBe(true);
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

// Jest has builtin function fail that based on Jasmine
// in case Jasmine would get removed from jest, created this one
// based on this: https://stackoverflow.com/a/55526098/16571658
function fail(reason) {
    throw new Error(reason);
}

// copied from account validation (with changes)
function get_account_data(master_key_id) {
    const account_name = 'account1';
    const id = '65a62e22ceae5e5f1a758aa9';
    const account_email = account_name; // temp, keep the email internally
    const creation_date = new Date('December 17, 2023 09:00:00').toISOString();
    const nsfs_account_config_uid_gid = {
        uid: 1001,
        gid: 1001,
    };

    const account_data = {
        _id: id,
        name: account_name,
        email: account_email,
        master_key_id: master_key_id,
        access_keys: [], // no access-keys
        nsfs_account_config: {
            ...nsfs_account_config_uid_gid
        },
        creation_date: creation_date,
        allow_bucket_creation: true,
    };

    return account_data;
}

function get_access_key_object() {
    const { access_key, secret_key } = cloud_utils.generate_access_keys();
    const unwrapped_secret_key = secret_key.unwrap();
    const access_key_object = {
        access_key: access_key,
        secret_key: unwrapped_secret_key,
        creation_date: '2024-06-03T07:40:58.808Z',
        deactivated: false,
    };
    return access_key_object;
}
