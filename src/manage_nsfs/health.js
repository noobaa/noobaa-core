/* Copyright (C) 2020 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const _ = require('lodash');
const P = require('../util/promise');
const config = require('../../config');
const os_util = require('../util/os_utils');
const nb_native = require('../util/nb_native');
const { CONFIG_DIR_PHASES } = require('../sdk/config_fs');
const native_fs_utils = require('../util/native_fs_utils');
const { read_stream_join } = require('../util/buffer_utils');
const { make_https_request } = require('../util/http_utils');
const { TYPES } = require('./manage_nsfs_constants');
const { get_boolean_or_string_value, throw_cli_error, write_stdout_response,
    get_bucket_owner_account_by_id, get_service_status, NOOBAA_SERVICE_NAME } = require('./manage_nsfs_cli_utils');
const { ManageCLIResponse } = require('./manage_nsfs_cli_responses');
const ManageCLIError = require('./manage_nsfs_cli_errors').ManageCLIError;


const HOSTNAME = 'localhost';

const health_errors = {
    NOOBAA_SERVICE_FAILED: {
        error_code: 'NOOBAA_SERVICE_FAILED',
        error_message: 'NooBaa service is not started properly, Please verify the service with status command.',
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
    INVALID_ACCOUNT_OWNER: {
        error_code: 'INVALID_ACCOUNT_OWNER',
        error_message: 'Bucket account owner is invalid',
    },
    MISSING_ACCOUNT_OWNER: {
        error_code: 'MISSING_ACCOUNT_OWNER',
        error_message: 'Bucket account owner not found',
    },
    INVALID_CONFIG_DIR: {
        error_code: 'INVALID_CONFIG_DIR',
        error_message: 'Config directory is invalid',
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
        this.all_account_details = options.all_account_details;
        this.all_bucket_details = options.all_bucket_details;
        this.config_fs = options.config_fs;
    }

    /**
    * nc_nsfs_health will execute the following checks and will result with a health report
    * 1. get noobaa service state
    * 2. get endpoint response
    * 3. get service memory usage
    * 5. if all_account_details flag provided check accounts status
    * 6. if all_bucket_details flag provided check buckets status
    * @returns {Promise<object>}
    */
    async nc_nsfs_health() {
        let endpoint_state;
        let memory;
        const noobaa_service_state = await this.get_service_state(NOOBAA_SERVICE_NAME);
        const { service_status, pid } = noobaa_service_state;
        if (pid !== '0') {
            endpoint_state = await this.get_endpoint_response();
            memory = await this.get_service_memory_usage();
        }
        // TODO: add more health status based on system.json, e.g. RPM upgrade issues
        const system_data = await this.config_fs.get_system_config_file({ silent_if_missing: true });
        const config_directory_status = this._get_config_dir_status(system_data);

        let bucket_details;
        let account_details;
        const endpoint_response_code = (endpoint_state && endpoint_state.response?.response_code) || 'UNKNOWN_ERROR';
        const health_check_params = { service_status, pid, endpoint_response_code, config_directory_status };
        const service_health = this._calc_health_status(health_check_params);
        const error_code = this.get_error_code(health_check_params);
        if (this.all_bucket_details) bucket_details = await this.get_bucket_status();
        if (this.all_account_details) account_details = await this.get_account_status();
        const health = {
            service_name: NOOBAA_SERVICE_NAME,
            status: service_health,
            memory: memory,
            error: error_code,
            checks: {
                services: [noobaa_service_state],
                endpoint: {
                    endpoint_state,
                    error_type: health_errors_tyes.TEMPORARY,
                },
                config_directory_status,
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
                    if (endpoint_state.response?.response_code === fork_response_code.NOT_RUNNING.response_code) {
                        throw new Error('Noobaa endpoint is not running, all the retries failed');
                    }
                }
            });
        } catch (err) {
            console.log('Error while pinging endpoint host :' + HOSTNAME + ', port ' + this.https_port, err);
            endpoint_state = { response: fork_response_code.NOT_RUNNING };
        }
        return endpoint_state;
    }

    /**
     * get_error_code returns the error code per the failed check
     * @param {{service_status: String, 
     * pid: string, 
     * endpoint_response_code: string, 
     * config_directory_status: Object }} health_check_params
     * @returns {Object}
    */
    get_error_code({ service_status, pid, endpoint_response_code, config_directory_status }) {
        if (service_status !== 'active' || pid === '0') {
            return health_errors.NOOBAA_SERVICE_FAILED;
        } else if (endpoint_response_code === 'NOT_RUNNING') {
            return health_errors.NOOBAA_ENDPOINT_FAILED;
        } else if (endpoint_response_code === 'MISSING_FORKS') {
            return health_errors.NOOBAA_ENDPOINT_FORK_MISSING;
        } else if (config_directory_status.error) {
            return health_errors.CONFIG_DIR_ERROR;
        }
    }

    async get_service_state(service_name) {
        let pid;
        const service_status = await get_service_status(service_name);
        try {
            pid = await os_util.exec('systemctl show --property MainPID --value ' + service_name, {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true,
            });
        } catch (err) {
            dbg.warn('could not receive service active state', service_name, err);
            pid = 'missing pid info';
        }
        const service_health = { name: service_name, service_status, pid };
        if (['inactive', 'missing service status info'].includes(service_status)) {
            service_health.error_type = health_errors_tyes.PERSISTENT;
            const service_error_name = _.upperCase(_.camelCase(service_name)) + '_SERVICE_FAILED';
            service_health.error_code = health_errors[service_error_name];
        }
        return service_health;
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
                    response: fork_response_code.NOT_RUNNING,
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
        let memory_status;
        try {
            memory_status = await os_util.exec('systemctl status ' + NOOBAA_SERVICE_NAME + ' | grep Memory ', {
                ignore_rc: false,
                return_stdout: true,
                trim_stdout: true,
            });
        } catch (err) {
            dbg.warn('could not receive service active state', NOOBAA_SERVICE_NAME, err);
            memory_status = 'Memory: missing memory info';
        }
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

    async get_bucket_status() {
        const bucket_details = await this.get_storage_status(TYPES.BUCKET, this.all_bucket_details);
        return bucket_details;
    }

    async get_account_status() {
        const account_details = await this.get_storage_status(TYPES.ACCOUNT, this.all_account_details);
        return account_details;
    }

    async get_storage_status(type, all_details) {
        const invalid_storages = [];
        const valid_storages = [];
        //check for account and buckets dir paths
        let config_root_type_exists;
        let config_dir_path;
        if (type === TYPES.BUCKET) {
            config_dir_path = this.config_fs.buckets_dir_path;
            config_root_type_exists = await this.config_fs.validate_config_dir_exists(config_dir_path);
        } else if (type === TYPES.ACCOUNT) {
            // TODO - handle iam accounts when directory structure changes - read_account_by_id
            config_dir_path = this.config_fs.accounts_by_name_dir_path;
            config_root_type_exists = await this.config_fs.validate_config_dir_exists(config_dir_path);
        }
        // TODO - this is not a good handling for that - we need to take it to an upper level
        if (!config_root_type_exists) {
            dbg.log1(`Config directory type - ${type} is missing, ${config_dir_path}`);
            return {
                invalid_storages: invalid_storages,
                valid_storages: valid_storages
            };
        }

        let config_files_names;
        if (type === TYPES.BUCKET) {
            config_files_names = await this.config_fs.list_buckets();
        } else {
            config_files_names = await this.config_fs.list_accounts();
        }
        for (const config_file_name of config_files_names) {
            // config_file get data or push error
            const { config_data = undefined, err_obj = undefined } =
                await this.get_config_file_data_or_error_object(type, config_file_name);
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
                const config_file_path = this.config_fs.get_account_path_by_name(config_file_name);
                res = await is_new_buckets_path_valid(config_file_path, config_data, storage_path);
            } else if (type === TYPES.BUCKET) {
                res = await is_bucket_storage_and_owner_exists(this.config_fs, config_data, storage_path);
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

    /**
     * get_config_file_data_or_error_object return an object containing config_data or err_obj if error occurred
     * @param {string} type
     * @param {string} config_file_name
     * @returns {Promise<object>}
     */
    async get_config_file_data_or_error_object(type, config_file_name) {
        let config_data;
        let err_obj;
        try {
            config_data = type === TYPES.BUCKET ?
                await this.config_fs.get_bucket_by_name(config_file_name) :
                // TODO - should be changed to id when moving to new structure for supporting iam accounts
                await this.config_fs.get_account_by_name(config_file_name);
        } catch (err) {
            let err_code;
            const config_file_path = type === TYPES.BUCKET ?
                this.config_fs.get_bucket_path_by_name(config_file_name) :
                // TODO - should be changed to id when moving to new structure for supporting iam accounts
                this.config_fs.get_account_path_by_name(config_file_name);

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
     * _get_config_dir_status returns the config directory phase, version, 
     * matching package_version, upgrade_status and error if occured.
     * @param {Object} system_data 
     * @returns {Object}
     */
    _get_config_dir_status(system_data) {
        if (!system_data) return { error: 'system data is missing' };
        const blocked_hosts_status = this._get_blocked_hosts_status(this.config_fs, system_data);
        const config_dir_data = system_data.config_directory;
        if (!config_dir_data) return { error: 'config directory data is missing, must upgrade config directory', blocked_hosts: blocked_hosts_status };
        const config_dir_upgrade_status = this._get_config_dir_upgrade_status(config_dir_data);
        return {
            phase: config_dir_data.phase,
            config_dir_version: config_dir_data.config_dir_version,
            upgrade_package_version: config_dir_data.upgrade_package_version,
            upgrade_status: config_dir_upgrade_status,
            error: config_dir_upgrade_status.error || undefined,
            blocked_hosts: blocked_hosts_status
        };
    }

    /**
     * _get_config_dir_upgrade_status returns one of the following
     * 1. the status of an ongoing upgrade, if valid it returns an object with upgrade details
     * 2. if upgrade is not ongoing but config dir is locked, the error details of the upgrade's last_failure will return
     * 3. if upgrade is not ongoing and config dir is unlocked, a corresponding message will return
     * @param {Object} config_dir_data 
     * @returns {Object}
     */
    _get_config_dir_upgrade_status(config_dir_data) {
        if (config_dir_data.in_progress_upgrade) return { in_progress_upgrade: config_dir_data.in_progress_upgrade };
        if (config_dir_data.phase === CONFIG_DIR_PHASES.CONFIG_DIR_LOCKED) {
            return { error: 'last_upgrade_failed', last_failure: config_dir_data.upgrade_history.last_failure };
        }
        if (config_dir_data.phase === CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED) {
            return { message: 'there is no in-progress upgrade' };
        }
    }

    /**
     * _get_blocked_hosts_status checks if there are any hosts blocked for updating the config directory
     * 1. if only config dir was upgraded (>=5.18.0) - host's config_dir_version does not exist (<5.18.0) and system's config_dir_version exists (>=5.18.0)
     * it means it's not blocked because the source code won't include _throw_if_config_dir_locked() but it still can create invalid config files, therefore including it in the blocked list
     * 2. if system's config_dir_version wasn't upgraded yet and hosts's config_dir_version exist (>= 5.18.0)
     * it means updates to the config directory from this host are blocked
     * 3. if system's config dir version does not match the hosts's config_dir_version - updates to the config directory from this host are blocked
     * @param {import('../sdk/config_fs').ConfigFS} config_fs
     * @param {Object} system_data 
     * @returns {Object}
     */
    _get_blocked_hosts_status(config_fs, system_data) {
        const system_config_dir_version = system_data.config_directory?.config_dir_version;
        const hosts_data = config_fs.get_hosts_data(system_data);
        let res;
        for (const host_name of Object.keys(hosts_data)) {
            const host_data = hosts_data[host_name];
            let version_compare_err;
            const only_config_dir_upgraded = !host_data.config_dir_version && system_config_dir_version;
            const only_host_upgraded = host_data.config_dir_version && !system_config_dir_version;
            if (only_config_dir_upgraded) {
                version_compare_err = `host's config_dir_version is undefined, system's config_dir_version already upgraded to ${system_config_dir_version}, updates to the config directory via the host will result with invalid config_dir files until the host source code upgrade`;
            } else if (only_host_upgraded) {
                version_compare_err = `host's config_dir_version is ${host_data.config_dir_version}, system's config_dir_version is undefined, updates to the config directory will be blocked until the config dir upgrade`;
            } else {
                version_compare_err = host_data.config_dir_version && system_config_dir_version &&
                    config_fs.compare_host_and_config_dir_version(host_data.config_dir_version, system_config_dir_version);
            }
            if (version_compare_err !== undefined) {
                res = Object.assign(res || {}, {
                    [host_name]: {
                        host_version: host_data.current_version,
                        host_config_dir_version: host_data.config_dir_version,
                        error: version_compare_err
                    }
                });
            }
        }
        return res;
    }

    /**
     *  _calc_health_status calcs the overall health status of NooBaa NC
     * @param {{service_status: String, 
     * pid: string, 
     * endpoint_response_code: string, 
     * config_directory_status: Object }} health_check_params
     * @returns {'OK' | 'NOTOK'}
     */
    _calc_health_status({ service_status, pid, endpoint_response_code, config_directory_status }) {
        const is_unhealthy = service_status !== 'active' ||
            pid === '0' ||
            endpoint_response_code !== 'RUNNING' ||
            config_directory_status.error;
        return is_unhealthy ? 'NOTOK' : 'OK';
    }
}

async function get_health_status(argv, config_fs) {
    try {
        const https_port = Number(argv.https_port) || config.ENDPOINT_SSL_PORT;
        const deployment_type = argv.deployment_type || 'nc';
        const all_account_details = get_boolean_or_string_value(argv.all_account_details);
        const all_bucket_details = get_boolean_or_string_value(argv.all_bucket_details);

        if (deployment_type === 'nc') {
            const health = new NSFSHealth({ https_port, all_account_details, all_bucket_details, config_fs });
            const health_status = await health.nc_nsfs_health();
            write_stdout_response(ManageCLIResponse.HealthStatus, health_status);
        } else {
            dbg.log0('Health is not supported for simple nsfs deployment.');
        }
    } catch (err) {
        dbg.error('Health: exit on error', err.stack || err);
        throw_cli_error({ ...ManageCLIError.HealthStatusFailed, cause: err });
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
        if (!_should_skip_health_access_check()) {
            await nb_native().fs.stat(account_fs_context, new_buckets_path);
            const accessible = await native_fs_utils.is_dir_accessible(account_fs_context, new_buckets_path);
            if (!accessible) {
                const new_err = new Error('ACCESS DENIED');
                new_err.code = 'EACCES';
                throw new_err;
            }
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
 * is_bucket_storage_and_owner_exists checks if the underlying storage path of a bucket exists
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {object} config_data
 * @param {string} storage_path
 * @returns {Promise<object>}
 */
async function is_bucket_storage_and_owner_exists(config_fs, config_data, storage_path) {
    let res_obj;
    try {
        if (!_should_skip_health_access_check()) {
            const account_fs_context = await get_account_owner_context(config_fs, config_data.owner_account);
            await nb_native().fs.stat(account_fs_context, storage_path);
        }
        res_obj = get_valid_object(config_data.name, undefined, storage_path);
    } catch (err) {
        let err_code;
        if (err.code === 'ENOENT') {
            dbg.log1(`Error: Storage path should be a valid dir path`, storage_path);
            err_code = health_errors.STORAGE_NOT_EXIST.error_code;
        } else if (err.code === 'EACCES' || (err.code === 'EPERM' && err.message === 'Operation not permitted')) {
            dbg.log1('Error:  Storage path should be accessible to account: ', storage_path);
            err_code = health_errors.ACCESS_DENIED.error_code;
        } else if (err.code === health_errors.INVALID_ACCOUNT_OWNER.error_code ||
                err.code === health_errors.MISSING_ACCOUNT_OWNER.error_code) {
            dbg.log1('Error: Bucket account owner should be existing and valid account', config_data.owner_account);
            err_code = err.code;
        }
        res_obj = get_invalid_object(config_data.name, undefined, storage_path, err_code);
    }
    return res_obj;
}

/**
 * get_account_owner_context returns bucket account owner specific FS context
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @param {string} owner_account
 * @returns {Promise<object>}
 */
async function get_account_owner_context(config_fs, owner_account) {
    if (!owner_account) {
        const new_err = new Error(health_errors.MISSING_ACCOUNT_OWNER.error_message);
        new_err.code = health_errors.MISSING_ACCOUNT_OWNER.error_code;
        throw new_err;
    }
    try {
        // when account owner is invalid method will throw error
        const owner_account_data = await get_bucket_owner_account_by_id(config_fs, owner_account, false, false);
        const account_fs_context = await native_fs_utils.get_fs_context(owner_account_data.nsfs_account_config,
            owner_account_data.nsfs_account_config.fs_backend);
        return account_fs_context;
    } catch (err) {
        const new_err = new Error(`Bucket account owner ${owner_account} is invalid`);
        new_err.code = health_errors.INVALID_ACCOUNT_OWNER.error_code;
        throw new_err;
    }
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

/**
 * _should_skip_access_check returns true if the health CLI should skip access check
 * @returns {Boolean}
 */
function _should_skip_health_access_check() {
    return config.NC_DISABLE_HEALTH_ACCESS_CHECK || config.NC_DISABLE_ACCESS_CHECK;
}

exports.get_health_status = get_health_status;
exports.NSFSHealth = NSFSHealth;
