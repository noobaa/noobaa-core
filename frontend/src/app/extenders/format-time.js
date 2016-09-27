import ko from 'knockout';
import moment from 'moment';

const timeFormat = 'DD MMM YYYY hh:mm:ss';

export default function formatSize(target) {
    return ko.pureComputed(
        () => {
            let value = target();
            return value == null || isNaN(value) ? 'N/A' : moment(value).format(timeFormat);
        }
    );
}
