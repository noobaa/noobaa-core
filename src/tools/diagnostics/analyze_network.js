/* Copyright (C) 2023 NooBaa */
'use strict';

const os = require('os');
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
const { make_http_request } = require('../../util/http_utils');
const { read_stream_join } = require('../../util/buffer_utils');

// ❌
// ✅

const ANALYZE_FUNCTION_BY_SERVICE_TYPE = {
    S3_HTTP: analyze_s3,
    S3_HTTPS: analyze_s3_secure,
    STS: analyze_sts,
    IAM: analyze_iam,
    DB: analyze_db,
    MGMT: analyze_mgmt,
    METRICS: analyze_metrics
};

const OK = 'OK';
const NOT_OK = 'NOT_OK';

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
            write_stdout_response(ManageCLIResponse.NetworkStatus, nc_network_status);
        } else {
            const network_status = await test_network();
            dbg.log0('network_status', network_status);
        }
    } catch (err) {
        dbg.error('Health: exit on error', err.stack || err);
        if (is_nc_deployment) throw_cli_error({ ...ManageCLIError.NetworkStatusFailed, cause: err });
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
    const forks_info = await analyze_forks(services_info);
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
async function test_network() {
    const analyze_network_res = [];
    const services = await os_utils.discover_k8s_services();
    const [external_services, internal_services] = _.partition(services, s => s.kind === 'EXTERNAL');
    for (const service_info of internal_services) {
        const service_type = get_service_type(service_info);
        if (service_type !== '') {
            const analyze_service_res = await analyze_service(service_type, service_info);
            analyze_network_res.push({ service_type, analyze_service_res });
        }
    }
    for (const service_info of external_services) {
        const service_type = get_service_type(service_info);
        if (service_type !== '') {
            const analyze_service_res = await analyze_service(service_type, service_info);
            analyze_network_res.push({ service_type, analyze_service_res });
        }
    }

    return { analyze_network_res };

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
    const nslookup_status = await nslookup_service(service_info);
    const ping_dns_status = await ping_service(service_info); // ping DNS
    const ping_ip_status = await ping_service(service_info); // ping IP
    const curl_status = await curl_service(service_info);
    const analyze_service_func = ANALYZE_FUNCTION_BY_SERVICE_TYPE[service_type];
    const analyze_service_func_status = await analyze_service_func(service_info);
    return { nslookup_status, ping_dns_status, ping_ip_status, curl_status, service_call_status: analyze_service_func_status};
}


///////////////////////////////////
//          GENERAL HELPERS      //
///////////////////////////////////

async function ping_service(service_info) {
    return { status: 'OK' };
}

async function nslookup_service(service_info) {
    return { status: OK };
}

async function curl_service(service_info) {
    return { status: OK };
}

async function analyze_s3(service_info) {
    return { status: OK };
}

async function analyze_s3_secure(service_info) {
    return { status: OK };
}

async function analyze_sts(service_info) {
    return { status: OK };
}

async function analyze_iam(service_info) {
    // nice to have
}

async function analyze_db(service_info) {
    return { status: OK };
}

async function analyze_mgmt(service_info) {
    return { status: OK };
}

/**
 * analyze_metrics checks the connectivity to the metrics server on each host and checks that recieved nsfs metrics
 * TODO: add other metrics like '/metrics/web_server':WS_METRICS_SERVER_PORT '/metrics/bg_workers':BG_METRICS_SERVER_PORT '/metrics/hosted_agents':HA_METRICS_SERVER_PORT
 * TODO: add port from config.json of this specific host
 * @param {Object} service_info 
 * @returns {Promise<Object>}
 */
async function analyze_metrics(service_info) {
    try {
        const { res, metrics_output = undefined, error_output = undefined } = await fetch_nsfs_metrics(service_info.hostname);
        const status = (res.statusCode !== 200 || !metrics_output || !metrics_output.nsfs_counters ||
            !metrics_output.op_stats_counters || !metrics_output.fs_worker_stats_counters) ? NOT_OK : OK;
        return { status, metrics_output, error_output};
    } catch (err) {
        dbg.error('analyze_network.analyze_metrics err', err);
        return { status: NOT_OK, error_output: err};
    }
}


/**
 * fetch_nsfs_metrics runs http request to a noobaa metrics server for fetching nsfs metrics
 * @param {String} hostname 
 */
async function fetch_nsfs_metrics(hostname = 'localhost') {
    console.log('ROMY bla', hostname);
    const res = await make_http_request({
        hostname: hostname,
        port: config.EP_METRICS_SERVER_PORT,
        path: '/metrics/nsfs_stats',
        method: 'GET'
    });
    if (res.statusCode === 200) {
        const buffer = await read_stream_join(res);
        const body = buffer.toString('utf8');
        const metrics_output = JSON.parse(body);
        return { metrics_output, res };
    } else if (res.statusCode >= 500 && res.rawHeaders.includes('application/json')) {
        const buffer = await read_stream_join(res);
        const body = buffer.toString('utf8');
        const error_output = JSON.parse(body);
        return { error_output, res };
    } else {
        throw new Error('received empty metrics response', { cause: res.statusCode });
    }
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
        if (service_info.service !== 'S3_HTTPS' || service_info.secure === false) continue;
        try {
            // TODO - check if doing calls to the running host with full hostname works
            const hostname = os.hostname() === service_info.hostname ? '' : service_info.hostname;
            const responsive_fork_ids = await call_forks(num_of_forks, hostname, service_info.port);
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
    const nc_services_info = [];
    for (const hostname of Object.keys(system_data)) {
        if (!is_fqdn(hostname)) continue;
        // TODO: 
        // 1. need to take the port from config.json per host and not from the general config
        // 2. add other service in the future
        const s3_info = { service: 'S3_HTTP', hostname, port: config.ENDPOINT_PORT, secure: false };
        const s3_ssl_info = { service: 'S3_HTTPS', hostname, port: config.ENDPOINT_SSL_PORT, secure: true };
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
