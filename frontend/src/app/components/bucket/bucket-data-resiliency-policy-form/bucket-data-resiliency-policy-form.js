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
    LOW: {
        text: 'Low',
        css: '',
        tooltip: ''
    },
    HIGH: {
        text: 'High',
        css: '',
        tootlip: ''
    },
    VERY_HIGH: {
        text: 'Very High',
        css: 'error',
        tooltip: 'Parity fragments rebuild time might take a while, varies according to data placement policy resources and type'
    }
});

function _getFailureTolerance(tolerance) {
    const warn = tolerance < 2;
    return {
        text: tolerance,
        css: warn ? 'warning' : '',
        tooltip: warn ?
            'Failure tolerance is below 2, in case of 1 failure data may be lost' :
            ''
    };
}

function _getRequiredDrives(requiredDrives, driveCountMetric) {
    const warn = requiredDrives > driveCountMetric;
    return {
        text: `${requiredDrives} drives per mirror set`,
        css: warn ? 'warning' : '',
        tooltip: warn ?
            'Current resources does not support this configured resiliency policy' :
             ''
    };
}

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
    requiredDrives = ko.observable();
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
            template: 'messageWithSeverity',
            value: this.failureTolerance
        },
        {
            label: 'Minimum Required Drives',
            template: 'messageWithSeverity',
            value: this.requiredDrives
        },
        {
            label: 'Rebuild time effort',
            template: 'messageWithSeverity',
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
            this.failureTolerance({});
            this.requiredDrives({});
            this.rebuildEffort({});
            return;
        }

        const toggleSection = section === policyName ? undefined : policyName;
        const driveCountMetric = buckets[bucket].resiliencyDriveCountMetric;
        const resiliency = summrizeResiliency(buckets[bucket].resiliency);
        const dataDistribution = resiliency.type === 'REPLICATION' ?
            `${resiliency.replicas} copies` :
            `${resiliency.dataFrags} data + ${resiliency.parityFrags} parity fragments`;
        const failureTolerance = _getFailureTolerance(resiliency.failureTolerance);
        const requiredDrives = _getRequiredDrives(resiliency.requiredDrives, driveCountMetric);
        const rebuildEffort = rebuildEffortToDisplay[resiliency.rebuildEffort];

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
        this.failureTolerance(failureTolerance);
        this.requiredDrives(requiredDrives);
        this.rebuildEffort(rebuildEffort);
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
