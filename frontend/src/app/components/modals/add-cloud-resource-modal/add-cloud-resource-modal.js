/* Copyright (C) 2016 NooBaa */

import template from './add-cloud-resource-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo, sessionInfo, cloudBucketList } from 'model';
import { loadCloudBucketList, createCloudResource } from 'actions';
import nameValidationRules from 'name-validation-rules';
import { deepFreeze } from 'utils/core-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { action$ } from 'state';
import { openAddCloudConnectionModal } from 'action-creators';

const usedTargetTooltip = deepFreeze({
    CLOUD_RESOURCE: name => `Already used by ${name} cloud resource`,
    NAMESPACE_RESOURCE: name => `Already used by ${name} namespace resource`,
    CLOUD_SYNC: name => `Already used by bucket's ${name} cloud sync policy`
});

const allowedServices = deepFreeze([
    'AWS',
    'S3_COMPATIBLE',
    'AZURE',
    'GOOGLE'
]);

class AddCloudResourceModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();
        this.onClose = onClose;
        this.wasValidated = ko.observable(false);
        this.fetchingTargetBucketsOptions = ko.observable(false);

        const cloudConnections = ko.pureComputed(
            () => {
                const user = (systemInfo() ? systemInfo().accounts : []).find(
                    account => account.email === sessionInfo().user
                );

                return user.external_connections.connections;
            }
        );

        this.connectionOptions = ko.pureComputed(
            () => cloudConnections()
                .filter(connection => allowedServices.some(
                        service => connection.endpoint_type === service
                ))
                .map(connection => {
                    const { identity, name = identity, endpoint_type } = connection;
                    const { icon, selectedIcon } = getCloudServiceMeta(endpoint_type);
                    return {
                        label: name,
                        value: connection,
                        remark: identity,
                        icon: icon,
                        selectedIcon: selectedIcon
                    };
                })
        );

        this.connectionActions = deepFreeze([
            {
                label: 'Add new connection',
                onClick: this.onAddNewConnection.bind(this)
            }
        ]);

        this.connection = ko.observable()
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

        const targetSubject = ko.pureComputed(
            () => {
                const { endpoint_type = 'AWS' } = this.connection() || {};
                return getCloudServiceMeta(endpoint_type).subject;
            }
        );

        this.targeBucketLabel = ko.pureComputed(
            () => `Target ${targetSubject()}`
        );

        this.targetBucketPlaceholder = ko.pureComputed(
            () => `Choose ${targetSubject()}...`
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

        this.targetBucketsOptions.subscribe(
            options => this.fetchingTargetBucketsOptions(!options.length)
        );

        this.targetBucket = ko.observable()
            .extend({
                required: {
                    onlyIf: this.connection,
                    message: () => {
                        const { endpoint_type = 'AWS' } = this.connection() || {};
                        return `Please select a ${
                            getCloudServiceMeta(endpoint_type).subject.toLowerCase()
                        } from the list`;
                    }
                }
            });

        const namesInUse = ko.pureComputed(
            () => systemInfo() && systemInfo().pools.map(
                pool => pool.name
            )
        );

        this.resourceName = ko.observableWithDefault(
            () => {
                let i = 0;
                let name = (this.targetBucket() || '').toLowerCase();
                while (namesInUse().includes(name)) {
                    name = `${this.targetBucket()}-${++i}`;
                }

                return name;
            }
        )
            .extend({
                validation: nameValidationRules(
                    'resoruce',
                    namesInUse,
                    this.targetBucket
                )
            });

        this.errors = ko.validation.group([
            this.connection,
            this.targetBucket,
            this.resourceName
        ]);
    }

    loadBucketsList() {
        this.fetchingTargetBucketsOptions(true);
        loadCloudBucketList(this.connection().name);
    }

    onAddNewConnection() {
        action$.onNext(openAddCloudConnectionModal(allowedServices));
    }

    add() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
            this.wasValidated(true);
        } else {
            createCloudResource(this.resourceName(), this.connection().name, this.targetBucket());
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: AddCloudResourceModalViewModel,
    template: template
};

