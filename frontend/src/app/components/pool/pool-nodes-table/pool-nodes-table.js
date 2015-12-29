import template from './pool-nodes-table.html';
import ko from 'knockout';
import { paginationPageSize as pageSize } from 'config';
import { makeArray} from 'utils';
import NodeRowViewModel from './node-row';

class PoolNodesTableViewModel {
	constructor({ nodes }) {
		this.rows = makeArray(
			pageSize,
			i => new NodeRowViewModel(() => nodes()[i])
		);
	}
}

export default {
	viewModel: PoolNodesTableViewModel,
	template: template,
}