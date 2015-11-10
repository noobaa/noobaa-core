import template from './node-parts-table.html';
import ko from 'knockout';
import api from 'services/api';
import PartRowViewModel from './part-row';

class NodePartsTableViewModel {
	constructor() {
		this.rows = ko.observable([]);
		this._fillRows();
	}

	_fillRows() {
		api.read_node_maps({
			name: 'Nimrods-MacBook-Air.local-fe61d7e7-6b66-4e6c-aa69-ace800fca61f', 
			limit: 5
		})
			.then(this._mapInfoToRows)
			.then(rows => rows.slice(0, 5))
			.then(this.rows);
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