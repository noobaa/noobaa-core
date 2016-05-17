import ko from 'knockout';
import { shortString, formatSize } from 'utils';

const partStateMapping = Object.freeze({
    available: { toolTip: 'available', icon: 'part-available' },
    building:  { toolTip: 'in process', icon: 'part-in-process' },
    unavailable: { toolTip: 'unavailable', icon: 'part-unavailable' }
});

class BlockRowViewModel {
    constructor({ adminfo }, index, count) {
        let { online, node_ip, node_name, pool_name } = adminfo;

        this.label = `Replica ${index + 1} of ${count}`
        this.nodeStateToolTip = online ? 'online' : 'offline';
        this.nodeStateIcon = `/fe/assets/icons.svg#node-${online ? 'online' : 'offline'}`;
        this.nodeIp = node_ip;
        this.poolName = pool_name;
        this.poolUrl = `/fe/systems/:system/pools/${pool_name}`;
        this.nodeName = node_name;
        this.shortenNodeName = shortString(node_name);
        this.nodeUrl = `${this.poolUrl}/nodes/${node_name}`;
    }
}

export default class ObjectPartRowViewModel {
    constructor(part, partNumber, partsCount) {
        let size = formatSize(part.chunk.size);
        let state = part.chunk.adminfo.health;
        let blocks = part.chunk.frags[0].blocks;
        let stateMapping = partStateMapping[state];

        this.stateToolTip = stateMapping.toolTip;
        this.stateIcon = `/fe/assets/icons.svg#${stateMapping.icon}`;
        this.name = `Part ${partNumber + 1} of ${partsCount}`;
        this.size = size;
        this.blocks = blocks;
        this.blocks = blocks.map(
            (block, i) =>  new BlockRowViewModel(block, i, blocks.length)
        );

        this.isExpended = ko.observable(partsCount === 1);
    }

    toggleExpend() {
        this.isExpended(!this.isExpended());
    }
}
