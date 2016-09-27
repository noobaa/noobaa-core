import ko from 'knockout';
import numeral from 'numeral';

export default function formatNumber(target, { format = '0,0' }) {
    return ko.pureComputed(
        () => numeral(target()).format(format || 0)
    );
}
