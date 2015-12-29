import template from './object-parts-list.html';
import ko from 'knockout';
import { formatSize } from 'utils';

const partStateIconMapping = Object.freeze({
	available: 	'/assets/icons.svg#part-available',
	in_process: '/assets/icons.svg#part-in-process',
	unavailable:'/assets/icons.svg#part-unavailable' 
});

class ObjectPartsListViewModel {
	constructor({ parts }) {
		this.parts = parts.map(
			part => this._mapPart(parts, part)
		);
	}

	_mapPart(parts, part) {
		let partsNumber = part.part_sequence_number + 1;
		let size = formatSize(part.chunk.size);
		let state = part.chunk.adminfo.health;

		let blocks = part.frags[0].blocks.map(
			block =>  ({
				nodeIp: block.adminfo.node_ip,
				nodeName: block.adminfo.node_name
			})
		);

		return {
			stateIcon: partStateIconMapping[state],
			name: `Part ${partsNumber} of ${parts().length} ( ${size} )`,
			blocks: blocks
		}
	}
}

export default {
	viewModel: ObjectPartsListViewModel,
	template: template
}