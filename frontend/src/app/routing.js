import overviewHandler from 'route-handlers/overview';
import bucketsHandler from 'route-handlers/buckets';
import bucketHandler from 'route-handlers/bucket';

export default function routing(router) {
	router
		.add('/:system', overviewHandler)
		.add('/:system/buckets', bucketsHandler)
		.add('/:system/buckets/:bucket', bucketHandler)
		// .add('/:system/nodes/:node', { panel: 'node' })
		.redircet('*', '/demo')

}	