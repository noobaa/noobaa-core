import template from './node-parts-table.html';
import ko from 'knockout';
import { makeArray } from 'utils';
import PartRowViewModel from './part-row';

const pageSize = 1000;

class NodeObjectsTableViewModel {
	constructor({ objects }) {

		let parts = ko.pureComputed(
			() => objects()
				.map(
					obj => obj.parts.map(
						part => ({
							object: obj.key,
							bucket: obj.bucket,
							state: part.chunk.adminfo.health,
							start: part.start,
							end: part.end,
							size: part.chunk.size						
						})
					)
				)
				.reduce(
					(list, parts) => {
						list.push(...parts)
						return list
					},
					[]
				)
		);

		this.rows = makeArray(
			pageSize,
			i => new PartRowViewModel(() => parts()[i])
		);

		// this.rows = ko.pureComputed(
		// 	() => this._mapObjectsToRows(objects())
		// );
	}

	// _mapObjectsToRows(objects) {
	// 	return objects.reduce((list, obj) => {
	// 		let rows = obj.parts.map(part => new PartRowViewModel(obj.key, obj.bucket, part));
	// 		list.push(...rows);
	// 		return list;
	// 	}, []);
	// }
}

export default {
	viewModel: NodeObjectsTableViewModel,
	template: template
}