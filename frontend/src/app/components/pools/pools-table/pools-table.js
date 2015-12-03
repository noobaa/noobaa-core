import template from './pools-table.html';
import PoolRowViewModel from './pool-row';

class PoolsTableViewModel {
	constructor({ pools }) {
		this.rows = pools.map(
			bucket => new PoolRowViewModel(bucket)
		);

		this.rows = [];		
	}
}

export default {
	viewModel: PoolsTableViewModel,
	template: template
} 