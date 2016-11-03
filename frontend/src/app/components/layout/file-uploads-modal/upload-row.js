import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze } from 'utils';

const stateMapping = deepFreeze({
    UPLOADED: 'success',
    FAILED: 'error'
});

export default class UploadRowViewModel extends Disposable {
    constructor(request) {
        super();

        this.fileName = ko.pureComputed(
            () => request() ? request().name : ''
        );

        this.bucketName = ko.pureComputed(
            () => request() ? request().targetBucket : ''
        );

        this.progress = ko.pureComputed(
            () => {
                if (!request()) {
                    return '';
                }

                let { state, progress, error } = request();
                let text = state === 'UPLOADING' ? numeral(progress).format('0%') : state;
                let tooltip = state === 'FAILED' ? error.message : '';
                let css = stateMapping[state];

                return { text, css, tooltip };
            }
        );
    }
}
