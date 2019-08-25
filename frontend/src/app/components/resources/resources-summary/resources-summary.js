/* Copyright (C) 2016 NooBaa */

import template from './resources-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { sumBy, unique } from 'utils/core-utils';
import numeral from 'numeral';

class ResourcesSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    hostPoolCount = ko.observable();
    hostCount = ko.observable();
    cloudResourceCount = ko.observable();
    cloudServiceCount = ko.observable();
    nsResourceCount = ko.observable();
    nsServiceCount = ko.observable();

    selectState(state) {
        return [
            state.hostPools,
            state.cloudResources,
            state.namespaceResources
        ];
    }

    mapStateToProps(hostPools, cloudResources, nsResources) {
        if (!hostPools || !cloudResources || !nsResources) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const hostPoolList = Object.values(hostPools);
            const hostPoolCount = hostPoolList.length;
            const hostCount = sumBy(hostPoolList, pool => pool.hostCount);
            const cloudResourceList = Object.values(cloudResources);
            const cloudResourceCount = cloudResourceList.length;
            const cloudServiceCount = unique(cloudResourceList.map(res => res.type)).length;
            const nsResourceList = Object.values(nsResources);
            const nsResourceCount = nsResourceList.length;
            const nsServiceCount = unique(nsResourceList.map(res => res.service)).length;

            ko.assignToProps(this, {
                dataReady: true,
                hostPoolCount: numeral(hostPoolCount).format(','),
                hostCount: numeral(hostCount).format(','),
                cloudResourceCount: numeral(cloudResourceCount).format(','),
                cloudServiceCount: numeral(cloudServiceCount).format(','),
                nsResourceCount: numeral(nsResourceCount).format(','),
                nsServiceCount: numeral(nsServiceCount).format(',')

            });
        }
    }
}

export default {
    viewModel: ResourcesSummaryViewModel,
    template: template
};
