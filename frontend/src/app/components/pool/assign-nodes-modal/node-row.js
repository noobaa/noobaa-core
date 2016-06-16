import ko from 'knockout';
import { formatSize } from 'utils';

export default class NodeRowViewModel {
    constructor(node) {
        this.isVisible = ko.pureComputed(
            () => !!node()
        );

        this.name = ko.pureComputed(
            () => !!node() && node().name
        );

        this.ip = ko.pureComputed(
            () => !!node() && node().ip
        );

        this.capacity = ko.pureComputed(
            () => !!node() && (node().storage ? formatSize(node().storage.total) : 'N/A')
        );

        this.currPool = ko.pureComputed(
            () => !!node() && node().pool
        );
        this.suggestedPool = ko.pureComputed(
            () => !!node() && node().suggested_pool
        );

    }
}
