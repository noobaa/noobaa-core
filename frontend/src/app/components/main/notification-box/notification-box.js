/* Copyright (C) 2016 NooBaa */

import template from './notification-box.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { hideNotification } from 'action-creators';
import ko from 'knockout';
import { deepFreeze, isFalsy } from 'utils/core-utils';
import { sleep, all } from 'utils/promise-utils';
import { get } from 'rx-extensions';
import { notifications as config } from 'config';

const { minTimeOnScreen, charTimeContribution } = config;
const severityMapping = deepFreeze({
    info: {
        css: 'info',
        icon: 'notif-info'
    },
    success: {
        css: 'success',
        icon: 'notif-success'
    },
    warning: {
        css: 'warning',
        icon: 'problem'
    },
    error: {
        css: 'error',
        icon: 'problem'
    }
});

class NotificationBarViewModel extends Observer {
    constructor() {
        super();

        this.notifications = ko.observableArray();
        this.visible = ko.observable();
        this.hover = ko.observable();

        this.observe(
            state$.pipe(get('notifications', 'list', '0')),
            this.onNotification
        );
    }

    onNotification(notif) {
        if (!notif) {
            this.visible(false);
            return;
        }

        const current = this.notifications.get(0);
        if (!current || current.id < notif.id) {
            this._processNotification(notif);
            this.visible(true);
        }
    }

    onTransitionEnd() {
        if (!this.visible() || this.notifications().length > 1) {
            this.notifications.shift();
        }
    }

    async _processNotification({ id, severity, message }){
        this.notifications.push({
            ...severityMapping[severity],
            id: id,
            text: message
        });

        await all(
            sleep(minTimeOnScreen),
            sleep(charTimeContribution * message.length)
        );

        await this.hover.when(isFalsy);

        action$.next(hideNotification(id));
    }
}

export default {
    viewModel: NotificationBarViewModel,
    template: template
};

