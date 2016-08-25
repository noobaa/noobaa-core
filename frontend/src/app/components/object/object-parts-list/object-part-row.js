import Disposable from 'disposable';
import ko from 'knockout';
import { shortString, formatSize } from 'utils';

const partStateIcons = Object.freeze({
    available: {
        name: 'healthy',
        css: 'success',
        tooltip: 'available'
    },
    building:  {
        name: 'working',
        css: 'warning',
        tooltip: 'in process'
    },
    unavailable: {
        name: 'problem',
        css: 'error',
        tooltip: 'unavailable'
    }
});

class BlockRowViewModel extends Disposable {
    constructor({ adminfo }, index, count) {
        super();

        let { online, node_ip, node_name, pool_name } = adminfo;

        this.stateIcon = {
            name: online ? 'healthy' : 'problem',
            tooltip: online ? 'healthy' : 'problem',
            css: online ? 'success' : 'error'
        };

        this.label = `Replica ${index + 1} of ${count}`;
        this.nodeIp = node_ip;
        this.poolName = pool_name;
        this.nodeName = node_name;
        this.shortenNodeName = shortString(node_name);
    }
}

export default class ObjectPartRowViewModel extends Disposable {
    constructor(part, partNumber, partsCount) {
        super();

        let size = formatSize(part.chunk.size);
        let state = part.chunk.adminfo.health;
        let blocks = part.chunk.frags[0].blocks;

        this.stateIcon = partStateIcons[state];
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
