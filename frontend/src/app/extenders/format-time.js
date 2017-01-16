import ko from 'knockout';
import moment from 'moment-timezone';
import { isNumber, isString } from 'utils/core-utils';

const defaultFormat = 'DD MMM YYYY hh:mm:ss';

export default function formatTime(target, params) {
    return ko.pureComputed(
        () => {
            const naked = ko.deepUnwrap(params);
            const {
                format = isString(naked) ? naked : defaultFormat,
                timezone = ''
            } = naked;

            const value = target();
            if (!isNumber(value)) {
                return 'N/A';
            }

            const time = timezone ? moment.tz(value, timezone) : moment(value);
            return time.format(format);
        }
    );
}
