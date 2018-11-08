/* Copyright (C) 2016 NooBaa */

import template from './bucket-quota-policy-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { formatSize, fromBigInteger, toBigInteger } from 'utils/size-utils';
import { getQuotaValue, getQuotaStateIcon } from 'utils/bucket-utils';
import ko from 'knockout';
import { getMany } from 'rx-extensions';
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

class BucketQuotaPolicyFormViewModel extends Observer {
    bucket = '';
    isExpanded = ko.observable();
    isQuotaDisabled = ko.observable();
    stateIcon = ko.observable();
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
        const { system, bucket, tab = 'data-policies', section } = location.params;
        this.isExpanded(section === policyName);

        if (!buckets || !buckets[bucket]) {
            this.stateIcon(disabledIcon);
            this.quotaStateText('Disabled');
            this.summary('');
            return;
        }

        const toggleSection = section === policyName ? undefined : policyName;
        const toggleUri = realizeUri(
            routes.bucket,
            { system, bucket, tab, section: toggleSection }
        );

        this.bucketName = bucket;
        this.toggleUri = toggleUri;

        const { quota, data } = buckets[bucket];
        if (quota) {
            const quotaSize = getQuotaValue(quota);
            const dataLeftUntilQuota = Math.max(
                0,
                fromBigInteger(toBigInteger(quotaSize).subtract(data.size))
            );

            this.isQuotaDisabled(false);
            this.stateIcon(getQuotaStateIcon(quota));
            this.summary(`Set to ${formatSize(quotaSize)}`);
            this.quotaStateText('Enabled');
            this.quotaSize(formatSize(quotaSize));
            this.dataLeftUntilQuota(formatSize(dataLeftUntilQuota));

        } else {
            this.isQuotaDisabled(true);
            this.stateIcon(disabledIcon);
            this.summary('Limit not set');
            this.quotaStateText('Disabled');
            this.quotaSize('Not set');
            this.dataLeftUntilQuota('None');
        }
    }

    onToggleSection() {
        action$.next(requestLocation(this.toggleUri));
    }

    onEditQuota(_, evt) {
        action$.next(openEditBucketQuotaModal(this.bucketName));
        evt.stopPropagation();
    }
}

export default {
    viewModel: BucketQuotaPolicyFormViewModel,
    template: template
};
