import ko from 'knockout';
import { formatSize as format } from 'utils/size-utils';
import { isObject,  isUndefined } from 'utils/core-utils';

export default function formatSize(target) {
    return ko.pureComputed(
        () => {
            const value = target();
            if (isNaN(value) && (!isObject(value) || isUndefined(value.peta))) {
                return 'N/A';
            }

            return format(value);
        }
    );
}
