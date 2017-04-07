import template from './notification-box.html';
import Observer from 'observer';
import state$ from 'state';
import { hideNotification } from 'dispatchers';
import ko from 'knockout';
import { deepFreeze, isFalsy } from 'utils/core-utils';
import { sleep, all } from 'utils/promise-utils';
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

        this.observe(state$.get('notifications', 'list', '0'), this.onState);
    }

    onState(notif) {
        if (!notif) {
            this.visible(false);
            return;
        }

        const displayed = this.notifications.get(0);
        if (!displayed || displayed.id < notif.id) {
            const notifVM = {
                ...severityMapping[notif.severity],
                id: notif.id,
                text: notif.message
            };

            this.notifications.push(notifVM);
            this._digestNotification(notifVM);
            this.visible(true);
        }
    }

    onTransitionEnd() {
        if (!this.visible() || this.notifications().length > 1) {
            this.notifications.shift();
        }
    }

    async _digestNotification(notifVM){
        await all(
            sleep(minTimeOnScreen),
            sleep(charTimeContribution * notifVM.text.length)
        );
        await this.hover.when(isFalsy);
        hideNotification(notifVM.id);
    }
}

export default {
    viewModel: NotificationBarViewModel,
    template: template
};

