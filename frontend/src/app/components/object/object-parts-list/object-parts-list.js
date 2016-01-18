import template from './object-parts-list.html';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { formatSize } from 'utils';
import { redirectTo } from 'actions';

const partStateIconMapping = Object.freeze({
	available: 	'/fe/assets/icons.svg#part-available',
	in_process: '/fe/assets/icons.svg#part-in-process',
	unavailable:'/fe/assets/icons.svg#part-unavailable' 
});

class ObjectPartsListViewModel {
	constructor({ parts }) {
		this.pageSize = paginationPageSize;
		this.count = parts.count;
		
		this.page = ko.pureComputed({
			read: parts.page,
			write: page => redirectTo(undefined, { page })
		});

		this.rows = parts.map(
			(part, i) => this._mapPart(part, this.currPage(), i(), this.count())
		);
	}

	expendPart(part) {
		part.isExpended(!part.isExpended());
	}

	_mapPart(part, page, index, partCount) {
		let partNumber = page * this.pageSize + index;
		let size = formatSize(part.chunk.size);
		let state = part.chunk.adminfo.health;

		let blocks = part.frags[0].blocks.map(
			block =>  {
				let { online, node_ip, node_name, pool_name } = block.adminfo;

				return {
					nodeStateIcon: `/fe/assets/icons.svg#node-${online ? 'online' : 'offline'}`,
					nodeIp: node_ip,
					nodeName: node_name,
					href: `/fe/systems/:system/pools/${pool_name}/nodes/${node_name}`
				}
			}
		);

		return {
			stateIcon: partStateIconMapping[state],
			name: `Part ${partNumber} of ${partCount}`,
			size: size,
			blocks: blocks,
			isExpended: ko.observable(false)
		}
	}
}

export default {
	viewModel: ObjectPartsListViewModel,
	template: template
}