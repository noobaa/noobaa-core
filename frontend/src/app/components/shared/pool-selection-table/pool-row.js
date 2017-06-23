/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { getPoolStateIcon, getResourceTypeIcon, getPoolCapacityBarValues } from 'utils/ui-utils';

export default class PoolRowViewModel extends BaseViewModel {
    constructor(pool, selectedPools) {
        super();

        this.select = ko.pureComputed({
            read: () => selectedPools().includes(this.name()),
            write: val => val ?
                selectedPools.push(this.name()) :
                selectedPools.remove(this.name())
        });

        this.state = ko.pureComputed(
            () => pool() ? getPoolStateIcon(pool()) : ''
        );

        this.type = ko.pureComputed(
            () => pool() ? getResourceTypeIcon(pool().resource_type, pool().cloud_info) : ''
        );

        this.name = ko.pureComputed(
            () => pool() ? pool().name : ''
        );

        this.onlineNodes = ko.pureComputed(
            () => {
                if (!pool()) {
                    return '';
                }

                return pool().resource_type === 'HOSTS' ?
                    `${pool().nodes.online} of ${pool().nodes.count}` :
                    '—';
            }
        );

        this.capacity = ko.pureComputed(
            () => getPoolCapacityBarValues(pool() || {})
        );


    }
}
