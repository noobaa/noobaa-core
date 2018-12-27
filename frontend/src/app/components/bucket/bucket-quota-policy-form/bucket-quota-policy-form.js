/* Copyright (C) 2016 NooBaa */

import template from './bucket-quota-policy-form.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { formatSize, fromBigInteger, toBigInteger, bigInteger } from 'utils/size-utils';
import { getQuotaValue, getQuotaStateIcon } from 'utils/bucket-utils';
import ko from 'knockout';
import * as routes from 'routes';
import { requestLocation, openEditBucketQuotaModal } from 'action-creators';

const policyName = 'quota';

const disabledIcon = deepFreeze({
    name: 'healthy',
    css: 'disabled',
    tooltip: {
        text: 'Disabled',
        align: 'start'
    }
});

class BucketQuotaPolicyFormViewModel extends ConnectableViewModel {
    bucketName = '';
    isExpanded = ko.observable();
    isQuotaDisabled = ko.observable();
    stateIcon = ko.observable({});
    summary = ko.observable();
    quotaStateText = ko.observable();
    quotaSize = ko.observable();
    dataLeftUntilQuota = ko.observable();
    toggleUri = '';
    info = [
        {
            label: 'Bucket Quota',
            value: this.quotaStateText
        },
        {
            label: 'Configured Limit',
            value: this.quotaSize
        },
        {
            label: 'Data left to reach quota',
            value: this.dataLeftUntilQuota,
            disabled: this.isQuotaDisabled
        }
    ];

    selectState(state) {
        return [
            state.location,
            state.buckets
        ];
    }

    mapStateToProps(location, buckets) {
        const { system, bucket: bucketName, tab = 'data-policies', section } = location.params;
        const isExpanded = section === policyName;

        if (!buckets || !buckets[bucketName]) {
            ko.assignToProps(this, {
                isExpanded,
                stateIcon: disabledIcon,
                quotaStateText: 'Disabled',
                summary: ''
            });

        } else {
            const toggleSection = section === policyName ? undefined : policyName;
            const toggleUri = realizeUri(routes.bucket, {
                system,
                bucket: bucketName,
                tab,
                section: toggleSection
            });
            const { quota, data } = buckets[bucketName];

            if (quota) {
                const quotaSize = getQuotaValue(quota);
                const dataLeftUntilQuota = fromBigInteger(
                    bigInteger.max(
                        toBigInteger(quotaSize).subtract(data.size),
                        bigInteger.zero
                    )
                );

                ko.assignToProps(this, {
                    isExpanded,
                    bucketName,
                    toggleUri,
                    isQuotaDisabled: false,
                    stateIcon: getQuotaStateIcon(quota),
                    summary: `Set to ${formatSize(quotaSize)}`,
                    quotaStateText: 'Enabled',
                    quotaSize: formatSize(quotaSize),
                    dataLeftUntilQuota: formatSize(dataLeftUntilQuota)
                });

            } else {
                ko.assignToProps(this, {
                    isExpanded,
                    bucketName,
                    toggleUri,
                    isQuotaDisabled: true,
                    stateIcon: disabledIcon,
                    summary: 'Limit not set',
                    quotaStateText: 'Disabled',
                    quotaSize: 'Not set',
                    dataLeftUntilQuota: 'None'
                });
            }
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onEditQuota(_, evt) {
        this.dispatch(openEditBucketQuotaModal(this.bucketName));
        evt.stopPropagation();
    }
}

export default {
    viewModel: BucketQuotaPolicyFormViewModel,
    template: template
};
