import template from './notification-bar.html';
import ko from 'knockout';
// import { lastNotification } from 'model';
// import { notificationInterval } from 'config';

const severityMapping = Object.freeze({
    INFO:     { css: 'info',      icon: 'notif-info' },
    SUCCESS:  { css: 'success',   icon: 'notif-success' },
    WARNING:  { css: 'warning',   icon: 'notif-warning' },
    ERROR:    { css: 'error',     icon: 'notif-error' }
});

class NotificationBarViewModel {
    constructor() {
    //     this.notifications = ko.observableArray();
    //     this.visible = ko.observable(false);

    //     lastNotification.subscribe(
    //         ({ message, severity }) => {
    //             let { css, icon } = severityMapping[severity];
    //             this.notifications.push({ icon, message, css });
    //             this.visible(true);

    //             setTimeout(
    //                 () => {
    //                     if (this.notifications().length > 1) {
    //                         this.notifications.shift();
    //                     } else {
    //                         this.visible(false);
    //                     }
    //                 },
    //                 notificationInterval
    //             );
    //         }
    //     );
    // }

    // removeLastNotification() {
    //     !this.visible() && this.notifications.shift();
    }
}

export default {
    viewModel: NotificationBarViewModel,
    template: template
};
