import * as model from 'model';
import { isDefined, isUndefined } from 'utils';
import page from 'page';
import api from 'services/api';

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
				model.sessionInfo({ user: account.email, system: system.name });
			} 
		})
		// Start the router.
		.then(() => page.start())
		.done();
}

// -----------------------------------------------------
// High level UI update actions (given routing context). 
// -----------------------------------------------------
export function showLogin(ctx) {
	logAction('showLogin', ctx);

	let session = model.sessionInfo();
	if (session) {
		page.redirect(`/systems/${session.system}`);

	} else {
		model.uiState({ 
			layout: 'login-layout', 
			returnUrl: ctx.query.returnUrl 
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
		breadcrumbs: [ { href: "systems/:system" } ],
		panel: 'buckets'	
	});

	readSystemInfo();
}

export function showBucket() {
	logAction('showBucket');

	let ctx = model.routeContext();
	let { bucket, tab } = ctx.params;
	let { objFilter } = ctx.query;

	model.uiState({
		layout: 'main-layout',
		title: bucket,
		breadcrumbs: [
			{ href: "systems/:system" },
			{ href: "buckets", label: "BUCKETS" },
		],
		panel: 'bucket',
		tab: tab || 'objects'
	});

	readBucket(bucket);
	listBucketObjects(bucket, objFilter);		
}

export function showObject() {
	logAction('showObject');
	
	let { object, bucket, tab } = model.routeContext().params;

	model.uiState({
		layout: 'main-layout',
		title: object,
		breadcrumbs: [
			{ href: "systems/:system" },
			{ href: "buckets", label: "BUCKETS" },
			{ href: ":bucket", label: bucket },
		],			
		panel: 'object',
		tab: tab || 'parts'
	});

	readObjectMetadata(bucket, object)
	listObjectParts(bucket, object);
}

export function showPools() {
	logAction('showPools');

	model.uiState({
		layout: 'main-layout',
		title: 'POOLS',
		breadcrumbs: [ { href: "systems/:system" } ],
		panel: 'pools'		
	});

	readSystemInfo();
}

export function showPool() {
	logAction('showPool');

	let { pool, tab } = model.routeContext().params;
	model.uiState({
		layout: 'main-layout',
		title: pool,
		breadcrumbs: [ { href: "systems/:system" } ],
		panel: 'pools',
		tab: tab || 'nodes'	
	});
}

export function showNode() {
	logAction('showNode');

	let { node, tab } = model.routeContext().params;
	model.uiState({
		layout: 'main-layout',
		title: node,
		breadcrumbs: [],
		panel: 'node',
		tab: tab || 'parts'
	});

	readNode(node);
	listNodeObjects(node);		
}	

export function refresh() {
	logAction('refresh');
}

// -----------------------------------------------------
// Sign In/Out actions.
// -----------------------------------------------------
export function signIn(email, password, redirectTo) {
	logAction('signIn', { email, password, redirectTo });

	api.create_auth_token({ email, password })
		.then(() => api.system.list_systems())
		.then(({ systems }) => {
			let system = systems[0].name;

			api.create_auth_token({ system, email, password })
				.then(({ token }) => {
					localStorage.setItem('sessionToken', token);
					
					model.sessionInfo({ user: email, system: system })

					if (isUndefined(redirectTo)) {
						redirectTo = `/systems/${system}`;
					}

					page.redirect(decodeURIComponent(redirectTo));
				})
		})
		.catch(err => {
			if (err.rpc_code !== 'UNAUTHORIZED') {
				throw err;
			}
		})
		.done();
}

export function signOut() {
	localStorage.setItem('sessionToken', token);
	model.sessionInfo(null);
}

// -----------------------------------------------------
// Information retrieval actions.
// -----------------------------------------------------
export function readServerInfo() {
	api.account.accounts_status()
		.then(reply => model.serverInfo({
			initialized: reply.has_accounts
		}))
		.done();
}

export function readSystemInfo() {
	logAction('readSystemInfo');

	let { systemOverview, bucketList, poolList } = model;
	api.system.read_system()
		.then(reply => {
			systemOverview({
				bucketCount: reply.buckets.length,
				objectCount: reply.objects,
				poolCount: 1000, // TODO: change to reply.pools.length, when avaliable
				nodeCount: reply.nodes.count
			});

			bucketList(reply.buckets);
			poolList(reply.pools);

			console.log(reply)
		})
		.done();
}

export function readBucket(name) {
	logAction('readBucket', { name });

	api.bucket.read_bucket({ name })
		.then(model.bucketInfo)
		.done();
}

export function listBucketObjects(bucketName, filter) {
	logAction('listBucketObjects', { bucketName, filter });

	api.object.list_objects({ bucket: bucketName, key_query: filter })
		.then(reply => {
			model.bucketObjectList.filter(filter);
			model.bucketObjectList(reply.objects);
		})
		.done();
}

export function readObjectMetadata(bucketName, objectName) {
	api.object.read_object_md({ bucket: bucketName, key: objectName })
		.then(reply => model.objectInfo({ name: objectName, info: reply }))
		.done();
}

export function listObjectParts(bucketName, objectName) {
	logAction('listObjectParts', { bucketName, objectName });

	api.object.read_object_mappings({ bucket: bucketName, key: objectName, adminfo: true })
		.then(reply => model.objectPartList(reply.parts))
		.done();
}

export function readNode(nodeName) {
	logAction('readNode', { nodeName });

	api.node.read_node({ name: nodeName })
		.then(reply => model.nodeInfo(reply))
		.done();
}

export function listNodeObjects(nodeName) {
	logAction('readNode', { nodeName });

	api.node.read_node_maps({ name: nodeName })
		.then(relpy => model.nodeObjectList(relpy.objects))
		.done();
}

// -----------------------------------------------------
// Managment actions.
// -----------------------------------------------------
export function createAccount(system, email, password) {
	logAction('createAccount', { system, email, password });

	api.account.create_account({ name: system, email: email, password: password })
		.then(({ token }) => {
			api.options.auth_token = token;
			localStorage.setItem('sessionToken', token);
			model.sessionInfo({ user: email, system: system});

			page.redirect(`/systems/${system}`);
		})
		.done();
}

export function deleteBucket(name) {
	logAction('deleteBucket', { name });

	api.bucket.delete_bucket({ name })
		.then(readSystemInfo)
		.done();
}







