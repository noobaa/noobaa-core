import ko from 'knockout';
import numeral from 'numeral';
import { isNumber } from 'utils/all';

export default function formatNumber(target, { format = '0,0' }) {
    return ko.pureComputed(
        () => isNumber(target()) ? numeral(target()).format(format || 0) : ''
    );
}
