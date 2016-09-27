import Disposable from 'disposable';
import ko from 'knockout';

export default class ObjectRowViewModel extends Disposable {
    constructor(obj) {
        super();

        this.name = ko.pureComputed(
            () => {
                if(!obj()) {
                    return '';
                }

                let href = {
                    route: 'object',
                    params: {
                        object: obj().key,
                        tab: null
                    }
                };

                return {
                    text: obj().key,
                    href: href
                };
            }
        );

        this.creationTime = ko.pureComputed(
            () => obj() && obj().create_time
        ).extend({
            formatTime: true
        });

        this.size = ko.pureComputed(
            () => obj() && obj().size
        ).extend({
            formatSize: true
        });
    }
}
