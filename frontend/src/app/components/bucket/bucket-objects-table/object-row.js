import { formatSize } from 'utils';
import Disposable from 'disposable';
import ko from 'knockout';

export default class ObjectRowViewModel extends Disposable {
    constructor(obj) {
        super();

        // BE dosent send any information about object availablity,
        // assuming the object is avaliable.
        this.state = 'object-available';

        this.name = ko.pureComputed(
            () => {
                if(!obj()) {
                    return '';
                }

                return {
                    text: obj().key,
                    href: {
                        route: 'object',
                        params: {
                            object: obj().key,
                            tab: null
                        }
                    }
                };
            }
        );

        this.size = ko.pureComputed(
            () => obj() ? formatSize(obj().size) : ''
        );
    }
}
