/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import moment from 'moment';
import { deepFreeze } from 'utils/core-utils';
import { sleep } from 'utils/promise-utils';
import { timeShortFormat } from 'config';

const updatingDelay = 500;
const severityIconMapping = deepFreeze({
    CRIT: 'problem',
    MAJOR: 'problem',
    INFO: 'notif-info'
});

export default class AlertRowViewModel {
    constructor() {
        this.id = ko.observable();
        this.text = ko.observable();
        this.css = ko.observable();
        this.time = ko.observable();
        this.icon = ko.observable();
        this.read = ko.observable();
        this.updating = ko.observable();

        this.markButton = ko.pureComputed(
            () => !this.read() && !this.updating()
        );
    }

    update({ id, alert, time, severity, read, updating }) {
        this.id(id);
        this.text(alert);
        this.time(moment(time).format(timeShortFormat));
        this.read(read);
        this.css(`${read ? 'read' : 'unread'} alert-${severity.toLowerCase()}`);
        this.icon(severityIconMapping[severity]);

        // Ensure that the visual updating indicator is visible for at least
        // a minimun (updatingDelay) amount of time.
        if (this.updating() && !updating) {
            sleep(updatingDelay, false).then(this.updating);
        } else {
            this.updating(updating);
        }
    }
}
