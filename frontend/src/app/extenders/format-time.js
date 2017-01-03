import ko from 'knockout';
import moment from 'moment';

const defaultFormat = 'DD MMM YYYY hh:mm:ss';

export default function formatTime(target, format) {
    return ko.pureComputed(
        () => {
            if (format === true) {
                format = defaultFormat;
            }

            const value = target();
            return value == null || isNaN(value) ?
                'N/A' :
                moment(value).format(format);
        }
    );
}
