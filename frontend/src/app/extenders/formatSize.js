import ko from 'knockout';
import { formatSize } from 'utils';

export default function tweenExtender(target) {
    return ko.pureComputed(
        () => formatSize(target() || 0)
    );
}