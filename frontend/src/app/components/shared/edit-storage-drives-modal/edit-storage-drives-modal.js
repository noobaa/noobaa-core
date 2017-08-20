/* Copyright (C) 2016 NooBaa */

import template from './edit-storage-drives-modal.html';
import Observer from 'observer';
import DriveNodeRowViewModel from './drive-node-row';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import { toggleHostServices, toggleHostNodes } from 'action-creators';
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

class EditStorageDrivesModalViewModel extends Observer {
    constructor({ host, onClose }) {
        super();

        this.host = ko.unwrap(host);
        this.close = onClose;
        this.columns = columns;
        this.rows = ko.observableArray();
        this.formReady = ko.observable(false);
        this.form = null;

        this.onToggleNode = this.onToggleNode.bind(this);

        this.observe(
            state$.getMany(
                ['hosts', 'items', this.host, 'services', 'storage'],
                ['forms', formName, 'fields']
            ),
            this.onHostStorageService
        );
    }

    onHostStorageService([ service, formFields ]) {
        if (!service) return;

        const nodesState = formFields ? formFields.nodesState.value : {};
        const rows = service.nodes
            .map((node, i) => {
                const row = this.rows()[i] || new DriveNodeRowViewModel({ onToggle: this.onToggleNode });
                row.onNode(node, Boolean(nodesState[node.name]));
                return row;
            });

        this.rows(rows);
        this.formReady(Boolean(formFields));

        // Initalize the form once.
        if (!this.formReady())  {
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    serviceState: service.enabled,
                    nodesState: keyByProperty(
                        service.nodes,
                        'name',
                        node => !disabledModes.includes(node.mode)
                    ),
                },
                onSubmit: this.onSubmit.bind(this)
            });
        }
    }

    onToggleNode(node, select) {
        const { nodesState } = this.form;
        nodesState({ ...nodesState(), [node]: select });
    }

    onSubmit({ serviceState, nodesState }) {
        const action = serviceState ?
            toggleHostNodes(this.host, nodesState) :
            toggleHostServices(this.host, { storage: false });

        action$.onNext(action);
        this.close();
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
    viewModel: EditStorageDrivesModalViewModel,
    template: template
};
