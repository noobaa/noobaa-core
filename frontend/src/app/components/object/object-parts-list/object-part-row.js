import ko from 'knockout';
import { formatSize, dblEncode } from 'utils';

const partStateMapping = Object.freeze({
    available: {
        toolTip: 'available',
        icon: '/fe/assets/icons.svg#part-available'
    },
    building:  {
        toolTip: 'in process',
        icon: '/fe/assets/icons.svg#part-in-process'
    },
    unavailable: {
        toolTip: 'unavailable',
        icon: '/fe/assets/icons.svg#part-unavailable'
    }
});

class BlockRowViewModel {
    constructor({ adminfo }) {
        let { online, node_ip, node_name, pool_name } = adminfo;

        this.nodeStateToolTip = online ? 'online' : 'offline';
        this.nodeStateIcon = `/fe/assets/icons.svg#node-${online ? 'online' : 'offline'}`;
        this.nodeIp = node_ip;
        this.nodeName = node_name;
        this.href = `/fe/systems/:system/pools/${
                dblEncode(pool_name)
            }/nodes/${
                dblEncode(node_name)
            }`;
    }
}

export default class ObjectPartRowViewModel {
    constructor(part, partNumber, partsCount) {
        let size = formatSize(part.chunk.size);
        let state = part.chunk.adminfo.health;
        let blocks = part.chunk.frags[0].blocks;
        let stateMapping = partStateMapping[state];

        this.stateToolTip = stateMapping.toolTip;
        this.stateIcon = stateMapping.icon;
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
