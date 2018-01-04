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
    action$.onNext(requestLocation(uri));

}

export function redirectTo(route = model.routeContext().pathname, params = {}, query = {}) {
    logAction('redirectTo', { route, params, query });

    const uri = realizeUri(route, Object.assign({}, model.routeContext().params, params), query);
    action$.onNext(requestLocation(uri, true));
}

export function reload() {
    logAction('reload');

    window.location.reload();
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
export function showObject() {
    logAction('showObject');

    const ctx = model.routeContext();
    const { object, bucket } = ctx.params;
    const { page = 0 } = ctx.query;

    loadObjectMetadata(bucket, object);
    loadObjectPartList(bucket, object, parseInt(page));
}

export function showFuncs() {
    logAction('showFuncs');

    loadFuncs();
}

export function showFunc() {
    logAction('showFunc');

    const ctx = model.routeContext();
    const { func } = ctx.params;

    loadFunc(func);
}

export async function loadFuncs() {
    logAction('loadFuncs');

    const { functions } = await api.func.list_funcs({});
    model.funcList(functions.map(func => {
        const { name, version, ...config } = func.config;
        return { name, version, config };
    }));
}

export async function loadFunc(name, version = '$LATEST') {
    logAction('loadFunc', { name, version });

    const reply = await api.func.read_func({
        name,
        version,
        read_code: true,
        read_stats: true
    });

    let codeFiles = [];
    const { zipfile } = reply.code || {};
    if (zipfile) {
        const zip = await JSZip.loadAsync(zipfile);

        // Convert the result of iterating the zip file into an array of Promises.
        const promises = [];
        zip.forEach((relativePath, file) => promises.push(
            // Create a promise that resolves to an object with file metadata and string content.
            (async () => {
                const content = !relativePath.includes('/') ?
                    await file.async('string') :
                    '';

                return {
                    path: relativePath,
                    size: file._data.uncompressedSize, // hacky
                    dir: file.dir,
                    content: content
                };
            })()
        ));
        codeFiles = await all(...promises);
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
        await api.func_update_func({
            config: { name, version, ...config }
        });
        notify(`Func ${config.name} updated successfully`, 'success');
        loadFunc(config.name);

    } catch (error) {
        notify(`Func ${config.name} update failed`, 'error');
    }
}

export async function updateFuncCode(name, version, patches) {
    logAction('updateFuncCode', { name, version });

    try {
        const { code = {} } = await api.func.read_func({
            name,
            version,
            read_code: true
        });

        if (code.zipfile) {
            const zip = await JSZip.loadAsync(code.zipfile);
            await all(patches.map(({ path, content }) => zip.file(path, content)));
            const zipfile = Buffer.from(await zip.generateAsync({ type: 'uint8array'}));

            await api.func.update_func({
                config: { name, version },
                code: { zipfile }
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
        await loadFuncs();

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

export function loadObjectMetadata(bucketName, objectName) {
    logAction('loadObjectMetadata', { bucketName, objectName });

    // Drop previous data if of diffrent object.
    if (!!model.objectInfo() && model.objectInfo().key !== objectName) {
        model.objectInfo(null);
    }

    api.object.read_object_md({
        bucket: bucketName,
        key: objectName,
        adminfo: {
            signed_url_endpoint: endpoint
        }
    })
        .then(model.objectInfo)
        .done();
}

export function loadObjectPartList(bucketName, objectName, page) {
    logAction('loadObjectPartList', { bucketName, objectName, page });

    api.object.read_object_mappings({
        bucket: bucketName,
        key: objectName,
        skip: config.paginationPageSize * page,
        limit: config.paginationPageSize,
        adminfo: true
    })
        .then(
            ({ total_parts, parts }) => {
                model.objectPartList(parts);
                model.objectPartList.page(page);
                model.objectPartList.count(total_parts);
            }
        )
        .done();
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
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function createCloudResource(name, connection, cloudBucket) {
    logAction('createCloudResource', { name, connection, cloudBucket });

    api.pool.create_cloud_pool({
        name: name,
        connection: connection,
        target_bucket: cloudBucket
    })
        .then(
            () => notify(`Cloud resource ${name} created successfully`, 'success'),
            () => notify(`Cloud ${name} creation failed`, 'error')
        )
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function deleteCloudResource(name) {
    logAction('deleteCloudResource', { name });

    api.pool.delete_pool({ name })
        .then(
            () => notify(`Resource ${name} deleted successfully`, 'success'),
            () => notify(`Resource ${name} deletion failed`, 'error')
        )
        .then(() => action$.onNext(fetchSystemInfo()))
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
        .then(() => action$.onNext(fetchSystemInfo()))
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
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function setSystemDebugLevel(level){
    logAction('setSystemDebugLevel', { level });

    api.cluster_server.set_debug_level({ level })
        .then(() => action$.onNext(fetchSystemInfo()))
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
        .then(() => action$.onNext(fetchSystemInfo()))
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
        .then(() => action$.onNext(fetchSystemInfo()));
}

export function removeCloudSyncPolicy(bucket) {
    logAction('removeCloudSyncPolicy', { bucket });

    api.bucket.delete_cloud_sync({ name: bucket })
        .then(
            () => notify(`${bucket} cloud sync policy removed successfully`, 'success'),
            () => notify(`Removing ${bucket} cloud sync policy failed`, 'error')
        )
        .then(() => action$.onNext(fetchSystemInfo()));
}

export function toogleCloudSync(bucket, pause) {
    logAction('toogleCloudSync', { bucket, pause });

    api.bucket.toggle_cloud_sync({
        name: bucket,
        pause: pause
    })
        .then(
            () => notify(`${bucket} cloud sync has been ${pause ? 'paused' : 'resumed'}`, 'success'),
            () => notify(`${pause ? 'Pausing' : 'Resuming'} ${bucket} cloud sync failed`, 'error')
        )
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function checkCloudConnection(endpointType, endpoint, identity, secret) {
    logAction('checkCloudConnection', { endpointType, endpoint, identity, secret });

    const connection = {
        endpoint_type: endpointType,
        endpoint: endpoint,
        identity: identity,
        secret: secret
    };

    api.account.check_external_connection(connection)
        .then(val => model.isCloudConnectionValid(val === 'SUCCESS'))
        .done();
}

export function updateBucketS3Access(bucketName, allowedAccounts) {
    logAction('updateBucketS3Access', { bucketName, allowedAccounts });

    api.bucket.update_bucket_s3_access({
        name: bucketName,
        allowed_accounts: allowedAccounts
    })
        .then(
            () => notify(`${bucketName} S3 access control updated successfully`, 'success'),
            () => notify(`Updating ${bucketName} S3 access control failed`, 'error')
        )
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function enterMaintenanceMode(duration) {
    logAction('enterMaintenanceMode', { duration });

    api.system.set_maintenance_mode({ duration })
        .then(() => action$.onNext(fetchSystemInfo()))
        .then(
            () => setTimeout(
                () => action$.onNext(fetchSystemInfo()),
                (duration * 60 + 1) * 1000
            )
        )
        .done();
}

export function exitMaintenanceMode() {
    logAction('exitMaintenanceMode');

    api.system.set_maintenance_mode({ duration: 0 })
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function updatePhoneHomeConfig(proxyAddress) {
    logAction('updatePhoneHomeConfig', { proxyAddress });

    api.system.update_phone_home_config({ proxy_address: proxyAddress })
        .then(
            () => notify('Phone home proxy settings updated successfully', 'success'),
            () => notify('Updating phone home proxy settings failed', 'error')
        )
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function enableRemoteSyslog(protocol, address, port) {
    logAction ('enableRemoteSyslog', { protocol, address, port });

    api.system.configure_remote_syslog({ enabled: true, protocol, address, port })
        .then(
            () => notify('Remote syslog has been enabled', 'success'),
            () => notify('Enabling remote syslog failed', 'error')
        )
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function disableRemoteSyslog() {
    logAction ('disableRemoteSyslog');

    api.system.configure_remote_syslog({ enabled: false })
        .then(
            () => notify('Remote syslog has been disabled', 'success'),
            () => notify('Enabling remote syslog failed', 'error')
        )
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function attachServerToCluster(serverAddress, serverSecret, hostname, location) {
    logAction('attachServerToCluster', { serverAddress, serverSecret, hostname, location });

    const name = `${hostname}-${serverSecret}`;
    api.cluster_server.add_member_to_cluster({
        address: serverAddress,
        secret: serverSecret,
        role: 'REPLICA',
        shard: 'shard1',
        location: location || undefined,
        new_hostname: hostname || undefined
    })
        .then(
            () => notify(`Attaching ${name} to the cluster, this might take a few moments`, 'info'),
            () => notify(`Attaching ${name} to cluster failed`, 'error')
        )
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
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
        .then(() => action$.onNext(fetchSystemInfo()))
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
        .then(() => action$.onNext(refreshLocation()))
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
        .then(() => action$.onNext(fetchSystemInfo()))
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
        .then(() => action$.onNext(fetchSystemInfo()))
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
    action$.onNext(showNotification(message, severity));
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

export function dismissUpgradedCapacityNotification() {
    logAction('dismissUpgradedCapacityNotification');

    api.system.phone_home_capacity_notified()
        .then(() => action$.onNext(fetchSystemInfo()))
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
        .then(() => action$.onNext(fetchSystemInfo()))
        .done();
}

export function verifyServer(address, secret) {
    logAction('verifyServer', { address, secret });

    api.cluster_server.verify_candidate_join_conditions({ address, secret})
        .then(
            reply => model.serverVerificationState(
                Object.assign({ address, secret }, reply)
            )
        )
        .done();
}

export function registerForAlerts() {
    logAction('registerForAlerts');
    api.redirector.register_for_alerts();
}
