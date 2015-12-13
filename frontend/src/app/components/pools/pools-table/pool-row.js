import numeral from 'numeral';

export default class PoolRowViewModel {
	constructor(pool) {

		this.stateIcon = '/assets/icons.svg#pool';
		this.name = pool.name;
		this.href = `/systems/:system/pools/${pool.name}`;
		this.nodeCount = numeral(pool.total_nodes).format('0,0');
		this.onlineCount = numeral(pool.online_nodes).format('0,0');
		this.offlineCount = numeral(pool.total_nodes - pool.online_nodes).format('0,0');
		this.usage = numeral(pool.storage.used).format('0,0');
		this.capacity = numeral(pool.storage.total).format('0,0');
	}
}