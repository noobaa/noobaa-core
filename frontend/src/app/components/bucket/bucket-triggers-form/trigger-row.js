/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import moment from 'moment';
import { deepFreeze } from 'utils/core-utils';
import { bucketEvents } from 'utils/bucket-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';

const modeToStatus = deepFreeze({
    DISABLED: {
        name: 'healthy',
        css: 'disabled',
        tooltip: 'Disabled'
    },
    MISSING_PERMISSIONS: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Access issue'
    },
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

function _getLastRunText(trigger) {
    const { lastRun } = trigger;
    return lastRun ? moment(lastRun).fromNow() : '(never run)';
}

export default class TriggerRowViewModel {
    state = ko.observable();
    funcName = ko.observable();
    event = ko.observable();
    prefix = ko.observable();
    suffix = ko.observable();
    lastRun = ko.observable();
    triggerId = ko.observable();
    edit = {
        id: this.triggerId,
        icon: 'edit',
        tooltip: 'Edit Trigger'
    };
    delete = {
        text: 'Delete trigger',
        disabled: false,
        active: ko.observable(),
        id: this.triggerId
    };

    constructor({ onEdit, onSelectForDelete, onDelete }) {
        this.edit.onClick = onEdit;
        this.delete.onDelete = onDelete;
        this.delete.onToggle = onSelectForDelete;
    }

    onState(trigger, system, selectedForDelete) {
        const event = bucketEvents
            .find(event => event.value === trigger.event)
            .label;

        const func = trigger.func.name;
        const funcName = {
            text: func,
            href: realizeUri(routes.func, { system, func })
        };

        this.state(modeToStatus[trigger.mode]);
        this.funcName(funcName);
        this.event(event);
        this.prefix(trigger.prefix || '(not set)');
        this.suffix(trigger.suffix || '(not set)');
        this.lastRun(_getLastRunText(trigger));
        this.triggerId(trigger.id);
        this.delete.active(selectedForDelete === trigger.id);
    }
}
