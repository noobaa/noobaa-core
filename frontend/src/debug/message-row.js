/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import moment from 'moment';

const dateFormat = 'DD MMM YYYY HH:mm:ss.SSSS';

export default class MessageRowViewModel {
    timestamp = 0;
    css = ko.observable();
    action = ko.observable();
    time = ko.observable();

    onState(message, selected) {
        const { timestamp, action, state } = message;
        const time = moment(timestamp).format(dateFormat);
        const css = {
            error: Boolean(state.lastError),
            ['alt-bg']: timestamp === selected
        };

        this.timestamp = timestamp;
        this.css(css);
        this.action(action.type);
        this.time(time);
    }
}
