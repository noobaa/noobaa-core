/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
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
        tooltip: 'Wipping'
    },
    HEALTHY: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

function _getBlockMarking(block) {
    const letter = block.kind[0];
    const digit = block.seq == null ? '' : (block.seq + 1);
    return `${letter}${digit}`;
}

function _getBlockResource(block, system) {
    if (block.mode === 'MOCKED') {
        return { text: 'Searching for resource' };
    }

    const { kind, pool, host } = block.storage || {};
    switch (kind) {
        case 'HOSTS': {
            const text = host;
            const href = realizeUri(routes.host, { system, pool, host });
            return { text, href };
        }

        case 'CLOUD': {
            return {
                text: 'Cloud Resource'
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
