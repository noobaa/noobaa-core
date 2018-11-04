/* Copyright (C) 2016 NooBaa */

import template from './account-s3-access-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { get } from 'rx-extensions';
import {
    openEditAccountS3AccessModal,
    openSetAccountIpRestrictionsModal,
    openRegenerateAccountCredentialsModal
} from 'action-creators';

const disabledActionTooltip = 'This option is unavailable for accounts without S3 access';
const boxCount = 4;

class AccountS3AccessFormViewModel extends Observer {
    accountName = ko.observable();
    isAccountLoaded = ko.observable();
    isS3AccessDisabled = ko.observable();
    s3AccessLabel = ko.observable();
    allowedBuckets = ko.observable();
    allowedBucketsTemplate = ko.observable();
    canCreateBuckets = ko.observable();
    defaultResource = ko.observable();
    accessKey = ko.observable();
    secretKey = ko.observable();
    ipRestrictions = ko.observable();
    allowedIps = ko.observable();
    allowedIpsTemplate = ko.observable();
    isAllowedIpVisible = ko.observable();
    setIPRestrictionsButtonTooltip = ko.observable();
    regenerateCredentialsButtonTooltip = ko.observable();

    s3AccessInfo = [
        {
            label: 'S3 Access',
            value: this.s3AccessLabel
        },
        {
            label: 'Permitted Buckets',
            value: this.allowedBuckets,
            disabled: this.isS3AccessDisabled,
            template: this.allowedBucketsTemplate
        },
        {
            label: 'New Bucket Creation',
            value: this.canCreateBuckets,
            disabled: this.isS3AccessDisabled
        },
        {
            label: 'Default Resource for S3 Applications',
            value: this.defaultResource,
            disabled: this.isS3AccessDisabled
        },
        {
            label: 'IP Restrictions',
            value: this.ipRestrictions,
            disabled: this.isS3AccessDisabled
        },
        {
            label: 'Allowed IPs',
            value: this.allowedIps,
            visible: this.isAllowedIpVisible,
            template: this.allowedIpsTemplate
        }

    ];

    credentials = [
        {
            label: 'Access Key',
            value: this.accessKey,
            allowCopy: true,
            disabled: this.isS3AccessDisabled
        },
        {
            label: 'Secret Key',
            value: this.secretKey,
            allowCopy: true,
            disabled: this.isS3AccessDisabled
        }
    ];

    constructor({ accountName }) {
        super();

        this.observe(
            state$.pipe(get('accounts', ko.unwrap(accountName))),
            this.onAccount
        );
    }

    onAccount(account) {
        if (!account) {
            this.isAccountLoaded(false);
            this.isS3AccessDisabled(true);
            return;
        }

        const {
            defaultResource,
            hasS3Access,
            hasAccessToAllBuckets,
            allowedBuckets,
            accessKeys,
            allowedIps
        } = account;

        let allowedIpsTemplate;
        let allowedIpsInfo = 'No IP allowed';
        if (allowedIps && allowedIps.length) {
            const formattedIpList =  allowedIps.map(({ start, end }) => {
                return start === end ? start : `${start} - ${end}`;
            });

            allowedIpsInfo = { tags: formattedIpList, boxCount };
            allowedIpsTemplate = 'list';
        }

        let allowedBucketsTemplate;
        let allowedBucketsInfo = 'All current and future buckets';
        if (!hasAccessToAllBuckets) {
            allowedBucketsInfo = allowedBuckets.length ? { tags: allowedBuckets, boxCount } : '(none)';
            allowedBucketsTemplate = allowedBuckets.length && 'list';
        }

        const regenerateCredentialsTooltip = !hasS3Access ?
            { align: 'end', text: disabledActionTooltip } :
            '';

        this.accountName(account.name);
        this.defaultResource(defaultResource || '(not set)');
        this.isS3AccessDisabled(!hasS3Access);
        this.s3AccessLabel(hasS3Access ? 'Enabled' : 'Disabled');
        this.allowedBuckets(allowedBucketsInfo);
        this.allowedBucketsTemplate(allowedBucketsTemplate);
        this.canCreateBuckets(account.canCreateBuckets ? 'Allowed' : 'Not Allowed');
        this.accessKey(accessKeys.accessKey);
        this.secretKey(accessKeys.secretKey);
        this.ipRestrictions(allowedIps ? 'Enabled' : 'Not set');
        this.allowedIps(allowedIpsInfo);
        this.allowedIpsTemplate(allowedIpsTemplate);
        this.isAllowedIpVisible(Boolean(hasS3Access && allowedIps));
        this.setIPRestrictionsButtonTooltip(hasS3Access ? '' : disabledActionTooltip);
        this.regenerateCredentialsButtonTooltip(regenerateCredentialsTooltip);
        this.isAccountLoaded(true);
    }

    onEditS3Access() {
        action$.next(openEditAccountS3AccessModal(this.accountName()));
    }

    onSetIPRestrictions() {
        action$.next(openSetAccountIpRestrictionsModal(this.accountName()));
    }

    onRegenerateAccountCredentials() {
        action$.next(openRegenerateAccountCredentialsModal(this.accountName()));
    }
}

export default {
    viewModel: AccountS3AccessFormViewModel,
    template: template
};
