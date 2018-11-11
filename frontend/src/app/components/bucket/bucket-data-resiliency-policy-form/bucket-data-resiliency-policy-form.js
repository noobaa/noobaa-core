/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-resiliency-policy-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import ko from 'knockout';
import numeral from 'numeral';
import { getMany } from 'rx-extensions';
import * as routes from 'routes';
import {
    summrizeResiliency,
    getResiliencyStateIcon,
    getResiliencyTypeDisplay
} from 'utils/bucket-utils';
import {
    requestLocation,
    openEditBucketDataResiliencyModal
} from 'action-creators';

const policyName = 'data-resiliency';

const rebuildEffortToDisplay = deepFreeze({
    LOW: {
        text: 'Low',
        icon: {
            name: 'question',
            tooltip: 'Rebuild time effort has 3 options: Low/High/Very High and might change according to the amount of fragments or replicas'
        }
    },
    HIGH: {
        text: 'High',
        icon: {
            name: 'question',
            tooltip: 'Rebuild time effort has 3 options: Low/High/Very High and might change according to the amount of fragments or replicas'
        }
    },
    VERY_HIGH: {
        text: 'Very High',
        css: 'error',
        icon: {
            name: 'problem',
            tooltip: 'Parity fragments rebuild time might take a while, varies according to data placement policy resources and type'
        }
    }
});

function _getConfiguredFailureTolerance(resiliency) {
    const { failureTolerance } = resiliency;
    const text = numeral(failureTolerance).format('0,0');

    if (failureTolerance < 2) {
        return {
            text: text,
            css: 'warning',
            icon: {
                name: 'problem',
                tooltip: 'It is not recommended to use a resiliency policy which results in less than a fault tolerance value of 2'
            }
        };
    } else {
        return { text };
    }
}

function _getActualFailureTolerance(actualTolerance, configuredTolerance, requiredDrives) {
    const { hosts, nodes } = actualTolerance;
    const text = `${hosts} Nodes / ${nodes} Drives`;
    if (hosts < configuredTolerance || nodes < configuredTolerance) {
        return {
            text: text,
            css: 'warning',
            icon: {
                name: 'problem',
                tooltip: `One or more of the configured mirror sets have less than ${requiredDrives} healthy nodes/drives. This brings the bucket\'s actual tolerance below the configured tolerance`
            }
        };
    } else {
        return {
            text: text,
            icon: {
                name: 'question',
                tooltip: 'The current number of nodes and drives that can suffer failure without causing any data loss'
            }
        };
    }
}

function _getRequiredDrives(resiliency) {
    const { requiredDrives } = resiliency;
    const text = `${requiredDrives} drives per mirror set`;
    return { text };
}

class BucketDataResiliencyPolicyFormViewModel extends Observer {
    isExpanded = ko.observable();
    bucketName = '';
    toggleUri = '';
    stateIcon = ko.observable();
    resiliencyType = ko.observable();
    usingReplicationPolicy = ko.observable();
    usingErasureCodingPolicy = ko.observable();
    dataDistribution = ko.observable();
    numOfCopies = ko.observable();
    numOfDataFrags = ko.observable();
    numOfParityFrags = ko.observable();
    storageOverhead = ko.observable();
    configuredFailureTolerance = ko.observable();
    actualFailureTolerance = ko.observable();
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
            label: 'Minimum Required Drives',
            template: 'messageWithSeverity',
            value: this.requiredDrives
        },
        {
            label: 'Configured Failure Tolerance',
            template: 'messageWithSeverity',
            value: this.configuredFailureTolerance
        },
        {
            label: 'Actual Failure Tolerance',
            template: 'messageWithSeverity',
            value: this.actualFailureTolerance
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
            state$.pipe(
                getMany(
                    'location',
                    'buckets'
                )
            ),
            this.onState
        );
    }

    onState([location, buckets]) {
        const { system, bucket: bucketName, tab = 'data-policies', section } = location.params;
        this.isExpanded(section === policyName);

        if (!buckets || !buckets[bucketName]) {
            this.stateIcon({});
            this.configuredFailureTolerance({});
            this.actualFailureTolerance({});
            this.requiredDrives({});
            this.rebuildEffort({});
            return;
        }

        const bucket = buckets[bucketName];
        const toggleSection = section === policyName ? undefined : policyName;
        const resiliency = summrizeResiliency(bucket.resiliency);
        const dataDistribution = resiliency.type === 'REPLICATION' ?
            `${resiliency.replicas} copies` :
            `${resiliency.dataFrags} data + ${resiliency.parityFrags} parity fragments`;
        const configuredFailureTolerance = _getConfiguredFailureTolerance(resiliency);
        const requiredDrives = _getRequiredDrives(resiliency);
        const actualFailureTolerance = _getActualFailureTolerance(
            bucket.failureTolerance,
            resiliency.failureTolerance,
            resiliency.requiredDrives
        );
        const rebuildEffort = rebuildEffortToDisplay[resiliency.rebuildEffort];

        this.bucketName = bucketName;
        this.toggleUri = realizeUri(
            routes.bucket,
            { system, bucket: bucketName, tab, section: toggleSection }
        );
        this.stateIcon(getResiliencyStateIcon(bucket.resiliency));
        this.resiliencyType(getResiliencyTypeDisplay(resiliency.type));
        this.usingReplicationPolicy(resiliency.type === 'REPLICATION');
        this.usingErasureCodingPolicy(resiliency.type === 'ERASURE_CODING');
        this.dataDistribution(dataDistribution);
        this.numOfCopies(resiliency.replicas);
        this.numOfDataFrags(resiliency.dataFrags);
        this.numOfParityFrags(resiliency.parityFrags);
        this.storageOverhead(numeral(resiliency.storageOverhead).format('%'));
        this.configuredFailureTolerance(configuredFailureTolerance);
        this.actualFailureTolerance(actualFailureTolerance);
        this.requiredDrives(requiredDrives);
        this.rebuildEffort(rebuildEffort);
    }

    onToggleSection() {
        action$.next(requestLocation(this.toggleUri));
    }

    onEditDataResiliency(_ ,evt) {
        action$.next(openEditBucketDataResiliencyModal(this.bucketName));
        evt.stopPropagation();
    }
}

export default {
    viewModel: BucketDataResiliencyPolicyFormViewModel,
    template: template
};
