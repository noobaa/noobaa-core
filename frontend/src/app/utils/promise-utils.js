export const all = Promise.all.bind(Promise);

export function execInOrder(list, executer) {
    let result = Promise.resolve();

    for (let i = 0; i < list.length; ++i) {
        result = result.then(
            res => res === true || executer(list[i], i)
        );
    }

    return result;
}

export function sleep(miliseconds, wakeValue) {
    return new Promise(
        resolve => setTimeout(
            () => resolve(wakeValue),
            miliseconds
        )
    );
}

