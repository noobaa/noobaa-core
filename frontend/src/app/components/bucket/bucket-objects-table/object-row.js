import { formatSize } from 'utils';

const statusIconMapping = Object.freeze({
	// AVALIABLE: '/assets/icons.svg#file-avaliable',
	// IN_PROCESS: '/assets/icons.svg#file-in-process',
	// UNAVALIABLE: '/assets/icons.svg#unavaliable',
	AVALIABLE: '/assets/icons.svg#bucket',
	IN_PROCESS: '/assets/icons.svg#bucket',
	UNAVALIABLE: '/assets/icons.svg#bucket',
});

export default class ObjectRowViewModel {
	constructor(name, info) {
		this.stateIcon = statusIconMapping[info.state || 'AVALIABLE'];
		this.name = name;
		this.href = `./${name}`;
		this.size = formatSize(info.size);
	}
}