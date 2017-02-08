import ko from 'knockout';
import moment from 'moment-timezone';
import { isNumber, isString } from 'utils/core-utils';
import { timeShortFormat as defaultFormat } from 'config';

export default function formatTime(target, params) {
    return ko.pureComputed(
        () => {
            const naked = ko.deepUnwrap(params);
            const {
                format = isString(naked) ? naked : defaultFormat,
                timezone = '',
                notAvailableText  = 'N/A'
            } = naked;

            const value = target();
            if (!isNumber(value)) {
                return notAvailableText;
            }

            const time = timezone ? moment.tz(value, timezone) : moment(value);
            return time.format(format);
        }
    );
}
