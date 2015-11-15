import { updateAppState, readSystemInfo } from 'actions';

export default function OverviewHandler(route) {
	updateAppState({
		system: route.params.system,
		heading: 'Overview',
		breadcrumbs: [],
		panel: 'overview'
	});

	readSystemInfo();
}