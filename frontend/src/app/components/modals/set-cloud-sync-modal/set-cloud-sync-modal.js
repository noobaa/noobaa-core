/* Copyright (C) 2016 NooBaa */

import template from './set-cloud-sync-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo, sessionInfo, cloudBucketList } from 'model';
import { loadCloudBucketList, setCloudSyncPolicy } from 'actions';
import { deepFreeze } from 'utils/core-utils';
import { getCloudServiceMeta } from 'utils/ui-utils';
import { openAddCloudConnectionModal } from 'action-creators';
import { action$ } from 'state';

const [ MIN, HOUR, DAY ] = [ 1, 60, 60 * 24 ];

const frequencyUnitOptions = deepFreeze([
    {
        value: MIN,
        label: 'Minutes'
    },
    {
        value: HOUR,
        label: 'Hours'
    },
    {
        value: DAY,
        label: 'Days'
    }
]);

const directionOptions = deepFreeze([
    {
        value: 3,
        label: 'Bi-Direcitonal',
        leftSymbol: 'arrow-left',
        rightSymbol: 'arrow-right'
    },
    {
        value: 1,
        label: 'Source to Target',
        leftSymbol: 'arrow-line',
        rightSymbol: 'arrow-right'
    },
    {
        value: 2,
        label: 'Target to Source',
        leftSymbol: 'arrow-left',
        rightSymbol: 'arrow-line'
    }
]);

const addConnectionOption = deepFreeze({
    label: 'Add new connection',
    value: {}
});

const allowedServices = deepFreeze([
    'AWS',
    'S3_COMPATIBLE'
]);

const usedTargetTooltip = deepFreeze({
    CLOUD_RESOURCE: name => `Already used by ${name} cloud resource`,
    NAMESPACE_RESOURCE: name => `Already used by ${name} namespace resource`,    
    CLOUD_SYNC: name => `Already used by bucket's ${name} cloud sync policy`
});

class SetCloudSyncModalViewModel extends BaseViewModel {
    constructor({ bucketName, onClose }) {
        super();

        this.allowedServices = allowedServices;
        this.onClose = onClose;
        this.bucketName = bucketName;

        const cloudConnections = ko.pureComputed(
            () => {
                const user = (systemInfo() ? systemInfo().accounts : []).find(
                    account => account.email === sessionInfo().user
                );

                return user.external_connections.connections;
            }
        );

        this.connectionOptions = ko.pureComputed(
            () => [
                addConnectionOption,
                null,
                ...cloudConnections()
                    .filter(
                        connection => allowedServices.some(
                            service => connection.endpoint_type === service
                        )
                    )
                    .map(
                        connection => {
                            const { identity, name = identity, endpoint_type } = connection;
                            const { icon, selectedIcon } = getCloudServiceMeta(endpoint_type);
                            return {
                                label: name,
                                value: connection,
                                remark: identity,
                                icon: icon,
                                selectedIcon: selectedIcon
                            };
                        }
                    )
            ]
        );

        let _connection = ko.observable();
        this.connection = ko.pureComputed({
            read: _connection,
            write: value => {
                if (value !== addConnectionOption.value) {
                    _connection(value);
                } else {
                    _connection(_connection() || null);
                    action$.onNext(openAddCloudConnectionModal());
                }
            }
        })
            .extend({
                required: { message: 'Please select a connection from the list' }
            });

        this.addToDisposeList(
            this.connection.subscribe(
                value => {
                    this.targetBucket(null);
                    value && this.loadBucketsList();
                }
            )
        );

        this.targetBucketsOptions = ko.pureComputed(
            () => this.connection() && cloudBucketList() && cloudBucketList().map(
                ({ name, used_by }) => {
                    const targetName = name;
                    if (used_by) {
                        const { usage_type, name } = used_by;
                        return {
                            value: targetName,
                            disabled: true,
                            tooltip: usedTargetTooltip[usage_type](name)
                        };

                    } else {
                        return { value: targetName };
                    }
                }
            )
        );

        this.targetBucket = ko.observable()
            .extend({
                required: {
                    onlyIf: this.connection,
                    message: 'Please select a bucket from the list'
                }
            });

        this.directionOption = ko.pureComputed(
            () => this.direction() && directionOptions
                .find(
                    dir => dir.value === this.direction()
                )
        );

        this.leftSymbol = ko.pureComputed(
            () => this.directionOption().leftSymbol
        );

        this.rightSymbol = ko.pureComputed(
            () => this.directionOption().rightSymbol
        );

        this.targetBucketName = ko.pureComputed(
            () => this.targetBucket() || 'Not configured'
        );

        this.direction = ko.observable(3);
        this.directionOptions = directionOptions;

        this.frequency = ko.observable(1)
            .extend({
                required: { message: 'Please enter a value greater than or equal to 1' },
                min: 1
            });

        this.frequencyUnit = ko.observable(HOUR);
        this.frequencyUnitOptions = frequencyUnitOptions;

        let _syncDeletions = ko.observable(true);
        this.syncDeletions = ko.pureComputed({
            read: () => this.direction() === 3 ? true : _syncDeletions(),
            write: _syncDeletions
        });

        this.errors = ko.validation.group(this);
    }

    loadBucketsList() {
        loadCloudBucketList(this.connection().name);
    }

    cancel() {
        this.onClose();
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            setCloudSyncPolicy(
                ko.unwrap(this.bucketName),
                this.connection().name,
                this.targetBucket(),
                this.direction(),
                this.frequency() * this.frequencyUnit(),
                this.syncDeletions()
            );
            this.onClose();
        }
    }
}

export default {
    viewModel: SetCloudSyncModalViewModel,
    template: template
};

