import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { shortString, formatSize } from 'utils/all';

const partStateIcons = Object.freeze({
    available: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Available'
    },
    building:  {
        name: 'working',
        css: 'warning',
        tooltip: 'In process'
    },
    unavailable: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable'
    }
});

class BlockRowViewModel extends BaseViewModel {
    constructor({ adminfo }, index, count) {
        super();

        let { online, in_cloud_pool, node_ip, node_name, pool_name } = adminfo;

        this.stateIcon = {
            name: online ? 'healthy' : 'problem',
            tooltip: online ? 'Healthy' : 'Problem',
            css: online ? 'success' : 'error'
        };
        this.label = `Replica ${index + 1} of ${count} ${in_cloud_pool ? '(cloud replica)' : ''}`;
        this.poolName = pool_name;

        if (!in_cloud_pool) {
            this.nodeName = node_name;
            this.shortenNodeName = shortString(node_name, 30, 8);
            this.nodeIp = node_ip;

            this.poolHref = {
                route: 'pool',
                params: {
                    pool: pool_name,
                    tab: null
                }
            };

            this.nodeHref = {
                route: 'node',
                params: {
                    pool: pool_name,
                    node: node_name,
                    tab: null
                }
            };
        } else {
            this.nodeName = null;
            this.shortenNodeName = '---';
            this.nodeIp = '---';
            this.poolHref = null;
            this.nodeHref = null;
        }
    }
}

export default class ObjectPartRowViewModel extends BaseViewModel {
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
