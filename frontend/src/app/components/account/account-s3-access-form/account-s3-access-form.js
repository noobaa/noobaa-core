/* Copyright (C) 2016 NooBaa */

import template from './account-s3-access-form.html';
import { state$, dispatch } from 'state';
import Observer from 'observer';
import ko from 'knockout';
import { openEditAccountS3AccessModal, openSetAccountIpRestrictions } from 'action-creators';

const disabledActionTooltip = 'This option is unavailable for accounts without S3 access';

function _createIpListHtml(ipList) {
    return `<ul class="list-no-style row multiline">${
        ipList
            .map(ip => `<li class="ip-box">${ip}</li>`)
            .join('')
    }</ul>`;
}

class AccountS3AccessFormViewModel extends Observer {
    constructor() {
        super();

        this.accountName = ko.observable();
        this.isS3AccessDisabled = ko.observable();
        this.s3AccessLabel = ko.observable();
        this.allowedBuckets = ko.observable();
        this.defaultResource = ko.observable();
        this.accessKey = ko.observable();
        this.secretKey = ko.observable();
        this.ipRestrictions = ko.observable();
        this.allowedIps = ko.observable();
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
                disabled: this.isS3AccessDisabled
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
                multiline: true
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
            state$.getMany('accounts', ['location', 'params', 'account']),
            this.onAccount
        );

        // TODO: Move RegenerateAccountCredentialsModal into Modal Maneger
        this.isRegenerateAccountCredentialsModalVisible = ko.observable(false);
    }

    onAccount([ accounts, accountName ]) {
        const account = accounts[accountName];
        if (!account) return;

        const {
            defaultResource,
            hasS3Access,
            hasAccessToAllBuckets,
            allowedBuckets,
            accessKeys,
            allowedIps
        } = account;

        this.accountName(accountName);
        this.defaultResource(defaultResource || '(not set)');
        this.isS3AccessDisabled(!hasS3Access);
        this.s3AccessLabel(hasS3Access ? 'Enabled' : 'Disabled');
        this.allowedBuckets(hasAccessToAllBuckets ?
            'All current and future buckets' :
            (allowedBuckets.length ? allowedBuckets.join(', ') : '(none)')
        );
        this.accessKey(accessKeys.accessKey);
        this.secretKey(accessKeys.secretKey);
        this.ipRestrictions(allowedIps ? 'Enabled' : 'Not set');
        this.isAllowedIpVisible(Boolean(hasS3Access && allowedIps));
        this.allowedIps(
            allowedIps &&
            (allowedIps.length ? _createIpListHtml(allowedIps) : 'No IP allowed')
        );
        this.setIPRestrictionsButtonTooltip(hasS3Access ? '' : disabledActionTooltip);
        this.regenerateCredentialsButtonTooltip(hasS3Access ? '' : disabledActionTooltip);
    }

    onEditS3Access() {
        dispatch(openEditAccountS3AccessModal(this.accountName()));
    }

    onSetIPRestrictions() {
        dispatch(openSetAccountIpRestrictions(this.accountName()));
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
