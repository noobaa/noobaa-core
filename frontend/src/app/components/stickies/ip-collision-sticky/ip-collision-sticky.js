/* Copyright (C) 2016 NooBaa */

import template from './ip-collision-sticky.html';
import ConnectableViewModel from 'components/connectable';
import { memoize, flatMap  } from 'utils/core-utils';
import ko from 'knockout';
import { ipCollisionSticky } from 'knowledge-base-articles';

class IpCollisionStickyViewModel extends ConnectableViewModel {
    articleUrl = ipCollisionSticky;
    isActive = ko.observable();
    addresses = ko.observableArray();
    tooltip = {
        template: 'list',
        text: this.addresses
    };

    selectCollisions = memoize(topology => {
        if (!topology) {
            return [];
        }

        const allAddresss = flatMap(
            Object.values(topology.servers),
            server => server.addresses
        );

        return allAddresss
            .filter(addr => addr.collision)
            .map(addr => addr.ip);
    });

    selectState(state) {
        return [
            this.selectCollisions(state.topology)
        ];
    }

    mapStateToProps(collisions) {
        ko.assignToProps(this, {
            isActive: collisions.length > 0,
            addresses: collisions
        });
    }
}

export default {
    viewModel: IpCollisionStickyViewModel,
    template: template
};
