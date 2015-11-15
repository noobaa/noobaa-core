import { updateAppState, readSystemInfo } from 'actions';

export default function BucketsHandler(route) {
	updateAppState({
		heading: 'Buckets',
		system: route.params.system,
		breadcrumbs: [ '/' ],
		panel: 'buckets'		
	})

	readSystemInfo();
}