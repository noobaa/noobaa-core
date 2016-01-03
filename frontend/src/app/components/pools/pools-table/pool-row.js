import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils';
import page from 'page';

export default class PoolRowViewModel {
	constructor(pool, deleteCandidate) {
		this.isVisible = ko.pureComputed(
			() => !!pool()
		);

		this.stateIcon = '/fe/assets/icons.svg#pool';

		this.name = ko.pureComputed(
			() => pool().name
		);

		this.href = ko.pureComputed(
			() => `/fe/systems/:system/pools/${pool().name}`
		);

		this.nodeCount = ko.pureComputed(
			() => numeral(pool().total_nodes).format('0,0')
		);

		this.onlineCount = ko.pureComputed(
			() => numeral(pool().online_nodes).format('0,0')
		);

		this.offlineCount = ko.pureComputed(
			() => numeral(pool().total_nodes - pool().online_nodes).format('0,0')
		);

		this.usage = ko.pureComputed(
			() => pool().storage ? formatSize(pool().storage.used) : 'N/A'
		);

		this.capacity = ko.pureComputed(
			() => pool().storage ? formatSize(pool().storage.total) : 'N/A'
		);

		this.allowDelete = ko.pureComputed(
			() => pool().total_nodes === 0
		);

		this.isDeleteCandidate = ko.pureComputed({
			read: () => deleteCandidate() === this,
			write: value => value ? deleteCandidate(this) : deleteCandidate(null)
		});

		this.deleteIcon = ko.pureComputed(
			() => `/fe/assets/icons.svg#${
				this.isDeleteCandidate() ? 'trash-opened' : 'trash-closed'
			}`
		);

		this.deleteTooltip = ko.pureComputed( 
			() => this.allowDelete() ? 'delete pool' : 'pool is not empty'
		);
	}

	delete() {
		//deletePool(this.name());
		this.isDeleteCandidate(false);
	}	
}