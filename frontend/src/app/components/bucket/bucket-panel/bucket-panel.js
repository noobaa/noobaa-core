/* Copyright (C) 2016 NooBaa */

import template from './bucket-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import { getPlacementStateIcon, getResiliencyStateIcon, getQuotaStateIcon } from 'utils/bucket-utils';

function _updateCounterState(state, severity) {
    if (severity === 'warning') {
        state.count += 1;
        if (state.severity !== 'error') {
            state.severity = 'warning';
        }

    } else if (severity === 'error') {
        state.count += 1;
        state.severity = 'error';

    }
    return state;
}

function _getPlacementCounterState(bucket) {
    const counterState = { count: 0, severity: '' };
    if (!bucket) return counterState;

    return bucket.placement.tiers
        .map(tier =>
            tier.policyType !== 'INTERNAL_STORAGE' ?
                getPlacementStateIcon(tier).css :
                'warning'
        )
        .reduce(_updateCounterState, counterState);
}

function _getPolicyCounterState(bucket) {
    const counterState = { count: 0, severity: '' };
    if (!bucket) return counterState;

    const { resiliency, versioning, quota } = bucket;
    return [
        getResiliencyStateIcon(resiliency).css,
        versioning.mode === 'SUSPENDED' ? 'warning' : '',
        quota ? getQuotaStateIcon(quota).css : ''
    ].reduce(_updateCounterState, counterState);
}

class BucketPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    selectedTab = ko.observable();
    bucketName = ko.observable();
    placementIssueCounter = {
        count: ko.observable(),
        severity: ko.observable()
    };
    policyIssueCounter = {
        count: ko.observable(),
        severity: ko.observable()
    };

    selectState(state) {
        const { location, buckets } = state;
        const bucket = buckets && buckets[location.params.bucket];

        return [
            location,
            bucket
        ];
    }

    mapStateToProps(location, bucket) {
        const { system, bucket: bucketName, tab = 'data-placement' } = location.params;

        ko.assignToProps(this, {
            baseRoute: realizeUri(location.route, { system, bucket: bucketName }, {}, true),
            selectedTab: tab,
            bucketName: bucketName,
            placementIssueCounter: _getPlacementCounterState(bucket),
            policyIssueCounter: _getPolicyCounterState(bucket)
        });
    }

    tabHref(tab) {
        const route = this.baseRoute();
        if (route) {
            return realizeUri(route, { tab });
        }
    }
}

export default {
    viewModel: BucketPanelViewModel,
    template: template
};
