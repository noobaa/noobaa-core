import { formatSize } from 'utils';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';

const timeFormat = 'DD MMM YYYY hh:mm:ss';

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
            () => obj() ? moment(obj().create_time).format(timeFormat) : ''
        );

        this.size = ko.pureComputed(
            () => obj() ? formatSize(obj().size) : ''
        );
    }
}
