import template from './notification-bar.html';
import ko from 'knockout';
import { lastNotification } from 'model';
import { notificationInterval } from 'config';

const severityMapping = Object.freeze({
    'INFO':     { css: 'info',      icon: '/fe/assets/icons.svg#notif-info' },
    'SUCCESS':  { css: 'success',   icon: '/fe/assets/icons.svg#notif-success' },
    'WARNING':  { css: 'warning',   icon: '/fe/assets/icons.svg#notif-warning' },
    'ERROR':    { css: 'error',     icon: '/fe/assets/icons.svg#notif-error' },
});

class NotificationBarViewModel {
    constructor() {
        this.notifications = ko.observableArray();
        this.visible = ko.observable(false);

        lastNotification.subscribe(
            ({ message, severity }) => {
                let { css, icon } = severityMapping[severity];
                this.notifications.push({ icon, message, css });
                this.visible(true);

                setTimeout(
                    () => {
                        if (this.notifications().length > 1) {
                            this.notifications.shift();
                        } else {
                            this.visible(false);
                        }
                    },
                    notificationInterval
                );
            }
        );
    }

    removeLastNotification(_, evt) {
        !this.visible() && this.notifications.shift();
    }
}

export default {
    viewModel: NotificationBarViewModel,
    template: template
}