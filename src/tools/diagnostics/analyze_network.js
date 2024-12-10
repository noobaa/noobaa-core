/* Copyright (C) 2023 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name('analyze_network');
const { is_fqdn } = require('../../util/net_utils');
const config = require('../../../config');
const { ManageCLIError } = require('../../manage_nsfs/manage_nsfs_cli_errors');
const { ManageCLIResponse } = require('../../manage_nsfs/manage_nsfs_cli_responses');
const { throw_cli_error, write_stdout_response } = require('../../manage_nsfs/manage_nsfs_cli_utils');
const { call_forks } = require('../../manage_nsfs/health');
const os_utils = require('../../util/os_utils');

const ANALYZE_FUNCTION_BY_SERVICE_TYPE = {
    S3_HTTP: analyze_s3,
    S3_HTTPS: analyze_s3_secure,
    STS: analyze_sts,
    IAM: analyze_iam,
    DB: analyze_db,
    MGMT: analyze_mgmt,
    METRICS: analyze_metrics
};

/**
 * get_network_status runs network tests and returns/prints the analyzed network information 
 * @param {*} [argv] 
 * @param {import('../../sdk/config_fs').ConfigFS} [config_fs] 
 * @returns {Promise<Void>}
 */
async function get_network_status(argv, config_fs) {
    const deployment_type = argv.deployment_type;
    const is_nc_deployment = deployment_type === 'nc';
    try {
        dbg.log0('starting to analyze network');
        if (is_nc_deployment) {
            const nc_network_status = await test_nc_network(config_fs);
            write_stdout_response(ManageCLIResponse.HealthStatus, nc_network_status);
        } else {
            const network_status = await test_network();
            console.log('network_status', network_status);
        }
    } catch (err) {
        dbg.error('Health: exit on error', err.stack || err);
        if (is_nc_deployment) throw_cli_error({ ...ManageCLIError.HealthStatusFailed, cause: err });
    }
    process.exit(0);
}

/**
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs 
 *  TODO: In the future add IAM, STS
 * @returns {Promise<Object>}
 */
async function test_nc_network(config_fs) {
    const services_info = await nc_prepare_services_info(config_fs);
    console.log('ROMY services info', services_info);
    const forks_info = await analyze_forks(services_info);
    console.log('ROMY services info', services_info);

    const analyze_network_res = [];
    for (const service of services_info) {
        const analyze_service_res = await analyze_service(service.service, service);
        analyze_network_res.push({ service, analyze_service_res });
    }
    return { forks_info, analyze_network_res };
}

/**
 * 
 */
async function test_network(services_info) {
    const services = await os_utils.discover_k8s_services();
    const [external_services, internal_services] = _.partition(services, s => s.kind === 'EXTERNAL');
    for (const service_info of internal_services) {
        const service_type = get_service_type(service_info);
        if (service_type !== '') await analyze_service(service_type, service_info);
    }
    for (const service_info of external_services) {
        const service_type = get_service_type(service_info);
        if (service_type !== '') await analyze_service(service_type, service_info);
    }
}

function get_service_type(info) {
    if (info.api === 'metrics') return 'METRICS';
    if (info.api === 's3') {
        if (info.secure) return 'S3';
        else return 'S3-HTTP';
    }
    if (info.api === 'postgres') return 'DB';
    if (info.api === 'mgmt') return 'MGMT';
    if (info.api === 'sts') return 'STS';
    return '';
}

/**
 * analyze_service
 */
async function analyze_service(service_type, service_info) {
    await nslookup_service(service_info);
    await ping_service(service_info); // ping DNS
    await ping_service(service_info); // ping IP
    await curl_service(service_info);
    const analyze_service_closure = ANALYZE_FUNCTION_BY_SERVICE_TYPE[service_type];
    await analyze_service_closure(service_info);
}


///////////////////////////////////
//          GENERAL HELPERS      //
///////////////////////////////////


async function ping_service(service_info) {

}

async function nslookup_service(service_info) {

}

async function curl_service(service_info) {

}

async function analyze_s3(service_info) {

}

async function analyze_s3_secure(service_info) {

}

async function analyze_sts(service_info) {

}

async function analyze_iam(service_info) {
    // nice to have
}

async function analyze_db(service_info) {

}

async function analyze_mgmt(service_info) {

}

async function analyze_metrics(service_info) {

}

/////////////////////////////////
///           NC               //
/////////////////////////////////

/**
 * analyze_forks iterates the services finds S3 secure hostname and port and calls every fork exists
 * @param {Object} services_info 
 * @returns {Promise<Object>}
 */
async function analyze_forks(services_info) {
    const res = {};
    for (const service_info of services_info) {
        const num_of_forks = config.ENDPOINT_FORKS;
        if (service_info.service !== 's3' || service_info.secure === false) continue;
        try {
            // TODO - check if doing calls to the running host with full hostname works
            const responsive_fork_ids = await call_forks(num_of_forks, service_info.hostname, service_info.port);
            res[service_info.hostname] = { total_fork_count: num_of_forks, responsive_fork_ids };
        } catch (err) {
            res[service_info.hostname] = { total_fork_count: num_of_forks, responsive_forks: [], error: err };
        }
    }
    return res;
}


/**
 * nc_prepare_services_info creates services info object
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs 
 * @returns {Promise<Object[]>}
 */
async function nc_prepare_services_info(config_fs) {
    const system_data = await config_fs.get_system_config_file({ silent_if_missing: true });
    console.log('ROMY system_data', system_data);

    const nc_services_info = [];
    for (const hostname of Object.keys(system_data)) {
        console.log('ROMY hostname', hostname, is_fqdn(hostname));

        if (!is_fqdn(hostname)) continue;
        // TODO: 
        // 1. need to take the port from config.json per host and not from the general config
        // 2. add other service in the future
        const s3_info = { service: 'S3-HTTP', hostname, port: config.ENDPOINT_PORT, secure: false };
        const s3_ssl_info = { service: 'S3', hostname, port: config.ENDPOINT_SSL_PORT, secure: true };
        const metrics_info = { service: 'METRICS', hostname, port: config.EP_METRICS_SERVER_PORT, secure: false };
        nc_services_info.push(s3_info);
        nc_services_info.push(s3_ssl_info);
        nc_services_info.push(metrics_info);

    }
    return nc_services_info;
}

exports.get_network_status = get_network_status;
if (require.main === module) {
    get_network_status();
}
