import { observable } from 'knockout';
import numeral from 'numeral';
import template from './pools-overview.html';

class PoolsOverviewViewModel {
	constructor() {
		this.poolCount = observable(40);
		this.nodeCount = observable(12801);
	}

	get poolCountText() {
		let formatted = numeral(this.poolCount()).format('0,0');
		return `${formatted} Pools`;
	}

	get nodeCountText() {
		let formatted = numeral(this.nodeCount()).format('0,0');
		return `${formatted} Buckets`;
	}
}

export default { 
	viewModel: PoolsOverviewViewModel,
	template: template
}
