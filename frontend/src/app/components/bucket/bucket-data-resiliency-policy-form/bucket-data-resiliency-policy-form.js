/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-resiliency-policy-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { summrizeResiliency, getResiliencyTypeDisplay } from 'utils/bucket-utils';
import ko from 'knockout';
import numeral from 'numeral';
import * as routes from 'routes';
import {
    requestLocation,
    openEditBucketDataResiliencyModal
} from 'action-creators';

const policyName = 'data-resiliency';

const rebuildEffortToDisplay = deepFreeze({
    LOW: 'Low',
    HIGH: 'High',
    VERY_HIGH: 'Very High'
});

class BucketDataResiliencyPolicyFormViewModel extends Observer {
    isExpanded = ko.observable();
    bucketName = '';
    toggleUri = '';
    resiliencyType = ko.observable();
    usingReplicationPolicy = ko.observable();
    usingErasureCodingPolicy = ko.observable();
    dataDistribution = ko.observable();
    numOfCopies = ko.observable();
    numOfDataFrags = ko.observable();
    numOfParityFrags = ko.observable();
    storageOverhead = ko.observable();
    failureTolerance = ko.observable();
    requiredHosts = ko.observable();
    rebuildEffort = ko.observable()
    info = [
        {
            label: 'Data Resiliency Type',
            value: this.resiliencyType
        },
        {
            label: 'Number of Copies',
            value: this.numOfCopies,
            visible: this.usingReplicationPolicy
        },
        {
            label: 'Number of data fragments',
            value: this.numOfDataFrags,
            visible: this.usingErasureCodingPolicy
        },
        {
            label: 'Number of parity fragments',
            value: this.numOfParityFrags,
            visible: this.usingErasureCodingPolicy
        },
        {
            label: 'Storage Overhead',
            value: this.storageOverhead
        },
        {
            label: 'Failure Tolerance',
            value: this.failureTolerance
        },
        {
            label: 'Minimum Required Nodes',
            value: this.requiredHosts
        },
        {
            label: 'Rebuild time effort',
            value: this.rebuildEffort
        }
    ];

    constructor() {
        super();

        this.observe(
            state$.getMany('location', 'buckets'),
            this.onState
        );
    }

    onState([location, buckets]) {
        const { system, bucket, tab = 'data-policies', section } = location.params;
        this.isExpanded(section === policyName);

        if (!buckets || !buckets[bucket]) {
            return;
        }

        const toggleSection = section === policyName ? undefined : policyName;
        const resiliency = summrizeResiliency(buckets[bucket].resiliency);
        const dataDistribution = resiliency.type === 'REPLICATION' ?
            `${resiliency.replicas} copies` :
            `${resiliency.dataFrags} data + ${resiliency.parityFrags} parity fragments`;

        this.bucketName = bucket;
        this.toggleUri = realizeUri(
            routes.bucket,
            { system, bucket, tab, section: toggleSection }
        );
        this.resiliencyType(getResiliencyTypeDisplay(resiliency.type));
        this.usingReplicationPolicy(resiliency.type === 'REPLICATION');
        this.usingErasureCodingPolicy(resiliency.type === 'ERASURE_CODING');
        this.dataDistribution(dataDistribution);
        this.numOfCopies(resiliency.replicas);
        this.numOfDataFrags(resiliency.dataFrags);
        this.numOfParityFrags(resiliency.parityFrags);
        this.storageOverhead(numeral(resiliency.storageOverhead).format('%'));
        this.failureTolerance(`${resiliency.failureTolerance} drives`);
        this.requiredHosts(`${resiliency.requiredHosts} nodes per mirror set`);
        this.rebuildEffort(rebuildEffortToDisplay[resiliency.rebuildEffort]);
    }

    onToggleSection() {
        action$.onNext(requestLocation(this.toggleUri));
    }

    onEditDataResiliency(_ ,evt) {
        action$.onNext(openEditBucketDataResiliencyModal(this.bucketName));
        evt.stopPropagation();
    }
}

export default {
    viewModel: BucketDataResiliencyPolicyFormViewModel,
    template: template
};
