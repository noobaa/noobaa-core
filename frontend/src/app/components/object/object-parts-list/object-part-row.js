import ko from 'knockout';
import { formatSize } from 'utils';

const partStateIconMapping = Object.freeze({
	available: 	'/fe/assets/icons.svg#part-available',
	in_process: '/fe/assets/icons.svg#part-in-process',
	unavailable:'/fe/assets/icons.svg#part-unavailable' 
});

class BlockRowViewModel {
	constructor({ adminfo }) {
		let { online, node_ip, node_name, pool_name } = adminfo;

		this.nodeStateIcon = `/fe/assets/icons.svg#node-${online ? 'online' : 'offline'}`;
		this.nodeIp = node_ip;
		this.nodeName = node_name;
		this.href = `/fe/systems/:system/pools/${pool_name}/nodes/${node_name}`;
	}
}

export default class ObjectPartRowViewModel {
	constructor(part, partNumber, partsCount) {
		let size = formatSize(part.chunk.size);
		let state = part.chunk.adminfo.health;
		let blocks = part.frags[0].blocks;

		this.stateIcon = partStateIconMapping[state];
		this.name = `Part ${partNumber} of ${partsCount}`;
		this.size = size;
		this.blocks = blocks;
		this.blocks = blocks.map(
			block =>  new BlockRowViewModel(block)
		);

		this.isExpended = ko.observable(false);
	}

	toggleExpend() {
		this.isExpended(!this.isExpended());
	}
}