import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';

const helpIconsMapping = deepFreeze({
    ARTICLE: 'article',
    LINK: 'link',
    SLIDES: 'guide',
    VIDEO: 'video'
});

export default class TopicRowViewModel {
    constructor() {
        this.title = ko.observable();
        this.subtitle = ko.observable();
        this.uri = ko.observable();
        this.icon = ko.observable();
    }

    onTopic(topic) {
        const { title, subtitle, kind, uri } = topic;

        this.title(title);
        this.subtitle(subtitle);
        this.uri(uri);
        this.icon(helpIconsMapping[kind]);
    }
}
