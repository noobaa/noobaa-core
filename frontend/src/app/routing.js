import OverviewState from 'states/overview-state';

export default function routing(router) {
	router
		.add('/:system', { panel: 'buckets' })
		.add('/:system')
		.redircet('*', '/demo')

}