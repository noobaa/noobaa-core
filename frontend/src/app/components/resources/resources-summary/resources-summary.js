/* Copyright (C) 2016 NooBaa */

import template from './resources-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { sumBy, unique } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';

class ResourcesSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    hostPoolSummary = ko.observable();
    cloudResourceSummary = ko.observable();
    nsResourceSummary = ko.observable();

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
            let hostPoolSummary = stringifyAmount('resource', hostPoolCount, 'No');
            if (hostPoolCount > 0) {
                hostPoolSummary += ` | ${stringifyAmount('node', hostCount)}`;
            }

            const cloudResourceList = Object.values(cloudResources);
            const cloudResourceCount = cloudResourceList.length;
            const cloudServiceCount = unique(cloudResourceList.map(res => res.type)).length;
            let cloudResourceSummary = stringifyAmount('resource', cloudResourceCount, 'No');
            if (cloudResourceCount > 0) {
                cloudResourceSummary += ` | ${stringifyAmount('service', cloudServiceCount)}`;
            }

            const nsResourceList = Object.values(nsResources);
            const nsResourceCount = nsResourceList.length;
            const nsServiceCount = unique(nsResourceList.map(res => res.service)).length;
            let nsResourceSummary = stringifyAmount('resource', nsResourceCount, 'No');
            if (nsResourceCount > 0) {
                nsResourceSummary += ` | ${stringifyAmount('service', nsServiceCount)}`;
            }

            ko.assignToProps(this, {
                dataReady: true,
                hostPoolSummary,
                cloudResourceSummary,
                nsResourceSummary
            });
        }
    }
}

export default {
    viewModel: ResourcesSummaryViewModel,
    template: template
};
