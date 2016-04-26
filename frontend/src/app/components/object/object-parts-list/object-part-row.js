import ko from 'knockout';
import { shortString, formatSize, dblEncode } from 'utils';

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
    constructor({ adminfo }, index, count) {
        let { online, node_ip, node_name, pool_name } = adminfo;

        this.label = `Replica ${index + 1} of ${count}`
        this.nodeStateToolTip = online ? 'online' : 'offline';
        this.nodeStateIcon = `/fe/assets/icons.svg#node-${online ? 'online' : 'offline'}`;
        this.nodeIp = node_ip;
        this.nodeName = shortString(node_name);
        this.nodeUrl = `/fe/systems/:system/pools/${
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
        this.name = `Part ${partNumber + 1} of ${partsCount}`;
        this.size = size;
        this.blocks = blocks;
        this.blocks = blocks.map(
            (block, i) =>  new BlockRowViewModel(block, i, blocks.length)
        );

        this.isExpended = ko.observable(partNumber === 0);
    }

    toggleExpend() {
        this.isExpended(!this.isExpended());
    }
}
