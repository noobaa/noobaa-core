import ko from 'knockout';
import { openShowVideoModal } from 'action-creators';
import { action$ } from 'state';

export default class TopicRowViewModel {
    constructor() {
        this.title = ko.observable();
        this.subtitle = ko.observable();
        this.uri = ko.observable();
        this.icon = ko.observable();
        this.kind = ko.observable();
    }

    onTopic(topic) {
        const { title, subtitle, kind, uri } = topic;

        this.title(title);
        this.subtitle(subtitle);
        this.uri(uri);
        this.icon(kind.toLowerCase());
        this.kind(kind);
    }

    onSelect() {
        if(this.kind() != 'VIDEO') {
            window.open(this.uri(),'_newtab');
        } else {
            action$.onNext(openShowVideoModal(this.title(), this.uri()));
        }

    }
}
