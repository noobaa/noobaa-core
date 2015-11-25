import { formatSize } from 'utils';

export default class PartRowViewModel {
	constructor(part, partCount) {
		let partsNumber = part.part_sequence_number + 1;
		let size = formatSize(part.chunk.size);

		this.partText = `Part ${partsNumber} of ${partCount} ( ${size} )`;
		this.blocks = part.frags[0].blocks.map(this._mapBlock);
	} 

	_mapBlock({ adminfo }) {
		return {
			nodeIp: adminfo.node_ip,
			nodeName: adminfo.node_name,
		};
	}
}