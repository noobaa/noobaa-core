import ko from 'knockout';
import { formatSize as format } from 'utils';

export default function formatSize(target) {
    return ko.pureComputed(
        () => {
            let value = target();
            return value == null || isNaN(value) ? 'N/A' : format(value);
        }
    );
}
