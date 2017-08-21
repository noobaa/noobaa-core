/* Copyright (C) 2016 NooBaa */

import template from './edit-host-storage-drives-modal.html';
import Observer from 'observer';
import DriveNodeRowViewModel from './drive-node-row';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import { openDisableHostStorageWarningModal, toggleHostNodes } from 'action-creators';
import { deepFreeze, keyByProperty, mapValues } from 'utils/core-utils';
import ko from 'knockout';

const columns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'mount',
        label: 'Drive Name'
    },
    {
        name: 'capacity',
        label: 'used capacity',
        type: 'capacity',
    },
]);

const disabledModes = deepFreeze([
    'DECOMMISSIONED',
    'DECOMMISSIONING'
]);

const formName = 'editStorageDrives';

class EditHostStorageDrivesModalViewModel extends Observer {
    constructor({ host, onClose }) {
        super();

        this.host = ko.unwrap(host);
        this.isLastService = false;
        this.close = onClose;
        this.columns = columns;
        this.rows = ko.observableArray();
        this.formReady = ko.observable(false);
        this.form = null;

        this.onToggleNode = this.onToggleNode.bind(this);

        this.observe(
            state$.getMany(
                ['hosts', 'items', this.host, 'services'],
                ['forms', formName, 'fields']
            ),
            this.onHostStorageService
        );
    }

    onHostStorageService([ services, formFields ]) {
        if (!services) return;

        const { gateway, storage } = services;
        const nodesState = formFields ? formFields.nodesState.value : {};
        const rows = storage.nodes
            .map((node, i) => {
                const row = this.rows()[i] || new DriveNodeRowViewModel({ onToggle: this.onToggleNode });
                row.onNode(node, Boolean(nodesState[node.name]));
                return row;
            });

        this.isLastService = disabledModes.includes(gateway.mode);
        this.rows(rows);
        this.formReady(Boolean(formFields));

        // Initalize the form once.
        if (!this.formReady())  {
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    serviceState: storage.enabled,
                    nodesState: keyByProperty(
                        storage.nodes,
                        'name',
                        node => !disabledModes.includes(node.mode)
                    ),
                },
                onValidate: this.onValidate.bind(this),
                onSubmit: this.onSubmit.bind(this)
            });
        }
    }

    onValidate({ serviceState, nodesState }) {
        const errors = {};

        if (serviceState && Object.values(nodesState).every(val => !val)) {
            errors.nodesState = 'Please select at least one drive or disable the service';
        }

        return errors;
    }

    onToggleNode(node, select) {
        const { nodesState } = this.form;
        nodesState({ ...nodesState(), [node]: select });
    }

    onSubmit({ serviceState, nodesState }) {
        const action = serviceState ?
            toggleHostNodes(this.host, nodesState) :
            openDisableHostStorageWarningModal(this.host, this.isLastService);

        this.close();
        action$.onNext(action);
    }

    onSelectAll() {
        const { form } = this;
        const state = mapValues(form.nodesState(), () => true);
        form.nodesState(state);
    }

    onClearAll() {
        const { form } = this;
        const state = mapValues(form.nodesState(), () => false);
        form.nodesState(state);
    }

    onCancel() {
        this.close();
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: EditHostStorageDrivesModalViewModel,
    template: template
};
