import * as model from 'model';
import page from 'page';
import api from 'services/api';
import config from 'config';
import { hostname as endpoint } from 'server-conf';
import { isDefined, isUndefined, encodeBase64, cmpStrings, cmpInts, cmpBools, randomString, last } from 'utils';

// TODO: resolve browserify issue with export of the aws-sdk module.
// The current workaround use the AWS that is set on the global window object.
import 'aws-sdk';
AWS = window.AWS;

// Compare functions for entities.
const bucketCmpFuncs = Object.freeze({
	state: (b1, b2) => cmpBools(b1.state, b2.state),
	name: (b1, b2) => cmpStrings(b1.name, b2.name),
	filecount: (b1, b2) => cmpInts(b1.num_objects, b2.num_objects),
	totalsize: (b1, b2) => cmpInts(b1.storage.total, b2.storage.total),
	freesize: (b1, b2) => cmpInts(b1.storage.free, b2.storage.free),
	cloudsync: (b1, b2) => cmpStrings(b1.cloud_sync_status, b2.cloud_sync_status)
});

const poolCmpFuncs = Object.freeze({
	state: (p1, p2) => cmpBools(true, true),
	name: (p1, p2) => cmpStrings(p1.name, p2.name),
	nodecount: (p1, p2) => cmpInts(p1.total_nodes, p2.total_nodes),
	onlinecount: (p1, p2) => cmpInts(p1.online_nodes, p2.online_nodes),
	offlinecount: (p1, p2) => cmpInts(
		p1.total_nodes - p1.online_nodes, 
		p2.total_nodes - p2.online_nodes, 
	),
	usage: (p1, p2) => cmpInts(p1.storage.used, p2.storage.used),
	capacity: (p1, p2) => cmpInts(p1.storage.total, p2.storage.total),
});

// Utility function to log actions.
function logAction(action, payload) {
	if (typeof payload !== 'undefined') {
		console.info(`action dispatched: ${action} with`, payload);
	} else {
		console.info(`action dispatched: ${action}`);
	}
}

// -----------------------------------------------------
// Applicaiton start action
// -----------------------------------------------------
export function start() {
	logAction('start');
	
	api.options.auth_token = localStorage.getItem('sessionToken');
	api.auth.read_auth()
		// Try to restore the last session
		.then(({account, system}) => {
			if (isDefined(account)) {
				model.sessionInfo({ 
					user: account.email, 
					system: system.name 
				});
			} 
		})
		// Start the router.
		.then(() => page.start())
		.done();
}

// -----------------------------------------------------
// High level UI update actions. 
// -----------------------------------------------------
export function showLogin() {
	logAction('showLogin');

	let session = model.sessionInfo();
	let ctx = model.routeContext();

	if (!!session) {
		page.redirect(`/fe/systems/${session.system}`);

	} else {
		model.uiState({ 
			layout: 'login-layout', 
			returnUrl: ctx.query.returnUrl,
		});

		readServerInfo();
	}
}	

export function showOverview() {
	logAction('showOverview');

	model.uiState({
		layout: 'main-layout',
		title: 'OVERVIEW',
		breadcrumbs: [], 
		panel: 'overview'	
	});

	readSystemInfo();
}

export function showBuckets() {
	logAction('showBuckets');	

	model.uiState({
		layout: 'main-layout',
		title: 'BUCKETS',
		breadcrumbs: [ { href: "fe/systems/:system" } ],
		panel: 'buckets',
	});

	let query = model.routeContext().query;
	model.bucketList.sortedBy(query.sortBy || 'name');
	model.bucketList.order(query.order < 0 ? -1 : 1);
	
	readSystemInfo();
}

export function showBucket() {
	logAction('showBucket');

	let ctx = model.routeContext();
	let { bucket, tab = 'objects' } = ctx.params;
	let { filter, sortBy = 'name', order = 1, page = 0 } = ctx.query;

	model.uiState({
		layout: 'main-layout',
		title: bucket,
		breadcrumbs: [
			{ href: "fe/systems/:system" },
			{ href: "buckets", label: "BUCKETS" },
		],
		panel: 'bucket',
		tab: tab
	});

	readBucket(bucket);
	listBucketObjects(bucket, filter, sortBy, parseInt(order), parseInt(page));		
}

export function showObject() {
	logAction('showObject');
	
	let ctx = model.routeContext();
	let { object, bucket, tab = 'parts' } = ctx.params;
	let { page = 0 } = ctx.query;

	model.uiState({
		layout: 'main-layout',
		title: object,
		breadcrumbs: [
			{ href: "fe/systems/:system" },
			{ href: "buckets", label: "BUCKETS" },
			{ href: ":bucket", label: bucket },
		],			
		panel: 'object',
		tab: tab
	});

	readObjectMetadata(bucket, object)
	listObjectParts(bucket, object, parseInt(page));
}

export function showPools() {
	logAction('showPools');

	model.uiState({
		layout: 'main-layout',
		title: 'POOLS',
		breadcrumbs: [ { href: "fe/systems/:system" } ],
		panel: 'pools'
	});

	let query = model.routeContext().query;
	model.poolList.sortedBy(query.sortBy || 'name');
	model.poolList.order(query.order < 0 ? -1 : 1);

	readSystemInfo();
	listAllNodes();
}

export function showPool() {
	logAction('showPool');

	let ctx = model.routeContext();
	let { pool, tab = 'nodes' } = ctx.params;
	let { filter, sortBy = 'name', order = 1, page = 0 } = ctx.query;

	
	model.uiState({
		layout: 'main-layout',
		title: pool,
		breadcrumbs: [ 
			{ href: "fe/systems/:system" },
			{ href: "pools", label: "POOLS"}
		],
		panel: 'pool',
		tab: tab
	});

	readPool(pool);
	listPoolNodes(pool, filter, sortBy, parseInt(order), parseInt(page));
}

export function showNode() {
	logAction('showNode');

	let ctx = model.routeContext();
	let { pool, node, tab = 'parts' } = ctx.params;
	let { page = 0 } = ctx.query;

	model.uiState({
		layout: 'main-layout',
		title: node,
		breadcrumbs: [
			{ href: "fe/systems/:system" },
			{ href: "pools", label: "POOLS"},
			{ href: ":pool", label: pool}
		],
		panel: 'node',
		tab: tab
	});

	readNode(node);
	listNodeStoredParts(node, parseInt(page));		
}	

export function showManagement() {
	logAction('showManagement');

	let { tab = 'accounts' } = model.routeContext().params;

	model.uiState({
		layout: 'main-layout',
		title: 'SYSTEM MANAGEMENT',
		breadcrumbs: [ { href: "fe/systems/:system" } ],
		panel: 'management',
		tab: tab
	});
}

export function refresh() {
	logAction('refresh');

	let { pathname, search } = window.location;
	page.redirect(pathname + search);
}

export function openAuditLog() {
	logAction('openAuditLog');

	model.uiState(
		Object.assign(model.uiState(), { 
			tray: { componentName: 'audit-pane' }
		})
	);
}

export function closeTray() {
	logAction('closeTray');

	model.uiState(
		Object.assign(model.uiState(), { tray: null })
	);
}

// -----------------------------------------------------
// Sign In/Out actions.
// -----------------------------------------------------
export function signIn(email, password, redirectTo) {
	logAction('signIn', { email, password, redirectTo });

	api.create_auth_token({ email, password })
		.then(() => api.system.list_systems())
		.then(
			({ systems }) => {
				let system = systems[0].name;

				return api.create_auth_token({ system, email, password })
					.then(({ token }) => {
						localStorage.setItem('sessionToken', token);
						
						model.sessionInfo({ user: email, system: system })
						model.loginInfo({ retryCount: 0 });

						if (isUndefined(redirectTo)) {
							redirectTo = `/fe/systems/${system}`;
						}

						page.redirect(decodeURIComponent(redirectTo));
					})
			}
		)
		.catch(
			err => {
				if (err.rpc_code === 'UNAUTHORIZED') {
					model.loginInfo({
						retryCount: model.loginInfo().retryCount + 1
					});

				} else {
					throw err;
				}
			}
		)
		.done();
}

export function signOut() {
	localStorage.removeItem('sessionToken');
	model.sessionInfo(null);
	refresh();
}

// -----------------------------------------------------
// Information retrieval actions.
// -----------------------------------------------------
export function readServerInfo() {
	api.account.accounts_status()
		.then(
			reply => model.serverInfo({
				endpoint: endpoint || window.location.hostname,
				initialized: reply.has_accounts
			})
		)
		.done();
}

export function readSystemInfo() {
	logAction('readSystemInfo');

	let { systemOverview, agentInstallationInfo, bucketList, poolList } = model;
	api.system.read_system()
		.then(
			reply => {
				let keys = reply.access_keys[0];

				systemOverview({
					endpoint: endpoint,
					keys: {
						access: keys.access_key,
						secret: keys.secret_key,
					},
					capacity: reply.storage.total,
					bucketCount: reply.buckets.length,
					objectCount: reply.objects,
					poolCount: reply.pools.length,
					nodeCount: reply.nodes.count,
					onlineNodeCount: reply.nodes.online,
					offlineNodeCount: reply.nodes.count - reply.nodes.online
				});

				agentInstallationInfo({
					agentConf: encodeBase64({
		                address: reply.base_address,
		                system: reply.name,
		                access_key: keys.access_key,
		                secret_key: keys.secret_key,
		                tier: 'nodes',
		                root_path: './agent_storage/'
		            }),
					downloadUris: {
						windows: reply.web_links.agent_installer,
						linux: reply.web_links.linux_agent_installer
					}
				});

				bucketList(reply.buckets);
				bucketList.sort(
					(b1, b2) => bucketList.order() * bucketCmpFuncs[bucketList.sortedBy()](b1, b2)
				);

				poolList(reply.pools);
				poolList.sort(
					(p1, p2) => poolList.order() * poolCmpFuncs[poolList.sortedBy()](p1, p2)
				);
			}
		)
		.done();
}

export function readBucket(name) {
	logAction('readBucket', { name });

	api.bucket.read_bucket({ name })
		.then(model.bucketInfo)
		.done();
}

export function readBucketPolicy(name) {
	logAction('readBucketPolicy', { name });

	model.bucketPolicy(null);
	api.tiering_policy.read_policy({ name })
		.then(model.bucketPolicy)
		.done();
}

export function listBucketObjects(bucketName, filter, sortBy, order, page) {
	logAction('listBucketObjects', { bucketName, filter, sortBy, order, page });

	let bucketObjectList = model.bucketObjectList;

	api.object.list_objects({ 
			bucket: bucketName,
			key_query: filter,
			sort: sortBy,
			order: order,
			skip: config.paginationPageSize * page,
			limit: config.paginationPageSize,
			pagination: true
		})
		.then(
			reply => {
				bucketObjectList.sortedBy(sortBy);
				bucketObjectList.filter(filter);
				bucketObjectList.order(order);
				bucketObjectList.page(page);
				bucketObjectList.count(reply.total_count);
				bucketObjectList(reply.objects);
			}
		) 
		.done();
}

export function readObjectMetadata(bucketName, objectName) {
	logAction('readObjectMetadata', { bucketName, objectName });

	// Drop previous data if of diffrent object.
	if (!!model.objectInfo() && model.objectInfo().name !== objectName) {
		model.objectInfo(null);
	}

	let objInfoPromise = api.object.read_object_md({
		 bucket: bucketName, 
		 key: objectName,
		 get_parts_count: true
	});

	let S3Promise = api.system.read_system()
		.then(
			reply => {
				let { access_key, secret_key } = reply.access_keys[0];

				return new AWS.S3({
				    endpoint: reply.ip_address,
				    credentials: {
				    	accessKeyId:  access_key,
				    	secretAccessKey:  secret_key
				    },
				    s3ForcePathStyle: true,
				    sslEnabled: false,
				})
			}
		);

	Promise.all([objInfoPromise, S3Promise])
		.then(
			([objInfo, s3]) => model.objectInfo({ 
				name: objectName, 
				bucket: bucketName,
				info: objInfo,				
				s3Url: s3.getSignedUrl(
					'getObject', 
					{ Bucket: bucketName, Key: objectName }
				)
			})
		);
}

export function listObjectParts(bucketName, objectName, page) {
	logAction('listObjectParts', { bucketName, objectName, page });

	api.object.read_object_mappings({ 
		bucket: bucketName, 
		key: objectName, 
		skip: config.paginationPageSize * page,
		limit: config.paginationPageSize,
		adminfo: true 
	})
		.then(
			reply => {
				model.objectPartList(reply.parts);
				model.objectPartList.page(page);

				// TODO: change to real count when avaliable.
				model.objectPartList.count(1000);				
			}
		)
		.done();
}

export function readPool(name) {
	logAction('readPool', { name });

	if (model.poolInfo() && model.poolInfo().name !== name) {
		model.poolInfo(null);
	}

	api.pool.read_pool({ name })
		.then(model.poolInfo)
		.done();
}

export function listPoolNodes(poolName, filter, sortBy, order, page) {
	logAction('listPoolNodes', { poolName, filter, sortBy, order, page });
	
	api.node.list_nodes({  
		query: {
			pool: [ poolName ],
			name: filter
		},
		sort: sortBy,
		order: order,
		skip: config.paginationPageSize * page,
		limit: config.paginationPageSize,
		pagination: true
	})
		.then(
			reply => {
				model.poolNodeList(reply.nodes);
				model.poolNodeList.count(reply.total_count);				
				model.poolNodeList.filter(filter);
				model.poolNodeList.sortedBy(sortBy);
				model.poolNodeList.order(order);
				model.poolNodeList.page(page)
			}
		)
		.done();
}

export function listAllNodes() {
	logAction('listAllNodes');

	api.node.list_nodes({})
		.then(
			reply => model.nodeList(reply.nodes)
		)
		.done();
}

export function readNode(nodeName) {
	logAction('readNode', { nodeName });

	if (model.nodeInfo() && model.nodeInfo().name !== nodeName) {
		model.nodeInfo(null);
	}


	api.node.read_node({ name: nodeName })
		.then(model.nodeInfo)
		.done();
}

export function listNodeStoredParts(nodeName, page) {
	logAction('listNodeStoredParts', { nodeName, page });

	api.node.read_node_maps({ name: nodeName })
		.then(
			reply => {
				let parts = reply.objects
					.map(
						obj => obj.parts.map(
							part => {
								return {
									object: obj.key,
									bucket: obj.bucket,
									info: part
								}
							}
						)
					)
					.reduce(
						(list, objParts) => {
							list.push(...objParts);
							return list;
						},
						[]
					);

				// TODO: change to server side paganation when avaliable.

				let pageParts = parts.slice(
					config.paginationPageSize * page,
					config.paginationPageSize * (page + 1),
				);

				let partsCount = parts.length;

				model.nodeStoredPartList(pageParts);
				model.nodeStoredPartList.page(page);
				model.nodeStoredPartList.count(partsCount);
			}
		)
		.done();
}

// -----------------------------------------------------
// Managment actions.
// -----------------------------------------------------
export function createSystemAccount(systemName, email, password, dnsName) {
	logAction('createSystemAccount', { systemName, email, password, dnsName });

	api.account.create_account({ name: systemName, email: email, password: password })
		.then(
			({ token }) => {
				api.options.auth_token = token;
				localStorage.setItem('sessionToken', token);
				model.sessionInfo({ user: email, system: systemName});
			}
		)
		.then(
			() => {
				if (dnsName) {
					return api.system.update_base_address({
						base_address: dnsName
					});

				} else {
					return Promise.when(true);
				}
			}
		)
		.then(
			() => page.redirect(`/fe/systems/${systemName}`)
		)
		.done();
}

export function createAccount(name, email, password) {
	logAction('createAccount', { name, email, password });

	let accountList = model.accountList;

	api.account.create_account({ name, email, password })
		.then(
			({ token }) => {
				api.options.auth_token = token;
				localStorage.setItem('sessionToken', token);
				model.sessionInfo({ user: email, system: system});
			}
		)
		.then(
			() => {
				if (dnsName) {
					return api.system.update_base_address({
						base_address: dnsName
					});

				} else {
					return Promise.when(true);
				}
			}
		)
		.done();	
}

export function createBucket(name, dataPlacement, pools) {
	logAction('createBucket', { name, dataPlacement, pools });

	let placeholder = { name: name, placeholder: true };
	model.bucketList.unshift(placeholder);

	api.tier.create_tier({ 
		name: randomString(8),
		data_placement: dataPlacement,
		pools: pools
	})
		.then(
			tier => {
				let policy = {
					// TODO: remove the random string after patching the server
					// with a delete bucket that deletes also the policy
					name: `${name}_tiering_${randomString(5)}`,
					tiers: [ { order: 0, tier: tier.name } ]
				};

				return api.tiering_policy.create_policy({ policy })
					.then(() => policy)
			}
		)
		.then(
			policy => api.bucket.create_bucket({ 
				name: name, 
				tiering: policy.name  
			})
		)
		.then(
			bucket => model.bucketList.replace(placeholder, bucket)
		)
		.done();
}

export function deleteBucket(name) {
	logAction('deleteBucket', { name });

	api.bucket.delete_bucket({ name })
		.then(readSystemInfo)
		.done();
}

export function updateTier(name, dataPlacement, pools) {
	logAction('updateTier', { name, dataPlacement, pools });

	api.tier.update_tier({ 
		name: name,
		data_placement: dataPlacement,
		pools: pools
	})
		.done();
}

export function createPool(name, nodes) {
	logAction('createPool', { name, nodes });

	let placeholder = { name: name, placeholder: true };
	model.poolList.unshift(placeholder);

	api.pool.create_pool({
		pool: { name, nodes }
	})
		.then(
			() => readSystemInfo()
		)
		.done();
}

export function uploadFiles(bucketName, files) {
	logAction('uploadFiles', { bucketName, files });
	
	let recentUploads = model.recentUploads;
	api.system.read_system()
		.then(
			reply => {
				let { access_key, secret_key } = reply.access_keys[0];

				return new AWS.S3({
				    endpoint: reply.ip_address,
				    credentials: {
				    	accessKeyId:  access_key,
				    	secretAccessKey:  secret_key
				    },
				    s3ForcePathStyle: true,
				    sslEnabled: false,
				})
			}
		)
		.then(
			s3 => {
				let uploadRequests = Array.from(files).map(
					file => new Promise(
						(resolve, reject) => {
							// Create an entry in the recent uploaded list.
							let entry = {
								name: file.name,
								state: 'UPLOADING',
								progress: 0,
								error: null
							};
							recentUploads.unshift(entry);

							// Start the upload.
							s3.upload(
								{
									Key: file.name,
									Bucket: bucketName,
									Body: file,
									ContentType: file.type
								}, 
								error => {
									if (!error) {
										entry.state = 'COMPLETED';
										entry.progress = 1;
										resolve(1);

									} else {
										entry.state = 'FAILED';
										entry.error = error;
										
										// This is not a bug we want to resolve failed uploads
										// in order to finalize the entire upload process.
										resolve(0);
									}

									// Use replace to trigger change event.
									recentUploads.replace(entry, entry);
								}
							)
							//	Report on progress.
							.on('httpUploadProgress', 
								({ loaded, total }) => {
									entry.progress = loaded / total;

									// Use replace to trigger change event.
									recentUploads.replace(entry, entry);
								}
							);
						}
					)
				);

				return Promise.all(uploadRequests);
			}
		)
		.then(
			results => results.reduce(
				(sum, result) => sum += result
			)
		)
		.then(
			completedCount => {
				console.log('herer', completedCount);
				completedCount > 0 && refresh()
			}
		);
}

export function loadAuditEntries(categories, count) {
	logAction('loadAuditEntries', { categories, count });

	let auditLog = model.auditLog;
	let filter = categories
		.map(
			category => `(^${category}.)`
		)
		.join('|');

	if (filter !== '') {
		api.system.read_activity_log({
			event: filter || '^$',
			limit: count
		})
			.then(
				reply => {
					auditLog(reply.logs.reverse());
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

	let auditLog = model.auditLog;
	let lastEntryTime = last(auditLog()).time;
	let filter = model.auditLog.loadedCategories()
		.map(
			category => `(^${category}.)` 
		)
		.join('|');

	if (filter !== '') {
		api.system.read_activity_log({
			event: filter,
			till: lastEntryTime,
			limit: count 
		})
			.then(
				reply => auditLog.push(...reply.logs.reverse())
			)
			.done()
	}
}

export function loadAccountList() {
	logAction('loadAccountList');

	api.account.list_system_accounts()
		.then(
			reply => model.accountList(reply.accounts)
		)
		.done()
}