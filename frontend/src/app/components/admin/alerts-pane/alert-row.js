import ko from 'knockout';
import moment from 'moment';
import { deepFreeze } from 'utils/core-utils';
import { timeShortFormat } from 'config';

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
        this.markButton = ko.observable();
        this.loader = ko.observable();
    }

    update({ id, text, time, severity, read, updating }) {
        this.id(id);
        this.text(text);
        this.time(moment(time).format(timeShortFormat));
        this.css(`${read ? 'read' : 'unread'} ${severity.toLowerCase()}`);
        this.icon(severityIconMapping[severity]);
        this.markButton(!read && !updating);
        this.loader(updating);
    }
}
