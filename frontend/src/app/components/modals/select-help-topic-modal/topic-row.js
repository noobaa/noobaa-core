import ko from 'knockout';
import { action$ } from 'state';
import { openShowVideoModal, selectHelpTopic } from 'action-creators';

export default class TopicRowViewModel {
    constructor(onClose) {
        this.uri = ko.observable();
        this.title = ko.observable();
        this.subtitle = ko.observable();
        this.name = '';
        this.kind = '';
        this.icon = ko.observable();
        this.category = ko.observable();
        this.close = onClose;
    }

    onTopic(topic, category) {
        const { uri, kind, title, subtitle, name } = topic;
        this.uri(uri);
        this.title(title);
        this.subtitle(subtitle);
        this.category(category);
        this.name = name;
        this.kind = kind;
        this.icon(topic.kind.toLowerCase());
    }

    onSelect() {
        this.close();

        if (this.kind === 'LINK') {
            window.open(this.uri(),'_newtab');
        } else if (this.kind === 'VIDEO') {
            action$.onNext(openShowVideoModal(this.title(), this.uri()));
        } else {
            action$.onNext(selectHelpTopic(this.name));
        }
    }
}
