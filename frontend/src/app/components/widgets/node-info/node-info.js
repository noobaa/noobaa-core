import template from './node-info.html';
import ko from 'knockout';
import moment from 'moment';
import api from 'services/api';
import { formatSize } from 'utils';

const nodeName = 'Nimrods-MacBook-Air.local-fe61d7e7-6b66-4e6c-aa69-ace800fca61f';

class NodeInfoViewModel {
	constructor(params) {
		this.version = ko.observable();
		this.hostname = ko.observable();
		this.upTime = ko.observable();
		this.osType = ko.observable();
		this.cpus = ko.observable();
		this.memory = ko.observable();
		this.totalSize = ko.observable();
		this.drives = ko.observableArray();
		this.networks = ko.observableArray();		

		api.read_node({ name: nodeName })
			.then(node => this._mapData(node));
	}

	_mapData(node) {
		let { os_info } = node;

		this.version(node.version);
		this.hostname(os_info.hostname);
		this.upTime(moment(os_info.uptime).fromNow(true));
		this.osType(os_info.ostype);
		this.cpus(`${os_info.cpus.length}x ${os_info.cpus[0].model}`);
		this.memory(formatSize(os_info.totalmem));
		this.networks(this._mapNetwotkInterfaces(os_info.networkInterfaces));
		this.totalSize(formatSize(node.storage.total));
		this.drives(this._mapDrives(node.drives)) 
	}

	_mapNetwotkInterfaces(networkInterfaces) {
		return Object.keys(networkInterfaces).map( controller => {
			return { 
				controller: controller, 
				interfaces: networkInterfaces[controller].map( addr => addr.address )
			};
		});
	}

	_mapDrives(drives) {
		return drives.map( ({ mount, storage }) => {
			let { total, used, free} = storage;
			let os = total - (used + free);

			return {
				name: mount,
				values: [
					{ value: used, label: formatSize(used),	color: '#3494D9' },
					{ value: os,   label: formatSize(os),	color: '#C3CEEF' },
					{ value: free, label: formatSize(free),	color: '#35434E' }
				]
			};
		});
	}
}

export default {
	viewModel: NodeInfoViewModel,
	template: template
}