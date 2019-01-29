/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import moment from 'moment';

const timeFormat = 'DD MMM YYYY HH:mm:ss.SSS';

function formatDeltaTime(dt) {
    const m = moment.duration(dt);
    return `[ +${
        String(m.hours()).padStart(2, '0')
    }:${
        String(m.minutes()).padStart(2, '0')
    }:${
        String(m.seconds()).padStart(2, '0')
    }.${
        String(m.milliseconds()).padStart(3, '0')
    } ]`;
}

export default class MessageRowViewModel {
    id = 0;
    timestamp = 0;
    css = ko.observable();
    action = ko.observable();
    time = ko.observable();

    onState(message, selected, prevRowTime) {
        const { id, action, state } = message;
        const time = `${
            moment(action.timestamp).format(timeFormat)
        } ${
            prevRowTime > -1 ? formatDeltaTime(action.timestamp - prevRowTime) : ''
        }`;

        const css = {
            error: Boolean(state.lastError),
            ['selected']: id === selected
        };

        this.id = id;
        this.css(css);
        this.action(action.type);
        this.time(time);
    }
}
