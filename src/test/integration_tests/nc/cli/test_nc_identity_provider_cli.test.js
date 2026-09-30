/* Copyright (C) 2026 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const os_util = require('../../../../util/os_utils');
const fs_utils = require('../../../../util/fs_utils');
const { ConfigFS } = require('../../../../sdk/config_fs');
const { TMP_PATH, set_nc_config_dir_in_config } = require('../../../system_tests/test_utils');
const { TYPES, ACTIONS } = require('../../../../manage_nsfs/manage_nsfs_constants');
const ManageCLIError = require('../../../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_identity_provider_cli.test');
const timeout = 5000;

describe('manage nsfs cli identity provider flow', () => {
    describe('cli create identity provider', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const config_fs = new ConfigFS(config_root);
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
        const options_file = path.join(TMP_PATH, 'idp1.json');
        const defaults = {
            name: 'idp1',
            type: 'ldap',
            uri: 'ldaps://ldap.example.com:636',
            admin_user: 'cn=admin,dc=example,dc=com',
            admin_password: 'Passw0rd',
            search_dn: 'ou=people,dc=example,dc=com',
            dn_attribute: 'uid',
            search_scope: 'sub',
            jwt_secret: 'jwt-secret-value',
        };

        beforeEach(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);

            fs.writeFileSync(options_file, JSON.stringify(defaults));
            const action = ACTIONS.ADD;
            const idp_options = { config_root, from_file: options_file };
            await exec_manage_cli(TYPES.IDENTITY_PROVIDER, action, idp_options);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli create identity provider from file', async () => {
            const idp = await config_fs.get_identity_provider_by_name(defaults.name);
            assert_identity_provider(idp, defaults, true);
        }, timeout);

        it('cli create identity provider from cli', async () => {
            await exec_manage_cli(TYPES.IDENTITY_PROVIDER, ACTIONS.DELETE, { config_root, name: defaults.name });
            const idp_options = { ...defaults, config_root };
            idp_options.name = 'fromcli';
            idp_options.uri = 'ldaps://ldap2.example.com:636';
            const res = await exec_manage_cli(TYPES.IDENTITY_PROVIDER, ACTIONS.ADD, idp_options);
            const res_json = JSON.parse(res.trim());
            expect(_.isEqual(new Set(Object.keys(res_json.response)), new Set(['reply', 'code', 'message']))).toBe(true);
            const idp = await config_fs.get_identity_provider_by_name(idp_options.name);
            assert_identity_provider(idp, idp_options, true);
        }, timeout);

        it('cli delete identity provider', async () => {
            await exec_manage_cli(TYPES.IDENTITY_PROVIDER, ACTIONS.DELETE, { config_root, name: defaults.name });
            expect(fs.readdirSync(config_fs.identity_providers_dir_path).filter(file => file.endsWith('.json')).length).toEqual(0);
        }, timeout);

        it('cli update identity provider', async () => {
            await exec_manage_cli(TYPES.IDENTITY_PROVIDER, ACTIONS.UPDATE, {
                config_root,
                name: defaults.name,
                search_dn: 'ou=staff,dc=example,dc=com',
            });
            const updated = await config_fs.get_identity_provider_by_name(defaults.name);
            const updated_content = { ...defaults, search_dn: 'ou=staff,dc=example,dc=com' };
            assert_identity_provider(updated, updated_content, true);
        }, timeout);

        it('cli list identity provider', async () => {
            const res = JSON.parse(await exec_manage_cli(TYPES.IDENTITY_PROVIDER, ACTIONS.LIST, { config_root }));
            expect(res.response.reply[0]).toEqual(defaults.name);
        }, timeout);

        it('cli status identity provider decrypt', async () => {
            const res = JSON.parse(await exec_manage_cli(TYPES.IDENTITY_PROVIDER, ACTIONS.STATUS, {
                config_root,
                name: defaults.name,
                decrypt: true
            }));
            assert_identity_provider(res.response.reply, defaults, false);
        }, timeout);

        it('identity provider already exists', async () => {
            const action = ACTIONS.ADD;
            const { name, type, uri, admin_user, admin_password, search_dn } = defaults;
            const idp_options = { config_root, name, type, uri, admin_user, admin_password, search_dn };
            const res = await exec_manage_cli(TYPES.IDENTITY_PROVIDER, action, idp_options, true);
            const res_json = JSON.parse(res.trim());
            expect(res_json.error.code).toBe(ManageCLIError.IdentityProviderAlreadyExists.code);
        });

        it('identity provider does not exist', async () => {
            const idp_options = { config_root, name: 'badname' };
            const res = await exec_manage_cli(TYPES.IDENTITY_PROVIDER, ACTIONS.DELETE, idp_options, true);
            const res_json = JSON.parse(res.trim());
            expect(res_json.error.code).toBe(ManageCLIError.NoSuchIdentityProvider.code);
        });

        it('second ldap identity provider is rejected', async () => {
            const idp_options = {
                ...defaults,
                config_root,
                name: 'other',
                uri: 'ldap://ldap.example.com:636',
            };
            const res = await exec_manage_cli(TYPES.IDENTITY_PROVIDER, ACTIONS.ADD, idp_options, true);
            const res_json = JSON.parse(res.trim());
            expect(res_json.error.code).toBe(ManageCLIError.LdapIdentityProviderAlreadyConfigured.code);
        });
    });
});

/**
 * @param {object} idp actual
 * @param {object} expected expected plaintext values
 * @param {boolean} is_encrypted whether secrets are encrypted at rest
 */
function assert_identity_provider(idp, expected, is_encrypted) {
    expect(idp.name).toEqual(expected.name);
    expect(idp.type).toEqual(expected.type);
    expect(idp.uri).toEqual(expected.uri);
    expect(idp.admin_user).toEqual(expected.admin_user);
    expect(idp.search_dn).toEqual(expected.search_dn);
    if (expected.dn_attribute) expect(idp.dn_attribute).toEqual(expected.dn_attribute);
    if (expected.search_scope) expect(idp.search_scope).toEqual(expected.search_scope);
    if (is_encrypted) {
        expect(idp.admin_password).not.toEqual(expected.admin_password);
        expect(idp.master_key_id).toBeDefined();
        if (expected.jwt_secret) {
            expect(idp.jwt_secret).not.toEqual(expected.jwt_secret);
        }
    } else {
        expect(idp.admin_password).toEqual(expected.admin_password);
        if (expected.jwt_secret) {
            expect(idp.jwt_secret).toEqual(expected.jwt_secret);
        }
    }
}

async function exec_manage_cli(type, action, options, expect_failure = false) {
    const command = create_command(type, action, options);
    let res;
    try {
        res = await os_util.exec(command, { return_stdout: true });
    } catch (e) {
        if (expect_failure) {
            res = e.stdout;
        } else {
            res = e;
        }
    }
    return res;
}

function create_command(type, action, options) {
    let flags = ``;
    for (const key in options) {
        if (Object.hasOwn(options, key)) {
            if (typeof options[key] === 'boolean') {
                flags += `--${key} `;
            } else if (typeof options[key] === 'object') {
                const val = JSON.stringify(options[key]);
                flags += `--${key} '${val}' `;
            } else {
                flags += `--${key} ${options[key]} `;
            }
        }
    }
    flags = flags.trim();
    return `node src/cmd/manage_nsfs ${type} ${action} ${flags}`;
}
