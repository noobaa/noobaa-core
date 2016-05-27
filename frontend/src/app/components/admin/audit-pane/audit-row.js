import moment from 'moment';
import categories from './categories';

export default class AuditRowViewModel {
    constructor(entry) {
        let [ categoryName, eventName] = entry.event.split('.');
        let categoryInfo = categories[categoryName];
        let eventInfo = categoryInfo.events[eventName];

        console.debug(entry.time);
        this.date = moment(entry.time).format('DD MMM YYYY HH:mm:ss');
        this.category = categoryInfo.displayName;
        this.event = eventInfo.message;
        this.entity = eventInfo.entityId(entry);
        this.level = entry.level;
        this.user = entry.actor && entry.actor.email;
    }
}
