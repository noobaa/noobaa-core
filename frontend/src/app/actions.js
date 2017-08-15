/* Copyright (C) 2016 NooBaa */

import * as model from 'model';
import page from 'page';
import api from 'services/api';
import config from 'config';
import * as routes from 'routes';
import JSZip from 'jszip';
import { last, makeArray, deepFreeze, flatMap } from 'utils/core-utils';
import { all, sleep, execInOrder } from 'utils/promise-utils';
import { getModeFilterFromState } from 'utils/ui-utils';
import { realizeUri, downloadFile, httpRequest, httpWaitForResponse, toFormData } from 'utils/browser-utils';
import { Buffer } from 'buffer';

// Action dispathers from refactored code.
import { action$ } from 'state';
import {
    fetchSystemInfo,
    signOut,
    showNotification,
    closeModal,
    requestLocation
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

export function refresh() {
    logAction('refresh');

    const { pathname, search } = window.location;

    // Refresh the current path
    page.redirect(pathname + search);
}

// -----------------------------------------------------
// High level UI update actions.
// -----------------------------------------------------
export function showLogin() {
    logAction('showLogin');

    loadServerInfo();
}

export function showObject() {
    logAction('showObject');

    const ctx = model.routeContext();
    const { object, bucket } = ctx.params;
    const { page = 0 } = ctx.query;

    loadObjectMetadata(bucket, object);
    loadObjectPartList(bucket, object, parseInt(page));
}

export function showPool() {
    logAction('showPool');

    const ctx = model.routeContext();
    const { pool } = ctx.params;
    const { filter, state, sortBy = 'name', order = 1, page = 0 } = ctx.query;
    const mode = state && getModeFilterFromState(state);

    loadPoolNodeList(pool, filter, mode, sortBy, parseInt(order), parseInt(page));
}

export function showNode() {
    logAction('showNode');

    const ctx = model.routeContext();
    const { node } = ctx.params;
    const { page = 0 } = ctx.query;

    loadNodeInfo(node);
    loadNodeStoredPartsList(node, parseInt(page));
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
    logAction('updateFuncCode', { name, version,});

    try {
        const { code = {} } = await api.func.read_func({
            name,
            version,
            read_code: true,
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

export function clearCompletedUploads() {
    model.uploads(
        model.uploads().filter(
            upload => !upload.completed
        )
    );
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
        // Guarantee a minimum time of at least 500ms before resuming execution.
        const [ config ] = await all(
            api.cluster_server.read_server_config({
                test_ph_connectivity: testPhonehomeConnectvity,
                ph_proxy: phonehomeProxy
            }),
            sleep(750)
        );

        serverInfo({
            initialized: false,
            address: endpoint,
            config: config
        });
    }
}

// REFACTOR: This action was refactored into  dispatcher + state action.
// This code will be removed after all referneces to modal.systemInfo will
// be refactored to use the state stream.
// ----------------------------------------------------------------------
export function loadSystemInfo() {
    logAction('loadSystemInfo');
    action$.onNext(fetchSystemInfo());
}

export function loadBucketObjectList(bucketName, filter, sortBy, order, page) {
    logAction('loadBucketObjectList', { bucketName, filter, sortBy, order, page });

    api.object.list_objects({
        bucket: bucketName,
        key_query: filter,
        sort: sortBy,
        order: order,
        skip: config.paginationPageSize * page,
        limit: config.paginationPageSize,
        pagination: true
    })
        .then(model.bucketObjectList)
        .done();
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

export function loadPoolNodeList(poolName, filter, mode, sortBy, order, page) {
    logAction('loadPoolNodeList', { poolName, filter, mode, sortBy, order, page });

    api.node.list_nodes({
        query: {
            pools: [ poolName ],
            filter: filter,
            mode: mode
        },
        sort: sortBy,
        order: order,
        skip: config.paginationPageSize * page,
        limit: config.paginationPageSize,
        pagination: true
    })
        .then(
            reply => model.poolNodeList(
                deepFreeze(reply)
            )
        )
        .done();
}

export function loadNodeList(filter, pools, onlyHealthy) {
    logAction('loadNodeList', { filter, pools, onlyHealthy });

    api.node.list_nodes({
        query: {
            filter: filter,
            pools: pools,
            online: onlyHealthy,
            has_issues: onlyHealthy ? false : undefined
        }
    })
        .then(
            ({ nodes }) => model.nodeList(nodes)
        )
        .done();
}

export function loadNodeInfo(nodeName) {
    logAction('loadNodeInfo', { nodeName });

    if (model.nodeInfo() && model.nodeInfo().name !== nodeName) {
        model.nodeInfo(null);
    }

    api.node.read_node({ name: nodeName })
        .then(model.nodeInfo)
        .done();
}

export function loadNodeStoredPartsList(nodeName, page) {
    logAction('loadNodeStoredPartsList', { nodeName, page });

    api.object.read_node_mappings({
        name: nodeName,
        skip: config.paginationPageSize * page,
        limit: config.paginationPageSize,
        adminfo: true
    })
        .then(
            ({ objects, total_count }) => ({
                total_count: total_count,
                parts: flatMap(
                    objects,
                    obj => obj.parts.map(
                        part => Object.assign(
                            {
                                object: obj.key,
                                bucket: obj.bucket
                            },
                            part
                        )
                    )
                )
            })
        )
        .then(model.nodeStoredPartList)
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
export function deleteAccount(email) {
    logAction('deleteAccount', { email });

    api.account.delete_account({ email })
        .then(
            () => {
                const user = model.sessionInfo() && model.sessionInfo().user;
                if (email === user) {
                    action$.onNext(signOut());
                } else {
                    loadSystemInfo();
                }
            }
        )
        .then(
            () => notify(`Account ${email} deleted successfully`, 'success'),
            () => notify(`Account ${email} deletion failed`, 'error')
        )
        .done();
}

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
        .then(loadSystemInfo)
        .done();
}

export function deleteBucket(name) {
    logAction('deleteBucket', { name });

    api.bucket.delete_bucket({ name })
        .then(
            () => notify(`Bucket ${name} deleted successfully`, 'success'),
            () => notify(`Bucket ${name} deletion failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function updateBucketPlacementPolicy(tierName, placementType, attachedPools) {
    logAction('updateBucketPlacementPolicy', { tierName, placementType, attachedPools });

    const bucket = model.systemInfo().buckets.find(
        bucket => bucket.tiering.tiers.find(
            entry => entry.tier === tierName
        )
    );

    api.tier.update_tier({
        name: tierName,
        data_placement: placementType,
        attached_pools: attachedPools
    })
        .then(
            () => notify(`${bucket.name} placement policy updated successfully`, 'success'),
            () => notify(`Updating ${bucket.name} placement policy failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function createPool(name, nodes) {
    logAction('createPool', { name, nodes });

    nodes = nodes.map(name => ({ name }));

    api.pool.create_nodes_pool({ name, nodes })
        .then(
            () => notify(`Pool ${name} created successfully`, 'success'),
            () => notify(`Pool ${name} creation failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function deletePool(name) {
    logAction('deletePool', { name });

    api.pool.delete_pool({ name })
        .then(
            () => notify(`Pool ${name} deleted successfully`, 'success'),
            () => notify(`Pool ${name} deletion failed`, 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function assignNodes(name, nodes) {
    logAction('assignNodes', { name, nodes });

    api.pool.assign_nodes_to_pool({
        name: name,
        nodes: nodes.map(name => ({ name }))
    })
        .then(
            () => notify(`${nodes.length} nodes has been assigend to pool ${name}`, 'success'),
            () => notify(`Assinging nodes to pool ${name} failed`, 'error')
        )
        .then(refresh)
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
        .then(loadSystemInfo)
        .done();
}

export function deleteCloudResource(name) {
    logAction('deleteCloudResource', { name });

    api.pool.delete_pool({ name })
        .then(
            () => notify(`Cloud resource ${name} deleted successfully`, 'success'),
            () => notify(`Cloud resource ${name} deletion failed`, 'error')
        )
        .then(loadSystemInfo)
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
                                        result.targetIp = ip;
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
        .then(loadSystemInfo)
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

export function upgradeSystem(upgradePackage) {
    logAction('upgradeSystem', { upgradePackage });

    const { upgradeStatus } = model;
    upgradeStatus({
        step: 'UPLOAD',
        progress: 0,
        state: 'IN_PROGRESS'
    });

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = function(evt) {
        upgradeStatus.assign({
            progress: evt.lengthComputable && evt.loaded / evt.total
        });
    };

    const payload = toFormData({ 'upgrade_file': upgradePackage });
    httpRequest('/upgrade', {  verb: 'POST', xhr, payload })
        .then(
            evt => {
                if (evt.target.status !== 200) {
                    throw evt;
                }

                upgradeStatus({
                    step: 'INSTALL',
                    progress: 1,
                    state: 'IN_PROGRESS'
                });
            }
        )
        .then(
            () => sleep(config.serverRestartWaitInterval)
        )
        .then(
            () => httpWaitForResponse('/version', 200)
        )
        .then(
            () => reloadTo(routes.system, undefined, { afterupgrade: true })
        )
        .catch(
            ({ type }) => upgradeStatus.assign({
                state: type === 'abort' ? 'CANCELED' : 'FAILED'
            })
        );
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
            evt => { if(evt.target.status !== 200) throw evt; }
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

export function downloadNodeDiagnosticPack(nodeName) {
    logAction('downloadDiagnosticFile', { nodeName });

    const currentNodeKey = `node:${nodeName}`;
    if(model.collectDiagnosticsState[currentNodeKey] === true) {
        return;
    }

    model.collectDiagnosticsState.assign({
        [currentNodeKey]: true
    });

    api.system.diagnose_node({ name: nodeName })
        .catch(
            err => {
                notify(`Packing diagnostic file for ${nodeName} failed`, 'error');
                model.collectDiagnosticsState.assign({
                    [currentNodeKey]: false
                });
                throw err;
            }
        )
        .then(
            url => {
                downloadFile(url);
                model.collectDiagnosticsState.assign({
                    [currentNodeKey]: false
                });
            }
        )
        .done();
}

export function downloadServerDiagnosticPack(secret, hostname) {
    logAction('downloadServerDiagnosticPack', { secret, hostname });

    const name = `${hostname}-${secret}`;
    const key = `server:${secret}`;
    if(model.collectDiagnosticsState[key]) {
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

    if(model.collectDiagnosticsState['system'] === true) {
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

export function setNodeDebugLevel(node, level) {
    logAction('setNodeDebugLevel', { node, level });

    api.node.read_node({ name: node })
        .then(
            node => api.node.set_debug_node({
                node: {
                    name: node.name
                },
                level: level
            })
        )
        .then(
            () => notify(
                `Debug mode was turned ${level === 0 ? 'off' : 'on'} for node ${node}`,
                'success'
            ),
            () => notify(
                `Could not turn ${level === 0 ? 'off' : 'on'} debug mode for node ${node}`,
                'error'
            )
        )
        .then(
            () => loadNodeInfo(node)
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
        .then(loadSystemInfo)
        .done();
}

export function setSystemDebugLevel(level){
    logAction('setSystemDebugLevel', { level });

    api.cluster_server.set_debug_level({ level })
        .then(loadSystemInfo)
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
        .then(loadSystemInfo)
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
        .then(loadSystemInfo);
}

export function removeCloudSyncPolicy(bucket) {
    logAction('removeCloudSyncPolicy', { bucket });

    api.bucket.delete_cloud_sync({ name: bucket })
        .then(
            () => notify(`${bucket} cloud sync policy removed successfully`, 'success'),
            () => notify(`Removing ${bucket} cloud sync policy failed`, 'error')
        )
        .then(loadSystemInfo);
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
        .then(loadSystemInfo)
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

export function loadBucketS3ACL(bucketName) {
    logAction('loadBucketS3ACL', { bucketName });

    api.bucket.list_bucket_s3_acl({
        name: bucketName
    })
        .then(model.bucketS3ACL)
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
        .then(loadSystemInfo)
        .done();
}

export function enterMaintenanceMode(duration) {
    logAction('enterMaintenanceMode', { duration });

    api.system.set_maintenance_mode({ duration })
        .then(loadSystemInfo)
        .then(
            () => setTimeout(
                loadSystemInfo,
                (duration * 60 + 1) * 1000
            )
        )
        .done();
}

export function exitMaintenanceMode() {
    logAction('exitMaintenanceMode');

    api.system.set_maintenance_mode({ duration: 0 })
        .then(loadSystemInfo)
        .done();
}

export function updatePhoneHomeConfig(proxyAddress) {
    logAction('updatePhoneHomeConfig', { proxyAddress });

    api.system.update_phone_home_config({ proxy_address: proxyAddress })
        .then(
            () => notify('Phone home proxy settings updated successfully', 'success'),
            () => notify('Updating phone home proxy settings failed', 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function enableRemoteSyslog(protocol, address, port) {
    logAction ('enableRemoteSyslog', { protocol, address, port });

    api.system.configure_remote_syslog({ enabled: true, protocol, address, port })
        .then(
            () => notify('Remote syslog has been enabled', 'success'),
            () => notify('Enabling remote syslog failed', 'error')
        )
        .then(loadSystemInfo)
        .done();
}

export function disableRemoteSyslog() {
    logAction ('disableRemoteSyslog');

    api.system.configure_remote_syslog({ enabled: false })
        .then(
            () => notify('Remote syslog has been disabled', 'success'),
            () => notify('Enabling remote syslog failed', 'error')
        )
        .then(loadSystemInfo)
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
        .then(loadSystemInfo)
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
        .then(loadSystemInfo)
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
        .then(() => sleep(config.serverRestartWaitInterval))
        .then(() => httpWaitForResponse('/version', 200))
        .then(reload)
        .catch(() => {
            action$.onNext(closeModal());
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
        .then(loadSystemInfo)
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
        .then(loadSystemInfo)
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
    logAction('notify', { message, severity });

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
        server_name: name
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
        .then(loadSystemInfo)
        .done();
}

export function decommissionNode(name) {
    logAction('decommissionNode', { name });

    api.node.decommission_node({ name })
        .then(
            () => notify(`Node ${name} deactivated successfully`, 'success'),
            () => notify(`Deactivating node ${name} failed`, 'error')
        )
        .then(refresh)
        .done();
}

export function recommissionNode(name) {
    logAction('recommissionNode', { name });

    api.node.recommission_node({ name })
        .then(
            () => notify(`Node ${name} activated successfully`, 'success'),
            () => notify(`Activating node ${name} failed`, 'error')
        )
        .then(refresh)
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
        .then(loadSystemInfo)
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

// ------------------------------------------
// Helper functions:
// ------------------------------------------
// DONT REMOVE THIS CODE - IT IS A NOTIFICAITON CODE WE NEED TO TRANSFER
// TO THE NEW ARCHITCTURE.
// function notifyUploadCompleted(uploaded, failed) {
//     if (failed === 0) {
//         notify(
//             `Uploading ${stringifyAmount('file', uploaded)} completed successfully`,
//             'success'
//         );

//     } else if (uploaded === 0) {
//         notify(
//             `Uploading ${stringifyAmount('file', failed)} failed`,
//             'error'
//         );

//     } else {
//         notify(
//             `Uploading completed. ${
//                 stringifyAmount('file', uploaded)
//             } uploaded successfully, ${
//                 stringifyAmount('file', failed)
//             } failed`,
//             'warning'
//         );
//     }
// }
