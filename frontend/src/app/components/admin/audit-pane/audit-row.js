import Disposable from 'disposable';
import moment from 'moment';
import categories from './categories';

export default class AuditRowViewModel extends Disposable {
    constructor(entry) {
        super();

        let [ categoryName, eventName] = entry.event.split('.');
        let categoryInfo = categories[categoryName];
        let eventInfo = categoryInfo.events[eventName];

        this.date = moment(entry.time).format('DD MMM YYYY HH:mm:ss');
        this.category = categoryInfo.displayName;
        this.event = eventInfo.message;
        this.entity = eventInfo.entityId(entry);
        this.user = entry.actor && entry.actor.email;
        this.description = entry.desc || [];
    }
}
