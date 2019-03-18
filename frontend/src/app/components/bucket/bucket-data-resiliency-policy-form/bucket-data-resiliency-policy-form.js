/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-resiliency-policy-form.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import ko from 'knockout';
import numeral from 'numeral';
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
        moreInfo: {
            severity: 'normal',
            tooltip: {
                text: 'Rebuild time effort has 3 options: Low/High/Very High and might change according to the amount of fragments or replicas',
                position: 'above'
            }
        }
    },
    HIGH: {
        text: 'High',
        moreInfo: {
            severity: 'normal',
            tooltip: {
                text: 'Rebuild time effort has 3 options: Low/High/Very High and might change according to the amount of fragments or replicas',
                position: 'above'
            }
        }
    },
    VERY_HIGH: {
        text: 'Very High',
        css: 'error',
        moreInfo: {
            severity: 'warning',
            tooltip: {
                text: 'Parity fragments rebuild time might take a while, varies according to data placement policy resources and type',
                position: 'above'
            }
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
            moreInfo: {
                severity: 'warning',
                tooltip: {
                    text: 'It is not recommended to use a resiliency policy which results in less than a fault tolerance value of 2',
                    position: 'above'
                }
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
            css: 'error',
            moreInfo: {
                severity: 'error',
                tooltip: {
                    text: `One or more of the configured mirror sets have less than ${requiredDrives} healthy nodes/drives. This brings the bucket\'s actual tolerance below the configured tolerance`,
                    position: 'above'
                }
            }
        };
    } else {
        return {
            text: text,
            moreInfo: {
                severity: 'normal',
                tooltip: {
                    text: 'The current number of nodes and drives that can suffer failure without causing any data loss',
                    position: 'above'
                }
            }
        };
    }
}

function _getRequiredDrives(resiliency) {
    const { requiredDrives } = resiliency;
    const text = `${requiredDrives} drives per mirror set`;
    return { text };
}

class BucketDataResiliencyPolicyFormViewModel extends ConnectableViewModel {
    isExpanded = ko.observable();
    bucketName = '';
    toggleUri = '';
    stateIcon = {
        name: ko.observable(),
        css: ko.observable(),
        tooltip: ko.observable()
    };
    resiliencyType = ko.observable();
    dataDistribution = ko.observable();
    info = [
        {
            label: 'Data Resiliency Type',
            value: ko.observable()
        },
        {
            label: 'Number of Copies',
            value: ko.observable(),
            visible: ko.observable()
        },
        {
            label: 'Number of data fragments',
            value: ko.observable(),
            visible: ko.observable()
        },
        {
            label: 'Number of parity fragments',
            value: ko.observable(),
            visible: ko.observable()
        },
        {
            label: 'Storage Overhead',
            value: ko.observable()
        },
        {
            label: 'Minimum Required Drives',
            template: 'messageWithSeverity',
            value: {
                css: ko.observable(),
                text: ko.observable(),
                moreInfo: ko.observable()
            }
        },
        {
            label: 'Configured Failure Tolerance',
            template: 'messageWithSeverity',
            value: {
                css: ko.observable(),
                text: ko.observable(),
                moreInfo: ko.observable()
            }
        },
        {
            label: 'Actual Failure Tolerance',
            template: 'messageWithSeverity',
            value: {
                css: ko.observable(),
                text: ko.observable(),
                moreInfo: ko.observable()
            }
        },
        {
            label: 'Rebuild time effort',
            template: 'messageWithSeverity',
            value: {
                css: ko.observable(),
                text: ko.observable(),
                moreInfo: ko.observable()
            }
        }
    ];

    selectState(state) {
        const { location, buckets } = state;
        const { bucket: bucketName } = location.params;
        return [
            location,
            buckets && buckets[bucketName]
        ];
    }

    mapStateToProps(location, bucket) {
        if (!bucket) {
            ko.assignToProps(this, {
                isExpanded: false
            });

        } else {
            const { system, tab = 'data-policies', section } = location.params;
            const toggleUri = realizeUri(routes.bucket, {
                system,
                bucket: bucket.name,
                tab,
                section: section === policyName ? undefined : policyName
            });
            const resiliency = summrizeResiliency(bucket.resiliency);
            const resiliencyType = getResiliencyTypeDisplay(resiliency.type);

            ko.assignToProps(this, {
                isExpanded: section === policyName,
                bucketName: bucket.name,
                toggleUri,
                stateIcon: getResiliencyStateIcon(bucket.resiliency),
                resiliencyType,
                dataDistribution: resiliency.type === 'REPLICATION' ?
                    `${resiliency.replicas} copies` :
                    `${resiliency.dataFrags} data + ${resiliency.parityFrags} parity fragments`,
                info: [
                    {
                        label: 'Data Resiliency Type',
                        value: resiliencyType
                    },
                    {
                        label: 'Number of Copies',
                        value: resiliency.replicas,
                        visible: resiliency.type === 'REPLICATION'
                    },
                    {
                        label: 'Number of data fragments',
                        value: resiliency.dataFrags,
                        visible: resiliency.type === 'ERASURE_CODING'
                    },
                    {
                        label: 'Number of parity fragments',
                        value: resiliency.parityFrags,
                        visible: resiliency.type === 'ERASURE_CODING'
                    },
                    {
                        label: 'Storage Overhead',
                        value: numeral(resiliency.storageOverhead).format('%')
                    },
                    {
                        label: 'Minimum Required Drives',
                        template: 'messageWithSeverity',
                        value: _getRequiredDrives(resiliency)
                    },
                    {
                        label: 'Configured Failure Tolerance',
                        template: 'messageWithSeverity',
                        value: _getConfiguredFailureTolerance(resiliency)
                    },
                    {
                        label: 'Actual Failure Tolerance',
                        template: 'messageWithSeverity',
                        value: _getActualFailureTolerance(
                            bucket.failureTolerance,
                            resiliency.failureTolerance,
                            resiliency.requiredDrives
                        )
                    },
                    {
                        label: 'Rebuild time effort',
                        template: 'messageWithSeverity',
                        value: rebuildEffortToDisplay[resiliency.rebuildEffort]
                    }
                ]
            });
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onEditDataResiliency(_ ,evt) {
        this.dispatch(openEditBucketDataResiliencyModal(this.bucketName));
        evt.stopPropagation();
    }
}

export default {
    viewModel: BucketDataResiliencyPolicyFormViewModel,
    template: template
};
