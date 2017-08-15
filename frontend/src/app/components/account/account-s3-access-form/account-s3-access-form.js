/* Copyright (C) 2016 NooBaa */

import template from './account-s3-access-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { openEditAccountS3AccessModal, openSetAccountIpRestrictions } from 'action-creators';

const disabledActionTooltip = 'This option is unavailable for accounts without S3 access';
const boxCount = 3;

function _prepareListTemplateData(items) {
    const visibleItems = items
        .slice(0, boxCount)
        .map(item => ({
            text: item,
            tooltip: {
                text: item,
                breakWords: true
            }
        }));
    const hasExtra = items.length > boxCount;
    const extraText =  `${items.length - boxCount} more`;
    const extraTooltip = {
        text: items.slice(boxCount),
        align: 'end',
        breakWords: true
    };

    return {
        visibleItems,
        hasExtra,
        extraText,
        extraTooltip,
        boxCount
    };
}

class AccountS3AccessFormViewModel extends Observer {
    constructor({ accountName }) {
        super();

        this.accountName = ko.observable();
        this.isS3AccessDisabled = ko.observable();
        this.s3AccessLabel = ko.observable();
        this.allowedBuckets = ko.observable();
        this.allowedBucketsTemplate = ko.observable();
        this.defaultResource = ko.observable();
        this.accessKey = ko.observable();
        this.secretKey = ko.observable();
        this.ipRestrictions = ko.observable();
        this.allowedIps = ko.observable();
        this.allowedIpsTemplate = ko.observable();
        this.isAllowedIpVisible = ko.observable();
        this.setIPRestrictionsButtonTooltip = ko.observable();
        this.regenerateCredentialsButtonTooltip = ko.observable();

        this.s3AccessInfo = [
            {
                label: 'S3 Access',
                value: this.s3AccessLabel
            },
            {
                label: 'Permitted buckets',
                value: this.allowedBuckets,
                disabled: this.isS3AccessDisabled,
                template: this.allowedBucketsTemplate
            },
            {
                label: 'Default resource for S3 applications',
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

        this.credentials = [
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

        this.observe(
            state$.get('accounts', ko.unwrap(accountName)),
            this.onAccount
        );

        // TODO: Move RegenerateAccountCredentialsModal into Modal Maneger
        this.isRegenerateAccountCredentialsModalVisible = ko.observable(false);
    }

    onAccount(account) {
        if (!account) return;

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

            allowedIpsInfo = _prepareListTemplateData(formattedIpList);
            allowedIpsTemplate = 'list';
        }

        let allowedBucketsTemplate;
        let allowedBucketsInfo = 'All current and future buckets';
        if (!hasAccessToAllBuckets) {
            allowedBucketsInfo = allowedBuckets.length ? _prepareListTemplateData(allowedBuckets) : '(none)';
            allowedBucketsTemplate = allowedBuckets.length && 'list';
        }

        this.accountName(account.name);
        this.defaultResource(defaultResource || '(not set)');
        this.isS3AccessDisabled(!hasS3Access);
        this.s3AccessLabel(hasS3Access ? 'Enabled' : 'Disabled');
        this.allowedBuckets(allowedBucketsInfo);
        this.allowedBucketsTemplate(allowedBucketsTemplate);
        this.accessKey(accessKeys.accessKey);
        this.secretKey(accessKeys.secretKey);
        this.ipRestrictions(allowedIps ? 'Enabled' : 'Not set');
        this.allowedIps(allowedIpsInfo);
        this.allowedIpsTemplate(allowedIpsTemplate);
        this.isAllowedIpVisible(Boolean(hasS3Access && allowedIps));
        this.setIPRestrictionsButtonTooltip(hasS3Access ? '' : disabledActionTooltip);
        this.regenerateCredentialsButtonTooltip(hasS3Access ? '' : disabledActionTooltip);
    }

    onEditS3Access() {
        action$.onNext(openEditAccountS3AccessModal(this.accountName()));
    }

    onSetIPRestrictions() {
        action$.onNext(openSetAccountIpRestrictions(this.accountName()));
    }

    showRegenerateAccountCredentialsModal() {
        this.isRegenerateAccountCredentialsModalVisible(true);
    }

    hideRegenerateAccountCredentialsModal() {
        this.isRegenerateAccountCredentialsModalVisible(false);
    }
}

export default {
    viewModel: AccountS3AccessFormViewModel,
    template: template
};
