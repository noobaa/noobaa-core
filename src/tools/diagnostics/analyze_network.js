/* Copyright (C) 2023 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name('analyze_network');

const os = require('os');
const dns = require('dns');
const _ = require('lodash');
const ping = require('ping');
const util = require('util');
const config = require('../../../config');
const os_utils = require('../../util/os_utils');
const { is_fqdn } = require('../../util/net_utils');
const { call_forks } = require('../../manage_nsfs/health');
const { read_stream_join } = require('../../util/buffer_utils');
const { ManageCLIError } = require('../../manage_nsfs/manage_nsfs_cli_errors');
const { make_https_request, make_http_request } = require('../../util/http_utils');
const { ManageCLIResponse } = require('../../manage_nsfs/manage_nsfs_cli_responses');
const { throw_cli_error, write_stdout_response } = require('../../manage_nsfs/manage_nsfs_cli_utils');

const SUCCESS = '✅ SUCCESS';
const FAILURE = '❌ FAILURE';
const SKIPPED_TEST = '⏭️ SKIPPED_TEST';
const UNSTABLE = '🟡 UNSTABLE';

/**
 * ANALYZE_FUNCTION_BY_SERVICE_TYPE is a mapping between service type and analyze function of the service
 */
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
    const deployment_type = argv?.deployment_type;
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

////////////////////////////////////////
//         CONTAINERIZED HELPERS      //
////////////////////////////////////////

/**
 * test_network runs network tests on NooBaa containerized environment
 * @returns {Promise<Object>}
 */
async function test_network() {
    const analyze_network_res = [];
    const services = await os_utils.discover_k8s_services();
    const is_containerized = true;
    const [external_services, internal_services] = _.partition(services, s => s.kind === 'EXTERNAL');
    for (const service_info of internal_services) {
        const service_type = get_service_type(service_info);
        if (service_type !== '') {
            const analyze_service_res = await analyze_service(service_type, service_info, is_containerized);
            analyze_network_res.push({ service_type, analyze_service_res });
        }
    }
    for (const service_info of external_services) {
        const service_type = get_service_type(service_info);
        if (service_type !== '') {
            const analyze_service_res = await analyze_service(service_type, service_info, is_containerized);
            analyze_network_res.push({ service_type, analyze_service_res });
        }
    }
    return { analyze_network_res };
}

/**
 * get_service_type is a function used for containerized deployment for mapping the api to the service type
 * @param {Object} info 
 * @returns {String}
 */
function get_service_type(info) {
    if (info.api === 'metrics') return 'METRICS';
    if (info.api === 's3') {
        if (info.secure) return 'S3-HTTPS';
        else return 'S3-HTTP';
    }
    if (info.api === 'postgres') return 'DB';
    if (info.api === 'mgmt') return 'MGMT';
    if (info.api === 'sts') return 'STS';
    return '';
}

/////////////////////////////////
///     NON CONTAINERIZED      //
/////////////////////////////////

/**
 * test_nc_network runs network tests on NooBaa non-containerized environment
 *  TODO: In the future add IAM, STS
 * @param {import('../../sdk/config_fs').ConfigFS} config_fs 
 * @returns {Promise<Object>}
 */
async function test_nc_network(config_fs) {
    const services_info = await nc_prepare_services_info(config_fs);
    const forks_info = await analyze_forks(services_info);
    const analyze_network_response = [];
    for (const service of services_info) {
        const checks = await analyze_service(service.service, service);
        analyze_network_response.push({ ...service, ...checks });
    }
    return { forks_info, analyze_network_response };
}

/**
 * analyze_forks iterates the services finds S3 secure hostname and port and calls every fork exists
 * @param {Object} services_info 
 * @returns {Promise<Object>}
 */
async function analyze_forks(services_info) {
    const res = {};
    for (const service_info of services_info) {
        const num_of_forks = config.ENDPOINT_FORKS;
        if (service_info.service !== 'S3_HTTPS') continue;
        try {
            const hostname = (os.hostname() === service_info.hostname) ? 'localhost' : service_info.hostname;
            // TODO - check if doing calls to the running host with full hostname works
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

///////////////////////////////////
//          GENERAL HELPERS      //
///////////////////////////////////

/**
 * analyze_service is the function that provides a set of checks for a service 
 * @param {Object} service_info 
 * @param {String} service_type 
 * @param {Boolean} [is_containerized]
 * @returns {Promise<Object>}
 */
async function analyze_service(service_type, service_info, is_containerized) {
    const nslookup_status = await nslookup_service(service_info);
    const ping_dns_status = await ping_service(service_info.hostname, is_containerized); // ping DNS
    const ping_ip_status = await ping_service(service_info.ip, is_containerized); // ping IP
    const curl_status = await curl_service(service_type, service_info);
    const analyze_service_func = ANALYZE_FUNCTION_BY_SERVICE_TYPE[service_type];
    const analyze_service_func_status = await analyze_service_func(service_info);
    return { nslookup_status, ping_dns_status, ping_ip_status, curl_status, service_call_status: analyze_service_func_status};
}

/**
 * ping_service calls ping on a given host/ip address
 * @param {String} host 
 * @param {Boolean} [is_containerized] 
 * @returns {Promise<Object>}
 */
async function ping_service(host, is_containerized) {
    const err_arr = [];
    if (is_containerized) {
        const warn = '⏭️ ping_service: ping host on containerized is skipped';
        console.warn(warn);
        return { status: SKIPPED_TEST, warn: warn };
    }
    if (!host) return { status: FAILURE, error: `host is missing ${host}` };
    const max_retries = 3;
    for (let i = 0; i < max_retries; i += 1) {
        try {
            const res = await ping.promise.probe(host);
            if (res.alive) {
                console.log('✅ ping_service: ping host success!', host);
            } else {
                err_arr.push(`ping_service: ping node failed', host, ${util.inspect(res.output)}`);
            }
        } catch (err) {
            err_arr.push(err);
            continue;
        }
    }
    if (err_arr.length === 0) {
        console.log('✅ ping_service: ping host success!', host);
        return { status: SUCCESS };
    } else if (err_arr.length === max_retries) {
        console.log('❌ ping_service: ping host failed', host, err_arr);
        return { status: FAILURE, error: err_arr };
    } else {
        console.log('❌ ping_service: ping host failed at least once', host, err_arr);
        return { status: UNSTABLE, error: err_arr };
    }
}

/**
 * nslookup_service runs nslookup on a hostname and sets the result ip on service_info param
 * @param {Object} service_info 
 * @returns {Promise<Object>}
 */
async function nslookup_service(service_info) {
    try {
        await os_utils.get_dns_config();
        const res = await dns.promises.lookup(service_info.hostname, { family: 4 });
        service_info.ip = res.address;
    } catch (err) {
        console.log('❌ nslookup_service: dns resolve failed service_info.hostname', service_info.hostname);
        return { status: FAILURE, error: err };
    }
    console.log('✅ nslookup_service: dns resolve success!', service_info.hostname, service_info.ip);
    return { status: SUCCESS };
}

/**
 * curl_service runs curl on the service and returns OK/NOT_OK per the response
 * @param {String} service_type 
 * @param {Object} service_info 
 * @returns {Promise<Object>}
 */
async function curl_service(service_type, service_info) {
    const options = {
        hostname: service_info.hostname,
        port: service_info.port,
        method: 'GET',
        rejectUnauthorized: false
      };
      try {
        let res;
        if (service_info.secure) {
            res = await make_https_request(options);
        } else {
            res = await make_http_request(options);
        }
        if (res.statusCode === 200 ||
            //on s3 we will get 403 responce for InvalidAccessKeyId
            (res.statusCode === 403 && (service_type === 'S3_HTTP' || service_type === 'S3_HTTPS'))) {
            console.log('✅ curl_service: http connection success!', service_info.hostname, service_info.port);
            return { status: SUCCESS };
        } else {
            console.log('❌ curl_service: http connection failed', service_info.hostname, service_info.port, res.statusCode);
            // TODO: need to add error
            return { status: FAILURE, error: res.statusCode};
        }
      } catch (err) {
        console.log('❌ curl_service: http connection failed', service_info.hostname, service_info.port, err);
        return { status: FAILURE, error: err };
      }
}

/**
 * TODO: implement analyze_s3
 * @param {Object} service_info 
 * @returns {Promise<Object>}
 */
async function analyze_s3(service_info) {
    return { status: SKIPPED_TEST };
}

/**
 * TODO: implement analyze_s3_secure
 * @param {Object} service_info 
 * @returns {Promise<Object>}
 */
async function analyze_s3_secure(service_info) {
    return { status: SKIPPED_TEST };
}

/**
 * TODO: implement analyze_sts
 * @param {Object} service_info 
 * @returns {Promise<Object>}
 */
async function analyze_sts(service_info) {
    return { status: SKIPPED_TEST };
}

/**
 * TODO: implement analyze_iam
 * @param {Object} service_info 
 * @returns {Promise<Object>}
 */
async function analyze_iam(service_info) {
    return { status: SKIPPED_TEST };
}

/**
 * TODO: implement analyze_db
 * @param {Object} service_info 
 * @returns {Promise<Object>}
 */
async function analyze_db(service_info) {
    return { status: SKIPPED_TEST };
}

/**
 * TODO: implement analyze_mgmt
 * @param {Object} service_info 
 * @returns {Promise<Object>}
 */
async function analyze_mgmt(service_info) {
    return { status: SKIPPED_TEST };
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
            !metrics_output.op_stats_counters || !metrics_output.fs_worker_stats_counters) ? FAILURE : SUCCESS;
        return { status, metrics_output, error_output};
    } catch (err) {
        dbg.error('analyze_metrics: err', err);
        return { status: FAILURE, error_output: err};
    }
}

/**
 * fetch_nsfs_metrics runs http request to a noobaa metrics server for fetching nsfs metrics
 * @param {String} hostname 
 * @returns {Promise<Object>}
 */
async function fetch_nsfs_metrics(hostname) {
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

////////////////////
//    EXPORTS     //
////////////////////

exports.get_network_status = get_network_status;
if (require.main === module) {
    get_network_status();
}
