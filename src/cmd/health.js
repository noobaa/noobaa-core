/* Copyright (C) 2020 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const path = require('path');
const _ = require('lodash');
const minimist = require('minimist');
const P = require('../util/promise');
const config = require('../../config');
const os_util = require('../util/os_utils');
const nb_native = require('../util/nb_native');
const native_fs_utils = require('../util/native_fs_utils');
const { read_stream_join } = require('../util/buffer_utils');
const { make_https_request } = require('../util/http_utils');
const { TYPES } = require('../manage_nsfs/manage_nsfs_constants');

const HELP = `
Help:

    'nsfs' is a noobaa-core command runs a local S3 endpoint on top of a filesystem.
    Each sub directory of the root filesystem represents an S3 bucket.
    Health command will return the health status of deployed nsfs.
`;

const USAGE = `
Usage:

    node src/cmd/health [flags]
`;


const OPTIONS = `
Flags:

    --deployment_type <string>        (optional)                             Set the nsfs type for heath check.(default nc; Non Containerized)
    --config_root <string>            (optional)                             Set Configuration files path for Noobaa standalon NSFS. (default config.NSFS_NC_DEFAULT_CONF_DIR)
    --https_port                      (optional)                             Set the S3 endpoint listening HTTPS port to serve. (default config.ENDPOINT_SSL_PORT)
    --all_account_details             (optional)                             Set a flag for returning all account details.
    --all_bucket_details              (optional)                             Set a flag for returning all bucket details.
    --check_syslog_ng                 (optional)                             Set a flag for considering syslog-ng in health check.
`;

function print_usage() {
    process.stdout.write(HELP);
    process.stdout.write(USAGE.trimStart());
    process.stdout.write(OPTIONS.trimStart());
    process.exit(1);
}

const HOSTNAME = 'localhost';
const NOOBAA_SERVICE = 'noobaa';
const RSYSLOG_SERVICE = 'rsyslog';
const SYSLOG_NG_SERVICE = 'syslog-ng';
const health_errors = {
    NOOBAA_SERVICE_FAILED: {
        error_code: 'NOOBAA_SERVICE_FAILED',
        error_message: 'NooBaa service is not started properly, Please verify the service with status command.',
    },
    RSYSLOG_SERVICE_FAILED: {
        error_code: 'RSYSLOG_SERVICE_FAILED',
        error_message: 'RSYSLOG service is not started properly, Please verify the service with status command.',
    },
    NOOBAA_ENDPOINT_FAILED: {
        error_code: 'NOOBAA_ENDPOINT_FAILED',
        error_message: 'S3 endpoint process is not running. Restart the endpoint process.',
    },
    NOOBAA_ENDPOINT_FORK_MISSING: {
        error_code: 'NOOBAA_ENDPOINT_FORK_MISSING',
        error_message: 'One or more endpoint fork is not started properly. Verify the total and missing fork count in response.',
    },
    STORAGE_NOT_EXIST: {
        error_code: 'STORAGE_NOT_EXIST',
        error_message: 'Storage path mentioned in schema pointing to the invalid directory.',
    },
    INVALID_CONFIG: {
        error_code: 'INVALID_CONFIG',
        error_message: 'Schema JSON is not valid, Please check the JSON format.',
    },
    ACCESS_DENIED: {
        error_code: 'ACCESS_DENIED',
        error_message: 'Account do no have access to storage path mentioned in schema.',
    },
    MISSING_CONFIG: {
        error_code: 'MISSING_CONFIG',
        error_message: 'Schema JSON is not found.',
    },
    INVALID_DISTINGUISHED_NAME: {
        error_code: 'INVALID_DISTINGUISHED_NAME',
        error_message: 'Account distinguished name was not found',
    },
    UNKNOWN_ERROR: {
        error_code: 'UNKNOWN_ERROR',
        error_message: 'An unknown error occurred',
    }
};

const fork_response_code = {
    RUNNING: {
        response_code: 'RUNNING',
        response_message: 'Endpoint running successfuly.',
    },
    MISSING_FORKS: {
        response_code: 'MISSING_FORKS',
        response_message: 'Number of running forks is less than the expected fork count.',
    },
    NOT_RUNNING: {
        response_code: 'NOT_RUNNING',
        response_message: 'Endpoint proccess not running.',
    },
};

const health_errors_tyes = {
    PERSISTENT: 'PERSISTENT',
    TEMPORARY: 'TEMPORARY',
};

//suppress aws sdk related commands.
process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1';

/**
 */
class NSFSHealth {
    constructor(options) {
        this.https_port = options.https_port;
        this.config_root = options.config_root;
        this.all_account_details = options.all_account_details;
        this.all_bucket_details = options.all_bucket_details;
        this.check_syslog_ng = options.check_syslog_ng;
    }
    async nc_nsfs_health() {
        let endpoint_state;
        let memory;
        let syslog_ng;
        const { service_status, pid } = await this.get_service_state(NOOBAA_SERVICE);
        if (pid !== '0') {
            endpoint_state = await this.get_endpoint_response();
            memory = await this.get_service_memory_usage();
        }
        let bucket_details;
        let account_details;
        const response_code = endpoint_state ? endpoint_state.response.response_code : 'NOT_RUNNING';
        const rsyslog = await this.get_service_state(RSYSLOG_SERVICE);
        let service_health = 'OK';
        let syslog_ng_health = 'OK';
        if (this.check_syslog_ng) {
            syslog_ng = await this.get_service_state(SYSLOG_NG_SERVICE);
            if (syslog_ng.service_status !== 'active' || syslog_ng.pid === '0') {
                syslog_ng_health = 'NOTOK';
            }
        }
        if (syslog_ng_health === 'NOTOK' || service_status !== 'active' || pid === '0' || response_code !== 'RUNNING' ||
            rsyslog.service_status !== 'active' || rsyslog.pid === '0') {
            service_health = 'NOTOK';
        }
        const error_code = await this.get_error_code(service_status, pid, rsyslog.service_status, response_code);
        if (this.all_bucket_details) bucket_details = await this.get_bucket_status(this.config_root);
        if (this.all_account_details) account_details = await this.get_account_status(this.config_root);
        const health = {
            service_name: NOOBAA_SERVICE,
            status: service_health,
            memory: memory,
            error: error_code,
            checks: {
                services: [{
                        name: NOOBAA_SERVICE,
                        service_status: service_status,
                        pid: pid,
                        error_type: health_errors_tyes.PERSISTENT,
                    },
                    {
                        name: RSYSLOG_SERVICE,
                        service_status: rsyslog.service_status,
                        pid: rsyslog.pid,
                        error_type: health_errors_tyes.PERSISTENT,
                    }
                ],
                endpoint: {
                    endpoint_state,
                    error_type: health_errors_tyes.TEMPORARY,
                },
                accounts_status: {
                    invalid_accounts: account_details === undefined ? undefined : account_details.invalid_storages,
                    valid_accounts: account_details === undefined ? undefined : account_details.valid_storages,
                    error_type: health_errors_tyes.PERSISTENT,
                },
                buckets_status: {
                    invalid_buckets: bucket_details === undefined ? undefined : bucket_details.invalid_storages,
                    valid_buckets: bucket_details === undefined ? undefined : bucket_details.valid_storages,
                    error_type: health_errors_tyes.PERSISTENT,
                }
            }
        };
        if (this.check_syslog_ng) {
            health.checks.services.push({
                name: SYSLOG_NG_SERVICE,
                service_status: syslog_ng.service_status,
                pid: syslog_ng.pid,
                error_type: health_errors_tyes.PERSISTENT,
            });
        }
        if (!this.all_account_details) delete health.checks.accounts_status;
        if (!this.all_bucket_details) delete health.checks.buckets_status;
        return health;
    }

    async get_endpoint_response() {
        let endpoint_state;
        try {
            await P.retry({
                attempts: config.NC_HEALTH_ENDPOINT_RETRY_COUNT,
                delay_ms: config.NC_HEALTH_ENDPOINT_RETRY_DELAY,
                func: async () => {
                    endpoint_state = await this.get_endpoint_fork_response();
                    if (endpoint_state.response.response_code === fork_response_code.NOT_RUNNING.response_code) {
                        throw new Error('Noobaa endpoint is not running, all the retries failed');
                    }
                }
            });
        } catch (err) {
            console.log('Error while pinging endpoint host :' + HOSTNAME + ', port ' + this.https_port, err);
            return {
                response: fork_response_code.NOT_RUNNING.response_code,
            };
        }
        return endpoint_state;
    }

    async get_error_code(nsfs_status, pid, rsyslog_status, endpoint_response_code) {
        if (nsfs_status !== 'active' || pid === '0') {
            return health_errors.NOOBAA_SERVICE_FAILED;
        } else if (rsyslog_status !== 'active') {
            return health_errors.RSYSLOG_SERVICE_FAILED;
        } else if (endpoint_response_code === 'NOT_RUNNING') {
            return health_errors.NOOBAA_ENDPOINT_FAILED;
        } else if (endpoint_response_code === 'MISSING_FORKS') {
            return health_errors.NOOBAA_ENDPOINT_FORK_MISSING;
        }
    }

    async get_service_state(service_name) {
        const service_status = await os_util.exec('systemctl show -p ActiveState --value ' + service_name, {
            ignore_rc: true,
            return_stdout: true,
            trim_stdout: true,
        });
        const pid = await os_util.exec('systemctl show --property MainPID --value ' + service_name, {
            ignore_rc: true,
            return_stdout: true,
            trim_stdout: true,
        });
        return { service_status: service_status, pid: pid };
    }

    async make_endpoint_health_request(url_path) {
        const response = await make_https_request({
            HOSTNAME,
            port: this.https_port,
            path: url_path,
            method: 'GET',
            rejectUnauthorized: false,
        });
        if (response && response.statusCode === 200) {
            const buffer = await read_stream_join(response);
            const body = buffer.toString('utf8');
            return JSON.parse(body);
        }
    }

    async get_endpoint_fork_response() {
        let url_path = '/total_fork_count';
        const worker_ids = [];
        let total_fork_count = 0;
        let response;
        try {
            const fork_count_response = await this.make_endpoint_health_request(url_path);
            if (!fork_count_response) {
                return {
                    response_code: fork_response_code.NOT_RUNNING,
                    total_fork_count: total_fork_count,
                    running_workers: worker_ids,
                };
            }
            total_fork_count = fork_count_response.fork_count;
            if (total_fork_count > 0) {
                url_path = '/endpoint_fork_id';
                await P.retry({
                    attempts: total_fork_count * 2,
                    delay_ms: 1,
                    func: async () => {
                        const fork_id_response = await this.make_endpoint_health_request(url_path);
                        if (fork_id_response.worker_id && !worker_ids.includes(fork_id_response.worker_id)) {
                            worker_ids.push(fork_id_response.worker_id);
                        }
                        if (worker_ids.length < total_fork_count) {
                            throw new Error('Number of running forks is less than the expected fork count.');
                        }
                    }
                });
                if (worker_ids.length === total_fork_count) {
                    response = fork_response_code.RUNNING;
                } else {
                    response = fork_response_code.MISSING_FORKS;
                }
            } else {
                response = fork_response_code.RUNNING;
            }
        } catch (err) {
            dbg.log1('Error while pinging endpoint host :' + HOSTNAME + ', port ' + this.https_port, err);
            response = fork_response_code.NOT_RUNNING;
        }
        return {
            response: response,
            total_fork_count: total_fork_count,
            running_workers: worker_ids,
        };
    }

    async get_service_memory_usage() {
        const memory_status = await os_util.exec('systemctl status ' + NOOBAA_SERVICE + ' | grep Memory ', {
            ignore_rc: true,
            return_stdout: true,
            trim_stdout: true,
        });
        if (memory_status) {
            const memory = memory_status.split('Memory: ')[1].trim();
            return memory;
        }
    }

    get_root_fs_context() {
        return {
            uid: process.getuid(),
            gid: process.getgid(),
            warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
        };
    }

    get_account_fs_context(uid, gid) {
        return {
            uid: uid,
            gid: gid,
            warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
        };
    }

    async get_bucket_status(config_root) {
        const bucket_details = await this.get_storage_status(config_root, TYPES.BUCKET, this.all_bucket_details);
        return bucket_details;
    }

    async get_account_status(config_root) {
        const account_details = await this.get_storage_status(config_root, TYPES.ACCOUNT, this.all_account_details);
        return account_details;
    }

    async get_storage_status(config_root, type, all_details) {
        const fs_context = this.get_root_fs_context();
        const config_root_type_path = this.get_config_path(config_root, type);
        const invalid_storages = [];
        const valid_storages = [];
        //check for account and buckets dir paths
        try {
            await nb_native().fs.stat(fs_context, config_root_type_path);
        } catch (err) {
            dbg.log1(`Config root path missing ${type} folder in ${config_root_type_path}`);
            return {
                invalid_storages: invalid_storages,
                valid_storages: valid_storages
            };
        }
        const entries = await nb_native().fs.readdir(fs_context, config_root_type_path);
        const config_files = entries.filter(entree => !native_fs_utils.isDirectory(entree) && entree.name.endsWith('.json'));
        for (const config_file of config_files) {
            // config_file get data or push error
            const config_file_path = path.join(config_root_type_path, config_file.name);
            const { config_data = undefined, err_obj = undefined } =
            await get_config_file_data(fs_context, config_file_path, config_file.name);
            if (!config_data && err_obj) {
                invalid_storages.push(err_obj.invalid_storage);
                continue;
            }

            // for account - check access permissions of new_buckets_path dir per account uid/gid/distinguished_name  
            // for bucket - check for if bucket underlying storage path exists
            let res;
            const storage_path = type === TYPES.BUCKET ?
                config_data.path :
                config_data.nsfs_account_config.new_buckets_path;

            if (type === TYPES.ACCOUNT) {
                res = await is_new_buckets_path_valid(config_file_path, config_data, storage_path);
            } else if (type === TYPES.BUCKET) {
                res = await is_bucket_storage_path_exists(fs_context, config_data, storage_path);
            }
            if (all_details && res.valid_storage) {
                valid_storages.push(res.valid_storage);
            } else {
                invalid_storages.push(res.invalid_storage);
            }
        }
        return {
            invalid_storages: invalid_storages,
            valid_storages: valid_storages
        };
    }

    get_config_path(config_root, type) {
        return path.join(config_root, type === TYPES.BUCKET ? '/buckets' : '/accounts');
    }
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        if (process.getuid() !== 0 || process.getgid() !== 0) {
            throw new Error('Root permissions required for NSFS Health execution.');
        }
        if (argv.help || argv.h) return print_usage();
        const config_root = argv.config_root ? String(argv.config_root) : config.NSFS_NC_CONF_DIR;
        const https_port = Number(argv.https_port) || config.ENDPOINT_SSL_PORT;
        const deployment_type = argv.deployment_type || 'nc';
        const all_account_details = argv.all_account_details || false;
        const all_bucket_details = argv.all_bucket_details || false;
        const check_syslog_ng = argv.check_syslog_ng || false;
        if (deployment_type === 'nc') {
            const health = new NSFSHealth({ https_port, config_root, all_account_details, all_bucket_details, check_syslog_ng });
            const health_status = await health.nc_nsfs_health();
            process.stdout.write(JSON.stringify(health_status) + '\n', () => {
                process.exit(0);
            });
        } else {
            dbg.log0('Health is not supported for simple nsfs deployment.');
        }
    } catch (err) {
        dbg.error('Health: exit on error', err.stack || err);
        process.exit(2);
    }
}


/**
 * is_new_buckets_path_valid check -
 * 1. new_buckets_path isn't defined and allow_bucket_creation is false
 * 2. account can access of new_buckets_path
 * returns a valid/invalid object accordingly
 * 
 * @param {string} config_file_path
 * @param {object} config_data
 * @param {string} new_buckets_path
 */
async function is_new_buckets_path_valid(config_file_path, config_data, new_buckets_path) {
    let err_code;
    let res_obj;
    let account_fs_context;

    // 1. account is invalid when allow_bucket_creation is true and new_buckets_path is missing, 
    // else account is considered a valid account that can not create a bucket.
    if (!new_buckets_path) {
        if (config_data.allow_bucket_creation) {
            res_obj = get_invalid_object(config_data.name, undefined, new_buckets_path, health_errors.STORAGE_NOT_EXIST.error_code);
        } else {
            res_obj = get_valid_object(config_data.name, undefined, new_buckets_path);
        }
        return res_obj;
    }

    // 2 
    try {
        account_fs_context = await native_fs_utils.get_fs_context(config_data.nsfs_account_config);
    } catch (err) {
        dbg.log1(`Error: Could not get account fs context`, config_data.nsfs_account_config, err);
        if (err.rpc_code === 'NO_SUCH_USER') {
            err_code = health_errors.INVALID_DISTINGUISHED_NAME.error_code;
        }
        return get_invalid_object(config_data.name, config_file_path, undefined, err_code);
    }

    try {
        const accessible = await native_fs_utils.is_dir_rw_accessible(account_fs_context, new_buckets_path);
        if (!accessible) {
            const new_err = new Error('ACCESS DENIED');
            new_err.code = 'EACCES';
            throw new_err;
        }
        res_obj = get_valid_object(config_data.name, undefined, new_buckets_path);
    } catch (err) {
        if (err.code === 'ENOENT') {
            dbg.log1(`Error: Storage path should be a valid dir path`, new_buckets_path);
            err_code = health_errors.STORAGE_NOT_EXIST.error_code;
        } else if (err.code === 'EACCES' || (err.code === 'EPERM' && err.message === 'Operation not permitted')) {
            dbg.log1('Error:  Storage path should be accessible to account: ', new_buckets_path);
            err_code = health_errors.ACCESS_DENIED.error_code;
        }
        res_obj = get_invalid_object(config_data.name, undefined, new_buckets_path, err_code);
    }
    return res_obj;
}

/**
 * get_config_file_data return an object containing config_data or err_obj if error occurred
 * @param {nb.NativeFSContext} fs_context
 * @param {string} config_file_path
 * @param {string} config_file_name
 * @returns {Promise<object>}
 */
async function get_config_file_data(fs_context, config_file_path, config_file_name) {
    let config_data;
    let err_obj;
    try {
        const { data } = await nb_native().fs.readFile(fs_context, config_file_path);
        config_data = JSON.parse(data.toString());
    } catch (err) {
        let err_code;
        if (err.code === 'ENOENT') {
            dbg.log1(`Error: Config file path should be a valid path`, config_file_path, err);
            err_code = health_errors.MISSING_CONFIG.error_code;
        } else {
            dbg.log1('Error: while accessing the config file: ', config_file_path, err);
            err_code = health_errors.INVALID_CONFIG.error_code;
        }
        err_obj = get_invalid_object(config_file_name, config_file_path, undefined, err_code);
    }
    return {
        config_data,
        err_obj
    };
}

/**
 * is_bucket_storage_path_exists checks if the underlying storage path of a bucket exists 
 * @param {nb.NativeFSContext} fs_context
 * @param {object} config_data
 * @param {string} storage_path
 * @returns {Promise<object>}
 */
async function is_bucket_storage_path_exists(fs_context, config_data, storage_path) {
    let res_obj;
    try {
        await nb_native().fs.stat(fs_context, storage_path);
        res_obj = get_valid_object(config_data.name, undefined, storage_path);
    } catch (err) {
        let err_code;
        if (err.code === 'ENOENT') {
            dbg.log1(`Error: Storage path should be a valid dir path`, storage_path);
            err_code = health_errors.STORAGE_NOT_EXIST.error_code;
        } else if (err.code === 'EACCES' || (err.code === 'EPERM' && err.message === 'Operation not permitted')) {
            dbg.log1('Error:  Storage path should be accessible to account: ', storage_path);
            err_code = health_errors.ACCESS_DENIED.error_code;
        }
        res_obj = get_invalid_object(config_data.name, undefined, storage_path, err_code);
    }
    return res_obj;
}


/**
 * get_valid_object returns an object which repersents a valid account/bucket and contains defined parameters
 * @param {string} name
 * @param {string} config_path
 * @param {string} storage_path
 */
function get_valid_object(name, config_path, storage_path) {
    return {
        valid_storage: _.omitBy({
            name: name,
            config_path: config_path,
            storage_path: storage_path,
        }, _.isUndefined)
    };
}

/**
 * get_invalid_object returns an object which repersents an invalid account/bucket and contains defined parameters
 * @param {string} name
 * @param {string} config_path
 * @param {string} storage_path
 * @param {string} err_code
 */
function get_invalid_object(name, config_path, storage_path, err_code) {
    return {
        invalid_storage: _.omitBy({
            name: name,
            config_path: config_path,
            storage_path: storage_path,
            code: err_code || health_errors.UNKNOWN_ERROR.error_code
        }, _.isUndefined)
    };
}

exports.main = main;

if (require.main === module) main();

module.exports = NSFSHealth;
