import { updateAppState, readBucket, listObjects } from 'actions';

export default function BucketHandler(route) {
	updateAppState({
		system: route.params.system,
		heading: 'bucket',
		breadcrumbs: [ '/', 'buckets' ],
		panel: 'bucket'
	});

	let bucketName = route.params.bucket;
	readBucket(bucketName);
	listObjects(bucketName);
}	