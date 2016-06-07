import ko from 'knockout';
import { noop } from 'utils';

export default {
    init: function(element, valueAccessor) {
        let value = valueAccessor();

        let pos = ko.unwrap(value);
        if (typeof pos === 'number') {
            let { scrollHeight, offsetHeight } = element;
            element.scrollTop = (scrollHeight - offsetHeight) * pos;
        }

        if (!ko.isWritableObservable(value)) {
            value = noop;
        }

        ko.utils.registerEventHandler(
            element,
            'scroll',
            () => {
                let { scrollTop, scrollHeight, offsetHeight } = element;
                let pos = scrollTop / (scrollHeight - offsetHeight);
                value(pos);
            }
        );
    }
};
