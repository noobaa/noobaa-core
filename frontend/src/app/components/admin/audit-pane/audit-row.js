import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import categories from './categories';

export default class AuditRowViewModel extends BaseViewModel {
    constructor(entry, selectedRow) {
        super();

        let categoryInfo = ko.pureComputed(
            () => {
                if (!entry()) {
                    return;
                }

                let [ category] = entry().event.split('.');
                return categories[category];
            }
        );

        let eventInfo = ko.pureComputed(
            () => {
                if (!entry()) {
                    return;
                }

                let [ category, event ] = entry().event.split('.');
                return categories[category].events[event];
            }
        );

        this.time = ko.pureComputed(
            () => entry() ? entry().time : ''
        ).extend({
            formatTime: true
        });

        this.account = ko.pureComputed(
            () => entry() && entry().actor ? entry().actor.email : '---'
        );

        this.category = ko.pureComputed(
            () => categoryInfo() ? categoryInfo().displayName : ''
        );

        this.event = ko.pureComputed(
            () => eventInfo() ? eventInfo().message : ''
        );

        this.entity = ko.pureComputed(
            () => eventInfo() ? eventInfo().entityId(entry()) : ''
        );

        this.description = ko.pureComputed(
            () => entry() ? entry().desc : []
        );

        this.selectedCss = ko.pureComputed(
            () => selectedRow() === this ? 'selected' : ''
        );
    }
}
