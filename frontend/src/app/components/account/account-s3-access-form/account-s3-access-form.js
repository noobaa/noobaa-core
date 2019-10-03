/* Copyright (C) 2016 NooBaa */

import template from './account-s3-access-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import {
    openEditAccountS3AccessModal,
    openSetAccountIpRestrictionsModal,
    openRegenerateAccountCredentialsModal
} from 'action-creators';

const boxCount = 4;


function _getAllowedIpsInfo(allowedIps = []) {
    return {
        tags: allowedIps.map(({ start, end }) => {
            return start === end ? start : `${start} - ${end}`;
        }),
        maxCount: boxCount,
        emptyMessage: 'No IP allowed'
    };
}

function _getAllowedBucketsInfo(hasAccessToAllBuckets, allowedBuckets) {
    return {
        tags: hasAccessToAllBuckets ? [] : allowedBuckets,
        maxCount: boxCount,
        emptyMessage: hasAccessToAllBuckets ?
            'All current and future buckets' :
            '(None)'
    };
}


class AccountS3AccessFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    accountName = ko.observable();
    s3AccessInfo = [
        {
            label: 'Access Type',
            value: ko.observable()
        },
        {
            label: 'Permitted Buckets',
            template: 'tagList',
            value: {
                tags: ko.observableArray(),
                maxCount: boxCount,
                emptyMessage: ko.observable()
            },
            disabled: ko.observable()
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
            template: 'tagList',
            value: {
                tags: ko.observableArray(),
                maxCount: boxCount,
                emptyMessage: ko.observable()
            },
            visible: ko.observable()
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
                dataReady: false
            });

        } else {
            const {
                defaultResource,
                isAdmin,
                hasAccessToAllBuckets,
                allowedBuckets,
                accessKeys,
                allowedIps
            } = account;


            const defaultResourceName =
                (defaultResource === 'INTERNAL_STORAGE' && 'Internal Storage') ||
                defaultResource ||
                'Not Set';

            ko.assignToProps(this, {
                dataReady: true,
                accountName: account.name,
                s3AccessInfo: [
                    { value: isAdmin ? 'Administator' : 'Application' },
                    { value: _getAllowedBucketsInfo(hasAccessToAllBuckets, allowedBuckets) },
                    { value: account.canCreateBuckets ? 'Allowed' : 'Not Allowed' },
                    { value: defaultResourceName },
                    { value: allowedIps ? 'Enabled' : 'Not set' },
                    {
                        value: _getAllowedIpsInfo(allowedIps),
                        visible: Boolean(allowedIps)
                    }
                ],
                credentials: [
                    { value: accessKeys.accessKey },
                    { value: accessKeys.secretKey }
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
