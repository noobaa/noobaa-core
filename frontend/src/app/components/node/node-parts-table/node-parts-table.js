import template from './node-parts-table.html';
import ko from 'knockout';
import PartRowViewModel from './part-row';

class NodeObjectsTableViewModel {
	constructor({ objects }) {
		this.rows = ko.pureComputed(
			() => this._mapObjectsToRows(objects())
		);
	}

	_mapObjectsToRows(objects) {
		return objects.reduce((list, obj) => {
			let rows = obj.parts.map(part => new PartRowViewModel(obj.key, obj.bucket, part));
			list.push(...rows);
			return list;
		}, []);
	}
}

export default {
	viewModel: NodeObjectsTableViewModel,
	template: template
}