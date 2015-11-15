import template from './node-parts-table.html';
import ko from 'knockout';
import { node } from 'services/api';
import PartRowViewModel from './part-row';

const nodeName = 'nb-ohad-server-6e43a1f0-dcb1-4c9e-85d9-db45a151ca11';

class NodePartsTableViewModel {
	constructor() {
		this.rows = ko.observable([]);

		node.read_node_maps({ name: nodeName })
			.then(reply => this._mapInfoToRows(reply.objects))
			.then(this.rows)
			.done();		
	}

	_mapInfoToRows(objects) {
		return objects.reduce((list, object) => {
			let rows = object.parts.map( part => new PartRowViewModel(object.key, part) );
			list.push(...rows);
			return list;
		}, []);

	}
}

export default {
	viewModel: NodePartsTableViewModel,
	template: template
}