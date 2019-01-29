/* Copyright (C) 2016 NooBaa */

import template from './account-s3-access-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import {
    openEditAccountS3AccessModal,
    openSetAccountIpRestrictionsModal,
    openRegenerateAccountCredentialsModal
} from 'action-creators';

const disabledActionTooltip = 'This option is unavailable for accounts without S3 access';
const boxCount = 4;

class AccountS3AccessFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    accountName = ko.observable();
    isS3AccessDisabled = ko.observable();
    setIPRestrictionsButtonTooltip = ko.observable();
    regenerateCredentialsButtonTooltip = ko.observable();
    s3AccessInfo = [
        {
            label: 'S3 Access',
            value: ko.observable()
        },
        {
            label: 'Permitted Buckets',
            value: ko.observable(),
            disabled: ko.observable(),
            template: ko.observable()
        },
        {
            label: 'New Bucket Creation',
            value: ko.observable(),
            disabled: ko.observable()
        },
        {
            label: 'Default Resource for S3 Applications',
            value: ko.observable(),
            disabled: ko.observable()
        },
        {
            label: 'IP Restrictions',
            value: ko.observable(),
            disabled: ko.observable()
        },
        {
            label: 'Allowed IPs',
            value: ko.observable(),
            visible: ko.observable(),
            template: ko.observable()
        }
    ];
    credentials = [
        {
            label: 'Access Key',
            allowCopy: true,
            value: ko.observable(),
            disabled: ko.observable()
        },
        {
            label: 'Secret Key',
            allowCopy: true,
            value: ko.observable(),
            disabled: ko.observable()
        }
    ];

    selectState(state, params) {
        const { accounts } = state;
        return [
            accounts && accounts[params.accountName]
        ];
    }

    mapStateToProps(account) {
        if (!account) {
            ko.assignToProps(this, {
                dataReady: false,
                isS3AccessDisabled: true
            });

        } else {
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

            const regenerateCredentialsTooltip = !hasS3Access ? {
                align: 'end',
                text: disabledActionTooltip
            } : '';

            ko.assignToProps(this, {
                dataReady: true,
                accountName: account.name,
                isS3AccessDisabled: !hasS3Access,
                setIPRestrictionsButtonTooltip: hasS3Access ? '' : disabledActionTooltip,
                regenerateCredentialsButtonTooltip: regenerateCredentialsTooltip,
                s3AccessInfo: [
                    {
                        value: hasS3Access ? 'Enabled' : 'Disabled'
                    },
                    {
                        value: allowedBucketsInfo,
                        disabled: !hasS3Access,
                        template: allowedBucketsTemplate
                    },
                    {
                        value: account.canCreateBuckets ? 'Allowed' : 'Not Allowed',
                        disabled: !hasS3Access
                    },
                    {
                        value: defaultResource || 'Not set',
                        disabled: !hasS3Access
                    },
                    {
                        value: allowedIps ? 'Enabled' : 'Not set',
                        disabled: !hasS3Access
                    },
                    {
                        value: allowedIpsInfo,
                        visible: Boolean(hasS3Access && allowedIps),
                        template: allowedIpsTemplate
                    }
                ],
                credentials: [
                    {
                        value: accessKeys.accessKey,
                        disabled: !hasS3Access
                    },
                    {
                        value: accessKeys.secretKey,
                        disabled: !hasS3Access
                    }
                ]
            });
        }
    }

    onEditS3Access() {
        this.dispatch(
            openEditAccountS3AccessModal(this.accountName())
        );
    }

    onSetIPRestrictions() {
        this.dispatch(
            openSetAccountIpRestrictionsModal(this.accountName())
        );
    }

    onRegenerateAccountCredentials() {
        this.dispatch(
            openRegenerateAccountCredentialsModal(this.accountName())
        );
    }
}

export default {
    viewModel: AccountS3AccessFormViewModel,
    template: template
};
