import ko from 'knockout';

// Used to dispose an handle that contain a dispose method.
function dispose(handle) {
    handle.dispose();
}

export default class BaseViewModel {
    constructor() {
        // Define a non enumrable read only property to hold the dispose list.
        Object.defineProperty(this, 'disposeList', { value: [] });
    }

    addToDisposeList(subject, disposer = dispose) {
        this.disposeList.push(
            () => disposer(subject)
        );
    }

    dispose() {
        // THIS CODE CREATE A SECONDARY BUG WHERE THING GOT DISPOSED WITH NO REASON
        // COMMENTING THIS COUNT OUT AND ALLOWING VALIDATORS CODE LEAK AGAIN

        // Used to clean up subscriptions created by knockout validation extenders.
        // for (const value of Object.values(this)) {
        //     if (ko.isObservable(value) && value.isValid) {
        //         value.extend({
        //             validatable: false
        //         });
        //     }
        // }

        this.disposeList.forEach(
            disposer => disposer()
        );
    }
}
