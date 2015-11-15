import * as stores from 'stores';
import api from 'services/api';

function logAction(action, payload) {
	if (typeof payload !== 'undefined') {
		console.info(`action dispatched: ${action} with`, payload);
	} else {
		console.info(`action dispatched: ${action}`);
	}
}

export function updateAppState(state) {
	logAction('updateAppState', { state });

	stores.appState(state);
}

export function readSystemInfo() {
	logAction('readSystemInfo');

	api.system.read_system()
		.then(stores.systemInfo)
		.done();
}

export function deleteBucket(name) {
	logAction('deleteBucket', { name });

	api.bucket.delete_bucket({ name })
		.then(readSystemInfo)
		.done();
}

export function readBucket(name) {
	logAction('readBucket', { name });

	api.bucket.read_bucket({ name })
		.then(stores.bucketInfo)
		.done();
}

export function listObjects(bucketName) {
	logAction('listObjects', { bucketName });

	stores.objectList([]);
	api.object.list_objects({ bucket: bucketName })
		.then(reply => stores.objectList(reply.objects))
		.done();
}