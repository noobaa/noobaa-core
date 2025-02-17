/* Copyright (C) 2025 NooBaa */
/* eslint-disable max-lines-per-function */
/* eslint max-lines: ['error', 4000] */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const os_util = require('../../../util/os_utils');
const fs_utils = require('../../../util/fs_utils');
const { ConfigFS } = require('../../../sdk/config_fs');
const { TMP_PATH, set_nc_config_dir_in_config } = require('../../system_tests/test_utils');
const { TYPES, ACTIONS } = require('../../../manage_nsfs/manage_nsfs_constants');

const ManageCLIError = require('../../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_connection_cli.test');

const timeout = 5000;

// eslint-disable-next-line max-lines-per-function
describe('manage nsfs cli connection flow', () => {
    describe('cli create connection', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const config_fs = new ConfigFS(config_root);
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
        const options_file = path.join(TMP_PATH, "conn1.json");
        const defaults = {
            name: 'conn1',
            agent_request_object: {
                host: "localhost",
                "port": 9999,
                "timeout": 100
            },
            request_options_object: {auth: "user:passw"},
            notification_protocol: "http",

        };
        beforeEach(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);

            fs.writeFileSync(options_file, JSON.stringify(defaults));
            const action = ACTIONS.ADD;
            const conn_options = { config_root, from_file: options_file };
            await exec_manage_cli(TYPES.CONNECTION, action, conn_options);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli create connection from file', async () => {
            const connection = await config_fs.get_connection_by_name(defaults.name);
            assert_connection(connection, defaults, true);
        }, timeout);

        it('cli create connection from cli', async () => {
            const conn_options = {...defaults, config_root};
            conn_options.name = "fromcli";
            const res = await exec_manage_cli(TYPES.CONNECTION, ACTIONS.ADD, conn_options);
            const res_json = JSON.parse(res.trim());
            expect(_.isEqual(new Set(Object.keys(res_json.response)), new Set(['reply', 'code']))).toBe(true);
            const connection = await config_fs.get_connection_by_name(conn_options.name);
            assert_connection(connection, conn_options, true);
        }, timeout);

        it('cli delete connection ', async () => {
            await exec_manage_cli(TYPES.CONNECTION, ACTIONS.DELETE, {config_root, name: defaults.name});
            expect(fs.readdirSync(config_fs.connections_dir_path).filter(file => file.endsWith(".json")).length).toEqual(0);
        }, timeout);

        //update notification_protocol field in the connection file.
        it('cli update connection ', async () => {
            await exec_manage_cli(TYPES.CONNECTION, ACTIONS.UPDATE, {
                config_root,
                name: defaults.name,
                key: "notification_protocol",
                value: "https"
            });
            const updated = await config_fs.get_connection_by_name(defaults.name);
            const updated_content = {...defaults};
            updated_content.notification_protocol = "https";
            assert_connection(updated, updated_content, true);
        }, timeout);

        it('cli list connection ', async () => {
            const res = JSON.parse(await exec_manage_cli(TYPES.CONNECTION, ACTIONS.LIST, {config_root}));
            expect(res.response.reply[0]).toEqual(defaults.name);
        }, timeout);

        it('cli status connection ', async () => {
            const res = JSON.parse(await exec_manage_cli(TYPES.CONNECTION, ACTIONS.STATUS, {
                config_root,
                name: defaults.name,
                decrypt: true
            }));
            assert_connection(res.response.reply, defaults, false);
        }, timeout);

        it('conn already exists', async () => {
            const action = ACTIONS.ADD;
            const { name, agent_request_object, request_options_object, notification_protocol } = defaults;
            const conn_options = { config_root, name, agent_request_object, request_options_object, notification_protocol };
            await exec_manage_cli(TYPES.CONNECTION, action, conn_options);
            const actual = await config_fs.get_connection_by_name(name);
            assert_connection(actual, defaults, true);

            const res = await exec_manage_cli(TYPES.CONNECTION, action, conn_options, true);
            const res_json = JSON.parse(res.trim());
            expect(res_json.error.code).toBe(ManageCLIError.ConnectionAlreadyExists.code);
        });

        it('conn does not exist', async () => {
            const conn_options = { config_root, name: "badname" };
            const res = await exec_manage_cli(TYPES.CONNECTION, ACTIONS.DELETE, conn_options, true);
            const res_json = JSON.parse(res.trim());
            expect(res_json.error.code).toBe(ManageCLIError.NoSuchConnection.code);
        });

    });
});


/**
 * assert_connection will verify the fields of the accounts 
 * @param {object} connection actual
 * @param {object} connection_options expected
 * @param {boolean} is_encrypted whether connection's auth field is encrypted
 */
function assert_connection(connection, connection_options, is_encrypted) {
    expect(connection.name).toEqual(connection_options.name);
    expect(connection.notification_protocol).toEqual(connection_options.notification_protocol);
    expect(connection.agent_request_object).toStrictEqual(connection_options.agent_request_object);
    if (is_encrypted) {
        expect(connection.request_options_object).not.toStrictEqual(connection_options.request_options_object);
    } else {
        expect(connection.request_options_object).toStrictEqual(connection_options.request_options_object);
    }
}

/**
 * exec_manage_cli will get the flags for the cli and runs the cli with it's flags
 * @param {string} type
 * @param {string} action
 * @param {object} options
 */
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

/**
 * create_command would create the string needed to run the CLI command
 * @param {string} type
 * @param {string} action
 * @param {object} options
 */
function create_command(type, action, options) {
    let account_flags = ``;
    for (const key in options) {
        if (Object.hasOwn(options, key)) {
            if (typeof options[key] === 'boolean') {
                account_flags += `--${key} `;
            } else if (typeof options[key] === 'object') {
                const val = JSON.stringify(options[key]);
                account_flags += `--${key} '${val}' `;
            } else {
                account_flags += `--${key} ${options[key]} `;
            }
        }
    }
    account_flags = account_flags.trim();

    const command = `node src/cmd/manage_nsfs ${type} ${action} ${account_flags}`;
    return command;
}
