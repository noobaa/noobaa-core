/* Copyright (C) 2016 NooBaa */

import * as model from 'model';
import api from 'services/api';
import config from 'config';
import * as routes from 'routes';
import JSZip from 'jszip';
import { last, makeArray } from 'utils/core-utils';
import { all, sleep, execInOrder } from 'utils/promise-utils';
import { realizeUri, downloadFile, httpRequest, toFormData } from 'utils/browser-utils';
import { Buffer } from 'buffer';

// Action dispathers from refactored code.
import { action$ } from 'state';
import {
    fetchSystemInfo,
    showNotification,
    requestLocation,
    refreshLocation
} from 'action-creators';

// Use preconfigured hostname or the addrcess of the serving computer.
const endpoint = window.location.hostname;

// -----------------------------------------------------
// Utility function to log actions.
// -----------------------------------------------------
const prefix = 'ACTION DISPATHCED';

function logAction(action, payload) {
    if (typeof payload !== 'undefined') {
        console.info(`${prefix} ${action} with`, payload);
    } else {
        console.info(`${prefix} ${action}`);
    }
}

// -----------------------------------------------------
// Navigation actions
// -----------------------------------------------------
export function navigateTo(route = model.routeContext().pathname, params = {},  query = {}) {
    logAction('navigateTo', { route, params, query });

    const uri = realizeUri(route, Object.assign({}, model.routeContext().params, params), query);
    action$.next(requestLocation(uri));

}

export function redirectTo(route = model.routeContext().pathname, params = {}, query = {}) {
    logAction('redirectTo', { route, params, query });

    const uri = realizeUri(route, Object.assign({}, model.routeContext().params, params), query);
    action$.next(requestLocation(uri, true));
}

export function reloadTo(route = model.routeContext().pathname, params = {},  query = {}) {
    logAction('reloadTo', { route, params, query });

    // Force full browser refresh
    window.location.href = realizeUri(
        route, Object.assign({}, model.routeContext().params, params), query
    );
}

// -----------------------------------------------------
// High level UI update actions.
// -----------------------------------------------------

export function showFunc() {
    logAction('showFunc');

    const ctx = model.routeContext();
    const { func } = ctx.params;

    loadFunc(func);
}

export async function loadFunc(name, version = '$LATEST') {
    logAction('loadFunc', { name, version });

    const reply = await api.func.read_func({
        name,
        version,
        read_code: true,
        read_stats: true
    });

    const codeFiles = [];
    const { zipfile } = reply[api.RPC_BUFFERS] || {};
    if (zipfile) {
        const zip = await JSZip.loadAsync(zipfile);
        const { handler } = reply.config;
        const handlerFile = handler.slice(0, handler.lastIndexOf('.'));
        const file = zip.files[handlerFile + '.js'];

        if (file) {
            codeFiles.push({
                path: file.name,
                size: file._data.uncompressedSize, // hacky
                dir: file.dir,
                content: await file.async('string')
            });
        }
    }

    const { name: _, version: __, ...config } = reply.config;
    const stats = reply.stats;
    model.funcInfo({ name, version, config, codeFiles, stats });
}

export async function invokeFunc(name, version, event = '') {
    logAction('invokeFunc', { name, version, event });

    try {
        const eventObj = JSON.parse(String(event));
        const { result, error } = await api.func.invoke_func({
            name: name,
            version: version,
            event: eventObj
        });

        error ?
            notify(`Func ${name} invoked but returned error: ${error.message}`, 'warning') :
            notify(`Func ${name} invoked successfully result: ${JSON.stringify(result)}`, 'success');

    } catch (error) {
        notify(`Func ${name} invocation failed`, 'error');
    }
}

export async function updateFuncConfig(name, version, config) {
    logAction('updateFuncConfig', { name, version, config });

    try {
        await api.func.update_func({
            config: { name, version, ...config }
        });
        notify(`Func ${name} updated successfully`, 'success');
        loadFunc(name);

    } catch (error) {
        notify(`Func ${name} update failed`, 'error');
    }
}

export async function updateFuncCode(name, version, patches) {
    logAction('updateFuncCode', { name, version });

    try {
        const reply = await api.func.read_func({
            name,
            version,
            read_code: true
        });
        const { zipfile } = reply[api.RPC_BUFFERS];
        if (zipfile) {
            const zip = await JSZip.loadAsync(zipfile);
            await all(patches.map(({ path, content }) => zip.file(path, content)));
            const update = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));

            await api.func.update_func({
                config: { name, version },
                code: {},
                [api.RPC_BUFFERS]: { zipfile: update }
            });
        }

        notify(`Func ${name} code updated successfully`, 'success');

    } catch (error) {
        notify(`Func ${name} code update failed`, 'error');
    }
}

export async function deleteFunc(name, version) {
    logAction('deleteFunc', { name, version });

    try {
        await api.func.delete_func({ name, version });
        notify(`Func ${name} deleted successfully`, 'success'),
        action$.next(fetchSystemInfo());

    } catch (error) {
        notify(`Func ${name} deletion failed`, 'error');
    }
}

// -----------------------------------------------------
// Information retrieval actions.
// -----------------------------------------------------
export async function loadServerInfo(testPhonehomeConnectvity, phonehomeProxy) {
    logAction('loadServerInfo', { testPhonehomeConnectvity, phonehomeProxy });

    const { serverInfo } = model;
    serverInfo(null);

    const { has_accounts } = await api.account.accounts_status();
    if (has_accounts) {
        serverInfo({
            initialized: true
        });
    } else {
        const config = await api.cluster_server.read_server_config({
            test_ph_connectivity: testPhonehomeConnectvity,
            ph_proxy: phonehomeProxy
        });

        serverInfo({
            initialized: false,
            address: endpoint,
            config: config
        });
    }
}

export function loadAuditEntries(categories, count) {
    logAction('loadAuditEntries', { categories, count });

    const auditLog = model.auditLog;
    const filter = categories
        .map(
            category => `(^${category}.)`
        )
        .join('|');

    if (filter !== '') {
        api.events.read_activity_log({
            event: filter || '^$',
            limit: count
        })
            .then(
                ({ logs }) => {
                    auditLog(logs);
                    auditLog.loadedCategories(categories);
                }
            )
            .done();

    } else {
        auditLog([]);
        auditLog.loadedCategories([]);
    }
}

export function loadMoreAuditEntries(count) {
    logAction('loadMoreAuditEntries', { count });

    const auditLog = model.auditLog;
    const lastEntryTime = last(auditLog()).time;
    const filter = model.auditLog.loadedCategories()
        .map(
            category => `(^${category}.)`
        )
        .join('|');

    if (filter !== '') {
        api.events.read_activity_log({
            event: filter,
            till: lastEntryTime,
            limit: count
        })
            .then(
                ({ logs }) => auditLog.push(...logs)
            )
            .done();
    }
}

export function exportAuditEnteries(categories) {
    logAction('exportAuditEnteries', { categories });

    const filter = categories
        .map(
            category => `(^${category}.)`
        )
        .join('|');

    api.events.export_activity_log({ event: filter || '^$' })
        .catch(
            err => {
                notify('Exporting activity log failed', 'error');
                throw err;
            }
        )
        .then(downloadFile)
        .done();
}

export function loadCloudBucketList(connection) {
    logAction('loadCloudBucketList', { connection });

    api.bucket.get_cloud_buckets({
        connection: connection
    })
        .then(
            model.cloudBucketList,
            () => model.cloudBucketList(null)
        )
        .done();
}

// -----------------------------------------------------
// Managment actions.
// -----------------------------------------------------
export function createBucket(name, dataPlacement, pools) {
    logAction('createBucket', { name, dataPlacement, pools });

    // TODO: remove the random string after patching the server
    // with a delete bucket that deletes also the policy
    const bucket_with_suffix = `${name}#${Date.now().toString(36)}`;

    api.tier.create_tier({
        name: bucket_with_suffix,
        data_placement: dataPlacement,
        attached_pools: pools
    })
        .then(
            tier => {
                const policy = {
                    name: bucket_with_suffix,
                    tiers: [ { order: 0, tier: tier.name } ]
                };

                return api.tiering_policy.create_policy(policy)
                    .then(
                        () => policy
                    );
            }
        )
        .then(
            policy => api.bucket.create_bucket({
                name: name,
                tiering: policy.name
            })
        )
        .then(
            () => notify(`Bucket ${name} created successfully`, 'success'),
            () => notify(`Bucket ${name} creation failed`, 'error')
        )
        .then(() => action$.next(fetchSystemInfo()))
        .done();
}

export function deleteCloudResource(name) {
    logAction('deleteCloudResource', { name });

    api.pool.delete_pool({ name })
        .then(
            () => notify(`Resource ${name} deleted successfully`, 'success'),
            () => notify(`Resource ${name} deletion failed`, 'error')
        )
        .then(() => action$.next(fetchSystemInfo()))
        .done();
}

export function testNode(source, testSet) {
    logAction('testNode', { source, testSet });

    const regexp = /=>(\w{3}):\/\/\[?([.:0-9a-fA-F]+)\]?:(\d+)$/;
    const { nodeTestInfo } = model;

    nodeTestInfo({
        source: source,
        tests: testSet,
        timestamp: Date.now(),
        results: [],
        state:'IN_PROGRESS'
    });

    const { targetCount, testSettings } = config.nodeTest;
    api.node.get_test_nodes({
        count: targetCount,
        source: source
    })
        .then(
            // Aggregate selected tests.
            targets => [].concat(
                ...testSet.map(
                    testType => targets.map(
                        ({ name, rpc_address }) => {
                            const result = {
                                testType: testType,
                                targetName: name,
                                targetAddress: rpc_address,
                                targetIp: '',
                                targetPort: '',
                                protocol: '',
                                state: 'WAITING',
                                time: 0,
                                position: 0,
                                speed: 0,
                                progress: 0
                            };
                            nodeTestInfo().results.push(result);

                            return {
                                testType: testType,
                                source: source,
                                target: rpc_address,
                                result: result
                            };
                        }
                    )
                )
            )
        )
        .then(
            // Execute the tests in order.
            tests => execInOrder(
                tests,
                ({ source, target, testType, result }) => {
                    if (nodeTestInfo().state === 'ABORTING') {
                        result.state = 'ABORTED';
                        nodeTestInfo.valueHasMutated();
                        return;
                    }

                    const { stepCount, requestLength, responseLength, count, concur } = testSettings[testType];
                    const stepSize = count * (requestLength + responseLength);
                    const totalTestSize = stepSize * stepCount;

                    // Create a step list for the test.
                    const steps = makeArray(
                        stepCount,
                        {
                            source: source,
                            target: target,
                            request_length: requestLength,
                            response_length: responseLength,
                            count: count,
                            concur: concur
                        }
                    );

                    // Set start time.
                    const start = Date.now();
                    result.state = 'RUNNING';

                    // Execute the steps in order.
                    return execInOrder(
                        steps,
                        stepRequest => {
                            if (nodeTestInfo().state === 'ABORTING'){
                                return true;
                            }

                            return api.node.test_node_network(stepRequest)
                                .then(
                                    ({ session }) => {
                                        const [,protocol, ip, port] = session.match(regexp);
                                        result.protocol = protocol;
                                        result.targetIp = ip.replace('::ffff:','');
                                        result.targetPort = port;
                                        result.time = Date.now() - start;
                                        result.position = result.position + stepSize;
                                        result.speed = result.position / result.time;
                                        result.progress = totalTestSize > 0 ?
                                            result.position / totalTestSize :
                                            1;

                                        // Notify subscribers on the change.
                                        nodeTestInfo.valueHasMutated();
                                    }
                                );
                        }
                    )
                        .then(
                            res => res === true ? 'ABORTED' : 'COMPLETED',
                            () => 'FAILED'
                        )
                        .then(
                            state => {
                            // Notify subscribers on the change.
                                result.state = state;
                                nodeTestInfo.valueHasMutated();
                            }
                        );
                }
            )
        )
        .then(
            () => {
                if (nodeTestInfo().state === 'ABORTING') {
                    nodeTestInfo(null);
                } else {
                    nodeTestInfo.assign({
                        state: 'COMPLETED'
                    });
                }
            }
        )
        .done();
}

export function abortNodeTest() {
    logAction('abortNodeTest');

    const nodeTestInfo = model.nodeTestInfo;
    if (nodeTestInfo().state === 'IN_PROGRESS') {
        nodeTestInfo.assign({
            state: 'ABORTING'
        });
    }
}

export function updateP2PTcpPorts(minPort, maxPort) {
    logAction('updateP2PSettings', { minPort, maxPort });

    const tcp_permanent_passive = minPort !== maxPort ?
        { min: minPort, max: maxPort } :
        { port: minPort };

    const config = Object.assign(
        {},
        model.systemInfo().n2n_config,
        { tcp_permanent_passive }
    );

    api.system.update_n2n_config(config)
        .then(
            () => notify('Peer to peer settings updated successfully', 'success'),
            () => notify('Peer to peer settings update failed', 'error')
        )
        .then(() => action$.next(fetchSystemInfo()))
        .done();
}

export function updateHostname(hostname) {
    logAction('updateHostname', { hostname });

    api.system.update_hostname({ hostname })
        // The system changed it's name, reload the page using the new IP/Name
        .then(
            () => {
                const { protocol, port } = window.location;
                const baseAddress = `${protocol}//${hostname}:${port}`;

                reloadTo(
                    `${baseAddress}${routes.management}`,
                    { tab: 'settings' }
                );
            }
        )
        .done();
}

// TODO: Notificaitons - remove message
export function uploadSSLCertificate(SSLCertificate) {
    logAction('uploadSSLCertificate', { SSLCertificate });

    const uploadStatus = model.sslCertificateUploadStatus;
    uploadStatus({
        state: 'IN_PROGRESS',
        progress: 0,
        error: ''
    });

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = function(evt) {
        uploadStatus.assign({
            progress: evt.lengthComputable && (evt.loaded / evt.total)
        });
    };

    const payload = toFormData({ upload_file: SSLCertificate });
    httpRequest('/upload_certificate', { verb: 'POST', xhr, payload })
        .then(
            evt => { if (evt.target.status !== 200) throw evt; }
        )
        .then(
            () => {
                uploadStatus.assign ({ state: 'SUCCESS' });
                notify('SSL cartificate uploaded successfully', 'success');
            }
        )
        .catch(
            evt => {
                if (evt.type === 'abort') {
                    uploadStatus.assign ({ state: 'CANCELED' });
                    notify('Uploading SSL cartificate canceled', 'info');

                } else {
                    const error = evt.target.responseText;
                    uploadStatus.assign ({ state: 'FAILED', error });
                    notify(`Uploading SSL cartificate failed: ${error}`, 'error');
                }
            }
        );
}

export function downloadServerDiagnosticPack(secret, hostname) {
    logAction('downloadServerDiagnosticPack', { secret, hostname });

    const name = `${hostname}-${secret}`;
    const key = `server:${secret}`;
    if (model.collectDiagnosticsState[key]) {
        return;
    }

    model.collectDiagnosticsState.assign({ [key]: true });
    api.cluster_server.diagnose_system({
        target_secret: secret
    })
        .catch(
            err => {
                notify(`Packing server diagnostic file for ${name} failed`, 'error');
                model.collectDiagnosticsState.assign({ [key]: false });
                throw err;
            }
        )
        .then(
            url => {
                downloadFile(url);
                model.collectDiagnosticsState.assign({ [key]: false });
            }
        )
        .done();
}

export function downloadSystemDiagnosticPack() {
    logAction('downloadSystemDiagnosticPack');

    if (model.collectDiagnosticsState['system'] === true) {
        return;
    }

    model.collectDiagnosticsState.assign({ system: true });

    api.cluster_server.diagnose_system({})
        .catch(
            err => {
                notify('Packing system diagnostic file failed', 'error');
                model.collectDiagnosticsState.assign({ system: false });
                throw err;
            }
        )
        .then(
            url => {
                downloadFile(url);
                model.collectDiagnosticsState.assign({ system: false });
            }
        )
        .done();
}

export function setServerDebugLevel(secret, hostname, level){
    logAction('setServerDebugLevel', { secret, hostname, level });

    const name = `${hostname}-${secret}`;
    api.cluster_server.set_debug_level({
        target_secret: secret,
        level: level
    })
        .then(
            () => notify(
                `Debug mode was turned ${level === 0 ? 'off' : 'on'} for server ${name}`,
                'success'
            ),
            () => notify(
                `Could not turn ${level === 0 ? 'off' : 'on'} debug mode for server ${name}`,
                'error'
            )
        )
        .then(() => action$.next(fetchSystemInfo()))
        .done();
}

export function setSystemDebugLevel(level){
    logAction('setSystemDebugLevel', { level });

    api.cluster_server.set_debug_level({ level })
        .then(() => action$.next(fetchSystemInfo()))
        .done();
}

export function setCloudSyncPolicy(bucket, connection, targetBucket, direction, frequency, syncDeletions) {
    logAction('setCloudSyncPolicy', { bucket, connection, targetBucket, direction, frequency, syncDeletions });

    api.bucket.set_cloud_sync({
        name: bucket,
        connection: connection,
        target_bucket: targetBucket,
        policy: {
            n2c_enabled: Boolean(direction & 1),
            c2n_enabled: Boolean(direction & 2),
            schedule_min: frequency,
            additions_only: !syncDeletions
        }
    })
        .then(
            () => notify(`${bucket} cloud sync policy was set successfully`, 'success'),
            () => notify(`Setting ${bucket} cloud sync policy failed`, 'error')
        )
        .then(() => action$.next(fetchSystemInfo()))
        .done();
}

export function updateCloudSyncPolicy(bucket, direction, frequency, syncDeletions) {
    logAction('updateCloudSyncPolicy', { bucket, direction, frequency, syncDeletions });

    api.bucket.update_cloud_sync({
        name: bucket,
        policy: {
            n2c_enabled: Boolean(direction & 1),
            c2n_enabled: Boolean(direction & 2),
            schedule_min: frequency,
            additions_only: !syncDeletions
        }
    })
        .then(
            () => notify(`${bucket} cloud sync policy updated successfully`, 'success'),
            () => notify(`Updating ${bucket} cloud sync policy failed`, 'error')
        )
        .then(() => action$.next(fetchSystemInfo()));
}

export async function updatePhoneHomeConfig(proxyAddress) {
    logAction('updatePhoneHomeConfig', { proxyAddress });

    const { isProxyTestRunning } = model;
    if (isProxyTestRunning()) return;

    if (proxyAddress) {
        isProxyTestRunning(true);
        notify('Checking external services connectivity using configure proxy');
    }

    try {
        await api.system.update_phone_home_config({ proxy_address: proxyAddress });
        notify('Proxy settings updated successfully', 'success');

        action$.next(fetchSystemInfo());

    } catch (error) {
        const message = error.rpc_code === 'CONNECTIVITY_TEST_FAILED' ?
            'External services could not be reached using configured proxy' :
            'Updating Proxy settings failed';

        notify(message, 'error');
    }

    isProxyTestRunning(false);
}

export function updateServerDetails(serverSecret, hostname, location) {
    logAction('updateServerDetails', { serverSecret, hostname, location });

    const name = `${hostname}-${serverSecret}`;
    api.cluster_server.update_server_conf({
        target_secret: serverSecret,
        hostname: hostname,
        location: location
    })
        .then(
            notify(`${name} details updated successfully`, 'success'),
            err => {
                notify(`Updating ${name} details failed`, 'error');
                throw err;
            }
        )
        .then(() => action$.next(fetchSystemInfo()))
        .then(
            () => {
                const { servers } = model.systemInfo().cluster.shards[0];
                const server = servers.find(
                    ({ secret }) => secret === serverSecret
                );

                if (server.hostname !== hostname) {
                    redirectTo(routes.server, { server: name });
                }
            }
        )
        .done();
}

export function updateServerDNSSettings(serverSecret, primaryDNS, secondaryDNS, searchDomains) {
    logAction('updateServerDNSSettings', { serverSecret, primaryDNS, secondaryDNS , searchDomains});

    api.cluster_server.update_dns_servers({
        target_secret: serverSecret,
        dns_servers: [primaryDNS, secondaryDNS].filter(Boolean),
        search_domains: searchDomains
    })
        .then(() => {
            notify('DNS server settings updated successfully', 'success');
            action$.next(refreshLocation());
        })
        .catch(() => {
            notify('Updating server DNS setting failed, Please try again later', 'error');
        })
        .done();
}

export function loadServerTime(serverSecret) {
    logAction('loadServerTime', { serverSecret });

    api.cluster_server.read_server_time({ target_secret: serverSecret })
        .then(
            time => model.serverTime({
                server: serverSecret,
                time: time
            })
        )
        .done();
}

export function updateServerClock(serverSecret, hostname, timezone, epoch) {
    logAction('updateServerClock', { serverSecret, hostname, timezone, epoch });

    const name = `${hostname}-${serverSecret}`;
    api.cluster_server.update_time_config({
        target_secret: serverSecret,
        timezone: timezone,
        epoch: epoch
    })
        .then(
            () => notify(`${name} time settings updated successfully`, 'success'),
            () => notify(`Updating ${name} time settings failed`, 'error')
        )
        .then(() => action$.next(fetchSystemInfo()))
        .done();
}
export function updateServerNTPSettings(serverSecret, hostname, timezone, ntpServerAddress) {
    logAction('updateServerNTP', { serverSecret, hostname, timezone, ntpServerAddress });

    const name = `${hostname}-${serverSecret}`;
    api.cluster_server.update_time_config({
        target_secret: serverSecret,
        timezone: timezone,
        ntp_server: ntpServerAddress
    })
        .then(
            () => notify(`${name} time settings updated successfully`, 'success'),
            () => notify(`Updating ${name} time settings failed`, 'error')
        )
        .then(() => action$.next(fetchSystemInfo()))
        .done();
}

export function attemptResolveNTPServer(ntpServerAddress, serverSecret) {
    logAction('attemptResolveNTPServer', { ntpServerAddress });

    api.system.attempt_server_resolve({
        server_name: ntpServerAddress
    })
        .then(
            reply => sleep(500, reply)
        )
        .then(
            ({ valid, reason }) => model.ntpResolutionState({ name, valid, reason, serverSecret })
        )
        .done();
}

export function notify(message, severity = 'info') {
    action$.next(showNotification(message, severity));
}

export function validateActivation(code, email) {
    logAction('validateActivation', { code, email });

    api.system.validate_activation({ code, email })
        .then(
            reply => sleep(500, reply)
        )
        .then(
            ({ valid, reason }) => model.activationState({ code, email, valid, reason })
        )

        .done();
}

export function attemptResolveSystemName(name) {
    logAction('attemptResolveSystemName', { name });

    api.system.attempt_server_resolve({
        server_name: name,
        version_check: true
    })
        .then(
            reply => sleep(500, reply)
        )
        .then(
            ({ valid, reason }) => model.nameResolutionState({ name, valid, reason })
        )
        .done();
}

export function regenerateAccountCredentials(email, verificationPassword) {
    logAction('regenerateAccountCredentials', { email, verificationPassword: '*****' });

    model.regenerateCredentialState('IN_PROGRESS');
    api.account.generate_account_keys({
        email: email,
        verification_password: verificationPassword
    })
        .then(
            () => {
                model.regenerateCredentialState('SUCCESS');
                notify(`${email} credentials regenerated successfully`, 'success');
            }
        )
        .catch(
            err => {
                if (err.rpc_code === 'UNAUTHORIZED') {
                    model.regenerateCredentialState('UNAUTHORIZED');
                } else {
                    model.regenerateCredentialState('ERROR');
                    notify(`Regenerating ${email} credentials failed`, 'error');
                }
            }
        )
        .then(() => action$.next(fetchSystemInfo()))
        .done();
}

export function registerForAlerts() {
    logAction('registerForAlerts');
    api.redirector.register_for_alerts();
}
