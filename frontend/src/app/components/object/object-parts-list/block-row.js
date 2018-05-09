/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getHostDisplayName } from 'utils/host-utils';
import * as routes from 'routes';

const blockModeToState = deepFreeze({
    NOT_ACCESSIBLE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable'
    },
    MOCKED: {
        name: 'working',
        css: 'warning',
        tooltip: 'Allocating'
    },
    WIPING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Wiping'
    },
    HEALTHY: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

function _getBlockMarking(block) {
    switch (block.kind) {
        case 'REPLICA': {
            return {
                text: 'R',
                tooltip: 'Replica'
            };
        }

        case 'DATA': {
            const digit = block.seq + 1;
            return {
                text: `D${digit}`,
                tooltip: `Data Fragment ${digit}`
            };

        }
        case 'PARITY': {
            const digit = block.seq + 1;
            return {
                text: `P${digit}`,
                tooltip: `Parity Fragment ${digit}`
            };
        }
    }

    const letter = block.kind[0];
    const digit = block.seq == null ? '' : (block.seq + 1);
    return `${letter}${digit}`;
}

function _getBlockResource(block, system) {
    if (block.mode === 'MOCKED') {
        return { text: 'Searching for resource' };
    }

    const { kind, resource, pool, host } = block.storage || {};
    switch (kind) {
        case 'HOSTS': {
            const text = getHostDisplayName(host);
            const href = realizeUri(routes.host, { system, pool, host });
            return { text, href };
        }

        case 'CLOUD': {
            return {
                text: resource
            };
        }

        case 'INTERNAL': {
            return {
                text: 'Internal Storage'
            };
        }
    }
}

export default class BlockRowViewModel {
    state = ko.observable();
    marking = ko.observable();
    resource = ko.observable();

    onState(block, system) {
        this.state(blockModeToState[block.mode]);
        this.marking(_getBlockMarking(block));
        this.resource(_getBlockResource(block, system));
    }
}
